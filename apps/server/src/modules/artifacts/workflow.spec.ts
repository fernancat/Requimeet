import { EventEmitter2 } from '@nestjs/event-emitter';
import { DOCUMENT_SECTIONS } from '@requimeet/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { createTestPrisma, cleanDb } from '../../test-utils/test-db';
import { MeetingAccessService } from '../meetings/meeting-access.service';
import { RequirementsService } from '../requirements/requirements.service';
import { TranscriptsService } from '../transcripts/transcripts.service';
import { AiService } from '../ai/ai.service';
import { OpenRouterService } from '../ai/openrouter.service';
import { QuestionsService } from '../questions/questions.service';
import { ArtifactsService } from './artifacts.service';

describe('levantamiento completo con proveedor simulado', () => {
  const prisma = createTestPrisma();
  const db = prisma as PrismaService;
  const access = new MeetingAccessService(db);
  const events = new EventEmitter2();
  const generate = jest.fn();
  const router = {
    enabled: () => true,
    model: 'deepseek/deepseek-v4-flash',
    generate,
  } as unknown as OpenRouterService;
  const ai = new AiService(db, access, router, events);
  const transcripts = new TranscriptsService(db, access, events);
  const requirements = new RequirementsService(db, access, events);
  const questions = new QuestionsService(db, access, events);
  const artifacts = new ArtifactsService(db, access, ai, router, events);
  beforeEach(async () => {
    await cleanDb(prisma);
    generate.mockReset();
    artifacts.onModuleInit();
  });
  afterAll(async () => {
    ai.onModuleDestroy();
    await prisma.$disconnect();
  });
  it('transcribe, analiza, aprueba, modela, revisa, exporta y detecta cambios', async () => {
    const host = await prisma.hostUser.create({
      data: {
        email: 'workflow@test.local',
        passwordHash: 'test',
        displayName: 'Host',
      },
    });
    const meeting = await prisma.meeting.create({
      data: {
        code: 'WORKFLOW',
        hostId: host.id,
        title: 'Clientes',
        status: 'active',
      },
    });
    const participant = await prisma.participant.create({
      data: {
        meetingId: meeting.id,
        hostUserId: host.id,
        displayName: 'Host',
        role: 'host',
      },
    });
    const caller = { kind: 'host' as const, hostUserId: host.id };
    const result = {
      resultId: 'stable',
      revision: 1,
      meetingId: meeting.id,
      participantId: participant.id,
      kind: 'transcript-partial' as const,
      isFinal: false,
      createdAtMs: Date.now(),
      payload: { text: 'Registrar clientes', startMs: 0, endMs: 500 },
    };
    await transcripts.save(result);
    expect((await ai.analyze(meeting.code, caller)).unchanged).toBe(true);
    const segment = await transcripts.save({
      ...result,
      revision: 2,
      kind: 'transcript-final',
      isFinal: true,
    });
    await transcripts.save(result); // atraso no degrada un final
    expect(
      (
        await prisma.transcriptSegment.findUniqueOrThrow({
          where: { resultId: 'stable' },
        })
      ).isFinal,
    ).toBe(true);
    generate.mockResolvedValueOnce({
      requirements: [
        {
          text: 'Registrar clientes con correo único',
          sourceIds: [segment!.id],
        },
      ],
      questions: [
        {
          text: '¿Quién registra clientes?',
          reason: 'No se especificó el permiso',
          category: 'permissions',
          priority: 'HIGH',
          sourceIds: [segment!.id],
        },
      ],
    });
    await ai.analyze(meeting.code, caller);
    await ai.processNext();
    expect(generate).toHaveBeenCalledTimes(1);
    const [requirement] = await requirements.list(meeting.code, caller);
    expect(requirement.sourceIds).toContain(segment!.id);
    const [question] = await questions.list(meeting.code, caller);
    await expect(
      questions.edit(meeting.code, question.id, caller, {
        version: 1,
        text: question.text,
        status: 'RESOLVED',
        answer: '',
        evidenceIds: [],
      }),
    ).rejects.toThrow('respuesta');
    await questions.edit(meeting.code, question.id, caller, {
      version: 1,
      text: question.text,
      status: 'RESOLVED',
      answer: 'El administrador',
      evidenceIds: [],
    });
    await requirements.update(meeting.code, requirement.id, caller, {
      version: 1,
      status: 'APPROVED',
    });
    const model = {
      entities: [
        {
          id: 'cliente',
          name: 'Cliente',
          sourceIds: [requirement.id],
          attributes: [
            {
              id: 'correo',
              name: 'correo',
              type: 'texto',
              required: true,
              identifier: true,
            },
          ],
        },
      ],
      relations: [],
    };
    generate.mockResolvedValueOnce(model);
    await artifacts.generate(meeting.code, 'entities', caller);
    await ai.processNext();
    const models = await artifacts.list(meeting.code, 'entities', caller);
    expect(models.items).toHaveLength(1);
    expect(models.selectedId).toBe(models.items[0].id);
    generate.mockResolvedValueOnce({
      title: 'Clientes',
      sections: DOCUMENT_SECTIONS.map((key) => ({
        key,
        items: [
          { text: 'Confirmar reglas y permisos', sourceIds: [requirement.id] },
        ],
      })),
      entities: model,
    });
    await artifacts.generate(meeting.code, 'document', caller);
    await ai.processNext();
    const docs = await artifacts.list(meeting.code, 'document', caller);
    expect(docs.items).toHaveLength(1);
    const document = await artifacts.edit(
      meeting.code,
      'document',
      docs.items[0].id,
      caller,
      { version: 1, action: 'review' },
    );
    expect(document.reviewed).toBe(true);
    const pdf = await artifacts.export(
      meeting.code,
      document.id,
      caller,
      'pdf',
      document.version,
    );
    const docx = await artifacts.export(
      meeting.code,
      document.id,
      caller,
      'docx',
      document.version,
    );
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(docx.subarray(0, 2).toString()).toBe('PK');
    await expect(
      artifacts.export(meeting.code, document.id, caller, 'pdf', 1),
    ).rejects.toThrow('versión');
    await requirements.update(meeting.code, requirement.id, caller, {
      version: 2,
      action: 'reopen',
    });
    expect(
      (await artifacts.list(meeting.code, 'document', caller)).items[0].stale,
    ).toBe(true);
    await expect(
      artifacts.edit(meeting.code, 'document', document.id, caller, {
        version: 2,
        action: 'review',
      }),
    ).rejects.toThrow('fuentes');
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { status: 'ended' },
    });
    expect(
      (await artifacts.list(meeting.code, 'document', caller)).items,
    ).toHaveLength(1);
    await expect(
      artifacts.list(meeting.code, 'document', {
        kind: 'guest',
        guestSessionId: 'other',
      }),
    ).rejects.toThrow();
  }, 15000);
  it('limita reintentos y permite reintentar explícitamente sin persistir fuentes inventadas', async () => {
    const host = await prisma.hostUser.create({
      data: {
        email: 'retry@test.local',
        passwordHash: 'test',
        displayName: 'Host',
      },
    });
    const meeting = await prisma.meeting.create({
      data: {
        code: 'RETRY',
        hostId: host.id,
        title: 'Reintentos',
        status: 'active',
      },
    });
    const segment = await prisma.transcriptSegment.create({
      data: {
        resultId: 'retry',
        meetingId: meeting.id,
        text: 'Registrar clientes',
        createdAtMs: Date.now(),
      },
    });
    const caller = { kind: 'host' as const, hostUserId: host.id };
    generate.mockResolvedValue({
      requirements: [{ text: 'No autorizado', sourceIds: ['otra-reunion'] }],
      questions: [],
    });
    const queued = await ai.analyze(meeting.code, caller);
    const duplicate = await ai.analyze(meeting.code, caller);
    expect(duplicate.job?.id).toBe(queued.job?.id);
    await ai.processNext();
    await ai.processNext();
    await ai.processNext();
    expect(
      (await prisma.aiJob.findUniqueOrThrow({ where: { id: queued.job!.id } }))
        .status,
    ).toBe('failed');
    expect(await prisma.requirement.count()).toBe(0);
    generate.mockResolvedValue({
      requirements: [{ text: 'Registrar clientes', sourceIds: [segment.id] }],
      questions: [],
    });
    await ai.analyze(meeting.code, caller);
    await ai.processNext();
    expect(await prisma.requirement.count()).toBe(1);
    expect((await ai.analyze(meeting.code, caller)).unchanged).toBe(true);
  });
});
