import type { AudioFrame, ProcessingResult, TrackRef } from '@requimeet/contracts';
import {
  DeepgramConsumer,
  DeepgramSocket,
  DeepgramSocketFactory,
} from './consumers/deepgram-consumer';

class FakeSocket implements DeepgramSocket {
  sent: Array<string | Buffer> = [];
  closed = false;
  private readonly listeners = new Map<string, Array<(data: never) => void>>();

  on(event: string, listener: (data: never) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  send(data: string | Buffer): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  receive(raw: string): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener(raw as never);
    }
  }
}

function audioFrame(participantId: string, trackSid: string): AudioFrame {
  const track: TrackRef = {
    meetingId: 'm1',
    participantId,
    trackSid,
    kind: 'audio',
    source: 'microphone',
  };
  return {
    track,
    format: 'pcm16',
    sampleRateHz: 48000,
    channels: 1,
    durationMs: 10,
    mediaTimeMs: 0,
    receivedAtMs: Date.now(),
    samples: new Int16Array(480),
  };
}

function transcriptMessage(text: string, opts: { is_final?: boolean; speech_final?: boolean; start?: number; duration?: number } = {}): string {
  return JSON.stringify({
    channel: { alternatives: [{ transcript: text }] },
    is_final: opts.is_final ?? false,
    speech_final: opts.speech_final ?? false,
    start: opts.start ?? 0,
    duration: opts.duration ?? 0.5,
  });
}

describe('DeepgramConsumer', () => {
  let sockets: FakeSocket[];
  let openedUrls: string[];
  let factory: DeepgramSocketFactory;

  beforeEach(() => {
    sockets = [];
    openedUrls = [];
    factory = (url) => {
      openedUrls.push(url);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    };
  });

  it('abre un stream por track y envia PCM16 con autorizacion', () => {
    const consumer = new DeepgramConsumer('m1', 'key-123', () => {}, () => {}, factory);
    consumer.onAudioFrame(audioFrame('p1', 'sid-1'));
    consumer.onAudioFrame(audioFrame('p2', 'sid-2'));
    consumer.onAudioFrame(audioFrame('p1', 'sid-1'));

    expect(sockets).toHaveLength(2);
    expect(openedUrls[0]).toContain('sample_rate=48000');
    expect(openedUrls[0]).toContain('interim_results=true');
    expect(sockets[0].sent).toHaveLength(2);
    expect(sockets[0].sent[0]).toBeInstanceOf(Buffer);
  });

  it('parciales reemplazan al anterior via replacesResultId y final cierra la utt', () => {
    const results: ProcessingResult[] = [];
    const consumer = new DeepgramConsumer('m1', 'key', (r) => results.push(r), () => {}, factory);
    consumer.onAudioFrame(audioFrame('p1', 'sid-1'));
    const socket = sockets[0];

    socket.receive(transcriptMessage('prueba uno'));
    socket.receive(transcriptMessage('prueba uno dos'));
    socket.receive(transcriptMessage('prueba uno dos', { is_final: true, speech_final: true }));

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      kind: 'transcript-partial',
      isFinal: false,
      participantId: 'p1',
      trackSid: 'sid-1',
      replacesResultId: undefined,
      payload: { text: 'prueba uno', startMs: 0, endMs: 500 },
    });
    expect(results[1]).toMatchObject({
      kind: 'transcript-partial',
      replacesResultId: results[0].resultId,
      payload: { text: 'prueba uno dos' },
    });
    expect(results[2]).toMatchObject({
      kind: 'transcript-final',
      replacesResultId: results[1].resultId,
      payload: { text: 'prueba uno dos' },
    });
  });

  it('publica cada segmento confirmado sin esperar speech_final', () => {
    const results: ProcessingResult[] = [];
    const consumer = new DeepgramConsumer('m1', 'key', (r) => results.push(r), () => {}, factory);
    consumer.onAudioFrame(audioFrame('p1', 'sid-1'));
    const socket = sockets[0];

    socket.receive(transcriptMessage('prueba uno', { is_final: true }));
    socket.receive(transcriptMessage('prueba dos', { is_final: true, speech_final: true }));

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ kind: 'transcript-final', isFinal: true, payload: { text: 'prueba uno' } });
    expect(results[1]).toMatchObject({ kind: 'transcript-final', isFinal: true, payload: { text: 'prueba dos' } });
    expect(results[1].resultId).not.toBe(results[0].resultId);
  });

  it('participantes en paralelo no mezclan resultados', () => {
    const results: ProcessingResult[] = [];
    const consumer = new DeepgramConsumer('m1', 'key', (r) => results.push(r), () => {}, factory);
    consumer.onAudioFrame(audioFrame('p1', 'sid-1'));
    consumer.onAudioFrame(audioFrame('p2', 'sid-2'));

    sockets[0].receive(transcriptMessage('prueba uno'));
    sockets[1].receive(transcriptMessage('prueba dos', { is_final: true, speech_final: true }));

    expect(results[0]).toMatchObject({ participantId: 'p1', payload: { text: 'prueba uno' } });
    expect(results[1]).toMatchObject({ participantId: 'p2', payload: { text: 'prueba dos' } });
  });

  it('speech_final sin texto no emite y resetea la utt', () => {
    const results: ProcessingResult[] = [];
    const consumer = new DeepgramConsumer('m1', 'key', (r) => results.push(r), () => {}, factory);
    consumer.onAudioFrame(audioFrame('p1', 'sid-1'));
    const socket = sockets[0];

    socket.receive(transcriptMessage('una frase', { is_final: true, speech_final: true }));
    socket.receive(JSON.stringify({ speech_final: true, is_final: true }));
    socket.receive(transcriptMessage('otra', { is_final: true, speech_final: true }));

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ payload: { text: 'una frase' } });
    expect(results[1]).toMatchObject({ payload: { text: 'otra' } });
    expect(results[1].replacesResultId).toBeUndefined();
  });

  it('onTrackUnpublished y onSessionEnd cierran el socket', () => {
    const consumer = new DeepgramConsumer('m1', 'key', () => {}, () => {}, factory);
    consumer.onAudioFrame(audioFrame('p1', 'sid-1'));
    consumer.onAudioFrame(audioFrame('p2', 'sid-2'));

    consumer.onTrackUnpublished({
      meetingId: 'm1',
      participantId: 'p1',
      trackSid: 'sid-1',
      kind: 'audio',
      source: 'microphone',
    });
    expect(sockets[0].closed).toBe(true);
    expect(sockets[1].closed).toBe(false);

    consumer.onSessionEnd();
    expect(sockets[1].closed).toBe(true);
  });

  it('solicita Finalize al detenerse PCM y espera confirmación sin promover parciales', async () => {
    jest.useFakeTimers();
    const results: ProcessingResult[] = [];
    const consumer = new DeepgramConsumer('m1', 'key', r => results.push(r), () => {}, factory);
    try {
      consumer.onSessionStart();
      consumer.onAudioFrame(audioFrame('p1', 'sid-1'));
      sockets[0].receive(transcriptMessage('respuesta provisional'));
      jest.advanceTimersByTime(750);
      expect(sockets[0].sent.filter(item => item === '{"type":"Finalize"}')).toHaveLength(1);
      expect(results.every(r => !r.isFinal)).toBe(true);
      jest.advanceTimersByTime(1000);
      expect(sockets[0].sent.filter(item => item === '{"type":"Finalize"}')).toHaveLength(1);
      sockets[0].receive(transcriptMessage('respuesta confirmada', { is_final: true }));
      expect(results.at(-1)).toMatchObject({ isFinal: true, payload: { text: 'respuesta confirmada' } });
      consumer.onAudioFrame(audioFrame('p1', 'sid-1'));
      sockets[0].receive(transcriptMessage('otra respuesta'));
      jest.advanceTimersByTime(750);
      expect(sockets[0].sent.filter(item => item === '{"type":"Finalize"}')).toHaveLength(2);
    } finally { await consumer.onSessionEnd(); jest.useRealTimers(); }
  });

  it('json invalido se ignora sin lanzar', () => {
    const consumer = new DeepgramConsumer('m1', 'key', () => {}, () => {}, factory);
    consumer.onAudioFrame(audioFrame('p1', 'sid-1'));
    expect(() => sockets[0].receive('no-json')).not.toThrow();
  });
});

it('espera OPEN, conserva el último final al cerrar y entrega revisiones estables', async () => {
  let readyState = 0;
  const listeners: Record<string, (...args: any[]) => void> = {};
  const sent: (string | Buffer)[] = [];
  const socket: DeepgramSocket = {
    get readyState() { return readyState; },
    on: (event: string, fn: any) => { listeners[event] = fn; },
    send: data => { sent.push(data); if (data === '{"type":"CloseStream"}') {
      listeners.message(transcriptMessage('final pendiente', { is_final: true }));
      readyState = 3; listeners.close();
    } },
    close: () => { readyState = 3; listeners.close(); },
  };
  const results: ProcessingResult[] = [];
  const consumer = new DeepgramConsumer('m', 'test', r => results.push(r), () => {}, () => socket);
  consumer.onAudioFrame(audioFrame('p', 'sid'));
  expect(sent).toHaveLength(0);
  readyState = 1; listeners.open();
  expect(sent[0]).toBeInstanceOf(Buffer);
  listeners.message(transcriptMessage('parcial'));
  await consumer.onSessionEnd();
  const transcripts = results.filter(r => r.kind.startsWith('transcript'));
  expect(transcripts.at(-1)).toMatchObject({ isFinal: true, resultId: transcripts[0].resultId, payload: { text: 'final pendiente' } });
  expect(transcripts.at(-1)!.revision).toBeGreaterThan(transcripts[0].revision!);
});
