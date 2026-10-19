import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { MeetingAccessService } from '../meetings/meeting-access.service';
import type { Caller } from '../meetings/caller-resolver';
const update = z.object({ version: z.number().int().positive(), text: z.string().trim().min(1).max(2000), status: z.enum(['PENDING','ASKED','RESOLVED','DISCARDED']), answer: z.string().trim().max(5000), evidenceIds: z.array(z.string()).max(50) }).strict();
@Injectable()
export class QuestionsService {
 constructor(private readonly prisma: PrismaService, private readonly access: MeetingAccessService, private readonly events: EventEmitter2) {}
 async list(code: string, caller: Caller) {
  const meeting = await this.access.require(code, caller);
  return this.prisma.question.findMany({ where: { meetingId: meeting.id }, orderBy: { createdAt: 'asc' } });
 }
 async edit(code: string, id: string, caller: Caller, body: unknown) {
  const meeting = await this.access.require(code, caller, true);
  const parsed = update.safeParse(body);
  if (!parsed.success) throw new BadRequestException('Pregunta inválida');
  const input = parsed.data;
  if (input.status === 'RESOLVED' && !input.answer && !input.evidenceIds.length) throw new BadRequestException('Agrega una respuesta o evidencia antes de resolver');
  const ids = [...new Set(input.evidenceIds)];
  if (await this.prisma.transcriptSegment.count({ where: { meetingId: meeting.id, id: { in: ids }, isFinal: true } }) !== ids.length) throw new BadRequestException('Evidencia inválida');
  const result = await this.prisma.$transaction(async tx => {
   const previous = await tx.question.findFirst({ where: { id, meetingId: meeting.id } });
   if (!previous || previous.version !== input.version) throw new ConflictException('La pregunta cambió; recarga para comparar');
   const history = [...(Array.isArray(previous.history) ? previous.history : []), { text: previous.text, answer: previous.answer, status: previous.status, version: previous.version, author: meeting.hostId, at: new Date().toISOString() }];
   const changed = await tx.question.updateMany({ where: { id, version: input.version }, data: { ...input, evidenceIds: ids, version: { increment: 1 }, history } });
   if (!changed.count) throw new ConflictException('Otro cambio fue guardado primero');
   return tx.question.findUniqueOrThrow({ where: { id } });
  });
  this.events.emit('workspace.changed', { code, resource: 'questions' });
  return result;
 }
}
