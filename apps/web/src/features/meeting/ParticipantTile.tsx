import { useEffect, useRef } from 'react';
import { LocalParticipant, Participant, RemoteParticipant, Track } from 'livekit-client';

function parseRole(participant: Participant): 'host' | 'participant' | null {
  try {
    const meta = JSON.parse(participant.metadata || '{}') as { role?: string };
    return meta.role === 'host' ? 'host' : meta.role === 'participant' ? 'participant' : null;
  } catch {
    return null;
  }
}

function MicStateIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="mini-icon">
      <path d="M12 3.5a3 3 0 0 1 3 3v5a3 3 0 1 1-6 0v-5a3 3 0 0 1 3-3Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M12 17v3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M8.5 20.5h7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      {muted && <path d="M5 5l14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />}
    </svg>
  );
}

interface TileProps {
  participant: Participant;
  isLocal: boolean;
  speaking: boolean;
  /** Fuente de video a mostrar: camara por defecto, pantalla para el tile de presentacion. */
  source?: Track.Source;
  label?: string;
}

export default function ParticipantTile({
  participant,
  isLocal,
  speaking,
  source = Track.Source.Camera,
  label,
}: TileProps) {
  const tileRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const publication = participant.getTrackPublication(source);
  const track = publication?.track ?? null;
  const micPublication = participant.getTrackPublication(Track.Source.Microphone);
  const micMuted = !micPublication?.track || micPublication.isMuted;
  const role = parseRole(participant);

  useEffect(() => {
    const el = videoRef.current;
    if (!track || !el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  useEffect(() => {
    const el = audioRef.current;
    const micTrack = micPublication?.track;
    if (!el || !micTrack || isLocal || source !== Track.Source.Camera) return;
    micTrack.attach(el);
    return () => {
      micTrack.detach(el);
    };
  }, [micPublication?.track, isLocal, source]);

  const name = participant.name || participant.identity;

  return (
    <div ref={tileRef} className={`tile ${speaking ? 'speaking' : ''} ${source === Track.Source.ScreenShare ? 'screen-tile' : ''}`}>
      {track ? (
        <video ref={videoRef} autoPlay playsInline muted={isLocal} />
      ) : (
        <div className="tile-placeholder">
          <span>{name.slice(0, 1).toUpperCase()}</span>
        </div>
      )}
      {!isLocal && source === Track.Source.Camera && <audio ref={audioRef} autoPlay />}
      {source === Track.Source.ScreenShare && <button className="fullscreen-button secondary" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void tileRef.current?.requestFullscreen?.().catch(() => {}); }}>Pantalla completa</button>}
      <div className="tile-label">
        <span>
          {label ?? name}
          {isLocal && ' · Tú'}
          {role === 'host' && <span className="badge">host</span>}
        </span>
        {source === Track.Source.Camera && (
          <span className={`mic-state ${micMuted ? 'muted' : ''}`} aria-label={micMuted ? 'Micrófono apagado' : 'Micrófono activo'} title={micMuted ? 'Micrófono apagado' : 'Micrófono activo'}>
            <MicStateIcon muted={micMuted} />
          </span>
        )}
      </div>
    </div>
  );
}

export type { LocalParticipant, RemoteParticipant };
