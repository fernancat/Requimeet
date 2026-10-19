import type { JoinRequestStatus, MeetingStatus } from '@requimeet/contracts';

export const DOMAIN_EVENTS = {
  meetingStarted: 'meeting.started',
  meetingEnded: 'meeting.ended',
  joinRequestCreated: 'joinrequest.created',
  joinRequestDecided: 'joinrequest.decided',
  participantKicked: 'meeting.participant-kicked',
  participantMuted: 'meeting.participant-muted',
  livekitEvent: 'livekit.event',
} as const;

export interface MeetingLifecyclePayload {
  startedAtMs?: number;
  meetingId: string;
  code: string;
  hostId: string;
  status: MeetingStatus;
}

export interface JoinRequestCreatedPayload {
  meetingId: string;
  meetingCode: string;
  requestId: string;
  guestSessionId: string;
  displayName: string;
}

export interface JoinRequestDecidedPayload {
  meetingId: string;
  meetingCode: string;
  requestId: string;
  guestSessionId: string;
  status: JoinRequestStatus;
}

export interface ParticipantModerationPayload {
  meetingId: string;
  meetingCode: string;
  participantId: string;
}

export interface LivekitEventPayload {
  eventId: string;
  event: string;
  room: string | null;
  participantIdentity: string | null;
}
