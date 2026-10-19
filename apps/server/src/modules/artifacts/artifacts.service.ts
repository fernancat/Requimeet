import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiJob, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MeetingAccessService } from '../meetings/meeting-access.service';
import type { Caller } from '../meetings/caller-resolver';
import { AiService } from '../ai/ai.service';
import { OpenRouterService } from '../ai/openrouter.service';
import { checkSources } from '../ai/ai.schemas';
import { entitySchema } from './artifact.schemas';
@Injectable()
export class ArtifactsService implements OnModuleInit {
 constructor(private readonly prisma: PrismaService, private readonly access: MeetingAccessService, private readonly ai: AiService, private readonly router: OpenRouterService, private readonly events: EventEmitter2) {}
 onModuleInit() { this.ai.register('entities', job => this.generateEntities(job)); }
 async source(meetingId: string, kind: string) {
  const requirements = await this.prisma.requirement.findMany({ where: { meetingId }, orderBy: { id: 'asc' }, select: { id: true, text: true, status: true, version: true, discarded: true, sourceIds: true } });
  const questions = kind === 'document' ? await this.prisma.question.findMany({ where: { meetingId }, orderBy: { id: 'asc' }, select: { id: true, text: true, answer: true, status: true, version: true } }) : [];
  const transcripts = kind === 'document' ? await this.prisma.transcriptSegment.findMany({ where: { meetingId, isFinal: true }, orderBy: { id: 'asc' }, select: { id: true, revision: true } }) : [];
  const meeting = await this.prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
  const entities = kind === 'document' && meeting.selectedEntityId ? await this.prisma.artifact.findUnique({ where: { id: meeting.selectedEntityId }, select: { id: true, version: true, content: true } }) : null;
  const snapshot = { title: meeting.title, requirements, questions, entities, transcripts };
  const fingerprint = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return { ...snapshot, fingerprint };
 }
 async list(code: string, kind: string, caller: Caller) {
  this.kind(kind);
  const meeting = await this.access.require(code, caller);
  const source = await this.source(meeting.id, kind);
  const items = await this.prisma.artifact.findMany({ where: { meetingId: meeting.id, kind }, orderBy: { createdAt: 'desc' } });
  return { items: items.map(item => ({ ...item, stale: item.sourceFingerprint !== source.fingerprint })), selectedId: kind === 'entities' ? meeting.selectedEntityId : meeting.selectedDocumentId, excludedCount: source.requirements.filter(r => r.status !== 'APPROVED' || r.discarded).length };
 }
 async generate(code: string, kind: string, caller: Caller) {
  this.kind(kind);
  const meeting = await this.access.require(code, caller, true);
  const source = await this.source(meeting.id, kind);
  if (!source.requirements.some(r => r.status === 'APPROVED' && !r.discarded)) throw new BadRequestException('Aprueba al menos un requerimiento antes de generar');
  // Se conserva la instantánea íntegra; no truncar silenciosamente el documento.
  if (JSON.stringify(source).length > 250000) throw new BadRequestException('El levantamiento excede el límite de generación (250000 caracteres)');
  return this.ai.enqueue(meeting.id, kind, source);
 }
 protected kind(kind: string) { if (kind !== 'entities') throw new NotFoundException('Recurso desconocido'); }
 async edit(code: string, kind: string, id: string, caller: Caller, body: { version: number; content?: unknown; action?: string }) {
  this.kind(kind);
  const meeting = await this.access.require(code, caller, true);
  if (!Number.isInteger(body.version) || body.version < 1 || body.action && !['select','review'].includes(body.action)) throw new BadRequestException('Versión o acción inválida');
  const source = await this.source(meeting.id, kind);
  const content = body.content === undefined ? undefined : this.validate(kind, body.content, source.requirements.filter(r => r.status === 'APPROVED' && !r.discarded).map(r => r.id));
  const result = await this.prisma.$transaction(async tx => {
   const previous = await tx.artifact.findFirst({ where: { id, meetingId: meeting.id, kind } });
   if (!previous || previous.version !== body.version) throw new ConflictException('El contenido cambió; recarga antes de guardar');
   if (body.action === 'review' && previous.sourceFingerprint !== source.fingerprint) throw new ConflictException('Las fuentes cambiaron; genera y revisa una propuesta actualizada');
   const history = [...(Array.isArray(previous.history) ? previous.history : []), { content: previous.content, version: previous.version, reviewed: previous.reviewed, at: new Date().toISOString(), author: meeting.hostId }];
   const changed = await tx.artifact.updateMany({ where: { id, version: body.version }, data: { ...(content === undefined ? {} : { content: content as Prisma.InputJsonValue }), reviewed: body.action === 'review', version: { increment: 1 }, history } });
   if (!changed.count) throw new ConflictException('Otro cambio fue guardado primero');
   if (body.action === 'select') await tx.meeting.update({ where: { id: meeting.id }, data: kind === 'entities' ? { selectedEntityId: id } : { selectedDocumentId: id } });
   return tx.artifact.findUniqueOrThrow({ where: { id } });
  });
  this.events.emit('workspace.changed', { code, resource: kind });
  return result;
 }
 validate(kind: string, value: unknown, allowedIds: string[]) {
  const parsed = entitySchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => i.message).join('; '));
  const allowed = new Set(allowedIds);
  try { for (const item of [...parsed.data.entities, ...parsed.data.relations]) checkSources(item.sourceIds, allowed); }
  catch { throw new BadRequestException('Las fuentes deben ser requerimientos aprobados de esta reunión'); }
  return parsed.data;
 }
 async saveProposal(job: AiJob, content: unknown, fingerprint: string) {
  const item = await this.prisma.artifact.upsert({ where: { jobId: job.id }, create: { jobId: job.id, meetingId: job.meetingId, kind: job.kind, content: content as Prisma.InputJsonValue, sourceFingerprint: fingerprint }, update: {} });
  await this.prisma.meeting.updateMany({ where: { id: job.meetingId, ...(job.kind === 'entities' ? { selectedEntityId: null } : { selectedDocumentId: null }) }, data: job.kind === 'entities' ? { selectedEntityId: item.id } : { selectedDocumentId: item.id } });
  return { artifactId: item.id };
 }
 private async generateEntities(job: AiJob) {
  const source = job.input as unknown as Awaited<ReturnType<ArtifactsService['source']>>;
  const requirements = source.requirements.filter(r => r.status === 'APPROVED' && !r.discarded);
  const output = await this.router.generate('Genera un modelo conceptual entidad-relación desde los requerimientos aprobados. JSON {"entities":[{"id":"cliente","name":"Cliente","sourceIds":["id-requerimiento"],"attributes":[{"id":"nombre","name":"nombre","type":"texto","required":true,"identifier":false}]}],"relations":[{"id":"r1","name":"realiza","from":"cliente","to":"pedido","cardinality":"1:1|1:N|N:M","sourceIds":["id-requerimiento"]}]}. Solo entidades fundamentadas; IDs únicos. Si no hay entidades inferibles usa arrays vacíos.', { requirements });
  return this.saveProposal(job, this.validate('entities', output, requirements.map(r => r.id)), source.fingerprint);
 }
}
