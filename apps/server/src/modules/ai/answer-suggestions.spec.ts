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
  const followup = jest.fn();
  let ai: AiService;
  beforeEach(async () => {
    await cleanDb(prisma);
    generate.mockReset();
    followup.mockReset().mockImplementation(async input => ({ questions: [{ text: '¿Cómo se registra la decisión?', category: 'missing', reason: 'Falta el registro.', priority: 'MEDIUM', sourceIds: [input.segments[0].id] }] }));
    ai = new AiService(db, access, { enabled: () => true, generate: (instruction: string, input: unknown, options: unknown) => instruction.startsWith('La respuesta anterior') ? followup(input) : generate(instruction, input, options) } as unknown as OpenRouterService, events);
  });
  afterEach(() => ai.onModuleDestroy());
  afterAll(() => prisma.$disconnect());
  async function setup(manual = true) {
    const host = await prisma.hostUser.create({ data: { email: 'answer@test.local', passwordHash: 'test', displayName: 'Host' } });
    const meeting = await prisma.meeting.create({ data: { code: 'ANSWER', title: 'Prueba', hostId: host.id, status: 'active' } });
    const question = await prisma.question.create({ data: { meetingId: meeting.id, text: '¿Quién aprueba?', normalizedText: 'quien aprueba', category: 'permissions', reason: 'Falta rol', priority: 'HIGH', sourceIds: [] } });
    const caller = { kind: 'host' as const, hostUserId: host.id };
    const asked = manual ? await questions.edit(meeting.code, question.id, caller, { version: 1, text: question.text, status: 'ASKED', answer: '', evidenceIds: [] }) : question;
    const participant = await prisma.participant.create({ data: { meetingId: meeting.id, hostUserId: host.id, displayName: 'Host', role: 'host' } });
    const segment = await prisma.transcriptSegment.create({ data: { meetingId: meeting.id, resultId: 'spoken', participantId: participant.id, text: 'Solo los administradores aprueban.', isFinal: true, createdAtMs: Date.now() + 1 } });
    return { meeting, question: asked, segment, caller };
  }
  const output = (questionId: string, sourceId: string) => ({ requirements: [], questions: [], answerSuggestions: [{ questionId, text: 'Solo los administradores.', sourceIds: [sourceId] }] });
  it('propone con evidencia, sin resolver; permite confirmación o rechazo explícitos', async () => {
    const { meeting, question, segment, caller } = await setup();
    generate.mockResolvedValue(output(question.id, segment.id));
    await ai.analyze(meeting.code, caller); await ai.processNext();
    const suggested = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    expect(suggested.status).toBe('ASKED'); expect(suggested.answer).toBe('');
    expect(suggested.answerSuggestion).toMatchObject({ text: 'Solo los administradores.', sourceIds: [segment.id] });
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
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe('completed');
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
  it('resuelve automáticamente solo respuestas claras con citas literales verificadas y conserva historial', async () => {
    const { meeting, question, segment, caller } = await setup();
    const result = output(question.id, segment.id);
    generate.mockResolvedValue({ ...result, answerSuggestions: [{ ...result.answerSuggestions[0], clarity: 'clear', reason: 'Rol explícito y sin contradicciones.', quotes: [{ sourceId: segment.id, text: segment.text }] }] });
    await ai.analyze(meeting.code, caller); await ai.processNext();
    const saved = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    expect(saved.status).toBe('RESOLVED'); expect(saved.automaticResolution).toBe(true);
    expect(saved.evidenceIds).toEqual([segment.id]); expect(saved.answerSuggestion).toBeNull();
    expect(JSON.stringify(saved.history)).toContain('brody');
    const reopened = await questions.edit(meeting.code, question.id, caller, { version: saved.version, text: saved.text, status: 'ASKED', answer: '', evidenceIds: [] });
    expect(reopened.status).toBe('ASKED'); expect(reopened.automaticResolution).toBe(false);
  });
  it.each(['uncertain', 'contradictory'])('pide confirmación ante claridad %s aunque las citas sean válidas', async clarity => {
    const { meeting, question, segment, caller } = await setup();
    const result = output(question.id, segment.id);
    generate.mockResolvedValue({ ...result, answerSuggestions: [{ ...result.answerSuggestions[0], clarity, reason: 'Falta acordar el rol.', quotes: [{ sourceId: segment.id, text: segment.text }] }] });
    await ai.analyze(meeting.code, caller); await ai.processNext();
    const saved = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    expect(saved.status).toBe('ASKED'); expect(saved.automaticResolution).toBe(false);
    expect(saved.answerSuggestion).toMatchObject({ reason: 'Falta acordar el rol.' });
  });
  it('no resuelve con citas inventadas aunque el proveedor diga clear', async () => {
    const { meeting, question, segment, caller } = await setup();
    const result = output(question.id, segment.id);
    generate.mockResolvedValue({ ...result, answerSuggestions: [{ ...result.answerSuggestions[0], clarity: 'clear', quotes: [{ sourceId: segment.id, text: 'Cita inexistente' }] }] });
    await ai.analyze(meeting.code, caller); await ai.processNext();
    expect((await prisma.question.findUniqueOrThrow({ where: { id: question.id } })).status).toBe('ASKED');
  });

  it('detecta pregunta del anfitrión y resuelve su respuesta en el mismo lote sin acciones manuales', async () => {
    const { meeting, question, segment, caller } = await setup(false);
    const spoken = '¿Quién aprueba las compras? Solo los administradores aprueban.';
    await prisma.transcriptSegment.update({ where: { id: segment.id }, data: { text: spoken } });
    generate.mockResolvedValue({ requirements: [], questions: [],
      askedQuestions: [{ questionId: question.id, sourceId: segment.id, quote: '¿Quién aprueba las compras?' }],
      answerSuggestions: [{ questionId: question.id, text: 'Solo los administradores.', sourceIds: [segment.id], clarity: 'clear', quotes: [{ sourceId: segment.id, text: 'Solo los administradores aprueban.' }] }],
    });
    await ai.analyze(meeting.code, caller); await ai.processNext();
    const saved = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    expect(saved.status).toBe('RESOLVED'); expect(saved.automaticResolution).toBe(true);
    expect(JSON.stringify(saved.history)).toContain('question-detected');
  });
  it('detecta la pregunta sin confundirla con una respuesta', async () => {
    const { meeting, question, segment, caller } = await setup(false);
    await prisma.transcriptSegment.update({ where: { id: segment.id }, data: { text: '¿Quién aprueba?' } });
    generate.mockResolvedValue({ requirements: [], questions: [], askedQuestions: [{ questionId: question.id, sourceId: segment.id, quote: '¿Quién aprueba?' }] });
    await ai.analyze(meeting.code, caller); await ai.processNext();
    const saved = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    expect(saved.status).toBe('ASKED'); expect(saved.answer).toBe('');
  });
  it('rechaza detección atribuida al anfitrión cuando habla un invitado', async () => {
    const { meeting, question, segment, caller } = await setup(false);
    await prisma.participant.update({ where: { id: segment.participantId! }, data: { role: 'guest' } });
    generate.mockResolvedValue({ requirements: [], questions: [], askedQuestions: [{ questionId: question.id, sourceId: segment.id, quote: segment.text }] });
    await ai.analyze(meeting.code, caller); await ai.processNext();
    expect((await prisma.question.findUniqueOrThrow({ where: { id: question.id } })).status).toBe('PENDING');
  });

  it('permite revisar explícitamente una pregunta sin respuesta con segmentos ya analizados', async () => {
    const { meeting, question, segment, caller } = await setup();
    await prisma.transcriptSegment.update({ where: { id: segment.id }, data: { analyzedRevision: segment.revision } });
    generate.mockResolvedValue(output(question.id, segment.id));
    const queued = await ai.analyze(meeting.code, caller);
    expect(queued.job).not.toBeNull();
    await ai.processNext();
    expect((await prisma.question.findUniqueOrThrow({ where: { id: question.id } })).answerSuggestion).not.toBeNull();
    const again = await ai.analyze(meeting.code, caller);
    expect(again.job?.id).not.toBe(queued.job?.id); // version changed with the saved proposal
  });

  it('publica una respuesta validada antes de terminar la extracción y no duplica el historial al finalizar', async () => {
    const { meeting, question, segment, caller } = await setup();
    const result = { askedQuestions: [], requirements: [], questions: [], answerSuggestions: [{ questionId: question.id, text: 'Administradores.', sourceIds: [segment.id], clarity: 'clear', quotes: [{ sourceId: segment.id, text: segment.text }] }] };
    generate.mockImplementation(async (_prompt, _input, options) => {
      await options.onPartial({ askedQuestions: [], answerSuggestions: result.answerSuggestions });
      const saved = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
      expect(saved.status).toBe('RESOLVED');
      expect((await prisma.transcriptSegment.findUniqueOrThrow({ where: { id: segment.id } })).analyzedRevision).toBe(0);
      return result;
    });
    await ai.analyze(meeting.code, caller); await ai.processNext();
    const saved = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    expect(saved.version).toBe(question.version + 1);
    expect((await prisma.transcriptSegment.findUniqueOrThrow({ where: { id: segment.id } })).analyzedRevision).toBe(segment.revision);
  });
  it('continúa una detección publicada por el mismo trabajo y luego guarda la respuesta', async () => {
    const { meeting, question, segment, caller } = await setup(false);
    const text = '¿Quién aprueba? Los administradores.';
    await prisma.transcriptSegment.update({ where: { id: segment.id }, data: { text } });
    const askedQuestions = [{ questionId: question.id, sourceId: segment.id, quote: '¿Quién aprueba?' }];
    const answerSuggestions = [{ questionId: question.id, text: 'Los administradores.', sourceIds: [segment.id], clarity: 'clear', quotes: [{ sourceId: segment.id, text: 'Los administradores.' }] }];
    generate.mockImplementation(async (_prompt, _input, options) => {
      await options.onPartial({ askedQuestions });
      expect((await prisma.question.findUniqueOrThrow({ where: { id: question.id } })).status).toBe('ASKED');
      await options.onPartial({ askedQuestions, answerSuggestions });
      return { askedQuestions, answerSuggestions, requirements: [], questions: [] };
    });
    await ai.analyze(meeting.code, caller); await ai.processNext();
    expect((await prisma.question.findUniqueOrThrow({ where: { id: question.id } })).status).toBe('RESOLVED');
  });

  it('conserva la respuesta publicada tras un corte y reintenta sin duplicar su historial', async () => {
    const { meeting, question, segment, caller } = await setup();
    const result = { askedQuestions: [], requirements: [], questions: [], answerSuggestions: [{ questionId: question.id, text: 'Administradores.', sourceIds: [segment.id], clarity: 'clear', quotes: [{ sourceId: segment.id, text: segment.text }] }] };
    generate.mockImplementationOnce(async (_prompt, _input, options) => {
      await options.onPartial(result);
      throw new Error('Stream interrumpido');
    }).mockImplementationOnce(async (_prompt, _input, options) => {
      await options.onPartial(result);
      return result;
    });
    const { job } = await ai.analyze(meeting.code, caller);
    await ai.processNext();
    const published = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    expect(published.status).toBe('RESOLVED');
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe('queued');
    expect((await prisma.transcriptSegment.findUniqueOrThrow({ where: { id: segment.id } })).analyzedRevision).toBe(0);
    await ai.processNext();
    const saved = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    expect(saved.version).toBe(published.version);
    expect(saved.history).toEqual(published.history);
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe('completed');
    expect((await prisma.transcriptSegment.findUniqueOrThrow({ where: { id: segment.id } })).analyzedRevision).toBe(segment.revision);
  });

  it('tolera detectar de nuevo una pregunta ASKED con evidencia válida y procesa su respuesta', async () => {
    const { meeting, question, segment, caller } = await setup();
    const spoken = '¿Quién aprueba? Solo los administradores aprueban.';
    await prisma.transcriptSegment.update({ where: { id: segment.id }, data: { text: spoken } });
    generate.mockResolvedValue({ requirements: [], questions: [],
      askedQuestions: [{ questionId: question.id, sourceId: segment.id, quote: '¿Quién aprueba?' }],
      answerSuggestions: [{ questionId: question.id, text: 'Administradores.', sourceIds: [segment.id], clarity: 'clear',
        quotes: [{ sourceId: segment.id, text: 'Solo los administradores aprueban.' }] }],
    });
    await ai.analyze(meeting.code, caller); await ai.processNext();
    const saved = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    expect(saved.status).toBe('RESOLVED');
    expect(saved.version).toBe(question.version + 1);
  });

  it('reanuda el texto nuevo acumulado cuando un trabajo agota sus reintentos', async () => {
    const { meeting, segment, caller } = await setup();
    generate.mockRejectedValue(new Error('Proveedor temporalmente no disponible'));
    await ai.analyze(meeting.code, caller);
    await ai.processNext(); await ai.processNext();
    await prisma.transcriptSegment.create({ data: { meetingId: meeting.id, resultId: 'new-after-failure',
      participantId: segment.participantId, text: 'Nueva información.', isFinal: true, createdAtMs: Date.now() + 2 } });
    await ai.processNext();
    await new Promise(resolve => setTimeout(resolve, 1000));
    const jobs = await prisma.aiJob.findMany({ where: { meetingId: meeting.id } });
    expect(jobs.some(job => job.status === 'failed')).toBe(true);
    expect(jobs.some(job => job.status === 'queued' && (job.input as any).segments.length === 2)).toBe(true);
  });

  it('ignora respuestas repetidas de preguntas cerradas sin bloquear preguntas nuevas', async () => {
    const { meeting, question, segment, caller } = await setup();
    await questions.edit(meeting.code, question.id, caller, { version: question.version, text: question.text, status: 'RESOLVED', answer: 'Decisión humana guardada.', evidenceIds: [] });
    generate.mockResolvedValue({ ...output(question.id, segment.id), questions: [{ text: '¿Cómo se registran las aprobaciones?', category: 'missing', priority: 'MEDIUM', reason: 'Falta el registro.', sourceIds: [segment.id] }, { text: '¿Qué otro proceso falta?', category: 'missing', priority: 'LOW', reason: 'Segunda propuesta del proveedor.', sourceIds: [segment.id] }] });
    const { job } = await ai.analyze(meeting.code, caller); await ai.processNext();
    expect((await prisma.question.findUniqueOrThrow({ where: { id: question.id } })).answer).toBe('Decisión humana guardada.');
    expect(await prisma.question.count({ where: { meetingId: meeting.id } })).toBe(2);
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe('completed');
  });

  it('completa el siguiente turno con una pasada enfocada cuando la IA devuelve cero preguntas', async () => {
    const { meeting, question, segment, caller } = await setup();
    generate.mockResolvedValue({ requirements: [], questions: [], answerSuggestions: [{ questionId: question.id,
      text: 'Administradores.', sourceIds: [segment.id], clarity: 'clear', quotes: [{ sourceId: segment.id, text: segment.text }] }] });
    const { job } = await ai.analyze(meeting.code, caller); await ai.processNext();
    expect(followup).toHaveBeenCalledTimes(1);
    expect(await prisma.question.count({ where: { meetingId: meeting.id, status: 'PENDING' } })).toBe(1);
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe('completed');
  });

  it('detecta una pregunta literal aun si el proveedor no devuelve detección', async () => {
    const { meeting, question, segment, caller } = await setup(false);
    const text = '¿Quién aprueba las solicitudes?';
    await prisma.question.update({ where: { id: question.id }, data: { text } });
    await prisma.transcriptSegment.update({ where: { id: segment.id }, data: { text } });
    generate.mockImplementation(async (_prompt, input) => {
      expect(input.questions[0].status).toBe('ASKED');
      return { questions: [], requirements: [] };
    });
    await ai.analyze(meeting.code, caller); await ai.processNext();
    expect((await prisma.question.findUniqueOrThrow({ where: { id: question.id } })).status).toBe('ASKED');
  });

  it('no reintenta ni resuelve una respuesta no solicitada para una pregunta pendiente', async () => {
    const { meeting, question, segment, caller } = await setup(false);
    generate.mockResolvedValue(output(question.id, segment.id));
    const { job } = await ai.analyze(meeting.code, caller); await ai.processNext();
    expect((await prisma.question.findUniqueOrThrow({ where: { id: question.id } })).status).toBe('PENDING');
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe('completed');
    expect(followup).not.toHaveBeenCalled();
  });

  it('una reunión lenta no bloquea otra y mantiene una ejecución por reunión', async () => {
    const { meeting } = await setup();
    const other = await prisma.meeting.create({ data: { code: 'OTHERLIVE', title: 'Otra reunión', hostId: meeting.hostId, status: 'active' } });
    let release!: () => void;
    let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    ai.register('slow-test', async job => { if (job.meetingId === meeting.id) { started(); await hold; } return {}; });
    const first = await ai.enqueue(meeting.id, 'slow-test', { turn: 1 });
    await ai.enqueue(meeting.id, 'slow-test', { turn: 2 });
    const second = await ai.enqueue(other.id, 'slow-test', { turn: 1 });
    const running = ai.processNext();
    try {
      await began;
      await ai.processNext();
      expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('completed');
      expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('running');
      expect(await prisma.aiJob.count({ where: { meetingId: meeting.id, status: 'running' } })).toBe(1);
    } finally { release(); await running; }
  });

  it('una propuesta con evidencia fuera de ventana no bloquea una respuesta válida del mismo lote', async () => {
    const { meeting, question, segment, caller } = await setup();
    const other = await prisma.question.create({ data: { meetingId: meeting.id, text: 'Otra pregunta', normalizedText: 'otra pregunta', category: 'missing', reason: 'Falta', priority: 'LOW', status: 'ASKED', askedAt: new Date(Date.now()+10000), sourceIds: [] } });
    generate.mockResolvedValue({ questions: [], requirements: [], answerSuggestions: [
      { questionId: other.id, text: 'No válida.', sourceIds: [segment.id] },
      { questionId: question.id, text: 'Administradores.', sourceIds: [segment.id], clarity: 'clear', quotes: [{ sourceId: segment.id, text: segment.text }] },
    ] });
    const { job } = await ai.analyze(meeting.code, caller); await ai.processNext();
    expect((await prisma.question.findUniqueOrThrow({ where: { id: question.id } })).status).toBe('RESOLVED');
    expect((await prisma.question.findUniqueOrThrow({ where: { id: other.id } })).answerSuggestion).toBeNull();
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe('completed');
  });

});
