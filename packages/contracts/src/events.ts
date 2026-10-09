import type { ChatMessageDto, JoinRequestDto, MeetingStatus, ParticipantDto } from './api';
import type { ProcessingResult } from './media';

/** Nombres de eventos del canal de tiempo real (Socket.IO). */
export const RT_EVENTS = {
  // Cliente -> servidor
  clientJoinMeetingChannel: 'meeting:subscribe',
  clientCancelJoinRequest: 'join-request:cancel',
  clientChatSend: 'chat:send',
  clientChatMarkRead: 'chat:mark-read',
  // Servidor -> cliente
  serverMeetingStatus: 'meeting:status',
  serverJoinRequestUpdated: 'join-request:updated',
  serverJoinRequestNew: 'join-request:new',
  serverAdmitted: 'meeting:admitted',
  serverRejected: 'meeting:rejected',
  serverMeetingEnded: 'meeting:ended',
  serverKicked: 'meeting:kicked',
  serverParticipants: 'participants:list',
  serverChatMessage: 'chat:message',
  serverProcessingResult: 'processing:result',
  serverError: 'error',
} as const;

export interface ChatSendPayload {
  body: string;
  /** UUID generado por el cliente; deduplica reintentos. */
  clientRef: string;
}

export interface ChatAckPayload {
  ok: boolean;
  clientRef: string;
  message?: ChatMessageDto;
  error?: string;
}

export interface MeetingStatusPayload {
  code: string;
  status: MeetingStatus;
}

export interface JoinRequestUpdatedPayload {
  request: JoinRequestDto;
}

export type ProcessingResultPayload = ProcessingResult;

export interface ParticipantsPayload {
  participants: ParticipantDto[];
}
