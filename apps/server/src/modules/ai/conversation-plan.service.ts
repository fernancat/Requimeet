import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { normalize } from './ai.schemas';
import { z } from 'zod';

export const conversationReplySchema = z.object({
  text: z.string().trim().min(1).max(650),
  // Discussion is not permission to apply a proposal: only explicit host directions.
  action: z.enum(['reply', 'replace_questions']),
  focus: z.string().trim().max(1000),
  questions: z.array(z.object({ text: z.string().trim().min(1).max(250), reason: z.string().trim().min(1).max(400) }).strict()).max(8),
}).strict();
export type ConversationReply = z.infer<typeof conversationReplySchema>;
export const isInterviewDirection = (text: string) => /\b(?:hazme|dame|prop[oó]n(?:me)?|replantea|reformula|cambia|cambiemos)\b.{0,100}\b(?:preguntas?|enfoque|tema|sugerencia)\b/iu.test(text);
export const addressesAssistant = (text: string) => /\bbrod[yi]\b/iu.test(text) || /\bqu[eé] te (?:parece|parecer[ií]a)\b/iu.test(text) || isInterviewDirection(text);

@Injectable()
export class ConversationPlanService {
  constructor(private readonly prisma: PrismaService) {}
  async apply(meetingId: string, sourceId: string, sourceRevision: number, expectedFocus: number,
    snapshot: { id: string; version: number }[], proposal: ConversationReply, utteranceId?: string) {
    return this.prisma.$transaction(async tx => {
      const meeting = await tx.meeting.findUniqueOrThrow({ where: { id: meetingId } });
      const source = await tx.transcriptSegment.findFirst({ where: { id: sourceId, meetingId, isFinal: true, revision: sourceRevision }, include: { participant: true } });
      if (!source || source.participant?.hostUserId !== meeting.hostId || source.participant.role !== 'host') throw new ForbiddenException('Solo el anfitrión puede cambiar el enfoque de la entrevista.');
      if (meeting.status !== 'active' || !proposal.questions.length) throw new ConflictException('No hay una propuesta aplicable.');
      const current = await tx.question.findMany({ where: { meetingId } });
      const candidates = proposal.questions.filter((q, index, all) => all.findIndex(other => normalize(other.text) === normalize(q.text)) === index && !current.some(old => normalize(old.text) === normalize(q.text) && (!['PENDING', 'ASKED'].includes(old.status) || !!old.answer)));
      if (!candidates.length) throw new ConflictException('Las preguntas propuestas ya existen; se conserva la guía actual.');
      const changed = await tx.meeting.updateMany({ where: { id: meetingId, brodyFocusVersion: expectedFocus }, data: { brodyFocus: proposal.focus, brodyFocusVersion: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('El enfoque cambió mientras preparaba la propuesta.');
      for (const old of current.filter(q => ['PENDING', 'ASKED'].includes(q.status) && !q.answer && !candidates.some(item => normalize(item.text) === normalize(q.text)))) {
        // Preserve manual edits and any response evidence; never discard decisions.
        const history = Array.isArray(old.history) ? old.history : [];
        if (old.evidenceIds.length || history.some(h => h && typeof h === 'object' && !Array.isArray(h) && 'author' in h && h.author !== 'brody')) continue;
        const original = snapshot.find(q => q.id === old.id);
        if (!original || original.version !== old.version) throw new ConflictException('La guía cambió mientras preparaba la propuesta.');
        const updated = await tx.question.updateMany({ where: { id: old.id, version: original.version, status: old.status, answer: '' }, data: {
          status: 'DISCARDED', version: { increment: 1 }, history: [...history, { event: 'host-refocused', author: 'brody', requestedBy: meeting.hostId, sourceId, at: new Date().toISOString(), text: old.text, status: old.status, version: old.version }],
        } });
        if (!updated.count) throw new ConflictException('Una edición más reciente tiene prioridad.');
      }
      const saved = [];
      for (const [index, item] of candidates.entries()) {
        const existing = current.find(q => normalize(q.text) === normalize(item.text));
        if (existing) { saved.push(existing); continue; }
        saved.push(await tx.question.create({ data: {
        meetingId, text: item.text, normalizedText: normalize(item.text), reason: item.reason, category: 'missing', priority: 'MEDIUM', sourceIds: [sourceId],
        createdAt: new Date(Date.now() + index),
        history: [{ event: 'host-requested', author: 'brody', sourceId, requestedBy: meeting.hostId, at: new Date().toISOString() }],
      } }));
      }
      if (utteranceId) {
        const published = await tx.brodyUtterance.updateMany({ where: { id: utteranceId, meetingId }, data: { questionIds: saved.map(q => q.id), text: `Actualicé la guía con ${saved.length} preguntas. Empecemos por: ${saved[0].text}` } });
        if (!published.count) throw new ConflictException('La intervención ya no está disponible.');
      }
      return saved;
    });
  }
}
