/**
 * Herramienta de dev: publica un tono seno de 440Hz (PCM16, 48kHz, mono,
 * frames de 10ms) en una sala de LiveKit durante ~15s. Sirve para probar el
 * processor de extremo a extremo sin navegador.
 *
 * Uso:
 *   npx ts-node scripts/publish-test-audio.ts <roomCode> [duracionSeg]
 * Env: LIVEKIT_URL (default ws://localhost:7880), LIVEKIT_API_KEY,
 *      LIVEKIT_API_SECRET (devkey/secret en dev).
 */
import { AudioFrame, AudioSource, LocalAudioTrack, Room } from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';

const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const FRAME_MS = 10;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_MS) / 1000;
const FREQ_HZ = 440;

async function main(): Promise<void> {
  const roomCode = process.argv[2];
  const durationSec = Number(process.argv[3] ?? 15);
  if (!roomCode) {
    console.error('uso: publish-test-audio.ts <roomCode> [duracionSeg]');
    process.exit(1);
  }
  const url = process.env.LIVEKIT_URL ?? 'ws://localhost:7880';
  const apiKey = process.env.LIVEKIT_API_KEY ?? 'devkey';
  const apiSecret = process.env.LIVEKIT_API_SECRET ?? 'secret';

  const token = new AccessToken(apiKey, apiSecret, {
    identity: 'test-publisher',
    name: 'Test Publisher',
    ttl: '15m',
  });
  token.addGrant({ roomJoin: true, room: roomCode, canPublish: true, canSubscribe: false });

  const room = new Room();
  await room.connect(url, await token.toJwt());
  console.log(`[test-publisher] conectado a ${roomCode}`);

  const source = new AudioSource(SAMPLE_RATE, CHANNELS);
  const track = LocalAudioTrack.createAudioTrack('test-tone', source);
  await room.localParticipant?.publishTrack(track);
  console.log('[test-publisher] publicando tono 440Hz...');

  const frames = Math.floor((durationSec * 1000) / FRAME_MS);
  let phase = 0;
  const phaseStep = (2 * Math.PI * FREQ_HZ) / SAMPLE_RATE;
  for (let i = 0; i < frames; i++) {
    const samples = new Int16Array(SAMPLES_PER_FRAME);
    for (let s = 0; s < SAMPLES_PER_FRAME; s++) {
      samples[s] = Math.round(Math.sin(phase) * 12000);
      phase += phaseStep;
    }
    await source.captureFrame(
      new AudioFrame(samples, SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME),
    );
    if (i % 100 === 0) {
      console.log(`[test-publisher] ${i / 100}s / ${durationSec}s`);
    }
  }

  await room.disconnect();
  console.log('[test-publisher] fin, desconectado');
}

void main();
