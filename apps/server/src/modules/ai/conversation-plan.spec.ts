import { ConversationPlanService, addressesAssistant, ConversationReply, isInterviewDirection } from './conversation-plan.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createTestPrisma, cleanDb } from '../../test-utils/test-db';
import { AiService } from './ai.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('One persisted interview plan for spoken directions and transcription', () => {
  const db = createTestPrisma(); const plans = new ConversationPlanService(db as PrismaService);
  let meetingId: string, sourceId: string, oldId: string;
  const proposal: ConversationReply = { action: 'replace_questions', text: 'Hablemos de permisos.', focus: 'Permisos para autorizar cambios', questions: Array.from({ length: 5 }, (_,i) => ({ text: `¿Qué permiso necesita el rol ${i}?`, reason: 'Aclarar autorización' })) };
  beforeAll(() => db.$connect()); afterAll(async () => { await cleanDb(db); await db.$disconnect(); });
  beforeEach(async () => {
    await cleanDb(db);
    const host = await db.hostUser.create({ data: { email: 'plan@test.invalid', passwordHash: 'unused', displayName: 'Host' } });
    const meeting = await db.meeting.create({ data: { code: 'PLAN', title: 'Plan', hostId: host.id, status: 'active' } }); meetingId = meeting.id;
    const participant = await db.participant.create({ data: { meetingId, hostUserId: host.id, displayName: 'Host', role: 'host' } });
    const source = await db.transcriptSegment.create({ data: { meetingId, participantId: participant.id, resultId: 'direction', text: 'Brody, hazme cinco preguntas clave de permisos.', createdAtMs: Date.now() } }); sourceId = source.id;
    const old = await db.question.create({ data: { meetingId, text: '¿Cuál es el proceso?', normalizedText: 'cual proceso', category: 'missing', reason: 'Aclarar', priority: 'HIGH', sourceIds: [] } }); oldId = old.id;
  });
  it('replaces open proposals with five ordered questions, keeping answers and requirements', async () => {
    const answered = await db.question.create({ data: { meetingId, text: '¿Quién aprueba?', normalizedText: 'quien aprueba', category: 'permissions', reason: 'Aclarar', priority: 'HIGH', sourceIds: [], status: 'RESOLVED', answer: 'Ana' } });
    const requirement = await db.requirement.create({ data: { meetingId, text: 'Validar permisos', originalText: 'Validar permisos', status: 'APPROVED' } });
    const saved = await plans.apply(meetingId, sourceId, 1, 0, [{ id: oldId, version: 1 }], proposal);
    expect(saved.map(q => q.text)).toEqual(proposal.questions.map(q => q.text));
    expect(await db.question.findUnique({ where: { id: oldId } })).toMatchObject({ status: 'DISCARDED', version: 2 });
    expect(await db.question.findUnique({ where: { id: answered.id } })).toMatchObject({ status: 'RESOLVED', answer: 'Ana' });
    expect(await db.requirement.findUnique({ where: { id: requirement.id } })).toMatchObject({ status: 'APPROVED' });
    expect(await db.meeting.findUnique({ where: { id: meetingId } })).toMatchObject({ brodyFocus: proposal.focus, brodyFocusVersion: 1 });
    expect(saved.every(q => q.sourceIds.includes(sourceId))).toBe(true);
  });
  it('rolls back the plan if another edit happened during generation', async () => {
    await db.question.update({ where: { id: oldId }, data: { version: 2 } });
    await expect(plans.apply(meetingId, sourceId, 1, 0, [{ id: oldId, version: 1 }], proposal)).rejects.toMatchObject({ status: 409 });
    expect((await db.meeting.findUniqueOrThrow({ where: { id: meetingId } })).brodyFocusVersion).toBe(0);
    expect(await db.question.count({ where: { meetingId } })).toBe(1);
  });
  it('never treats a guest or a foreign source as permission to change the plan', async () => {
    await db.transcriptSegment.update({ where: { id: sourceId }, data: { participantId: null } });
    await expect(plans.apply(meetingId, sourceId, 1, 0, [{ id: oldId, version: 1 }], proposal)).rejects.toMatchObject({ status: 403 });
    await expect(plans.apply(meetingId, 'foreign', 1, 0, [], proposal)).rejects.toMatchObject({ status: 403 });
  });
  it('ignores an old analysis result after the host changes the focus', async () => {
    await plans.apply(meetingId, sourceId, 1, 0, [{ id: oldId, version: 1 }], proposal);
    const ai = new AiService(db as any, {} as any, {} as any, new EventEmitter2());
    await (ai as any).persistAnalysis({ id: 'old-job', meetingId }, { focusVersion: 0, questions: [], segments: [{ id: sourceId, revision: 1, text: 'Una fuente anterior' }], context: [] }, { askedQuestions: [], answerSuggestions: [], requirements: [], questions: [{ text: 'Pregunta del enfoque viejo', category: 'missing', priority: 'HIGH', reason: 'Viejo', sourceIds: [sourceId] }] }, true);
    expect(await db.question.count({ where: { meetingId, text: 'Pregunta del enfoque viejo' } })).toBe(0);
  });
  it('recognizes explicit assistant directions without matching ordinary requirement statements', () => {
    expect(addressesAssistant('Hazme 5 preguntas clave sobre permisos')).toBe(true);
    expect(addressesAssistant('¿Qué te parecería cambiar el enfoque?')).toBe(true);
    expect(addressesAssistant('Necesitamos guardar cinco preguntas por formulario')).toBe(false);
    expect(isInterviewDirection('Brody, necesitamos validar los permisos')).toBe(false);
    expect(isInterviewDirection('Cambia el enfoque a validaciones')).toBe(true);
  });
});
