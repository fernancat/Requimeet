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
    <div className={`tile ${speaking ? 'speaking' : ''}`}>
      {track ? (
        <video ref={videoRef} autoPlay playsInline muted={isLocal} />
      ) : (
        <div className="tile-placeholder">
          <span>{name.slice(0, 1).toUpperCase()}</span>
        </div>
      )}
      {!isLocal && source === Track.Source.Camera && <audio ref={audioRef} autoPlay />}
      <div className="tile-label">
        <span>
          {label ?? name}
          {isLocal && ' · Tú'}
          {role === 'host' && <span className="badge">host</span>}
        </span>
        {source === Track.Source.Camera && (
          <span className={`mic-state ${micMuted ? 'muted' : ''}`}>
            {micMuted ? 'mic apagado' : 'mic activo'}
          </span>
        )}
      </div>
    </div>
  );
}

export type { LocalParticipant, RemoteParticipant };
