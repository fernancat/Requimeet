import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type {
  ChatAckPayload,
  ChatMessageDto,
  ChatSendPayload,
  JoinRequestDto,
  JoinRequestStatus,
  ParticipantsPayload,
} from '@requimeet/contracts';
import { RT_EVENTS } from '@requimeet/contracts';
import { ChatService } from '../chat/chat.service';
import { AuthService } from '../identity/auth.service';
import { GuestTokenService } from '../identity/guest-token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatRateLimiter } from './chat-rate-limiter';

export type SocketIdentity =
  | { kind: 'host'; hostUserId: string }
  | { kind: 'guest'; guestSessionId: string };

export interface SubscribeAck {
  ok: boolean;
  role?: 'host' | 'participant' | 'waiting';
  error?: string;
  pendingRequests?: JoinRequestDto[];
}

const meetingRoom = (code: string) => `meeting:${code}`;
const hostRoom = (code: string) => `meeting:${code}:host`;
const waitRoom = (code: string) => `wait:${code}`;

@WebSocketGateway({
  cors: {
    // WEB_ORIGIN admite varios origenes separados por coma
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(','),
  },
})
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly guestTokens: GuestTokenService,
    private readonly chat: ChatService,
    private readonly rateLimiter: ChatRateLimiter,
  ) {}

  /** Auth del handshake: JWT host o invitado; invalido -> disconnect. */
  handleConnection(socket: Socket): void {
    const token = (socket.handshake.auth as Record<string, unknown>)?.token;
    if (typeof token !== 'string' || !token) {
      socket.disconnect(true);
      return;
    }
    try {
      const host = this.authService.verifyHostToken(token);
      socket.data.identity = { kind: 'host', hostUserId: host.sub } satisfies SocketIdentity;
      return;
    } catch {
      // no es token de host; se intenta como invitado
    }
    try {
      const guest = this.guestTokens.verifyAny(token);
      socket.data.identity = {
        kind: 'guest',
        guestSessionId: guest.sub,
      } satisfies SocketIdentity;
    } catch {
      socket.disconnect(true);
    }
  }

  /**
   * Suscripcion al canal de la reunion. La autorizacion se re-evalua contra
   * la base de datos en cada llamada, asi re-suscribirse tras ser admitido
   * mueve el socket de wait:<code> a meeting:<code>.
   */
  @SubscribeMessage(RT_EVENTS.clientJoinMeetingChannel)
  async handleSubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { code?: string },
  ): Promise<SubscribeAck> {
    const code = body?.code;
    const identity = socket.data.identity as SocketIdentity | undefined;
    if (!code || !identity) {
      return { ok: false, error: 'bad-request' };
    }
    const meeting = await this.prisma.meeting.findUnique({ where: { code } });
    if (!meeting) {
      return { ok: false, error: 'meeting-not-found' };
    }

    if (identity.kind === 'host' && meeting.hostId === identity.hostUserId) {
      await socket.leave(waitRoom(code));
      await socket.join([meetingRoom(code), hostRoom(code)]);
      socket.data.meetingCode = code;
      socket.emit(
        RT_EVENTS.serverParticipants,
        await this.participantsPayload(meeting.id),
      );
      const pending = await this.prisma.joinRequest.findMany({
        where: { meetingId: meeting.id, status: 'pending' },
        orderBy: { createdAt: 'asc' },
      });
      return {
        ok: true,
        role: 'host',
        pendingRequests: pending.map((r) => ({
          id: r.id,
          displayName: r.displayName,
          status: r.status as JoinRequestStatus,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }

    if (identity.kind === 'guest') {
      const participant = await this.prisma.participant.findFirst({
        where: { meetingId: meeting.id, guestSessionId: identity.guestSessionId },
      });
      if (participant?.state === 'admitted') {
        await socket.leave(waitRoom(code));
        await socket.join(meetingRoom(code));
        socket.data.meetingCode = code;
        socket.emit(
          RT_EVENTS.serverParticipants,
          await this.participantsPayload(meeting.id),
        );
        return { ok: true, role: 'participant' };
      }
      const pending = await this.prisma.joinRequest.findFirst({
        where: {
          meetingId: meeting.id,
          guestSessionId: identity.guestSessionId,
          status: 'pending',
        },
      });
      if (pending) {
        // Sala de espera real: no entra a meeting:<code>; no ve chat ni participantes
        await socket.join(waitRoom(code));
        return { ok: true, role: 'waiting' };
      }
    }
    return { ok: false, error: 'not-authorized' };
  }

  @SubscribeMessage(RT_EVENTS.clientChatSend)
  async handleChatSend(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ChatSendPayload,
  ): Promise<ChatAckPayload> {
    const identity = socket.data.identity as SocketIdentity | undefined;
    const code = socket.data.meetingCode as string | undefined;
    const clientRef = typeof body?.clientRef === 'string' ? body.clientRef : '';
    if (!identity || !code) {
      return { ok: false, clientRef, error: 'not-subscribed' };
    }
    const rateKey =
      identity.kind === 'host'
        ? `h:${identity.hostUserId}:${code}`
        : `g:${identity.guestSessionId}:${code}`;
    if (!this.rateLimiter.consume(rateKey)) {
      return { ok: false, clientRef, error: 'rate-limited' };
    }
    let message: ChatMessageDto;
    try {
      const result = await this.chat.send({
        meetingCode: code,
        caller:
          identity.kind === 'host'
            ? { kind: 'host', hostUserId: identity.hostUserId }
            : { kind: 'guest', guestSessionId: identity.guestSessionId },
        body: typeof body?.body === 'string' ? body.body : '',
        clientRef,
      });
      message = result.message;
      if (result.created) {
        this.server.to(meetingRoom(code)).emit(RT_EVENTS.serverChatMessage, message);
      }
    } catch (error) {
      return {
        ok: false,
        clientRef,
        error: error instanceof Error ? error.message : 'send-failed',
      };
    }
    return { ok: true, clientRef, message };
  }

  async participantsPayload(meetingId: string): Promise<ParticipantsPayload> {
    const participants = await this.prisma.participant.findMany({
      where: { meetingId, state: 'admitted' },
      orderBy: { joinedAt: 'asc' },
    });
    return {
      participants: participants.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        role: p.role as 'host' | 'participant',
        state: p.state as 'admitted' | 'left' | 'kicked',
        joinedAt: p.joinedAt.toISOString(),
      })),
    };
  }
}

export { meetingRoom, hostRoom, waitRoom };
