import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionState,
  Participant,
  RemoteParticipant,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import type { MediaTokenResponse } from '@requimeet/contracts';
import { api, ApiError } from '../../lib/api';
import { getMediaPrefs } from '../../lib/auth';
import { ScreenSharerInfo } from './media-controls';

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL ?? 'ws://localhost:7880';

export type ExitReason = 'left' | 'kicked' | 'ended' | 'media-revoked' | 'error';

export interface MeetingRoomState {
  room: Room | null;
  connectionState: ConnectionState | 'idle';
  /** Se incrementa en cada evento relevante para re-renderizar. */
  tick: number;
  speakers: Set<string>;
  exitReason: ExitReason | null;
  error: string | null;
  retry: () => void;
  toggleMic: (enabled: boolean) => Promise<void>;
  toggleCamera: (enabled: boolean) => Promise<void>;
  setScreenShare: (enabled: boolean) => Promise<void>;
  switchDevice: (kind: MediaDeviceKind, deviceId: string) => Promise<void>;
  localMicOn: boolean;
  localCameraOn: boolean;
  localSharing: boolean;
  screenSharers: ScreenSharerInfo[];
  leave: () => Promise<void>;
}

const RENEW_AT_FRACTION = 0.8;

/** Ciclo de vida de la Room de LiveKit: conexion, pistas locales, renovacion de token. */
export function useMeetingRoom(
  code: string,
  token: string | null,
  onLeave: (reason: ExitReason) => void,
): MeetingRoomState {
  const [room, setRoom] = useState<Room | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState | 'idle'>('idle');
  const [tick, setTick] = useState(0);
  const [speakers, setSpeakers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [localMicOn, setLocalMicOn] = useState(false);
  const [localCameraOn, setLocalCameraOn] = useState(false);
  const [localSharing, setLocalSharing] = useState(false);
  const [screenSharers, setScreenSharers] = useState<ScreenSharerInfo[]>([]);
  const roomRef = useRef<Room | null>(null);
  const renewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;
  const exitedRef = useRef(false);

  const bump = useCallback(() => setTick((t) => t + 1), []);

  const requestMediaToken = useCallback(async (): Promise<MediaTokenResponse> => {
    return api<MediaTokenResponse>(`/meetings/${code}/media-token`, {
      method: 'POST',
      token,
    });
  }, [code, token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let currentRoom: Room | null = null;

    function scheduleRenewal(expiresInSec: number, activeRoom: Room) {
      if (renewTimer.current) clearTimeout(renewTimer.current);
      renewTimer.current = setTimeout(
        () => {
          void (async () => {
            try {
              // El backend revalida (admitido, no expulsado, reunion activa)
              await requestMediaToken();
              if (!cancelled) scheduleRenewal(expiresInSec, activeRoom);
            } catch (err) {
              if (
                err instanceof ApiError &&
                (err.status === 403 || err.status === 409)
              ) {
                exitedRef.current = true;
                await activeRoom.disconnect();
                onLeaveRef.current(err.status === 403 ? 'media-revoked' : 'ended');
              }
            }
          })();
        },
        expiresInSec * 1000 * RENEW_AT_FRACTION,
      );
    }

    async function connect() {
      setError(null);
      setConnectionState('connecting' as ConnectionState);
      let media: MediaTokenResponse;
      try {
        media = await requestMediaToken();
      } catch (err) {
        setError(
          err instanceof ApiError && err.status === 0
            ? 'No se pudo conectar con el servidor'
            : 'No tienes acceso a esta reunión',
        );
        setConnectionState('disconnected' as ConnectionState);
        return;
      }
      if (cancelled) return;

      const newRoom = new Room();
      currentRoom = newRoom;
      roomRef.current = newRoom;

      newRoom
        .on(RoomEvent.ConnectionStateChanged, (state) => {
          setConnectionState(state);
          bump();
        })
        .on(RoomEvent.ActiveSpeakersChanged, (active: Participant[]) => {
          setSpeakers(new Set(active.map((p) => p.identity)));
        })
        .on(
          RoomEvent.LocalTrackPublished,
          () => {
            const lp = newRoom.localParticipant;
            setLocalMicOn(lp.isMicrophoneEnabled);
            setLocalCameraOn(lp.isCameraEnabled);
            setLocalSharing(Boolean(lp.getTrackPublication(Track.Source.ScreenShare)?.track));
            bump();
          },
        )
        .on(RoomEvent.LocalTrackUnpublished, () => {
          // El usuario pudo detener la presentacion desde la UI del navegador
          const lp = newRoom.localParticipant;
          setLocalMicOn(lp.isMicrophoneEnabled);
          setLocalCameraOn(lp.isCameraEnabled);
          setLocalSharing(Boolean(lp.getTrackPublication(Track.Source.ScreenShare)?.track));
          bump();
        })
        .on(RoomEvent.Disconnected, () => {
          setConnectionState('disconnected' as ConnectionState);
        });

      for (const event of [
        RoomEvent.ParticipantConnected,
        RoomEvent.ParticipantDisconnected,
        RoomEvent.TrackSubscribed,
        RoomEvent.TrackUnsubscribed,
        RoomEvent.TrackMuted,
        RoomEvent.TrackUnmuted,
        RoomEvent.TrackStreamStateChanged,
      ]) {
        newRoom.on(event, () => bump());
      }

      try {
        await newRoom.connect(LIVEKIT_URL, media.token);
      } catch (err) {
        if (!cancelled) {
          setError(`No se pudo conectar a la videollamada: ${String(err)}`);
          setConnectionState('disconnected' as ConnectionState);
        }
        return;
      }
      if (cancelled) {
        await newRoom.disconnect();
        return;
      }
      setRoom(newRoom);
      setConnectionState(newRoom.state);

      const prefs = getMediaPrefs(code);
      try {
        await newRoom.localParticipant.setMicrophoneEnabled(
          prefs.audioEnabled,
          prefs.audioDeviceId ? { deviceId: prefs.audioDeviceId } : undefined,
        );
        await newRoom.localParticipant.setCameraEnabled(
          prefs.videoEnabled,
          prefs.videoDeviceId ? { deviceId: prefs.videoDeviceId } : undefined,
        );
      } catch {
        setError('No se pudieron activar tus dispositivos; puedes reintentar en la sala');
      }
      setLocalMicOn(newRoom.localParticipant.isMicrophoneEnabled);
      setLocalCameraOn(newRoom.localParticipant.isCameraEnabled);
      scheduleRenewal(media.expiresInSec, newRoom);
      bump();
    }

    void connect();
    return () => {
      cancelled = true;
      if (renewTimer.current) clearTimeout(renewTimer.current);
      if (currentRoom) {
        void currentRoom.disconnect();
      }
      roomRef.current = null;
    };
  }, [code, token, attempt, bump, requestMediaToken]);

  // Tira lateral / bloqueo de presentacion: quien comparte pantalla ahora
  useEffect(() => {
    if (!room) {
      setScreenSharers([]);
      return;
    }
    const sharers: ScreenSharerInfo[] = [];
    const collect = (p: Participant, isLocal: boolean) => {
      if (p.getTrackPublication(Track.Source.ScreenShare)?.track) {
        sharers.push({ identity: p.identity, name: p.name || p.identity, isLocal });
      }
    };
    collect(room.localParticipant, true);
    room.remoteParticipants.forEach((p: RemoteParticipant) => collect(p, false));
    setScreenSharers(sharers);
  }, [room, tick]);

  const toggleMic = useCallback(
    async (enabled: boolean) => {
      if (!roomRef.current) return;
      await roomRef.current.localParticipant.setMicrophoneEnabled(enabled);
      setLocalMicOn(enabled);
    },
    [],
  );

  const toggleCamera = useCallback(async (enabled: boolean) => {
    if (!roomRef.current) return;
    await roomRef.current.localParticipant.setCameraEnabled(enabled);
    setLocalCameraOn(enabled);
  }, []);

  const setScreenShare = useCallback(async (enabled: boolean) => {
    if (!roomRef.current) return;
    // audio:true = compartir audio del sistema si el navegador lo permite
    await roomRef.current.localParticipant.setScreenShareEnabled(enabled, { audio: true });
  }, []);

  const switchDevice = useCallback(
    async (kind: MediaDeviceKind, deviceId: string) => {
      if (!roomRef.current) return;
      try {
        await roomRef.current.switchActiveDevice(kind, deviceId);
      } catch {
        setError('No se pudo cambiar de dispositivo');
      }
      bump();
    },
    [bump],
  );

  const leave = useCallback(async () => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    try {
      await api(`/meetings/${code}/leave`, { method: 'POST', token });
    } catch {
      // salida best-effort
    }
    await roomRef.current?.disconnect();
    onLeaveRef.current('left');
  }, [code, token]);

  const retry = useCallback(() => {
    setAttempt((a) => a + 1);
  }, []);

  return {
    room,
    connectionState,
    tick,
    speakers,
    exitReason: null,
    error,
    retry,
    toggleMic,
    toggleCamera,
    setScreenShare,
    switchDevice,
    localMicOn,
    localCameraOn,
    localSharing,
    screenSharers,
    leave,
  };
}
