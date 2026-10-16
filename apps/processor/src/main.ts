import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import type { MediaConsumer, ProcessingResult, StartProcessingRequest } from '@requimeet/contracts';
import { createApp, SessionHandle } from './app';
import { DeepgramConsumer } from './consumers/deepgram-consumer';
import { DemoConsumer } from './consumers/demo-consumer';
import { ResultsClient } from './results-client';
import { MediaSession } from './session';

// Carga .env del repo (raiz) y luego el local del paquete si existe (este gana).
loadEnv({ path: resolve(__dirname, '../../../.env') });
loadEnv({ path: resolve(__dirname, '../.env'), override: true });

const PORT = Number(process.env.PROCESSOR_PORT) || 4100;
const SECRET = process.env.INTERNAL_SHARED_SECRET;
const SERVER_INTERNAL_URL =
  process.env.SERVER_INTERNAL_URL ?? 'http://localhost:3000';
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

const log = (msg: string) => console.log(`[processor] ${msg}`);

if (!SECRET) {
  console.error('[processor] INTERNAL_SHARED_SECRET no configurada');
  process.exit(1);
}

const results = new ResultsClient(SERVER_INTERNAL_URL, SECRET, log);

function sessionFactory(request: StartProcessingRequest): SessionHandle {
  let session: MediaSession;
  const consumers: MediaConsumer[] = [
    new DemoConsumer(
      request.meetingId,
      (result: ProcessingResult) => void results.post(result),
      () => session.droppedFrames(),
    ),
  ];
  if (DEEPGRAM_API_KEY) {
    consumers.push(
      new DeepgramConsumer(
        request.meetingId,
        DEEPGRAM_API_KEY,
        (result: ProcessingResult) => void results.post(result),
        log,
      ),
    );
  }
  session = new MediaSession(request, consumers, log);
  return session;
}

if (!DEEPGRAM_API_KEY) {
  log('DEEPGRAM_API_KEY no configurada: transcripcion desactivada');
}

const app = createApp({ internalSecret: SECRET, sessionFactory, logger: log });

app.listen(PORT, () => {
  log(`API interna escuchando en :${PORT}`);
});
