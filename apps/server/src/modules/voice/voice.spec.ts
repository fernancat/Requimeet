import { EventEmitter2 } from '@nestjs/event-emitter';
import { VoiceService, mentionsBrody } from './voice.service';
import { MeetingAccessService } from '../meetings/meeting-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ElevenLabsService } from './elevenlabs.service';
import { OpenRouterService } from '../ai/openrouter.service';
import { cleanDb, createTestPrisma } from '../../test-utils/test-db';

describe('Brody voice authorization, generation and wake requests', () => {
  const prisma = createTestPrisma();
  const eleven = { enabled: () => true, synthesize: jest.fn(async () => Buffer.from('audio')) };
  const router = { generate: jest.fn(async () => ({ text: 'Podemos aclarar quién autoriza los cambios.' })) };
  const events = new EventEmitter2();
  const access = new MeetingAccessService(prisma as PrismaService);
  const service = new VoiceService(prisma as PrismaService, access, eleven as unknown as ElevenLabsService, router as unknown as OpenRouterService, events);
  let code: string, meetingId: string, caller: { kind: 'host'; hostUserId: string }, guest: { kind: 'guest'; guestSessionId: string }, questionId: string;
  beforeAll(() => prisma.$connect());
  afterAll(async () => { service.onModuleDestroy(); await cleanDb(prisma); await prisma.$disconnect(); });
  beforeEach(async () => {
    await cleanDb(prisma); jest.clearAllMocks();
    const host = await prisma.hostUser.create({ data: { email: 'voice@test.invalid', passwordHash: 'unused', displayName: 'Host' } });
    const meeting = await prisma.meeting.create({ data: { code: 'VOICE', title: 'Voz', hostId: host.id, status: 'active', voiceEnabled: true, voiceSince: new Date(Date.now() - 5000) } });
    meetingId = meeting.id; code = meeting.code; caller = { kind: 'host', hostUserId: host.id };
    const g = await prisma.guestSession.create({ data: { displayName: 'Guest', expiresAt: new Date(Date.now() + 60000) } });
    guest = { kind: 'guest', guestSessionId: g.id };
    await prisma.participant.create({ data: { meetingId, guestSessionId: g.id, displayName: 'Guest', role: 'guest' } });
    const q = await prisma.question.create({ data: { meetingId, text: '¿Quién autoriza los cambios?', normalizedText: 'quien autoriza', category: 'permissions', reason: 'Aclarar', priority: 'HIGH', sourceIds: [] } }); questionId = q.id;
  });
  it('generates one audio per saved question and denies unshared audio to guests', async () => {
    const first = await service.question(code, caller, { questionId, version: 1 });
    await service.question(code, caller, { questionId, version: 1 });
    expect(eleven.synthesize).toHaveBeenCalledTimes(1); expect(first.latest?.status).toBe('ready');
    await expect(service.audio(code, guest, first.latest!.id)).rejects.toMatchObject({ status: 403 });
    await expect(service.configure(code, guest, { enabled: true, shared: true, version: 1 })).rejects.toMatchObject({ status: 403 });
    await service.configure(code, caller, { enabled: true, shared: true, version: 1 });
    expect((await service.audio(code, guest, first.latest!.id)).toString()).toBe('audio');
    await expect(service.configure(code, caller, { enabled: false, shared: true, version: 1 })).rejects.toMatchObject({ status: 409 });
  });
  it('rejects foreign questions, expired audio, removed participants and stale versions', async () => {
    await expect(service.question(code, caller, { questionId: 'foreign', version: 1 })).rejects.toMatchObject({ status: 409 });
    const state = await service.question(code, caller, { questionId, version: 1 });
    await prisma.brodyUtterance.update({ where: { id: state.latest!.id }, data: { createdAt: new Date(Date.now() - 180000) } });
    await expect(service.audio(code, caller, state.latest!.id)).rejects.toMatchObject({ status: 404 });
    await prisma.participant.updateMany({ where: { meetingId }, data: { state: 'kicked' } });
    await expect(service.state(code, guest)).rejects.toMatchObject({ status: 403 });
  });
  it('answers final mentions once using meeting context; partial and old mentions do not trigger', async () => {
    await prisma.transcriptSegment.create({ data: { meetingId, resultId: 'partial', text: 'Brody, ayúdame', isFinal: false, createdAtMs: Date.now() } });
    await (service as any).respond(meetingId); expect(router.generate).not.toHaveBeenCalled();
    await prisma.transcriptSegment.update({ where: { resultId: 'partial' }, data: { isFinal: true } });
    await (service as any).respond(meetingId); await (service as any).respond(meetingId);
    expect(router.generate).toHaveBeenCalledTimes(1); expect(eleven.synthesize).toHaveBeenCalledTimes(1);
    expect((await service.state(code, caller)).latest?.kind).toBe('reply');
    await prisma.transcriptSegment.create({ data: { meetingId, resultId: 'again', text: 'Brodi, ¿qué falta aclarar?', isFinal: true, createdAtMs: Date.now() } });
    await (service as any).respond(meetingId); expect(router.generate).toHaveBeenCalledTimes(2);
  });
  it('a provider failure leaves a terminal state, not a permanent spinner or automatic charge loop', async () => {
    eleven.synthesize.mockRejectedValueOnce(new Error('private upstream payload'));
    const result = await service.question(code, caller, { questionId, version: 1 });
    expect(result.latest?.status).toBe('failed'); expect(result.latest?.error).not.toContain('private');
    await service.question(code, caller, { questionId, version: 1 }); expect(eleven.synthesize).toHaveBeenCalledTimes(1);
  });
  it('recognizes the assistant name as a word, not arbitrary fragments', () => {
    expect(mentionsBrody('Oye Brody, ¿qué sigue?')).toBe(true);
    expect(mentionsBrody('Brodi, resume los acuerdos')).toBe(true);
    expect(mentionsBrody('el producto brodytech')).toBe(false);
  });
});
