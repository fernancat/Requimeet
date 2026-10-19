import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { MeetingAccessService } from '../meetings/meeting-access.service';
import type { Caller } from '../meetings/caller-resolver';
import type { UpdateRequirementDto } from './update-requirement.dto';
const include = {
  transcriptSegment: {
    include: { participant: { select: { id: true, displayName: true } } },
  },
};
@Injectable()
export class RequirementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: MeetingAccessService,
    private readonly events: EventEmitter2,
  ) {}
  async list(code: string, caller: Caller) {
    const meeting = await this.access.require(code, caller);
    return this.prisma.requirement.findMany({
      where: { meetingId: meeting.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include,
    });
  }
  async create(
    code: string,
    caller: Caller,
    body: { text: string; sourceIds?: string[] },
  ) {
    const meeting = await this.access.require(code, caller, true);
    if (
      typeof body.text !== 'string' ||
      !body.text.trim() ||
      body.text.length > 5000
    )
      throw new BadRequestException('Texto requerido (máximo 5000 caracteres)');
    const ids = body.sourceIds ?? [];
    if (
      !Array.isArray(ids) ||
      ids.some((id) => typeof id !== 'string') ||
      new Set(ids).size !== ids.length ||
      (await this.prisma.transcriptSegment.count({
        where: { id: { in: ids }, meetingId: meeting.id, isFinal: true },
      })) !== ids.length
    )
      throw new BadRequestException('Fuentes inválidas');
    const item = await this.prisma.requirement.create({
      data: {
        meetingId: meeting.id,
        text: body.text.trim(),
        originalText: body.text.trim(),
        sourceIds: ids,
        transcriptSegmentId: ids[0],
      },
      include,
    });
    this.events.emit('workspace.changed', { code, resource: 'requirements' });
    return item;
  }
  async update(
    code: string,
    id: string,
    caller: Caller,
    input: UpdateRequirementDto,
  ) {
    const meeting = await this.access.require(code, caller, true);
    const item = await this.prisma.$transaction(async (tx) => {
      const previous = await tx.requirement.findFirst({
        where: { id, meetingId: meeting.id },
      });
      if (!previous) throw new NotFoundException('Requerimiento no encontrado');
      if (input.version !== previous.version)
        throw new ConflictException(
          'El requerimiento cambió. Recarga para comparar tus cambios',
        );
      if (previous.status === 'APPROVED' && input.action !== 'reopen')
        throw new ConflictException(
          'Reabre el requerimiento antes de modificarlo',
        );
      if (input.action === 'reopen' && previous.status !== 'APPROVED')
        throw new BadRequestException('Solo se reabren aprobados');
      if (
        input.action &&
        (input.text !== undefined || input.status !== undefined)
      )
        throw new BadRequestException(
          'La acción debe enviarse sin otros cambios',
        );
      const text = input.text?.trim() ?? previous.text;
      if (!text || text.length > 5000)
        throw new BadRequestException('Texto inválido');
      const status =
        input.action === 'reopen'
          ? 'PENDING'
          : (input.status ??
            (text !== previous.text ? 'CORRECTED' : previous.status));
      if (input.status === 'APPROVED' && text !== previous.text)
        throw new BadRequestException(
          'Guarda el texto corregido antes de aprobar',
        );
      const history = [
        ...(Array.isArray(previous.history) ? previous.history : []),
        {
          text: previous.text,
          status: previous.status,
          discarded: previous.discarded,
          version: previous.version,
          author: meeting.hostId,
          at: new Date().toISOString(),
        },
      ];
      const changed = await tx.requirement.updateMany({
        where: { id, version: input.version },
        data: {
          text,
          status,
          history,
          version: { increment: 1 },
          discarded:
            input.action === 'discard'
              ? true
              : input.action === 'restore'
                ? false
                : previous.discarded,
        },
      });
      if (!changed.count)
        throw new ConflictException('Otro cambio fue guardado primero');
      return tx.requirement.findUniqueOrThrow({ where: { id }, include });
    });
    this.events.emit('workspace.changed', { code, resource: 'requirements' });
    return item;
  }
}
