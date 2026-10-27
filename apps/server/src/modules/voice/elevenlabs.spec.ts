import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import { ElevenLabsService } from './elevenlabs.service';
jest.mock('ws', () => ({ __esModule: true, default: jest.fn() }));
describe('Eleven v4 Turbo transport', () => {
  let socket: EventEmitter & { send: jest.Mock; terminate: jest.Mock };
  const service = new ElevenLabsService(new ConfigService({ ELEVENLABS_API_KEY: 'private-test' }));
  beforeEach(() => { jest.useFakeTimers(); socket = Object.assign(new EventEmitter(), { send: jest.fn(), terminate: jest.fn() }); (WebSocket as unknown as jest.Mock).mockImplementation(() => socket); });
  afterEach(() => jest.useRealTimers());
  it('uses v4 dialogue protocol, flushes and requires final confirmation', async () => {
    const work = service.synthesize('Hola'); socket.emit('open');
    expect(WebSocket).toHaveBeenLastCalledWith(expect.stringContaining('model_id=eleven_v4_turbo'), expect.anything());
    expect(socket.send.mock.calls.map(([x]) => JSON.parse(x))).toEqual([
      { voices: ['21m00Tcm4TlvDq8ikWAM'] }, { inputs: [{ text: 'Hola', voice_id: '21m00Tcm4TlvDq8ikWAM' }] }, { close_socket: true },
    ]);
    socket.emit('message', JSON.stringify({ audio: Buffer.from('mp3').toString('base64') })); socket.emit('message', JSON.stringify({ is_final: true }));
    expect((await work).toString()).toBe('mp3'); expect(socket.terminate).toHaveBeenCalledTimes(1);
  });
  it('times out, cancels and rejects incomplete streams without leaking provider details', async () => {
    const work = service.synthesize('hola'); const rejection = expect(work).rejects.toThrow('tardó demasiado'); jest.advanceTimersByTime(18000); await rejection;
    const abort = new AbortController(); const cancelled = service.synthesize('hola', abort.signal); const expected = expect(cancelled).rejects.toThrow('cancelada'); abort.abort(); await expected;
    const incomplete = service.synthesize('hola'); const closed = expect(incomplete).rejects.toThrow('antes de completar'); socket.emit('close'); await closed;
  });
});
