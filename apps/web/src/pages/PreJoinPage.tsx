import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import {
  getGuestSession,
  getMediaPrefs,
  saveGuestSession,
  saveMediaPrefs,
} from '../lib/auth';
import type { JoinRequestDto } from '@requimeet/contracts';

interface JoinRequestResponse {
  request: JoinRequestDto;
  guestToken: string;
}

type MediaErrorKind = 'denied' | 'not-found' | 'in-use' | 'other';

const ERROR_TEXT: Record<MediaErrorKind, string> = {
  denied: 'Permisos denegados: habilítalos en el navegador',
  'not-found': 'No se encontró cámara/micrófono',
  'in-use': 'El dispositivo está en uso por otra aplicación',
  other: 'No se pudo acceder a los dispositivos',
};

function classifyMediaError(err: unknown): MediaErrorKind {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'denied';
    if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') return 'not-found';
    if (err.name === 'NotReadableError') return 'in-use';
  }
  return 'other';
}

export default function PreJoinPage({
  code,
  onRequested,
}: {
  code: string;
  onRequested: () => void;
}) {
  const existing = getGuestSession(code);
  const [displayName, setDisplayName] = useState(existing?.displayName ?? '');
  const [prefs, setPrefs] = useState(() => getMediaPrefs(code));
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [mediaError, setMediaError] = useState<MediaErrorKind | null>(null);
  const [skipCamera, setSkipCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopPreview = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startPreview = useCallback(
    async (audioDeviceId?: string, videoDeviceId?: string) => {
      stopPreview();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
          video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true,
        });
        streamRef.current = stream;
        stream.getAudioTracks().forEach((t) => (t.enabled = prefs.audioEnabled));
        stream.getVideoTracks().forEach((t) => (t.enabled = prefs.videoEnabled));
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setMediaError(null);
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(all.filter((d) => d.deviceId));
      } catch (err) {
        setMediaError(classifyMediaError(err));
      }
    },
    [prefs.audioEnabled, prefs.videoEnabled, stopPreview],
  );

  useEffect(() => {
    if (!skipCamera) {
      void startPreview(prefs.audioDeviceId, prefs.videoDeviceId);
    }
    const onDeviceChange = () => {
      void navigator.mediaDevices.enumerateDevices().then((all) => {
        setDevices(all.filter((d) => d.deviceId));
      });
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    return () => {
      stopPreview();
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipCamera, prefs.audioDeviceId, prefs.videoDeviceId]);

  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = prefs.audioEnabled));
    streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = prefs.videoEnabled));
    saveMediaPrefs(code, prefs);
  }, [prefs, code]);

  function continueWithoutCamera() {
    stopPreview();
    setSkipCamera(true);
    setMediaError(null);
    setPrefs((p) => ({ ...p, audioEnabled: false, videoEnabled: false }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<JoinRequestResponse>(`/meetings/${code}/join-requests`, {
        method: 'POST',
        body: { displayName: displayName.trim() },
        token: existing?.token ?? null,
      });
      saveGuestSession(code, { token: res.guestToken, displayName: displayName.trim() });
      stopPreview();
      onRequested();
    } catch {
      setError('No se pudo solicitar el ingreso. Intenta de nuevo.');
      setBusy(false);
    }
  }

  const mics = devices.filter((d) => d.kind === 'audioinput');
  const cameras = devices.filter((d) => d.kind === 'videoinput');

  return (
    <div className="page">
      <div className="card card-wide">
        <h2>Preparado para unirte</h2>
        {!skipCamera && (
          <>
            <video ref={videoRef} className="preview-video" autoPlay muted playsInline />
            {mediaError && (
              <>
                <p className="error-text">{ERROR_TEXT[mediaError]}</p>
                <div className="actions">
                  <button
                    className="secondary"
                    onClick={() => void startPreview(prefs.audioDeviceId, prefs.videoDeviceId)}
                  >
                    Reintentar
                  </button>
                  <button className="secondary" onClick={continueWithoutCamera}>
                    Continuar sin cámara
                  </button>
                </div>
              </>
            )}
            {!mediaError && (
              <>
                <div className="device-grid">
                  <div>
                    <label htmlFor="mic">Micrófono</label>
                    <select
                      id="mic"
                      value={prefs.audioDeviceId ?? ''}
                      onChange={(e) =>
                        setPrefs((p) => ({ ...p, audioDeviceId: e.target.value || undefined }))
                      }
                    >
                      <option value="">Predeterminado</option>
                      {mics.map((d, i) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Micrófono ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="camera">Cámara</label>
                    <select
                      id="camera"
                      value={prefs.videoDeviceId ?? ''}
                      onChange={(e) =>
                        setPrefs((p) => ({ ...p, videoDeviceId: e.target.value || undefined }))
                      }
                    >
                      <option value="">Predeterminada</option>
                      {cameras.map((d, i) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Cámara ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="toggle-row">
                  <button
                    type="button"
                    className={`secondary ${prefs.audioEnabled ? 'active' : ''}`}
                    onClick={() => setPrefs((p) => ({ ...p, audioEnabled: !p.audioEnabled }))}
                  >
                    {prefs.audioEnabled ? 'Micrófono activado' : 'Micrófono apagado'}
                  </button>
                  <button
                    type="button"
                    className={`secondary ${prefs.videoEnabled ? 'active' : ''}`}
                    onClick={() => setPrefs((p) => ({ ...p, videoEnabled: !p.videoEnabled }))}
                  >
                    {prefs.videoEnabled ? 'Cámara activada' : 'Cámara apagada'}
                  </button>
                </div>
              </>
            )}
          </>
        )}
        <form onSubmit={onSubmit}>
          <label htmlFor="displayName">Tu nombre visible</label>
          <input
            id="displayName"
            required
            maxLength={80}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Ej. Ana (entrevista)"
          />
          {error && <p className="error-text">{error}</p>}
          <div className="actions">
            <button type="submit" disabled={busy || displayName.trim().length === 0}>
              {busy ? 'Solicitando…' : 'Solicitar ingreso'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
