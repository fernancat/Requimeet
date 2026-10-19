import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { JoinRequestStatus } from '@requimeet/contracts';
import { RT_EVENTS } from '@requimeet/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DOMAIN_EVENTS,
  JoinRequestCreatedPayload,
  JoinRequestDecidedPayload,
  LivekitEventPayload,
  MeetingLifecyclePayload,
  ParticipantModerationPayload,
} from '../meetings/meetings.events';
import { hostRoom, meetingRoom, RealtimeGateway, waitRoom } from './realtime.gateway';

/** Retransmite eventos de dominio a las rooms de Socket.IO. Sin logica de negocio. */
@Injectable()
export class RealtimeRelay {
  private readonly logger = new Logger(RealtimeRelay.name);

  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('workspace.changed')
  onWorkspaceChanged(payload: { code: string; resource: string }) {
    this.gateway.server?.to(meetingRoom(payload.code)).emit('workspace:changed', payload);
  }

  @OnEvent(DOMAIN_EVENTS.joinRequestCreated)
  async onJoinRequestCreated(payload: JoinRequestCreatedPayload): Promise<void> {
    const request = await this.prisma.joinRequest.findUnique({
      where: { id: payload.requestId },
    });
    if (!request) return;
    this.gateway.server.to(hostRoom(payload.meetingCode)).emit(
      RT_EVENTS.serverJoinRequestNew,
      {
        request: {
          id: request.id,
          displayName: request.displayName,
          status: request.status as JoinRequestStatus,
          createdAt: request.createdAt.toISOString(),
        },
      },
    );
  }

  @OnEvent(DOMAIN_EVENTS.joinRequestDecided)
  async onJoinRequestDecided(payload: JoinRequestDecidedPayload): Promise<void> {
    const request = await this.prisma.joinRequest.findUnique({
      where: { id: payload.requestId },
    });
    if (!request) return;
    const update = {
      request: {
        id: request.id,
        displayName: request.displayName,
        status: request.status as JoinRequestStatus,
        createdAt: request.createdAt.toISOString(),
      },
    };
    this.gateway.server
      .to(hostRoom(payload.meetingCode))
      .emit(RT_EVENTS.serverJoinRequestUpdated, update);
    this.gateway.server
      .to(waitRoom(payload.meetingCode))
      .emit(RT_EVENTS.serverJoinRequestUpdated, update);
    if (payload.status === 'accepted') {
      this.gateway.server
        .to(waitRoom(payload.meetingCode))
        .emit(RT_EVENTS.serverAdmitted, { code: payload.meetingCode });
      await this.broadcastParticipants(payload.meetingId, payload.meetingCode);
    } else if (payload.status === 'rejected') {
      this.gateway.server
        .to(waitRoom(payload.meetingCode))
        .emit(RT_EVENTS.serverRejected, { code: payload.meetingCode });
    }
  }

  @OnEvent(DOMAIN_EVENTS.meetingEnded)
  onMeetingEnded(payload: MeetingLifecyclePayload): void {
    for (const room of [meetingRoom(payload.code), waitRoom(payload.code)]) {
      this.gateway.server.to(room).emit(RT_EVENTS.serverMeetingEnded, {
        code: payload.code,
        status: 'ended',
      });
    }
    this.gateway.server.in(meetingRoom(payload.code)).socketsLeave(meetingRoom(payload.code));
    this.gateway.server.in(waitRoom(payload.code)).socketsLeave(waitRoom(payload.code));
    this.gateway.server.in(hostRoom(payload.code)).socketsLeave(hostRoom(payload.code));
  }

  @OnEvent(DOMAIN_EVENTS.participantKicked)
  async onParticipantKicked(payload: ParticipantModerationPayload): Promise<void> {
    const room = meetingRoom(payload.meetingCode);
    this.gateway.server
      .to(room)
      .emit(RT_EVENTS.serverKicked, { participantId: payload.participantId });
    const participant = await this.prisma.participant.findUnique({
      where: { id: payload.participantId },
    });
    // Sacar de la room los sockets del expulsado: deja de recibir chat al instante
    if (participant?.guestSessionId) {
      const sockets = await this.gateway.server.in(room).fetchSockets();
      for (const socket of sockets) {
        const identity = socket.data.identity as
          | { kind: string; guestSessionId?: string }
          | undefined;
        if (identity?.kind === 'guest' && identity.guestSessionId === participant.guestSessionId) {
          socket.leave(room);
        }
      }
    }
    await this.broadcastParticipants(payload.meetingId, payload.meetingCode);
  }

  @OnEvent(DOMAIN_EVENTS.participantMuted)
  async onParticipantMuted(payload: ParticipantModerationPayload): Promise<void> {
    await this.broadcastParticipants(payload.meetingId, payload.meetingCode);
  }

  /** Nada de LiveKit se persiste; solo se refresca la presencia. */
  @OnEvent(DOMAIN_EVENTS.livekitEvent)
  async onLivekitEvent(payload: LivekitEventPayload): Promise<void> {
    if (
      (payload.event === 'participant_joined' || payload.event === 'participant_left') &&
      payload.room
    ) {
      const meeting = await this.prisma.meeting.findUnique({
        where: { code: payload.room },
      });
      if (meeting) {
        await this.broadcastParticipants(meeting.id, meeting.code);
      }
    }
  }

  private async broadcastParticipants(meetingId: string, code: string): Promise<void> {
    this.gateway.server
      .to(meetingRoom(code))
      .emit(RT_EVENTS.serverParticipants, await this.gateway.participantsPayload(meetingId));
  }
}
