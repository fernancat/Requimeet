import type { AudioFrame, MediaConsumer, TrackRef } from '@requimeet/contracts';
import { ConsumerPipeline } from './consumer-pipeline';

const track: TrackRef = {
  meetingId: 'm1',
  participantId: 'p1',
  trackSid: 'sid1',
  kind: 'audio',
  source: 'microphone',
};

function frame(): AudioFrame {
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ConsumerPipeline', () => {
  it('un consumidor que lanza no interrumpe el procesamiento', async () => {
    const errors: string[] = [];
    const received: number[] = [];
    const consumer: MediaConsumer = {
      onAudioFrame: () => {
        received.push(1);
        throw new Error('boom');
      },
    };
    const pipeline = new ConsumerPipeline(consumer, 'test', (m) => errors.push(m));
    pipeline.start();
    pipeline.push({ type: 'audio', frame: frame() });
    pipeline.push({ type: 'audio', frame: frame() });
    pipeline.push({ type: 'audio', frame: frame() });
    await pipeline.close();

    expect(received).toHaveLength(3);
    expect(errors.filter((m) => m.includes('boom'))).toHaveLength(3);
  });

  it('respeta el limite del buffer bajo un consumidor lento', async () => {
    let processed = 0;
    const consumer: MediaConsumer = {
      onAudioFrame: () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            processed += 1;
            resolve();
          }, 20);
        }),
    };
    const pipeline = new ConsumerPipeline(consumer, 'slow', () => {});
    pipeline.start();
    for (let i = 0; i < 60; i++) {
      pipeline.push({ type: 'audio', frame: frame() });
    }
    await sleep(30);
    expect(pipeline.droppedCount).toBeGreaterThan(0);
    await pipeline.close();
    expect(processed).toBeGreaterThan(0);
  });
});
