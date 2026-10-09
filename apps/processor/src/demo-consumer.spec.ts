import type { AudioFrame, ProcessingResult, TrackRef } from '@requimeet/contracts';
import { DemoConsumer } from './consumers/demo-consumer';

function audioFrame(participantId: string): AudioFrame {
  const track: TrackRef = {
    meetingId: 'm1',
    participantId,
    trackSid: `sid-${participantId}`,
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

describe('DemoConsumer', () => {
  it('cuenta frames por participante y emite resultados kind demo', () => {
    const results: ProcessingResult[] = [];
    const consumer = new DemoConsumer('m1', (r) => results.push(r), () => 7);

    for (let i = 0; i < 5; i++) consumer.onAudioFrame(audioFrame('p1'));
    for (let i = 0; i < 3; i++) consumer.onAudioFrame(audioFrame('p2'));
    consumer.tick();

    expect(results).toHaveLength(2);
    const byParticipant = new Map(results.map((r) => [r.participantId, r]));
    expect(byParticipant.get('p1')).toMatchObject({
      meetingId: 'm1',
      kind: 'demo',
      isFinal: false,
      payload: {
        audioFrames: 5,
        videoFrames: 0,
        droppedFrames: 7,
        note: 'DEMO: no es una transcripcion',
      },
    });
    expect(byParticipant.get('p2')?.payload).toMatchObject({ audioFrames: 3 });
    for (const r of results) {
      expect(r.resultId).toBeTruthy();
      expect(r.createdAtMs).toBeGreaterThan(0);
    }
  });

  it('sin participantes no emite nada', () => {
    const results: ProcessingResult[] = [];
    const consumer = new DemoConsumer('m1', (r) => results.push(r), () => 0);
    consumer.tick();
    expect(results).toHaveLength(0);
  });
});
