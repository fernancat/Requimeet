import { EventEmitter2 } from '@nestjs/event-emitter';
import { createTestPrisma, cleanDb } from '../../test-utils/test-db';
import { PrismaService } from '../../prisma/prisma.service';
import { MeetingAccessService } from '../meetings/meeting-access.service';
import { QuestionsService } from '../questions/questions.service';
import { AiService } from './ai.service';
import { OpenRouterService } from './openrouter.service';

describe('respuestas habladas de Brody', () => {
  const prisma = createTestPrisma();
  const db = prisma as PrismaService;
  const events = new EventEmitter2();
  const access = new MeetingAccessService(db);
  const questions = new QuestionsService(db, access, events);
  const generate = jest.fn();
  let ai: AiService;
  beforeEach(async () => {
    await cleanDb(prisma);
    generate.mockReset();
    ai = new AiService(db, access, { enabled: () => true, generate } as unknown as OpenRouterService, events);
  });
  afterEach(() => ai.onModuleDestroy());
  afterAll(() => prisma.$disconnect());
  async function setup() {
    const host = await prisma.hostUser.create({ data: { email: 'answer@test.local', passwordHash: 'test', displayName: 'Host' } });
    const meeting = await prisma.meeting.create({ data: { code: 'ANSWER', title: 'Prueba', hostId: host.id, status: 'active' } });
    const question = await prisma.question.create({ data: { meetingId: meeting.id, text: '¿Quién aprueba?', normalizedText: 'quien aprueba', category: 'permissions', reason: 'Falta rol', priority: 'HIGH', sourceIds: [] } });
    const caller = { kind: 'host' as const, hostUserId: host.id };
    const asked = await questions.edit(meeting.code, question.id, caller, { version: 1, text: question.text, status: 'ASKED', answer: '', evidenceIds: [] });
    const segment = await prisma.transcriptSegment.create({ data: { meetingId: meeting.id, resultId: 'spoken', text: 'Solo los administradores aprueban.', isFinal: true, createdAtMs: Date.now() + 1 } });
    return { meeting, question: asked, segment, caller };
  }
  const output = (questionId: string, sourceId: string) => ({ requirements: [], questions: [], answerSuggestions: [{ questionId, text: 'Solo los administradores.', sourceIds: [sourceId] }] });
  it('propone con evidencia, sin resolver; permite confirmación o rechazo explícitos', async () => {
    const { meeting, question, segment, caller } = await setup();
    generate.mockResolvedValue(output(question.id, segment.id));
    await ai.analyze(meeting.code, caller); await ai.processNext();
    const suggested = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    expect(suggested.status).toBe('ASKED'); expect(suggested.answer).toBe('');
    expect(suggested.answerSuggestion).toEqual({ text: 'Solo los administradores.', sourceIds: [segment.id] });
    const confirmed = await questions.edit(meeting.code, question.id, caller, { version: suggested.version, text: question.text, status: 'RESOLVED', answer: 'Solo los administradores.', evidenceIds: [segment.id] });
    expect(confirmed.status).toBe('RESOLVED'); expect(confirmed.answerSuggestion).toBeNull();
  });
  it('no sobrescribe una respuesta humana guardada mientras la IA trabaja', async () => {
    const { meeting, question, segment, caller } = await setup();
    generate.mockImplementation(async () => {
      await questions.edit(meeting.code, question.id, caller, { version: question.version, text: question.text, status: 'RESOLVED', answer: 'El supervisor.', evidenceIds: [] });
      return output(question.id, segment.id);
    });
    await ai.analyze(meeting.code, caller); await ai.processNext();
    const saved = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    expect(saved.answer).toBe('El supervisor.'); expect(saved.answerSuggestion).toBeNull();
  });
  it('rechaza evidencia anterior a la pregunta, ajena o inventada', async () => {
    const { meeting, question, segment, caller } = await setup();
    await prisma.transcriptSegment.update({ where: { id: segment.id }, data: { createdAtMs: question.askedAt!.getTime() - 1000 } });
    generate.mockResolvedValue(output(question.id, segment.id));
    const { job } = await ai.analyze(meeting.code, caller); await ai.processNext();
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: job!.id } })).error).toContain('fuentes desconocidas');
    expect((await prisma.question.findUniqueOrThrow({ where: { id: question.id } })).answerSuggestion).toBeNull();
  });
  it('rechazar una propuesta limpia la sugerencia e inicia una nueva ventana de escucha', async () => {
    const { meeting, question, segment, caller } = await setup();
    generate.mockResolvedValue(output(question.id, segment.id));
    await ai.analyze(meeting.code, caller); await ai.processNext();
    const saved = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    const rejected = await questions.edit(meeting.code, question.id, caller, { version: saved.version, text: question.text, status: 'ASKED', answer: '', evidenceIds: [], dismissSuggestion: true });
    expect(rejected.answerSuggestion).toBeNull(); expect(rejected.askedAt!.getTime()).toBeGreaterThanOrEqual(question.askedAt!.getTime());
  });
});
