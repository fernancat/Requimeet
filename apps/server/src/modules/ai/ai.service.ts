import { compactIds } from './compact-ids';
import { LIVE_ANALYSIS_PROMPT } from './live-analysis.prompt';
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { createHash } from 'node:crypto';
import { Prisma, AiJob } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MeetingAccessService } from '../meetings/meeting-access.service';
import type { Caller } from '../meetings/caller-resolver';
import { OpenRouterService } from './openrouter.service';
import { analysisSchema, checkSources, normalize } from './ai.schemas';

type AnalysisInput = {
  segments: { id: string; text: string; revision: number; createdAtMs?: number; speakerRole?: string }[];
  context: { id: string; text: string; revision?: number; createdAtMs?: number; speakerRole?: string }[];
  requirements: { text: string; status: string }[];
  questions: { id: string; version: number; text: string; status: string; answer: string; eligibleSourceIds: string[] }[];
};
export type JobHandler = (job: AiJob) => Promise<unknown>;
@Injectable()
export class AiService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private timers = new Map<string, NodeJS.Timeout>();
  private running = false;
  private stopped = false;
  private handlers = new Map<string, JobHandler>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: MeetingAccessService,
    private readonly router: OpenRouterService,
    private readonly events: EventEmitter2,
  ) {}
  register(kind: string, handler: JobHandler) {
    this.handlers.set(kind, handler);
  }
  async onModuleInit() {
    if (!this.router.enabled()) return;
    // Un único proceso servidor ejecuta la cola PostgreSQL; no requiere Redis.
    await this.prisma.aiJob.updateMany({
      where: { status: 'running' },
      data: { status: 'queued' },
    });
    this.timer = setInterval(
      () => void this.processNext().catch(() => {}),
      500,
    );
    this.timer.unref();
    const meetings = await this.prisma.meeting.findMany({
      where: { transcriptSegments: { some: { isFinal: true } } },
      select: { id: true },
    });
    for (const meeting of meetings) this.schedule({ meetingId: meeting.id });
  }
  onModuleDestroy() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const timer of this.timers.values()) clearTimeout(timer);
  }
  @OnEvent('transcript.confirmed')
  schedule({ meetingId }: { meetingId: string }) {
    if (!this.router.enabled() || this.stopped || this.timers.has(meetingId))
      return;
    const timer = setTimeout(() => {
      this.timers.delete(meetingId);
      void this.enqueueAnalysis(meetingId).catch(() => {});
    }, 800);
    timer.unref();
    this.timers.set(meetingId, timer);
  }
  async list(code: string, caller: Caller) {
    const meeting = await this.access.require(code, caller);
    return {
      enabled: this.router.enabled(),
      model: this.router.model,
      jobs: await this.prisma.aiJob.findMany({
        where: { meetingId: meeting.id },
        select: {
          id: true,
          kind: true,
          status: true,
          error: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    };
  }
  async analyze(code: string, caller: Caller) {
    const meeting = await this.access.require(code, caller, true);
    if (!this.router.enabled())
      throw new ServiceUnavailableException(
        'Configura OpenRouter para analizar',
      );
    const job = await this.enqueueAnalysis(meeting.id, true);
    return { job, unchanged: !job };
  }
  async enqueue(meetingId: string, kind: string, input: unknown) {
    if (!this.router.enabled())
      throw new ServiceUnavailableException(
        'Configura OpenRouter para generar',
      );
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    const job = await this.prisma.aiJob.upsert({
      where: { meetingId_kind_fingerprint: { meetingId, kind, fingerprint } },
      create: {
        meetingId,
        kind,
        fingerprint,
        input: input as Prisma.InputJsonValue,
      },
      update: {},
    });
    await this.notify(meetingId);
    return job;
  }
  private async enqueueAnalysis(meetingId: string, retry = false) {
    const active = await this.prisma.aiJob.findFirst({
      where: {
        meetingId,
        kind: 'analysis',
        status: { in: ['queued', 'running'] },
      },
    });
    if (active) return active;
    let pending = await this.prisma.transcriptSegment.findMany({
      where: {
        meetingId,
        isFinal: true,
        revision: { gt: this.prisma.transcriptSegment.fields.analyzedRevision },
      },
      orderBy: [{ createdAtMs: 'asc' }, { id: 'asc' }],
      take: 20,
      include: { participant: { select: { role: true } } },
    });
    // Explicit retry can revisit an unanswered turn after a prompt fix, even if
    // its segments were already analyzed. Fingerprinting still deduplicates it.
    if (!pending.length && retry && await this.prisma.question.count({ where: { meetingId, status: 'ASKED', answer: '' } })) {
      pending = (await this.prisma.transcriptSegment.findMany({
        where: { meetingId, isFinal: true }, orderBy: [{ createdAtMs: 'desc' }, { id: 'desc' }], take: 20,
        include: { participant: { select: { role: true } } },
      })).reverse();
    }
    if (!pending.length) return null;
    // Acota caracteres además del número de segmentos.
    const segments: AnalysisInput['segments'] = [];
    let size = 0;
    for (const s of pending) {
      if (size && size + s.text.length > 40000) break;
      segments.push({ id: s.id, text: s.text, revision: s.revision, createdAtMs: s.createdAtMs, speakerRole: s.participant?.role });
      size += s.text.length;
    }
    const context = await this.prisma.transcriptSegment.findMany({
      where: {
        meetingId,
        isFinal: true,
        id: { notIn: segments.map((s) => s.id) },
      },
      orderBy: { createdAtMs: 'desc' },
      take: 10,
      select: { id: true, text: true, revision: true, createdAtMs: true, participant: { select: { role: true } } },
    });
    const requirements = await this.prisma.requirement.findMany({
      where: { meetingId },
      select: { text: true, status: true },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });
    const questions = await this.prisma.question.findMany({
      where: { meetingId },
      select: { id: true, version: true, text: true, status: true, answer: true, askedAt: true, answerSuggestion: true, createdAt: true },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });
    const input = {
      policyVersion: 'brody-live-v3',
      segments,
      context: context.slice().reverse().map(s => ({ id: s.id, text: s.text.slice(0, 3000), revision: s.revision, createdAtMs: s.createdAtMs, speakerRole: s.participant?.role })),
      requirements,
      questions: questions.map(q => ({ id: q.id, version: q.version, text: q.text, status: q.status, answer: q.answer,
        eligibleSourceIds: ['PENDING', 'ASKED'].includes(q.status) && !q.answer
          ? [...pending.filter(s => segments.some(item => item.id === s.id)), ...context].filter(s => s.createdAtMs >= (q.askedAt ?? q.createdAt).getTime()).map(s => s.id)
          : [],
      })),
    };
    const job = await this.enqueue(meetingId, 'analysis', input);
    if (retry && job.status === 'failed')
      return this.prisma.aiJob.update({
        where: { id: job.id },
        data: { status: 'queued', attempts: 0, error: null },
      });
    return job;
  }
  private async notify(meetingId: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
    });
    if (meeting)
      this.events.emit('workspace.changed', {
        code: meeting.code,
        resource: 'analysis',
      });
  }
  async processNext() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const job = await this.prisma.aiJob.findFirst({
        where: { status: 'queued' },
        orderBy: { createdAt: 'asc' },
      });
      if (!job) return;
      const claimed = await this.prisma.aiJob.updateMany({
        where: { id: job.id, status: 'queued' },
        data: { status: 'running', attempts: { increment: 1 }, error: null },
      });
      if (!claimed.count) return;
      await this.notify(job.meetingId);
      try {
        const output =
          job.kind === 'analysis'
            ? await this.runAnalysis(job)
            : await this.handlers.get(job.kind)?.(job);
        if (output === undefined) throw new Error('Generador no disponible');
        await this.prisma.aiJob.update({
          where: { id: job.id },
          data: {
            status: 'completed',
            output: output as Prisma.InputJsonValue,
          },
        });
        this.schedule({ meetingId: job.meetingId });
      } catch (error) {
        await this.prisma.aiJob.update({
          where: { id: job.id },
          data: {
            status: job.attempts < 2 ? 'queued' : 'failed',
            error:
              error instanceof Error
                ? error.message.slice(0, 250)
                : 'No se pudo completar el análisis',
          },
        });
      }
      await this.notify(job.meetingId);
    } finally {
      this.running = false;
    }
  }
  private async runAnalysis(job: AiJob) {
    const input = job.input as unknown as AnalysisInput;
    const wire = compactIds(input);
    const result = analysisSchema.parse(wire.expand(
      await this.router.generate(
        LIVE_ANALYSIS_PROMPT,
        wire.input,
        { live: true, onPartial: async arrays => {
          // A complete array is an independently validated unit, never token text.
          if (!Object.hasOwn(arrays, 'askedQuestions')) return;
          const ready = analysisSchema.parse(wire.expand({ questions: [], ...arrays, requirements: [] }));
          await this.persistAnalysis(job, input, ready, false);
          await this.notify(job.meetingId);
        } },
      ),
    ));
    await this.persistAnalysis(job, input, result, true);
    return result;
  }
  private async persistAnalysis(job: AiJob, input: AnalysisInput, result: ReturnType<typeof analysisSchema.parse>, final: boolean) {
    const allowed = new Set(
      [...input.segments, ...input.context].map((s) => s.id),
    );
    for (const item of [...result.requirements, ...result.questions])
      checkSources(item.sourceIds, allowed);
    const allSegments = [...input.segments, ...input.context];
    const detections = new Map<string, { sourceId: string; quote: string; at: number }>();
    for (const asked of result.askedQuestions) {
      const question = input.questions.find(q => q.id === asked.questionId);
      const source = allSegments.find(s => s.id === asked.sourceId);
      if (!question || question.status !== 'PENDING' || !question.eligibleSourceIds.includes(asked.sourceId) ||
          !source || source.speakerRole !== 'host' || !source.text.includes(asked.quote) || !Number.isFinite(source.createdAtMs))
        throw new Error('Detección de pregunta sin evidencia válida del anfitrión');
      detections.set(question.id, { sourceId: source.id, quote: asked.quote, at: source.createdAtMs! });
    }
    for (const suggestion of result.answerSuggestions) {
      const question = input.questions.find(q => q.id === suggestion.questionId);
      if (!question || (question.status !== 'ASKED' && !detections.has(question.id))) throw new Error('Respuesta para una pregunta no realizada');
      checkSources(suggestion.sourceIds, new Set(question.eligibleSourceIds ?? []));
      const detected = detections.get(question.id);
      if (detected && suggestion.sourceIds.some(id => (allSegments.find(s => s.id === id)?.createdAtMs ?? -1) < detected.at))
        throw new Error('La respuesta precede a la pregunta');
      if (detected && suggestion.sourceIds.includes(detected.sourceId) && !suggestion.quotes.some(quote =>
        quote.sourceId === detected.sourceId && allSegments.find(s => s.id === quote.sourceId)!.text.indexOf(quote.text, allSegments.find(s => s.id === quote.sourceId)!.text.indexOf(detected.quote) + detected.quote.length) >= 0))
        throw new Error('La pregunta no es evidencia de su propia respuesta');
    }
    await this.prisma.$transaction(async (tx) => {
      const detectedVersions = new Map<string, number>();
      for (const [id, detected] of detections) {
        const question = input.questions.find(q => q.id === id)!;
        const source = allSegments.find(s => s.id === detected.sourceId)!;
        const valid = await tx.transcriptSegment.findFirst({ where: { id: source.id, meetingId: job.meetingId, revision: source.revision, isFinal: true } });
        const previous = await tx.question.findUnique({ where: { id } });
        if (!valid || !previous) continue;
        if (previous.status === 'ASKED' && previous.version === question.version + 1 && Array.isArray(previous.history) && previous.history.some(entry =>
          entry && typeof entry === 'object' && !Array.isArray(entry) && entry.jobId === job.id && entry.event === 'question-detected')) {
          detectedVersions.set(id, previous.version); continue;
        }
        if (previous.version !== question.version || previous.status !== 'PENDING') continue;
        const changed = await tx.question.updateMany({ where: { id, version: question.version, status: 'PENDING', answer: '' },
          data: { status: 'ASKED', askedAt: new Date(detected.at), version: { increment: 1 }, history: [
            ...(Array.isArray(previous.history) ? previous.history : []),
            { text: previous.text, answer: previous.answer, status: previous.status, version: previous.version,
              author: 'brody', at: new Date().toISOString(), event: 'question-detected', sourceId: detected.sourceId, quote: detected.quote, jobId: job.id },
          ] },
        });
        if (changed.count) detectedVersions.set(id, question.version + 1);
      }
      for (const suggestion of result.answerSuggestions) {
        const question = input.questions.find(q => q.id === suggestion.questionId)!;
        const evidence = await tx.transcriptSegment.findMany({
          where: { meetingId: job.meetingId, id: { in: suggestion.sourceIds }, isFinal: true },
          select: { id: true, revision: true },
        });
        if (evidence.length !== new Set(suggestion.sourceIds).size || evidence.some(s => ![...input.segments, ...input.context].some(original => original.id === s.id && original.revision === s.revision))) continue;
        const previous = await tx.question.findUnique({ where: { id: question.id } });
        if (!previous || previous.version !== (detectedVersions.get(question.id) ?? question.version) || previous.status !== 'ASKED' || previous.answer) continue;
        const grounded = suggestion.sourceIds.every(id => suggestion.quotes.some(quote =>
          quote.sourceId === id && [...input.segments, ...input.context].some(segment => segment.id === id && segment.text.includes(quote.text))
        )) && suggestion.quotes.every(quote => suggestion.sourceIds.includes(quote.sourceId) && [...input.segments, ...input.context].some(segment => segment.id === quote.sourceId && segment.text.includes(quote.text)));
        const automatic = suggestion.clarity === 'clear' && grounded;
        // Compare-and-swap: human edits and newer proposals always win.
        const history = [
          ...(Array.isArray(previous.history) ? previous.history : []),
          { text: previous.text, answer: previous.answer, status: previous.status,
            evidenceIds: previous.evidenceIds, version: previous.version,
            answerSuggestion: previous.answerSuggestion, automaticResolution: previous.automaticResolution,
            author: 'brody', at: new Date().toISOString(), reason: suggestion.reason, jobId: job.id },
        ];
        await tx.question.updateMany({
          where: { id: question.id, meetingId: job.meetingId, version: previous.version, status: 'ASKED', answer: '' },
          data: automatic
            ? { status: 'RESOLVED', answer: suggestion.text, evidenceIds: suggestion.sourceIds,
                answerSuggestion: Prisma.DbNull, automaticResolution: true, history, version: { increment: 1 } }
            : { answerSuggestion: { text: suggestion.text, sourceIds: suggestion.sourceIds, reason: suggestion.clarity === 'clear' && !grounded ? 'No pude verificar las citas de esta respuesta. Necesito que la revises.' : suggestion.reason }, history, version: { increment: 1 } },
        });
      }
      const current = await tx.requirement.findMany({
        where: { meetingId: job.meetingId },
        select: { text: true, originalText: true },
      });
      const known = new Set(
        current.flatMap((r) => [normalize(r.text), normalize(r.originalText)]),
      );
      for (const item of result.requirements) {
        if (known.has(normalize(item.text))) continue;
        await tx.requirement.create({
          data: {
            meetingId: job.meetingId,
            text: item.text,
            originalText: item.text,
            sourceIds: item.sourceIds,
            transcriptSegmentId: item.sourceIds[0],
          },
        });
        known.add(normalize(item.text));
      }
      await tx.question.createMany({
        data: result.questions.map((q) => ({
          ...q,
          meetingId: job.meetingId,
          normalizedText: normalize(q.text),
        })),
        skipDuplicates: true,
      });
      if (final) for (const segment of input.segments)
        await tx.transcriptSegment.updateMany({
          where: { id: segment.id, revision: segment.revision },
          data: { analyzedRevision: segment.revision },
        });
    });
    return result;
  }
}
