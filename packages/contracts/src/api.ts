/** Tipos compartidos de la API REST entre web y server. */

export type MeetingStatus = 'created' | 'active' | 'ended';
export type JoinRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';
export type ParticipantRole = 'host' | 'participant';
export type ParticipantState = 'admitted' | 'left' | 'kicked';

export interface MeetingSummary {
  id: string;
  /** Codigo compartible del enlace: /meetings/:code */
  code: string;
  title: string;
  status: MeetingStatus;
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
}

export interface MeetingPublicInfo {
  code: string;
  title: string;
  status: MeetingStatus;
  /** true si se puede solicitar ingreso ahora. */
  acceptingRequests: boolean;
}

export interface ParticipantDto {
  id: string;
  displayName: string;
  role: ParticipantRole;
  state: ParticipantState;
  joinedAt: string;
}

export interface JoinRequestDto {
  id: string;
  displayName: string;
  status: JoinRequestStatus;
  createdAt: string;
}

export interface ChatMessageDto {
  id: string;
  meetingId: string;
  authorParticipantId: string;
  authorName: string;
  body: string;
  createdAt: string;
  /** Referencia del cliente para deduplicar reintentos. */
  clientRef: string;
}

/** Respuesta de POST /meetings/:code/media-token */
export interface MediaTokenResponse {
  token: string;
  livekitUrl: string;
  /** Segundos hasta la expiracion; el cliente debe renovar antes. */
  expiresInSec: number;
}
