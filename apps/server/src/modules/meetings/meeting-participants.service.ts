import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Meeting, Participant } from '@prisma/client';
import type { MediaTokenResponse, ParticipantDto, ParticipantRole, ParticipantState } from '@requimeet/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { LivekitRoomService, MuteResult } from '../livekit/livekit-room.service';
import { LivekitTokenService } from '../livekit/livekit-token.service';
import { DOMAIN_EVENTS } from './meetings.events';

export type Caller =
  | { kind: 'host'; hostUserId: string }
  | { kind: 'guest'; guestSessionId: string };

@Injectable()
export class MeetingParticipantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: LivekitTokenService,
    private readonly rooms: LivekitRoomService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Emite token LiveKit solo si el caller es participante admitido de una
   * reunion activa. Es la restriccion real de la sala de espera: un invitado
   * pending/rejected/kicked nunca recibe token. Toda renovacion revalida aqui.
   */
  async createMediaToken(caller: Caller, code: string): Promise<MediaTokenResponse> {
    const meeting = await this.getMeetingOr404(code);
    if (meeting.status !== 'active') {
      throw new ConflictException('meeting is not active');
    }
    const participant = await this.findCallerParticipant(meeting, caller);
    if (!participant || participant.state !== 'admitted') {
      throw new ForbiddenException('caller is not an admitted participant');
    }
    return this.tokens.createParticipantToken(meeting, participant);
  }

  /**
   * Expulsa al participante (persistente) y lo desconecta del SFU.
   * LiveKit OSS no revoca tokens ya emitidos: la ventana residual es
   * <= LIVEKIT_TOKEN_TTL; media-token revalida y rechaza renovaciones.
   */
  async kick(
    hostUserId: string,
    code: string,
    participantId: string,
  ): Promise<ParticipantDto> {
    const meeting = await this.getOwnedMeeting(hostUserId, code);
    const participant = await this.prisma.participant.findFirst({
      where: { id: participantId, meetingId: meeting.id },
    });
    if (!participant) {
      throw new NotFoundException('participant not found');
    }
    if (participant.role === 'host') {
      throw new ForbiddenException('cannot kick the host');
    }
    const updated =
      participant.state === 'kicked'
        ? participant
        : await this.prisma.participant.update({
            where: { id: participant.id },
            data: { state: 'kicked', leftAt: new Date() },
          });
    await this.rooms.removeParticipant(meeting.code, participant.id);
    this.events.emit(DOMAIN_EVENTS.participantKicked, {
      meetingId: meeting.id,
      meetingCode: meeting.code,
      participantId: participant.id,
    });
    return this.toParticipantDto(updated);
  }

  /** Silencia el microfono a nivel SFU. Nunca activa micros ajenos. */
  async mute(
    hostUserId: string,
    code: string,
    participantId: string,
  ): Promise<MuteResult> {
    const meeting = await this.getOwnedMeeting(hostUserId, code);
    const participant = await this.prisma.participant.findFirst({
      where: { id: participantId, meetingId: meeting.id },
    });
    if (!participant) {
      throw new NotFoundException('participant not found');
    }
    const result = await this.rooms.muteMicrophone(meeting.code, participant.id);
    if (result.muted) {
      this.events.emit(DOMAIN_EVENTS.participantMuted, {
        meetingId: meeting.id,
        meetingCode: meeting.code,
        participantId: participant.id,
      });
    }
    return result;
  }

  private async findCallerParticipant(
    meeting: Meeting,
    caller: Caller,
  ): Promise<Participant | null> {
    return this.prisma.participant.findFirst({
      where:
        caller.kind === 'host'
          ? { meetingId: meeting.id, hostUserId: caller.hostUserId }
          : { meetingId: meeting.id, guestSessionId: caller.guestSessionId },
    });
  }

  private async getMeetingOr404(code: string): Promise<Meeting> {
    const meeting = await this.prisma.meeting.findUnique({ where: { code } });
    if (!meeting) {
      throw new NotFoundException('meeting not found');
    }
    return meeting;
  }

  private async getOwnedMeeting(
    hostUserId: string,
    code: string,
  ): Promise<Meeting> {
    const meeting = await this.getMeetingOr404(code);
    if (meeting.hostId !== hostUserId) {
      throw new ForbiddenException('not the meeting host');
    }
    return meeting;
  }

  private toParticipantDto(participant: Participant): ParticipantDto {
    return {
      id: participant.id,
      displayName: participant.displayName,
      role: participant.role as ParticipantRole,
      state: participant.state as ParticipantState,
      joinedAt: participant.joinedAt.toISOString(),
    };
  }
}
