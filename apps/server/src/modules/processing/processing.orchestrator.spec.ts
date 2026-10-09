import { ConfigService } from '@nestjs/config';
import { ProcessingOrchestrator } from './processing.orchestrator';

const config = () =>
  new ConfigService({
    INTERNAL_SHARED_SECRET: 'test-internal',
    PROCESSOR_INTERNAL_URL: 'http://processor:4100',
    PROCESSOR_ENABLE_VIDEO: 'false',
    LIVEKIT_URL: 'ws://localhost:7880',
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'secret',
  });

const payload = { meetingId: 'm1', code: 'ABCDE23456', hostId: 'h1', status: 'active' as const };

describe('ProcessingOrchestrator', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 201 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('meeting.started -> POST /sessions con token y secreto', async () => {
    const orchestrator = new ProcessingOrchestrator(config());

    await orchestrator.onMeetingStarted(payload);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://processor:4100/sessions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-internal-secret']).toBe('test-internal');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      meetingId: 'm1',
      roomName: 'ABCDE23456',
      livekitUrl: 'ws://localhost:7880',
      enableVideo: false,
    });
    expect(typeof body.processorToken).toBe('string');
    const tokenPayload = JSON.parse(
      Buffer.from(body.processorToken.split('.')[1], 'base64url').toString(),
    );
    expect(tokenPayload.sub).toBe('processor-m1');
    expect(tokenPayload.video).toMatchObject({
      roomJoin: true,
      room: 'ABCDE23456',
      canSubscribe: true,
      canPublish: false,
      hidden: true,
    });
  });

  it('processor caido: reintenta y no lanza', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    const orchestrator = new ProcessingOrchestrator(config());

    await expect(orchestrator.onMeetingStarted(payload)).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('meeting.ended -> DELETE /sessions/:meetingId tolerante', async () => {
    const orchestrator = new ProcessingOrchestrator(config());

    await orchestrator.onMeetingEnded({ ...payload, status: 'ended' });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://processor:4100/sessions/m1');
    expect(init.method).toBe('DELETE');

    fetchSpy.mockRejectedValue(new Error('down'));
    await expect(
      orchestrator.onMeetingEnded({ ...payload, status: 'ended' }),
    ).resolves.toBeUndefined();
  });
});
