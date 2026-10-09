import type { ProcessingResult, StartProcessingRequest } from '@requimeet/contracts';
import { createApp, SessionHandle } from './app';
import { DemoConsumer } from './consumers/demo-consumer';
import { ResultsClient } from './results-client';
import { MediaSession } from './session';

const PORT = Number(process.env.PROCESSOR_PORT) || 4100;
const SECRET = process.env.INTERNAL_SHARED_SECRET;
const SERVER_INTERNAL_URL =
  process.env.SERVER_INTERNAL_URL ?? 'http://localhost:3000';

const log = (msg: string) => console.log(`[processor] ${msg}`);

if (!SECRET) {
  console.error('[processor] INTERNAL_SHARED_SECRET no configurada');
  process.exit(1);
}

const results = new ResultsClient(SERVER_INTERNAL_URL, SECRET, log);

function sessionFactory(request: StartProcessingRequest): SessionHandle {
  let session: MediaSession;
  const demo = new DemoConsumer(
    request.meetingId,
    (result: ProcessingResult) => void results.post(result),
    () => session.droppedFrames(),
  );
  session = new MediaSession(request, [demo], log);
  return session;
}

const app = createApp({ internalSecret: SECRET, sessionFactory, logger: log });

app.listen(PORT, () => {
  log(`API interna escuchando en :${PORT}`);
});
