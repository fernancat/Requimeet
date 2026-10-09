import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as jwt from 'jsonwebtoken';
import { GuestTokenService } from '../identity/guest-token.service';
import { LivekitEventsListener } from '../livekit/livekit-events.listener';
import { LivekitRoomService } from '../livekit/livekit-room.service';
import { LivekitTokenService } from '../livekit/livekit-token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { cleanDb, TEST_DATABASE_URL } from '../../test-utils/test-db';
import { Caller, MeetingParticipantsService } from './meeting-participants.service';
import { MeetingsService } from './meetings.service';

const LK_SECRET = 'test-livekit-secret';

describe('MeetingParticipantsService (integracion)', () => {
  let prisma: PrismaService;
  let meetings: MeetingsService;
  let participants: MeetingParticipantsService;
  let events: EventEmitter2;
  let emitSpy: jest.SpyInstance;
  let rooms: jest.Mocked<LivekitRoomService>;
  let guestTokens: GuestTokenService;

  beforeAll(async () => {
    prisma = new PrismaService({
      datasources: { db: { url: TEST_DATABASE_URL } },
    });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb(prisma);
    const config = new ConfigService({
      GUEST_TOKEN_SECRET: 'test-guest-secret',
      LIVEKIT_URL: 'ws://localhost:7880',
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: LK_SECRET,
      LIVEKIT_TOKEN_TTL: '5m',
    });
    guestTokens = new GuestTokenService(config);
    events = new EventEmitter2();
    emitSpy = jest.spyOn(events, 'emit');
    rooms = {
      removeParticipant: jest.fn().mockResolvedValue(undefined),
      muteMicrophone: jest.fn().mockResolvedValue({ muted: false, reason: 'no-mic-track' }),
      deleteRoom: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<LivekitRoomService>;
    const tokens = new LivekitTokenService(config);
    meetings = new MeetingsService(prisma, guestTokens, events);
    participants = new MeetingParticipantsService(prisma, tokens, rooms, events);
  });

  async function hostCaller() {
    const host = await prisma.hostUser.create({
      data: { email: 'host@example.com', passwordHash: 'x', displayName: 'Host' },
    });
    const caller: Caller = { kind: 'host', hostUserId: host.id };
    return { host, caller };
  }

  async function activeMeetingWithGuest() {
    const { host, caller } = await hostCaller();
    const created = await meetings.create(host.id, { title: 'T' });
    await meetings.start(host.id, created.code);
    const join = await meetings.createJoinRequest(created.code, { displayName: 'G' }, null);
    const guestSessionId = guestTokens.verify(join.guestToken, created.code).sub;
    const guestCaller: Caller = { kind: 'guest', guestSessionId };
    return { host, caller, created, join, guestSessionId, guestCaller };
  }

  it('guest pending no recibe media-token (403)', async () => {
    const { created, guestCaller } = await activeMeetingWithGuest();

    await expect(
      participants.createMediaToken(guestCaller, created.code),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('guest admitted recibe token con identity = participant.id', async () => {
    const { host, created, join, guestCaller, guestSessionId } =
      await activeMeetingWithGuest();
    await meetings.decideJoinRequest(host.id, created.code, join.request.id, 'accepted');

    const result = await participants.createMediaToken(guestCaller, created.code);

    const participant = await prisma.participant.findFirstOrThrow({
      where: { meetingId: created.id, guestSessionId },
    });
    const decoded = jwt.verify(result.token, LK_SECRET) as jwt.JwtPayload;
    expect(decoded.sub).toBe(participant.id);
    expect((decoded.video as Record<string, unknown>).room).toBe(created.code);
    expect(result.expiresInSec).toBe(300);
  });

  it('host admitted recibe token', async () => {
    const { caller, created } = await activeMeetingWithGuest();

    const result = await participants.createMediaToken(caller, created.code);

    const hostParticipant = await prisma.participant.findFirstOrThrow({
      where: { meetingId: created.id, role: 'host' },
    });
    const decoded = jwt.verify(result.token, LK_SECRET) as jwt.JwtPayload;
    expect(decoded.sub).toBe(hostParticipant.id);
  });

  it('meeting ended da 409 en media-token', async () => {
    const { host, caller, created } = await activeMeetingWithGuest();
    await meetings.end(host.id, created.code);

    await expect(
      participants.createMediaToken(caller, created.code),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('kick marca kicked, llama removeParticipant y media-token pasa a 403', async () => {
    const { host, created, join, guestCaller, guestSessionId } =
      await activeMeetingWithGuest();
    await meetings.decideJoinRequest(host.id, created.code, join.request.id, 'accepted');
    const participant = await prisma.participant.findFirstOrThrow({
      where: { meetingId: created.id, guestSessionId },
    });

    const kicked = await participants.kick(host.id, created.code, participant.id);

    expect(kicked.state).toBe('kicked');
    expect(rooms.removeParticipant).toHaveBeenCalledWith(created.code, participant.id);
    expect(emitSpy).toHaveBeenCalledWith(
      'meeting.participant-kicked',
      expect.objectContaining({ participantId: participant.id }),
    );
    await expect(
      participants.createMediaToken(guestCaller, created.code),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('kick al host da 403', async () => {
    const { host, created } = await activeMeetingWithGuest();
    const hostParticipant = await prisma.participant.findFirstOrThrow({
      where: { meetingId: created.id, role: 'host' },
    });

    await expect(
      participants.kick(host.id, created.code, hostParticipant.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rooms.removeParticipant).not.toHaveBeenCalled();
  });

  it('mute sin track de micro devuelve {muted:false}', async () => {
    const { host, created, join, guestSessionId } = await activeMeetingWithGuest();
    await meetings.decideJoinRequest(host.id, created.code, join.request.id, 'accepted');
    const participant = await prisma.participant.findFirstOrThrow({
      where: { meetingId: created.id, guestSessionId },
    });

    const result = await participants.mute(host.id, created.code, participant.id);

    expect(result).toEqual({ muted: false, reason: 'no-mic-track' });
    expect(rooms.muteMicrophone).toHaveBeenCalledWith(created.code, participant.id);
    expect(emitSpy).not.toHaveBeenCalledWith(
      'meeting.participant-muted',
      expect.anything(),
    );
  });

  it('mute exitoso emite meeting.participant-muted', async () => {
    const { host, created, join, guestSessionId } = await activeMeetingWithGuest();
    await meetings.decideJoinRequest(host.id, created.code, join.request.id, 'accepted');
    const participant = await prisma.participant.findFirstOrThrow({
      where: { meetingId: created.id, guestSessionId },
    });
    rooms.muteMicrophone.mockResolvedValue({ muted: true });

    const result = await participants.mute(host.id, created.code, participant.id);

    expect(result).toEqual({ muted: true });
    expect(emitSpy).toHaveBeenCalledWith(
      'meeting.participant-muted',
      expect.objectContaining({ participantId: participant.id }),
    );
  });

  it('meeting.ended dispara deleteRoom via listener', async () => {
    const listener = new LivekitEventsListener(rooms);

    await listener.onMeetingEnded({
      meetingId: 'm1',
      code: 'ABCDE23456',
      hostId: 'h1',
      status: 'ended',
    });

    expect(rooms.deleteRoom).toHaveBeenCalledWith('ABCDE23456');
  });
});
