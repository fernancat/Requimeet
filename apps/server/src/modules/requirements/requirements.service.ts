import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ProcessingResult } from '@requimeet/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import type { Caller } from '../meetings/caller-resolver';
import { extractRequirementCandidates } from './requirement-extractor';
import type { UpdateRequirementDto } from './update-requirement.dto';

@Injectable()
export class RequirementsService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireMeetingAccess(code: string, caller: Caller) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { code },
    });

    if (!meeting) {
      throw new NotFoundException('Reunión no encontrada');
    }

    const participant = await this.prisma.participant.findFirst({
      where: {
        meetingId: meeting.id,
        state: 'admitted',
        ...(caller.kind === 'host'
          ? { hostUserId: caller.hostUserId }
          : { guestSessionId: caller.guestSessionId }),
      },
      select: { id: true },
    });

    if (!participant) {
      throw new ForbiddenException(
        'Debes ser participante admitido de esta reunión',
      );
    }

    return meeting;
  }

  async list(code: string, caller: Caller) {
    const meeting = await this.requireMeetingAccess(code, caller);

    return this.prisma.requirement.findMany({
      where: { meetingId: meeting.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        transcriptSegment: {
          include: {
            participant: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
      },
    });
  }

    async update(
    code: string,
    requirementId: string,
    caller: Caller,
    input: UpdateRequirementDto,
  ) {
    const meeting = await this.requireMeetingAccess(code, caller);

    const requirement = await this.prisma.requirement.findFirst({
      where: {
        id: requirementId,
        meetingId: meeting.id,
      },
    });

    if (!requirement) {
      throw new NotFoundException('Requerimiento no encontrado');
    }

    if (input.text === undefined && input.status === undefined) {
      throw new BadRequestException(
        'Debes enviar el texto o el estado que deseas cambiar',
      );
    }

    const text = input.text?.trim();

    if (text !== undefined && text.length === 0) {
      throw new BadRequestException('El texto no puede estar vacío');
    }

    const textChanged =
      text !== undefined && text !== requirement.text;

    return this.prisma.requirement.update({
      where: { id: requirement.id },
      data: {
        ...(text !== undefined ? { text } : {}),
        status:
          input.status ??
          (textChanged ? 'CORRECTED' : requirement.status),
      },
      include: {
        transcriptSegment: {
          include: {
            participant: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
      },
    });
  }

  async saveFinalTranscript(result: ProcessingResult) {
    if (result.kind !== 'transcript-final' || !result.isFinal) {
      return null;
    }

    const { text, startMs, endMs } = result.payload;

    if (typeof text !== 'string' || !text.trim()) {
      return null;
    }

    if (result.participantId) {
      const participant = await this.prisma.participant.findFirst({
        where: {
          id: result.participantId,
          meetingId: result.meetingId,
        },
        select: { id: true },
      });

      if (!participant) {
        throw new BadRequestException(
          'El participante no pertenece a la reunión',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const segment = await tx.transcriptSegment.upsert({
        where: { resultId: result.resultId },
        update: {},
        create: {
          resultId: result.resultId,
          meetingId: result.meetingId,
          participantId: result.participantId ?? null,
          trackSid: result.trackSid ?? null,
          text: text.trim(),
          startMs:
            typeof startMs === 'number' && Number.isFinite(startMs)
              ? startMs
              : null,
          endMs:
            typeof endMs === 'number' && Number.isFinite(endMs)
              ? endMs
              : null,
          createdAtMs: result.createdAtMs,
        },
      });

      if (segment.meetingId !== result.meetingId) {
        throw new BadRequestException(
          'El resultado ya pertenece a otra reunión',
        );
      }

      const candidates = extractRequirementCandidates(segment.text);

      if (candidates.length > 0) {
        await tx.requirement.createMany({
          data: candidates.map((candidate) => ({
            meetingId: segment.meetingId,
            transcriptSegmentId: segment.id,
            originalText: candidate,
            text: candidate,
            status: 'PENDING' as const,
          })),
          skipDuplicates: true,
        });
      }

      return segment;
    });
  }
}