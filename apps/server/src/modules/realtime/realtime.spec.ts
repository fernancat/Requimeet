import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../app.module';
import { AuthService } from '../identity/auth.service';
import { GuestTokenService } from '../identity/guest-token.service';
import { MeetingParticipantsService } from '../meetings/meeting-participants.service';
import { MeetingsService } from '../meetings/meetings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { cleanDb, TEST_DATABASE_URL } from '../../test-utils/test-db';
import { ChatRateLimiter } from './chat-rate-limiter';

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.LIVEKIT_API_KEY = 'devkey';
process.env.LIVEKIT_API_SECRET = 'secret';

interface Ack {
  ok: boolean;
  role?: string;
  error?: string;
  clientRef?: string;
  message?: { id: string };
  pendingRequests?: unknown[];
}

describe('RealtimeGateway (integracion)', () => {
  let app: INestApplication;
  let port: number;
  let prisma: PrismaService;
  let auth: AuthService;
  let meetings: MeetingsService;
  let participantsSvc: MeetingParticipantsService;
  let guestTokens: GuestTokenService;
  let rateLimiter: ChatRateLimiter;
  let clients: Socket[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    meetings = app.get(MeetingsService);
    participantsSvc = app.get(MeetingParticipantsService);
    guestTokens = app.get(GuestTokenService);
    rateLimiter = app.get(ChatRateLimiter);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    clients = [];
    await cleanDb(prisma);
    rateLimiter.reset();
  });

  afterEach(() => {
    for (const client of clients) {
      client.disconnect();
    }
  });

  function connect(token: string): Promise<Socket> {
    const socket = io(`http://127.0.0.1:${port}`, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
    });
    clients.push(socket);
    return new Promise((resolve, reject) => {
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });
  }

  function emitAck(socket: Socket, event: string, payload: unknown): Promise<Ack> {
    return new Promise((resolve) => socket.emit(event, payload, resolve));
  }

  function once<T = unknown>(socket: Socket, event: string, ms = 2000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout esperando ${event}`)), ms);
      socket.once(event, (data: T) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  function collect(socket: Socket, event: string): unknown[] {
    const received: unknown[] = [];
    socket.on(event, (data) => received.push(data));
    return received;
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const ref = () => `ref-${Math.random().toString(36).slice(2, 12)}`;

  async function setupMeeting() {
    const { user, accessToken } = await auth.register({
      email: `h-${Date.now()}@example.com`,
      password: 'password123',
      displayName: 'Host RT',
    });
    const meeting = await meetings.create(user.id, { title: 'RT' });
    await meetings.start(user.id, meeting.code);
    return { hostId: user.id, hostToken: accessToken, code: meeting.code };
  }

  async function setupGuest(code: string, name = 'Guest RT') {
    const join = await meetings.createJoinRequest(code, { displayName: name }, null);
    return { join, guestToken: join.guestToken };
  }

  it('handshake con token invalido desconecta', async () => {
    const socket = io(`http://127.0.0.1:${port}`, {
      auth: { token: 'basura' },
      transports: ['websocket'],
      forceNew: true,
    });
    clients.push(socket);
    await once(socket, 'disconnect');
  });

  it('guest pending subscribe -> waiting; no recibe chat ni participants de la sala', async () => {
    const { hostToken, code } = await setupMeeting();
    const { guestToken } = await setupGuest(code);

    const hostSocket = await connect(hostToken);
    expect((await emitAck(hostSocket, 'meeting:subscribe', { code })).role).toBe('host');

    const guestSocket = await connect(guestToken);
    const ack = await emitAck(guestSocket, 'meeting:subscribe', { code });
    expect(ack).toMatchObject({ ok: true, role: 'waiting' });

    const guestChat = collect(guestSocket, 'chat:message');
    const guestParticipants = collect(guestSocket, 'participants:list');
    const hostChat = collect(hostSocket, 'chat:message');

    const sendAck = await emitAck(hostSocket, 'chat:send', {
      body: 'hola sala',
      clientRef: ref(),
    });
    expect(sendAck.ok).toBe(true);
    await sleep(400);

    expect(hostChat).toHaveLength(1);
    expect(guestChat).toHaveLength(0);
    expect(guestParticipants).toHaveLength(0);
  });

  it('guest admitted subscribe -> participant y recibe participants:list', async () => {
    const { hostId, code } = await setupMeeting();
    const { join, guestToken } = await setupGuest(code);
    await meetings.decideJoinRequest(hostId, code, join.request.id, 'accepted');

    const guestSocket = await connect(guestToken);
    const participantsPromise = once(guestSocket, 'participants:list');
    const ack = await emitAck(guestSocket, 'meeting:subscribe', { code });
    expect(ack).toMatchObject({ ok: true, role: 'participant' });
    const payload = (await participantsPromise) as { participants: { role: string }[] };
    expect(payload.participants.length).toBeGreaterThanOrEqual(2);
  });

  it('chat:send persiste, broadcast a la sala y deduplica por clientRef', async () => {
    const { hostId, hostToken, code } = await setupMeeting();
    const { join, guestToken } = await setupGuest(code);
    await meetings.decideJoinRequest(hostId, code, join.request.id, 'accepted');

    const hostSocket = await connect(hostToken);
    await emitAck(hostSocket, 'meeting:subscribe', { code });
    const guestSocket = await connect(guestToken);
    await emitAck(guestSocket, 'meeting:subscribe', { code });
    const hostChat = collect(hostSocket, 'chat:message');

    const clientRef = ref();
    const first = await emitAck(guestSocket, 'chat:send', { body: 'mensaje unico', clientRef });
    expect(first.ok).toBe(true);
    const second = await emitAck(guestSocket, 'chat:send', { body: 'mensaje unico', clientRef });
    expect(second.ok).toBe(true);
    expect(second.message?.id).toBe(first.message?.id);

    const meeting = await prisma.meeting.findUniqueOrThrow({ where: { code } });
    const count = await prisma.chatMessage.count({ where: { meetingId: meeting.id } });
    expect(count).toBe(1);
    await sleep(300);
    expect(hostChat).toHaveLength(1);
  });

  it('body vacio o de 2100 chars da ack error', async () => {
    const { hostToken, code } = await setupMeeting();
    const hostSocket = await connect(hostToken);
    await emitAck(hostSocket, 'meeting:subscribe', { code });

    const empty = await emitAck(hostSocket, 'chat:send', { body: '   ', clientRef: ref() });
    expect(empty.ok).toBe(false);
    const huge = await emitAck(hostSocket, 'chat:send', {
      body: 'x'.repeat(2100),
      clientRef: ref(),
    });
    expect(huge.ok).toBe(false);
  });

  it('kick: el expulsado recibe meeting:kicked y deja de recibir chat', async () => {
    const { hostId, hostToken, code } = await setupMeeting();
    const { join, guestToken } = await setupGuest(code);
    await meetings.decideJoinRequest(hostId, code, join.request.id, 'accepted');

    const hostSocket = await connect(hostToken);
    await emitAck(hostSocket, 'meeting:subscribe', { code });
    const guestSocket = await connect(guestToken);
    await emitAck(guestSocket, 'meeting:subscribe', { code });
    const guestChat = collect(guestSocket, 'chat:message');

    const guestSessionId = guestTokens.verify(guestToken, code).sub;
    const meeting = await prisma.meeting.findUniqueOrThrow({ where: { code } });
    const participant = await prisma.participant.findFirstOrThrow({
      where: { meetingId: meeting.id, guestSessionId },
    });

    const kickedPromise = once(guestSocket, 'meeting:kicked');
    await participantsSvc.kick(hostId, code, participant.id);
    const kickedPayload = (await kickedPromise) as { participantId: string };
    expect(kickedPayload.participantId).toBe(participant.id);

    await emitAck(hostSocket, 'chat:send', { body: 'ya no te leo', clientRef: ref() });
    await sleep(400);
    expect(guestChat).toHaveLength(0);
  });

  it('meeting.ended llega a admitted y waiting', async () => {
    const { hostId, hostToken, code } = await setupMeeting();
    const admitted = await setupGuest(code, 'Admitido');
    const waiting = await setupGuest(code, 'Esperando');
    await meetings.decideJoinRequest(hostId, code, admitted.join.request.id, 'accepted');

    const hostSocket = await connect(hostToken);
    await emitAck(hostSocket, 'meeting:subscribe', { code });
    const admittedSocket = await connect(admitted.guestToken);
    await emitAck(admittedSocket, 'meeting:subscribe', { code });
    const waitingSocket = await connect(waiting.guestToken);
    await emitAck(waitingSocket, 'meeting:subscribe', { code });

    const ends = [
      once(hostSocket, 'meeting:ended'),
      once(admittedSocket, 'meeting:ended'),
      once(waitingSocket, 'meeting:ended'),
    ];
    await meetings.end(hostId, code);
    const results = await Promise.all(ends);
    for (const payload of results) {
      expect(payload).toMatchObject({ code, status: 'ended' });
    }
  });

  it('rate limit: 6 mensajes rapidos -> el sexto es rate-limited', async () => {
    const { hostToken, code } = await setupMeeting();
    const hostSocket = await connect(hostToken);
    await emitAck(hostSocket, 'meeting:subscribe', { code });

    const acks: Ack[] = [];
    for (let i = 0; i < 6; i++) {
      acks.push(await emitAck(hostSocket, 'chat:send', { body: `m${i}`, clientRef: ref() }));
    }
    expect(acks.slice(0, 5).every((a) => a.ok)).toBe(true);
    expect(acks[5]).toMatchObject({ ok: false, error: 'rate-limited' });
  });

  it('waiting recibe meeting:admitted y al re-suscribirse pasa a participant', async () => {
    const { hostId, code } = await setupMeeting();
    const { join, guestToken } = await setupGuest(code);

    const guestSocket = await connect(guestToken);
    expect((await emitAck(guestSocket, 'meeting:subscribe', { code })).role).toBe('waiting');

    const admittedPromise = once(guestSocket, 'meeting:admitted');
    await meetings.decideJoinRequest(hostId, code, join.request.id, 'accepted');
    await admittedPromise;

    const ack = await emitAck(guestSocket, 'meeting:subscribe', { code });
    expect(ack).toMatchObject({ ok: true, role: 'participant' });
  });

  it('GET /messages: pending -> 403, admitted -> historial', async () => {
    const { hostId, hostToken, code } = await setupMeeting();
    const pending = await setupGuest(code, 'Pendiente');
    const admitted = await setupGuest(code, 'Admitido');
    await meetings.decideJoinRequest(hostId, code, admitted.join.request.id, 'accepted');

    const hostSocket = await connect(hostToken);
    await emitAck(hostSocket, 'meeting:subscribe', { code });
    await emitAck(hostSocket, 'chat:send', { body: 'historial previo', clientRef: ref() });

    const base = `http://127.0.0.1:${port}/api/meetings/${code}/messages`;
    const denied = await fetch(base, {
      headers: { Authorization: `Bearer ${pending.guestToken}` },
    });
    expect(denied.status).toBe(403);

    const ok = await fetch(base, {
      headers: { Authorization: `Bearer ${admitted.guestToken}` },
    });
    expect(ok.status).toBe(200);
    const history = (await ok.json()) as { body: string }[];
    expect(history.map((m) => m.body)).toContain('historial previo');
  });
});
