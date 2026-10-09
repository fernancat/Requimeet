import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GuestTokenService } from '../identity/guest-token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { cleanDb, TEST_DATABASE_URL } from '../../test-utils/test-db';
import { MeetingsService } from './meetings.service';

describe('MeetingsService (integracion)', () => {
  let prisma: PrismaService;
  let service: MeetingsService;
  let guestTokens: GuestTokenService;
  let events: EventEmitter2;
  let emitSpy: jest.SpyInstance;

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
    guestTokens = new GuestTokenService(
      new ConfigService({ GUEST_TOKEN_SECRET: 'test-guest-secret' }),
    );
    events = new EventEmitter2();
    emitSpy = jest.spyOn(events, 'emit');
    service = new MeetingsService(prisma, guestTokens, events);
  });

  async function createHost(email = 'host@example.com') {
    return prisma.hostUser.create({
      data: { email, passwordHash: 'x', displayName: 'Host' },
    });
  }

  async function activeMeeting(hostId: string) {
    const created = await service.create(hostId, { title: 'Planning' });
    await service.start(hostId, created.code);
    return created;
  }

  it('ciclo crear/iniciar/finalizar', async () => {
    const host = await createHost();

    const created = await service.create(host.id, { title: 'Planning' });
    expect(created.status).toBe('created');
    expect(created.code).toHaveLength(10);
    expect(created.url).toBe(`/m/${created.code}`);

    const started = await service.start(host.id, created.code);
    expect(started.status).toBe('active');
    expect(started.startedAt).toBeTruthy();
    expect(emitSpy).toHaveBeenCalledWith(
      'meeting.started',
      expect.objectContaining({ code: created.code }),
    );

    const hostParticipant = await prisma.participant.findFirst({
      where: { meetingId: created.id, hostUserId: host.id },
    });
    expect(hostParticipant).not.toBeNull();
    expect(hostParticipant?.role).toBe('host');

    const ended = await service.end(host.id, created.code);
    expect(ended.status).toBe('ended');
    expect(ended.endedAt).toBeTruthy();
    expect(emitSpy).toHaveBeenCalledWith(
      'meeting.ended',
      expect.objectContaining({ code: created.code }),
    );
  });

  it('iniciar dos veces es idempotente y no duplica participant', async () => {
    const host = await createHost();
    const created = await service.create(host.id, { title: 'T' });

    await service.start(host.id, created.code);
    const again = await service.start(host.id, created.code);

    expect(again.status).toBe('active');
    const count = await prisma.participant.count({
      where: { meetingId: created.id, hostUserId: host.id },
    });
    expect(count).toBe(1);
    expect(
      emitSpy.mock.calls.filter(([name]) => name === 'meeting.started'),
    ).toHaveLength(1);
  });

  it('start sobre reunion ended da 409', async () => {
    const host = await createHost();
    const created = await service.create(host.id, { title: 'T' });
    await service.end(host.id, created.code);

    await expect(service.start(host.id, created.code)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('end desde created pasa a ended y es idempotente', async () => {
    const host = await createHost();
    const created = await service.create(host.id, { title: 'T' });

    const ended = await service.end(host.id, created.code);
    expect(ended.status).toBe('ended');

    const again = await service.end(host.id, created.code);
    expect(again.status).toBe('ended');
    expect(
      emitSpy.mock.calls.filter(([name]) => name === 'meeting.ended'),
    ).toHaveLength(1);
  });

  it('publicInfo: 404 si no existe y acceptingRequests solo si active', async () => {
    const host = await createHost();
    await expect(service.publicInfo('NOEXITE00')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const created = await service.create(host.id, { title: 'T' });
    expect((await service.publicInfo(created.code)).acceptingRequests).toBe(
      false,
    );
    await service.start(host.id, created.code);
    expect((await service.publicInfo(created.code)).acceptingRequests).toBe(
      true,
    );
  });

  it('join-request en reunion ended o created da 409', async () => {
    const host = await createHost();
    const created = await service.create(host.id, { title: 'T' });

    await expect(
      service.createJoinRequest(created.code, { displayName: 'G' }, null),
    ).rejects.toBeInstanceOf(ConflictException);

    await service.start(host.id, created.code);
    await service.end(host.id, created.code);
    await expect(
      service.createJoinRequest(created.code, { displayName: 'G' }, null),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('misma sesion invitada no duplica solicitud pending', async () => {
    const host = await createHost();
    const created = await activeMeeting(host.id);

    const first = await service.createJoinRequest(
      created.code,
      { displayName: 'Invitado' },
      null,
    );
    expect(first.request.status).toBe('pending');
    expect(first.guestToken).toBeTruthy();
    const sessionId = guestTokens.verify(first.guestToken, created.code).sub;

    const second = await service.createJoinRequest(
      created.code,
      { displayName: 'Invitado' },
      sessionId,
    );
    expect(second.request.id).toBe(first.request.id);

    const count = await prisma.joinRequest.count({
      where: { meetingId: created.id, guestSessionId: sessionId },
    });
    expect(count).toBe(1);

    const session = await prisma.guestSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 23 * 60 * 60 * 1000,
    );
  });

  it('tras rejected puede crear una nueva solicitud', async () => {
    const host = await createHost();
    const created = await activeMeeting(host.id);

    const first = await service.createJoinRequest(
      created.code,
      { displayName: 'G' },
      null,
    );
    const sessionId = guestTokens.verify(first.guestToken, created.code).sub;
    await service.decideJoinRequest(host.id, created.code, first.request.id, 'rejected');

    const retry = await service.createJoinRequest(
      created.code,
      { displayName: 'G' },
      sessionId,
    );
    expect(retry.request.id).not.toBe(first.request.id);
    expect(retry.request.status).toBe('pending');
  });

  it('accept crea participant y emite joinrequest.decided', async () => {
    const host = await createHost();
    const created = await activeMeeting(host.id);

    const join = await service.createJoinRequest(
      created.code,
      { displayName: 'Invitado' },
      null,
    );
    const accepted = await service.decideJoinRequest(
      host.id,
      created.code,
      join.request.id,
      'accepted',
    );
    expect(accepted.status).toBe('accepted');

    const sessionId = guestTokens.verify(join.guestToken, created.code).sub;
    const participant = await prisma.participant.findFirst({
      where: { meetingId: created.id, guestSessionId: sessionId },
    });
    expect(participant).not.toBeNull();
    expect(participant?.role).toBe('participant');
    expect(participant?.state).toBe('admitted');
    expect(emitSpy).toHaveBeenCalledWith(
      'joinrequest.created',
      expect.objectContaining({ requestId: join.request.id }),
    );
    expect(emitSpy).toHaveBeenCalledWith(
      'joinrequest.decided',
      expect.objectContaining({
        requestId: join.request.id,
        status: 'accepted',
      }),
    );
  });

  it('doble accept concurrente crea un solo participant', async () => {
    const host = await createHost();
    const created = await activeMeeting(host.id);

    const join = await service.createJoinRequest(
      created.code,
      { displayName: 'Invitado' },
      null,
    );
    const [a, b] = await Promise.all([
      service.decideJoinRequest(host.id, created.code, join.request.id, 'accepted'),
      service.decideJoinRequest(host.id, created.code, join.request.id, 'accepted'),
    ]);
    expect(a.status).toBe('accepted');
    expect(b.status).toBe('accepted');

    const sessionId = guestTokens.verify(join.guestToken, created.code).sub;
    const count = await prisma.participant.count({
      where: { meetingId: created.id, guestSessionId: sessionId },
    });
    expect(count).toBe(1);
  });

  it('reject tras accept no cambia nada', async () => {
    const host = await createHost();
    const created = await activeMeeting(host.id);

    const join = await service.createJoinRequest(
      created.code,
      { displayName: 'Invitado' },
      null,
    );
    await service.decideJoinRequest(host.id, created.code, join.request.id, 'accepted');
    const after = await service.decideJoinRequest(
      host.id,
      created.code,
      join.request.id,
      'rejected',
    );

    expect(after.status).toBe('accepted');
    const stored = await prisma.joinRequest.findUniqueOrThrow({
      where: { id: join.request.id },
    });
    expect(stored.status).toBe('accepted');
  });

  it('accept a sesion kicked da 403', async () => {
    const host = await createHost();
    const created = await activeMeeting(host.id);

    const join = await service.createJoinRequest(
      created.code,
      { displayName: 'Invitado' },
      null,
    );
    const sessionId = guestTokens.verify(join.guestToken, created.code).sub;
    await prisma.participant.create({
      data: {
        meetingId: created.id,
        guestSessionId: sessionId,
        displayName: 'Invitado',
        role: 'participant',
        state: 'kicked',
      },
    });

    await expect(
      service.decideJoinRequest(host.id, created.code, join.request.id, 'accepted'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const stored = await prisma.joinRequest.findUniqueOrThrow({
      where: { id: join.request.id },
    });
    expect(stored.status).toBe('pending');
  });

  it('nueva solicitud de sesion kicked da 403', async () => {
    const host = await createHost();
    const created = await activeMeeting(host.id);

    const join = await service.createJoinRequest(
      created.code,
      { displayName: 'Invitado' },
      null,
    );
    const sessionId = guestTokens.verify(join.guestToken, created.code).sub;
    await prisma.participant.create({
      data: {
        meetingId: created.id,
        guestSessionId: sessionId,
        displayName: 'Invitado',
        role: 'participant',
        state: 'kicked',
      },
    });
    await prisma.joinRequest.update({
      where: { id: join.request.id },
      data: { status: 'cancelled' },
    });

    await expect(
      service.createJoinRequest(created.code, { displayName: 'Invitado' }, sessionId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('host no dueno recibe 403 en start/end/accept/reject/list', async () => {
    const owner = await createHost('owner@example.com');
    const intruder = await createHost('intruder@example.com');
    const created = await activeMeeting(owner.id);

    await expect(
      service.start(intruder.id, created.code),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.end(intruder.id, created.code)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.listJoinRequests(intruder.id, created.code),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const join = await service.createJoinRequest(
      created.code,
      { displayName: 'G' },
      null,
    );
    await expect(
      service.decideJoinRequest(intruder.id, created.code, join.request.id, 'accepted'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.decideJoinRequest(intruder.id, created.code, join.request.id, 'rejected'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cancel propio es idempotente', async () => {
    const host = await createHost();
    const created = await activeMeeting(host.id);

    const join = await service.createJoinRequest(
      created.code,
      { displayName: 'G' },
      null,
    );
    const sessionId = guestTokens.verify(join.guestToken, created.code).sub;

    const first = await service.cancelJoinRequest(sessionId, created.code);
    expect(first.cancelled).toBe(true);
    const second = await service.cancelJoinRequest(sessionId, created.code);
    expect(second.cancelled).toBe(false);

    const stored = await prisma.joinRequest.findUniqueOrThrow({
      where: { id: join.request.id },
    });
    expect(stored.status).toBe('cancelled');
    expect(stored.decidedAt).not.toBeNull();
  });

  it('leave marca participant como left y re-accept lo readmite', async () => {
    const host = await createHost();
    const created = await activeMeeting(host.id);

    const join = await service.createJoinRequest(
      created.code,
      { displayName: 'G' },
      null,
    );
    const sessionId = guestTokens.verify(join.guestToken, created.code).sub;
    await service.decideJoinRequest(host.id, created.code, join.request.id, 'accepted');

    const left = await service.leaveByGuest(sessionId, created.code);
    expect(left.state).toBe('left');

    const rejoin = await service.createJoinRequest(
      created.code,
      { displayName: 'G' },
      sessionId,
    );
    await service.decideJoinRequest(host.id, created.code, rejoin.request.id, 'accepted');

    const participants = await prisma.participant.findMany({
      where: { meetingId: created.id, guestSessionId: sessionId },
    });
    expect(participants).toHaveLength(1);
    expect(participants[0].state).toBe('admitted');
    expect(participants[0].leftAt).toBeNull();
  });

  it('leave del host no finaliza la reunion', async () => {
    const host = await createHost();
    const created = await activeMeeting(host.id);

    const left = await service.leaveByHost(host.id, created.code);
    expect(left.state).toBe('left');

    const info = await service.publicInfo(created.code);
    expect(info.status).toBe('active');

    await service.start(host.id, created.code);
    const participants = await prisma.participant.findMany({
      where: { meetingId: created.id, hostUserId: host.id },
    });
    expect(participants).toHaveLength(1);
    expect(participants[0].state).toBe('admitted');
  });

  it('lista join-requests filtrada por status', async () => {
    const host = await createHost();
    const created = await activeMeeting(host.id);

    const j1 = await service.createJoinRequest(created.code, { displayName: 'A' }, null);
    await service.createJoinRequest(created.code, { displayName: 'B' }, null);
    await service.decideJoinRequest(host.id, created.code, j1.request.id, 'rejected');

    const all = await service.listJoinRequests(host.id, created.code);
    expect(all).toHaveLength(2);
    const pending = await service.listJoinRequests(host.id, created.code, 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].displayName).toBe('B');
  });
});
