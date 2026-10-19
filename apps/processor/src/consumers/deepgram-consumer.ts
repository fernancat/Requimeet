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
  readonly readyState?: number;
  on(event: 'open' | 'error' | 'close', listener: () => void): void;
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
  segmentId: string;
  revision: number;
  pending: Buffer[];
  offsetMs: number;
  trackOffsetMs: number;
  closing: boolean;
  done?: () => void;
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
  private startedAtMs = 0;
  private readonly retryAt = new Map<string, { at: number; attempts: number }>();
  private readonly deliveries = new Set<Promise<unknown>>();
  private keepalive: NodeJS.Timeout | null = null;

  constructor(
    private readonly meetingId: string,
    private readonly apiKey: string,
    private readonly emitResult: (result: ProcessingResult) => unknown,
    private readonly logger: (msg: string) => void = () => {},
    private readonly openSocket: DeepgramSocketFactory = defaultOpenSocket,
  ) {}

  onSessionStart(session?: { startedAtMs: number }): void {
    this.startedAtMs = session?.startedAtMs ?? Date.now();
    this.keepalive = setInterval(() => this.pingIdleStreams(), KEEPALIVE_MS);
    this.keepalive.unref?.();
  }

  async onSessionEnd(): Promise<void> {
    if (this.keepalive) {
      clearInterval(this.keepalive);
      this.keepalive = null;
    }
    await Promise.all([...this.streams.values()].map(stream => this.closeStream(stream)));
    await Promise.allSettled([...this.deliveries]);
  }

  async onTrackUnpublished(track: TrackRef): Promise<void> {
    const stream = this.streams.get(track.trackSid);
    if (stream) await this.closeStream(stream);
  }

  onAudioFrame(frame: AudioFrame): void {
    const sid = frame.track.trackSid;
    let stream = this.streams.get(sid);
    if (!stream) {
      if ((this.retryAt.get(sid)?.at ?? 0) > Date.now()) return;
      stream = this.openStream(frame);
      this.streams.set(sid, stream);
    }
    stream.lastFrameAtMs = Date.now();
    const bytes = Buffer.from(
      frame.samples.buffer,
      frame.samples.byteOffset,
      frame.samples.byteLength,
    );
    if (stream.closing) return;
    if (stream.socket.readyState === undefined || stream.socket.readyState === WebSocket.OPEN) stream.socket.send(bytes);
    else {
      if (stream.pending.length >= 50) { stream.pending.shift(); this.logger('Deepgram: buffer lleno; audio descartado'); }
      stream.pending.push(Buffer.from(bytes));
    }
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
      socket, segmentId: randomUUID(), revision: 0, pending: [], closing: false,
      offsetMs: this.startedAtMs ? Math.max(0, frame.receivedAtMs - this.startedAtMs) : 0,
      trackOffsetMs: frame.mediaTimeMs,
      track: frame.track,
      lastPartialId: null,
      utteranceStartMs: null,
      utteranceEndMs: null,
      finalChunks: [],
      lastFrameAtMs: Date.now(),
    };
    socket.on('message', (data) => this.handleMessage(stream, data.toString()));
    socket.on('open', () => {
      this.deliver({ resultId: randomUUID(), meetingId: this.meetingId, kind: 'analysis', isFinal: false, createdAtMs: Date.now(), payload: { processingStatus: 'connected' } });
      this.retryAt.delete(frame.track.trackSid);
      for (const bytes of stream.pending.splice(0)) socket.send(bytes);
      if (stream.closing) socket.send('{"type":"CloseStream"}');
    });
    socket.on('error', () => { try { socket.close(); } catch { /* already closed */ } });
    socket.on('close', () => {
      this.emitFinal(stream);
      if (this.streams.get(stream.track.trackSid) === stream) this.streams.delete(stream.track.trackSid);
      if (!stream.closing) {
        this.deliver({ resultId: randomUUID(), meetingId: this.meetingId, kind: 'analysis', isFinal: false, createdAtMs: Date.now(), payload: { processingStatus: 'interrupted' } });
        const attempts = (this.retryAt.get(stream.track.trackSid)?.attempts ?? 0) + 1;
        this.retryAt.set(stream.track.trackSid, { attempts, at: Date.now() + Math.min(1000 * 2 ** (attempts - 1), 10000) });
        this.logger('Deepgram: conexión interrumpida; se reintentará con el próximo audio');
      }
      stream.done?.();
    });
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
    const resultId = stream.segmentId;
    this.deliver({
      resultId,
      revision: ++stream.revision,
      replacesResultId: stream.lastPartialId ?? undefined,
      meetingId: this.meetingId,
      participantId: stream.track.participantId,
      trackSid: stream.track.trackSid,
      kind: 'transcript-partial',
      isFinal: false,
      createdAtMs: Date.now(),
      payload: {
        text,
        startMs: stream.utteranceStartMs === null ? null : stream.offsetMs + stream.utteranceStartMs,
        trackStartMs: stream.utteranceStartMs === null ? null : stream.trackOffsetMs + stream.utteranceStartMs,
        endMs: stream.utteranceEndMs === null ? null : stream.offsetMs + stream.utteranceEndMs,
        trackEndMs: stream.utteranceEndMs === null ? null : stream.trackOffsetMs + stream.utteranceEndMs,
      },
    });
    stream.lastPartialId = resultId;
  }

  private emitFinal(stream: TrackStream): void {
    const text = stream.finalChunks.join(' ');
    if (text) {
      this.deliver({
        resultId: stream.segmentId,
        revision: ++stream.revision,
        replacesResultId: stream.lastPartialId ?? undefined,
        meetingId: this.meetingId,
        participantId: stream.track.participantId,
        trackSid: stream.track.trackSid,
        kind: 'transcript-final',
        isFinal: true,
        createdAtMs: Date.now(),
        payload: {
          text,
          startMs: stream.utteranceStartMs === null ? null : stream.offsetMs + stream.utteranceStartMs,
        trackStartMs: stream.utteranceStartMs === null ? null : stream.trackOffsetMs + stream.utteranceStartMs,
          endMs: stream.utteranceEndMs === null ? null : stream.offsetMs + stream.utteranceEndMs,
        trackEndMs: stream.utteranceEndMs === null ? null : stream.trackOffsetMs + stream.utteranceEndMs,
        },
      });
    }
    stream.segmentId = randomUUID();
    stream.revision = 0;
    stream.lastPartialId = null;
    stream.finalChunks = [];
    stream.utteranceStartMs = null;
    stream.utteranceEndMs = null;
  }

  private deliver(result: ProcessingResult): void {
    const promise = Promise.resolve(this.emitResult(result));
    this.deliveries.add(promise);
    void promise.finally(() => this.deliveries.delete(promise)).catch(() => this.logger('No se pudo entregar transcripción'));
  }

  private async closeStream(stream: TrackStream): Promise<void> {
    if (stream.closing) return;
    stream.closing = true;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.emitFinal(stream); stream.socket.close(); resolve(); }, 5000);
      stream.done = () => { clearTimeout(timer); resolve(); };
      try {
        if (stream.socket.readyState === undefined) { this.emitFinal(stream); stream.socket.close(); stream.done(); }
        else if (stream.socket.readyState === WebSocket.OPEN) stream.socket.send('{"type":"CloseStream"}');
        else if (stream.socket.readyState === WebSocket.CLOSED) stream.done();
      } catch { stream.done(); }
    });
    if (this.streams.get(stream.track.trackSid) === stream) this.streams.delete(stream.track.trackSid);
  }

  private pingIdleStreams(): void {
    const now = Date.now();
    for (const stream of this.streams.values()) {
      if (!stream.closing && (stream.socket.readyState === undefined || stream.socket.readyState === WebSocket.OPEN) && now - stream.lastFrameAtMs >= KEEPALIVE_MS) {
        stream.socket.send('{"type":"KeepAlive"}');
      }
    }
  }
}
