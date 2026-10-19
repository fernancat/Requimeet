import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveGuestSession } from '../lib/auth';
import MeetingRoomPage from './MeetingRoomPage';

const { disconnectMock, connectMock } = vi.hoisted(() => ({
  disconnectMock: vi.fn().mockResolvedValue(undefined),
  connectMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../features/brody/BrodyAvatar', () => ({ default: () => null }));

vi.mock('livekit-client', () => {
  class FakeRoom {
    state = 'connected';
    localParticipant = {
      identity: 'p-local',
      name: 'Invitado',
      metadata: '',
      isMicrophoneEnabled: true,
      isCameraEnabled: true,
      setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
      setCameraEnabled: vi.fn().mockResolvedValue(undefined),
      setScreenShareEnabled: vi.fn().mockResolvedValue(undefined),
      getTrackPublication: () => undefined,
    };
    remoteParticipants = new Map();
    connect = connectMock;
    disconnect = disconnectMock;
    switchActiveDevice = vi.fn().mockResolvedValue(true);

    on() {
      return this;
    }
  }
  return {
    Room: FakeRoom,
    RoomEvent: {
      ConnectionStateChanged: 'connectionStateChanged',
      ActiveSpeakersChanged: 'activeSpeakersChanged',
      LocalTrackPublished: 'localTrackPublished',
      LocalTrackUnpublished: 'localTrackUnpublished',
      Disconnected: 'disconnected',
      ParticipantConnected: 'participantConnected',
      ParticipantDisconnected: 'participantDisconnected',
      TrackSubscribed: 'trackSubscribed',
      TrackUnsubscribed: 'trackUnsubscribed',
      TrackMuted: 'trackMuted',
      TrackUnmuted: 'trackUnmuted',
      TrackStreamStateChanged: 'trackStreamStateChanged',
    },
    Track: {
      Source: {
        Camera: 'camera',
        Microphone: 'microphone',
        ScreenShare: 'screen_share',
        ScreenShareAudio: 'screen_share_audio',
      },
    },
  };
});

vi.mock('../lib/api', () => ({
  api: vi.fn((path: string) => {
    if (path.includes('media-token')) {
      return Promise.resolve({ token: 'lk-token', livekitUrl: 'ws://x', expiresInSec: 300 });
    }
    if (path.includes('analysis')) return Promise.resolve({ enabled: true, model: 'deepseek/deepseek-v4-flash', jobs: [] });
    if (path.includes('questions') || path.includes('requirements')) return Promise.resolve([]);
    if (path.includes('messages')) {
      return Promise.resolve([]);
    }
    return Promise.resolve({});
  }),
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

vi.mock('../lib/socket', () => ({
  createSocket: () => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

describe('MeetingRoomPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveGuestSession('ABC123', { token: 'guest-token', displayName: 'Invitado' });
  });

  it('conecta la room y al desmontar llama room.disconnect', async () => {
    const { unmount } = render(
      <MemoryRouter>
        <MeetingRoomPage code="ABC123" />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Conectado')).toBeTruthy();
    });
    expect(connectMock).toHaveBeenCalled();

    unmount();

    await waitFor(() => {
      expect(disconnectMock).toHaveBeenCalled();
    });
  });
});
