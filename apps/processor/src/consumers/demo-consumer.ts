import { randomUUID } from 'node:crypto';
import type {
  AudioFrame,
  MediaConsumer,
  ProcessingResult,
  VideoFrame,
} from '@requimeet/contracts';

const EMIT_INTERVAL_MS = 10_000;

interface ParticipantCounts {
  audioFrames: number;
  videoFrames: number;
}

/**
 * Consumidor de referencia: cuenta frames por participante y publica un
 * resultado kind 'demo' cada 10s. NO es una transcripcion.
 */
export class DemoConsumer implements MediaConsumer {
  private readonly counts = new Map<string, ParticipantCounts>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly meetingId: string,
    private readonly emitResult: (result: ProcessingResult) => void,
    private readonly droppedFrames: () => number,
  ) {}

  onSessionStart(): void {
    this.timer = setInterval(() => this.tick(), EMIT_INTERVAL_MS);
    this.timer.unref?.();
  }

  onSessionEnd(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onAudioFrame(frame: AudioFrame): void {
    this.bump(frame.track.participantId, 'audioFrames');
  }

  onVideoFrame(frame: VideoFrame): void {
    this.bump(frame.track.participantId, 'videoFrames');
  }

  /** Publica un resultado por participante activo (llamado cada 10s). */
  tick(): void {
    const now = Date.now();
    for (const [participantId, counts] of this.counts) {
      this.emitResult({
        resultId: randomUUID(),
        meetingId: this.meetingId,
        participantId,
        kind: 'demo',
        isFinal: false,
        createdAtMs: now,
        payload: {
          audioFrames: counts.audioFrames,
          videoFrames: counts.videoFrames,
          droppedFrames: this.droppedFrames(),
          note: 'DEMO: no es una transcripcion',
        },
      });
    }
  }

  private bump(participantId: string, field: keyof ParticipantCounts): void {
    let counts = this.counts.get(participantId);
    if (!counts) {
      counts = { audioFrames: 0, videoFrames: 0 };
      this.counts.set(participantId, counts);
    }
    counts[field] += 1;
  }
}
