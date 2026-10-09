import type { JoinRequestStatus, MeetingStatus } from '@requimeet/contracts';

export const DOMAIN_EVENTS = {
  meetingStarted: 'meeting.started',
  meetingEnded: 'meeting.ended',
  joinRequestCreated: 'joinrequest.created',
  joinRequestDecided: 'joinrequest.decided',
} as const;

export interface MeetingLifecyclePayload {
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
