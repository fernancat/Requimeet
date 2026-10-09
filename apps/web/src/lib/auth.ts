import type { MeetingSummary } from '@requimeet/contracts';

const HOST_TOKEN_KEY = 'requimeet.hostToken';
const MEETINGS_KEY = 'requimeet.myMeetings';

export interface GuestSessionData {
  token: string;
  displayName: string;
}

export interface MediaPrefs {
  audioEnabled: boolean;
  videoEnabled: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
}

export function saveHostToken(token: string): void {
  localStorage.setItem(HOST_TOKEN_KEY, token);
}

export function getHostToken(): string | null {
  return localStorage.getItem(HOST_TOKEN_KEY);
}

export function clearHostToken(): void {
  localStorage.removeItem(HOST_TOKEN_KEY);
}

const guestKey = (code: string) => `requimeet.guest.${code}`;
const mediaKey = (code: string) => `requimeet.media.${code}`;

export function saveGuestSession(code: string, data: GuestSessionData): void {
  sessionStorage.setItem(guestKey(code), JSON.stringify(data));
}

export function getGuestSession(code: string): GuestSessionData | null {
  const raw = sessionStorage.getItem(guestKey(code));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GuestSessionData;
  } catch {
    return null;
  }
}

export function clearGuestSession(code: string): void {
  sessionStorage.removeItem(guestKey(code));
}

export function saveMediaPrefs(code: string, prefs: MediaPrefs): void {
  sessionStorage.setItem(mediaKey(code), JSON.stringify(prefs));
}

export function getMediaPrefs(code: string): MediaPrefs {
  const raw = sessionStorage.getItem(mediaKey(code));
  if (raw) {
    try {
      return JSON.parse(raw) as MediaPrefs;
    } catch {
      // fallback a defaults
    }
  }
  return { audioEnabled: true, videoEnabled: true };
}

const roleKey = (code: string) => `requimeet.role.${code}`;

export function saveMeetingRole(code: string, role: 'host' | 'participant'): void {
  sessionStorage.setItem(roleKey(code), role);
}

export function getMeetingRole(code: string): 'host' | 'participant' | null {
  const role = sessionStorage.getItem(roleKey(code));
  return role === 'host' || role === 'participant' ? role : null;
}

/** Reuniones creadas desde este navegador (no hay endpoint de lista). */
export function rememberMeeting(meeting: MeetingSummary): void {
  const all = getRememberedMeetings().filter((m) => m.code !== meeting.code);
  all.unshift(meeting);
  localStorage.setItem(MEETINGS_KEY, JSON.stringify(all.slice(0, 20)));
}

export function getRememberedMeetings(): MeetingSummary[] {
  const raw = localStorage.getItem(MEETINGS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as MeetingSummary[];
  } catch {
    return [];
  }
}
