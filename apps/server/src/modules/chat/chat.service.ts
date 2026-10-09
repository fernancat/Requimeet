import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChatMessage, Meeting, Participant, Prisma } from '@prisma/client';
import type { ChatMessageDto } from '@requimeet/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { Caller } from '../meetings/caller-resolver';

const BODY_MAX = 2000;
const CLIENT_REF_MIN = 8;
const CLIENT_REF_MAX = 64;
const HISTORY_LIMIT = 500;

export interface SendChatInput {
  meetingCode: string;
  caller: Caller;
  body: string;
  clientRef: string;
}

export interface SendChatResult {
  message: ChatMessageDto;
  /** false si era un reintento con clientRef ya persistido (no re-broadcast). */
  created: boolean;
}

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persiste un mensaje. Dedupe por UNIQUE(meetingId, authorParticipantId,
   * clientRef): un reintento con el mismo clientRef devuelve el mensaje
   * existente sin duplicar.
   */
  async send(input: SendChatInput): Promise<SendChatResult> {
    const body = input.body.trim();
    if (body.length < 1 || body.length > BODY_MAX) {
      throw new BadRequestException('body must be 1..2000 chars');
    }
    if (
      typeof input.clientRef !== 'string' ||
      input.clientRef.length < CLIENT_REF_MIN ||
      input.clientRef.length > CLIENT_REF_MAX
    ) {
      throw new BadRequestException('clientRef must be 8..64 chars');
    }
    const { meeting, participant } = await this.requireAdmitted(
      input.meetingCode,
      input.caller,
    );
    try {
      const message = await this.prisma.chatMessage.create({
        data: {
          meetingId: meeting.id,
          authorParticipantId: participant.id,
          authorName: participant.displayName,
          body,
          clientRef: input.clientRef,
        },
      });
      return { message: this.toDto(message), created: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.chatMessage.findUniqueOrThrow({
          where: {
            meetingId_authorParticipantId_clientRef: {
              meetingId: meeting.id,
              authorParticipantId: participant.id,
              clientRef: input.clientRef,
            },
          },
        });
        return { message: this.toDto(existing), created: false };
      }
      throw error;
    }
  }

  /**
   * Historial completo ascendente (un recien admitido SI ve los mensajes
   * anteriores), limitado a los ultimos 500.
   */
  async history(meetingCode: string, caller: Caller): Promise<ChatMessageDto[]> {
    const { meeting } = await this.requireAdmitted(meetingCode, caller);
    const messages = await this.prisma.chatMessage.findMany({
      where: { meetingId: meeting.id },
      orderBy: { createdAt: 'asc' },
      take: HISTORY_LIMIT,
    });
    return messages.map((m) => this.toDto(m));
  }

  private async requireAdmitted(
    meetingCode: string,
    caller: Caller,
  ): Promise<{ meeting: Meeting; participant: Participant }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { code: meetingCode },
    });
    if (!meeting) {
      throw new NotFoundException('meeting not found');
    }
    const participant = await this.prisma.participant.findFirst({
      where:
        caller.kind === 'host'
          ? { meetingId: meeting.id, hostUserId: caller.hostUserId }
          : { meetingId: meeting.id, guestSessionId: caller.guestSessionId },
    });
    if (!participant || participant.state !== 'admitted') {
      throw new ForbiddenException('caller is not an admitted participant');
    }
    return { meeting, participant };
  }

  private toDto(message: ChatMessage): ChatMessageDto {
    return {
      id: message.id,
      meetingId: message.meetingId,
      authorParticipantId: message.authorParticipantId,
      authorName: message.authorName,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
      clientRef: message.clientRef,
    };
  }
}
