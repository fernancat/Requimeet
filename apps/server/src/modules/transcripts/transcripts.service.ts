import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ProcessingResult } from '@requimeet/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { MeetingAccessService } from '../meetings/meeting-access.service';
import type { Caller } from '../meetings/caller-resolver';
@Injectable()
export class TranscriptsService {
  constructor(private readonly prisma: PrismaService, private readonly access: MeetingAccessService, private readonly events: EventEmitter2) {}
  async list(code: string, caller: Caller, cursor?: string) {
    const meeting = await this.access.require(code, caller);
    const items = await this.prisma.transcriptSegment.findMany({ where: { meetingId: meeting.id }, orderBy: { id: 'asc' }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { participant: { select: { displayName: true } } } });
    return { items, nextCursor: items.length === 100 ? items[99].id : null };
  }
  async save(result: ProcessingResult) {
    if (!result.kind.startsWith('transcript-')) return null;
    const { text, startMs, endMs, trackStartMs, trackEndMs } = result.payload;
    const revision = result.revision ?? 1;
    if (typeof text !== 'string' || !text.trim() || text.length > 30000 || !Number.isSafeInteger(revision) || revision < 1 ||
      result.isFinal !== (result.kind === 'transcript-final') || !Number.isFinite(result.createdAtMs)) throw new BadRequestException('Transcripción inválida');
    const time = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
    if (time(startMs) !== null && time(endMs) !== null && Number(endMs) < Number(startMs)) throw new BadRequestException('Intervalo inválido');
    if (!result.participantId || !await this.prisma.participant.findFirst({ where: { id: result.participantId, meetingId: result.meetingId } })) throw new BadRequestException('Participante inválido');
    const data = { text: text.trim(), originalText: text.trim(), revision, isFinal: result.isFinal, startMs: time(startMs), endMs: time(endMs), trackStartMs: time(trackStartMs), trackEndMs: time(trackEndMs) };
    const saved = await this.prisma.$transaction(async tx => {
      await tx.transcriptSegment.createMany({ data: [{ ...data, resultId: result.resultId, meetingId: result.meetingId, participantId: result.participantId, trackSid: result.trackSid, createdAtMs: result.createdAtMs }], skipDuplicates: true });
      const existing = await tx.transcriptSegment.findUniqueOrThrow({ where: { resultId: result.resultId } });
      if (existing.meetingId !== result.meetingId || existing.participantId !== result.participantId) throw new BadRequestException('Resultado ajeno a la reunión');
      await tx.transcriptSegment.updateMany({ where: { id: existing.id, revision: { lt: revision }, isFinal: false, edited: false }, data });
      return tx.transcriptSegment.findUniqueOrThrow({ where: { id: existing.id } });
    });
    if (saved.isFinal) this.events.emit('transcript.confirmed', { meetingId: saved.meetingId });
    return saved;
  }
  async edit(code: string, id: string, caller: Caller, body: { text: string; version: number }) {
    const meeting = await this.access.require(code, caller, true);
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 30000 || !Number.isInteger(body.version)) throw new BadRequestException('Texto y versión requeridos');
    const updated = await this.prisma.$transaction(async tx => {
      const previous = await tx.transcriptSegment.findFirst({ where: { id, meetingId: meeting.id, isFinal: true } });
      if (!previous || previous.revision !== body.version) throw new ConflictException('La transcripción cambió; recarga antes de guardar');
      const history = [...(Array.isArray(previous.history) ? previous.history : []), { text: previous.text, revision: previous.revision, at: new Date().toISOString(), author: meeting.hostId }];
      const result = await tx.transcriptSegment.updateMany({ where: { id, revision: body.version }, data: { text: body.text.trim(), edited: true, revision: { increment: 1 }, history } });
      if (!result.count) throw new ConflictException('La transcripción cambió');
      return tx.transcriptSegment.findUniqueOrThrow({ where: { id } });
    });
    this.events.emit('transcript.confirmed', { meetingId: meeting.id });
    this.events.emit('workspace.changed', { code, resource: 'transcripts' });
    return updated;
  }
}
