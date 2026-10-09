export interface HostTokenPayload {
  sub: string;
  kind: 'host';
}

export interface GuestTokenPayload {
  sub: string;
  kind: 'guest';
  meetingCode: string;
}

export interface HostPrincipal {
  hostUserId: string;
}

export interface GuestPrincipal {
  guestSessionId: string;
  meetingCode: string;
}
