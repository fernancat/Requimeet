import { RequirementsService } from './requirements.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createTestPrisma, cleanDb } from '../../test-utils/test-db';
import { MeetingAccessService } from '../meetings/meeting-access.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('revisión de requerimientos', () => {
 const prisma = createTestPrisma();
 const access = new MeetingAccessService(prisma as PrismaService);
 const service = new RequirementsService(prisma as PrismaService, access, new EventEmitter2());
 beforeEach(() => cleanDb(prisma));
 afterAll(() => prisma.$disconnect());
 it('conserva aprobados, reabre con historial y rechaza versiones atrasadas e invitados', async () => {
  const host = await prisma.hostUser.create({ data: { email: 'revision@test.local', passwordHash: 'test', displayName: 'Host' } });
  const meeting = await prisma.meeting.create({ data: { code: 'REVISION', title: 'Revisión', hostId: host.id, status: 'ended' } });
  const caller = { kind: 'host' as const, hostUserId: host.id };
  const item = await service.create(meeting.code, caller, { text: 'Registrar clientes' });
  const approved = await service.update(meeting.code, item.id, caller, { version: 1, status: 'APPROVED' });
  await expect(service.update(meeting.code, item.id, caller, { version: 2, text: 'Cambio' })).rejects.toThrow('Reabre');
  const reopened = await service.update(meeting.code, item.id, caller, { version: approved.version, action: 'reopen' });
  expect(reopened.status).toBe('PENDING');
  expect(reopened.history).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'APPROVED' })]));
  await expect(service.update(meeting.code, item.id, caller, { version: 1, text: 'Cambio' })).rejects.toThrow('cambió');
  await expect(service.create(meeting.code, { kind: 'guest', guestSessionId: 'other' }, { text: 'No' })).rejects.toThrow('anfitrión');
  expect(await service.list(meeting.code, caller)).toHaveLength(1);
 });
});
