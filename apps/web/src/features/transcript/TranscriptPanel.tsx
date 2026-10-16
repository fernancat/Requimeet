import { useEffect, useMemo, useRef } from 'react';
import type { ParticipantDto } from '@requimeet/contracts';
import type { TranscriptSegment } from './transcript-store';

interface TranscriptPanelProps {
  segments: TranscriptSegment[];
  participants: ParticipantDto[];
}

function formatClock(ms: number | null): string {
  if (ms === null) return '';
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function TranscriptPanel({ segments, participants }: TranscriptPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const nameById = useMemo(
    () => new Map(participants.map((p) => [p.id, p.displayName])),
    [participants],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [segments.length]);

  return (
    <div className="side-panel">
      <h3>Transcripción</h3>
      <div className="transcript-list">
        {segments.length === 0 && (
          <p className="transcript-empty">Esperando audio de los participantes…</p>
        )}
        {segments.map((segment) => (
          <div
            key={segment.resultId}
            className={`transcript-line ${segment.isFinal ? 'final' : 'partial'}`}
          >
            <span className="transcript-meta">
              {nameById.get(segment.participantId ?? '') ?? 'Participante'}
              {segment.startMs !== null && <> · {formatClock(segment.startMs)}</>}
              {!segment.isFinal && <> · parcial</>}
            </span>
            <span className="transcript-text">{segment.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
