import { randomUUID } from 'node:crypto';
import type {
  AudioFrame,
  MediaConsumer,
  ProcessingResult,
  TrackRef,
} from '@requimeet/contracts';
import WebSocket from 'ws';

export interface DeepgramSocket {
  send(data: string | Buffer): void;
  close(): void;
  on(event: 'message', listener: (data: { toString(): string }) => void): void;
  on(event: 'error' | 'close', listener: () => void): void;
}

export type DeepgramSocketFactory = (
  url: string,
  headers: Record<string, string>,
) => DeepgramSocket;

interface DeepgramMessage {
  is_final?: boolean;
  speech_final?: boolean;
  start?: number;
  duration?: number;
  channel?: { alternatives?: Array<{ transcript?: string }> };
}

interface TrackStream {
  socket: DeepgramSocket;
  track: TrackRef;
  lastPartialId: string | null;
  utteranceStartMs: number | null;
  utteranceEndMs: number | null;
  finalChunks: string[];
  lastFrameAtMs: number;
}

const MODEL = 'nova-2';
const LANGUAGE = 'es';
const ENDPOINTING_MS = 300;
const KEEPALIVE_MS = 5_000;

function defaultOpenSocket(url: string, headers: Record<string, string>): DeepgramSocket {
  return new WebSocket(url, { headers });
}

export class DeepgramConsumer implements MediaConsumer {
  private readonly streams = new Map<string, TrackStream>();
  private keepalive: NodeJS.Timeout | null = null;

  constructor(
    private readonly meetingId: string,
    private readonly apiKey: string,
    private readonly emitResult: (result: ProcessingResult) => void,
    private readonly logger: (msg: string) => void = () => {},
    private readonly openSocket: DeepgramSocketFactory = defaultOpenSocket,
  ) {}

  onSessionStart(): void {
    this.keepalive = setInterval(() => this.pingIdleStreams(), KEEPALIVE_MS);
    this.keepalive.unref?.();
  }

  onSessionEnd(): void {
    if (this.keepalive) {
      clearInterval(this.keepalive);
      this.keepalive = null;
    }
    for (const stream of [...this.streams.values()]) {
      this.closeStream(stream);
    }
  }

  onTrackUnpublished(track: TrackRef): void {
    const stream = this.streams.get(track.trackSid);
    if (stream) this.closeStream(stream);
  }

  onAudioFrame(frame: AudioFrame): void {
    const sid = frame.track.trackSid;
    let stream = this.streams.get(sid);
    if (!stream) {
      stream = this.openStream(frame);
      this.streams.set(sid, stream);
    }
    stream.lastFrameAtMs = Date.now();
    const bytes = Buffer.from(
      frame.samples.buffer,
      frame.samples.byteOffset,
      frame.samples.byteLength,
    );
    stream.socket.send(bytes);
  }

  private openStream(frame: AudioFrame): TrackStream {
    const params = new URLSearchParams({
      model: MODEL,
      language: LANGUAGE,
      encoding: 'linear16',
      sample_rate: String(frame.sampleRateHz),
      channels: String(frame.channels),
      interim_results: 'true',
      endpointing: String(ENDPOINTING_MS),
      smart_format: 'true',
    });
    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
    const socket = this.openSocket(url, {
      Authorization: `Token ${this.apiKey}`,
    });
    const stream: TrackStream = {
      socket,
      track: frame.track,
      lastPartialId: null,
      utteranceStartMs: null,
      utteranceEndMs: null,
      finalChunks: [],
      lastFrameAtMs: Date.now(),
    };
    socket.on('message', (data) => this.handleMessage(stream, data.toString()));
    socket.on('error', () => this.closeStream(stream));
    socket.on('close', () => this.streams.delete(stream.track.trackSid));
    this.logger(
      `sesion ${this.meetingId}: stream deepgram abierto (${frame.track.trackSid})`,
    );
    return stream;
  }

  private handleMessage(stream: TrackStream, raw: string): void {
    let message: DeepgramMessage;
    try {
      message = JSON.parse(raw) as DeepgramMessage;
    } catch {
      return;
    }
    const text = message.channel?.alternatives?.[0]?.transcript?.trim() ?? '';
    const startMs = message.start !== undefined ? Math.round(message.start * 1000) : null;
    const endMs =
      message.start !== undefined && message.duration !== undefined
        ? Math.round((message.start + message.duration) * 1000)
        : null;
    if (text) {
      if (stream.utteranceStartMs === null && startMs !== null) {
        stream.utteranceStartMs = startMs;
      }
      if (endMs !== null) stream.utteranceEndMs = endMs;
      if (message.is_final) {
        stream.finalChunks.push(text);
        if (message.speech_final) {
          this.emitFinal(stream);
        } else {
          this.emitPartial(stream, stream.finalChunks.join(' '));
        }
      } else {
        this.emitPartial(stream, [...stream.finalChunks, text].join(' '));
      }
      return;
    }
    if (message.speech_final) this.emitFinal(stream);
  }

  private emitPartial(stream: TrackStream, text: string): void {
    if (!text) return;
    const resultId = randomUUID();
    this.emitResult({
      resultId,
      replacesResultId: stream.lastPartialId ?? undefined,
      meetingId: this.meetingId,
      participantId: stream.track.participantId,
      trackSid: stream.track.trackSid,
      kind: 'transcript-partial',
      isFinal: false,
      createdAtMs: Date.now(),
      payload: {
        text,
        startMs: stream.utteranceStartMs,
        endMs: stream.utteranceEndMs,
      },
    });
    stream.lastPartialId = resultId;
  }

  private emitFinal(stream: TrackStream): void {
    const text = stream.finalChunks.join(' ');
    if (text) {
      this.emitResult({
        resultId: randomUUID(),
        replacesResultId: stream.lastPartialId ?? undefined,
        meetingId: this.meetingId,
        participantId: stream.track.participantId,
        trackSid: stream.track.trackSid,
        kind: 'transcript-final',
        isFinal: true,
        createdAtMs: Date.now(),
        payload: {
          text,
          startMs: stream.utteranceStartMs,
          endMs: stream.utteranceEndMs,
        },
      });
    }
    stream.lastPartialId = null;
    stream.finalChunks = [];
    stream.utteranceStartMs = null;
    stream.utteranceEndMs = null;
  }

  private closeStream(stream: TrackStream): void {
    this.streams.delete(stream.track.trackSid);
    try {
      stream.socket.close();
    } catch {
      return;
    }
  }

  private pingIdleStreams(): void {
    const now = Date.now();
    for (const stream of this.streams.values()) {
      if (now - stream.lastFrameAtMs >= KEEPALIVE_MS) {
        stream.socket.send('{"type":"KeepAlive"}');
      }
    }
  }
}
