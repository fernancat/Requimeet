import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import type { ProcessingResult } from '@requimeet/contracts';
import { AppModule } from '../../app.module';
import { AuthService } from '../identity/auth.service';
import { MeetingsService } from '../meetings/meetings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { cleanDb, TEST_DATABASE_URL } from '../../test-utils/test-db';

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.LIVEKIT_API_KEY = 'devkey';
process.env.LIVEKIT_API_SECRET = 'secret';
process.env.INTERNAL_SHARED_SECRET = 'test-internal-secret';

const SECRET = 'test-internal-secret';

describe('InternalProcessingController (integracion)', () => {
  let app: INestApplication;
  let port: number;
  let prisma: PrismaService;
  let auth: AuthService;
  let meetings: MeetingsService;
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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    clients = [];
    await cleanDb(prisma);
  });

  afterEach(() => {
    for (const client of clients) client.disconnect();
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

  function emitAck(socket: Socket, event: string, payload: unknown): Promise<{ ok: boolean }> {
    return new Promise((resolve) => socket.emit(event, payload, resolve));
  }

  function postResult(body: unknown, secret = SECRET) {
    return fetch(`http://127.0.0.1:${port}/api/internal/processing/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify(body),
    });
  }

  function demoResult(meetingId: string): ProcessingResult {
    return {
      resultId: 'r1',
      meetingId,
      participantId: 'p1',
      kind: 'demo',
      isFinal: false,
      createdAtMs: Date.now(),
      payload: { audioFrames: 42 },
    };
  }

  it('secreto invalido -> 401', async () => {
    const res = await postResult(demoResult('m-x'), 'secreto-malo');
    expect(res.status).toBe(401);
  });

  it('resultado valido se retransmite como processing:result a la reunion', async () => {
    const { user, accessToken } = await auth.register({
      email: `p-${Date.now()}@example.com`,
      password: 'password123',
      displayName: 'Host P',
    });
    const meeting = await meetings.create(user.id, { title: 'P' });
    await meetings.start(user.id, meeting.code);

    const host = await connect(accessToken);
    await emitAck(host, 'meeting:subscribe', { code: meeting.code });
    const resultPromise = new Promise((resolve) =>
      host.once('processing:result', resolve),
    );

    const res = await postResult(demoResult(meeting.id));
    expect(res.status).toBe(201);
    const received = (await resultPromise) as ProcessingResult;
    expect(received).toMatchObject({
      resultId: 'r1',
      meetingId: meeting.id,
      kind: 'demo',
      payload: { audioFrames: 42 },
    });
  });

  it('meetingId desconocido -> 200 descartado; shape invalido -> received:false', async () => {
    const unknown = await postResult(demoResult('no-existe'));
    expect(unknown.status).toBe(201);
    expect(await unknown.json()).toMatchObject({ received: true, discarded: true });

    const invalid = await postResult({ hello: 'world' });
    expect(await invalid.json()).toMatchObject({ received: false });
  });
});
