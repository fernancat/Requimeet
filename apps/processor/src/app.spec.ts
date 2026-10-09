import { AddressInfo } from 'node:net';
import type { StartProcessingRequest } from '@requimeet/contracts';
import { createApp, SessionHandle } from './app';

const SECRET = 'test-secret';

const request: StartProcessingRequest = {
  meetingId: 'm1',
  roomName: 'ABCDE23456',
  livekitUrl: 'ws://localhost:7880',
  processorToken: 'token',
  enableVideo: false,
};

class FakeSession implements SessionHandle {
  meetingId = request.meetingId;
  started = false;
  stopped = 0;
  private state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' = 'connecting';

  constructor(private readonly failOnStart = false) {}

  connectionState() {
    return this.state;
  }

  info() {
    return {
      meetingId: this.meetingId,
      roomName: request.roomName,
      startedAtMs: 1,
      subscribedTracks: 0,
      connectionState: this.state,
    };
  }

  async start(): Promise<void> {
    if (this.failOnStart) throw new Error('connect failed');
    this.started = true;
    this.state = 'connected';
  }

  async stop(): Promise<void> {
    this.stopped += 1;
    this.state = 'disconnected';
  }

  breakIt(): void {
    this.state = 'disconnected';
  }
}

describe('API interna del processor', () => {
  let base: string;
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  let created: FakeSession[];

  beforeAll(async () => {
    created = [];
    const app = createApp({
      internalSecret: SECRET,
      sessionFactory: () => {
        const session = new FakeSession();
        created.push(session);
        return session;
      },
    });
    server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  const call = (method: string, path: string, body?: unknown, secret = SECRET) =>
    fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'x-internal-secret': secret } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  it('sin secreto o con secreto malo -> 401', async () => {
    expect((await call('GET', '/sessions', undefined, '')).status).toBe(401);
    expect((await call('GET', '/sessions', undefined, 'malo')).status).toBe(401);
  });

  it('POST /sessions es idempotente por meetingId', async () => {
    const first = await call('POST', '/sessions', request);
    expect(first.status).toBe(201);
    const second = await call('POST', '/sessions', request);
    expect(second.status).toBe(200);

    expect(created).toHaveLength(1);
    const list = (await (await call('GET', '/sessions')).json()) as { meetingId: string; connectionState: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ meetingId: 'm1', connectionState: 'connected' });
  });

  it('sesion en mal estado se reinicia sin duplicar', async () => {
    created[0].breakIt();
    const res = await call('POST', '/sessions', request);
    expect(res.status).toBe(201);
    expect(created).toHaveLength(2);
    expect(created[0].stopped).toBe(1);
    const list = (await (await call('GET', '/sessions')).json()) as { meetingId: string; connectionState: string }[];
    expect(list).toHaveLength(1);
  });

  it('DELETE /sessions/:meetingId es idempotente', async () => {
    const first = await call('DELETE', '/sessions/m1');
    expect(first.status).toBe(200);
    expect(((await first.json()) as { stopped: boolean }).stopped).toBe(true);
    const second = await call('DELETE', '/sessions/m1');
    expect(((await second.json()) as { stopped: boolean }).stopped).toBe(false);
    expect((await (await call('GET', '/sessions')).json()) as unknown[]).toHaveLength(0);
  });

  it('body invalido -> 400', async () => {
    const res = await call('POST', '/sessions', { meetingId: 'x' });
    expect(res.status).toBe(400);
  });
});
