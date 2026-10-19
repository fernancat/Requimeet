import { ConfigService } from '@nestjs/config';
import { OpenRouterService } from './openrouter.service';
describe('OpenRouter live latency settings', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  it('disables optional reasoning only for live analysis and preserves the exact model', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'deepseek/deepseek-v4-flash' }] }) })
      .mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }) });
    global.fetch = fetchMock;
    const service = new OpenRouterService(new ConfigService({ OPENROUTER_API_KEY: 'test-key' }));
    await service.generate('test', {}, { live: true });
    const live = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(live.model).toBe('deepseek/deepseek-v4-flash');
    expect(live.reasoning).toEqual({ effort: 'none' });
    expect(live.max_tokens).toBe(3000);
    expect(live.provider).toEqual({ sort: 'latency' });
    await service.generate('document', {});
    const document = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(document.provider).toBeUndefined(); expect(document.reasoning).toBeUndefined(); expect(document.max_tokens).toBe(7000);
  });
});
