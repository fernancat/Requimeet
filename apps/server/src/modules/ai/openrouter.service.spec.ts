import { z } from 'zod';
import { ConfigService } from '@nestjs/config';
import { OpenRouterService } from './openrouter.service';
describe('OpenRouter live latency settings', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  it('uses low reasoning for conversational comprehension and preserves the exact model', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'deepseek/deepseek-v4-flash' }] }) })
      .mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }) });
    global.fetch = fetchMock;
    const service = new OpenRouterService(new ConfigService({ OPENROUTER_API_KEY: 'test-key' }));
    await service.generate('test', {}, { live: true });
    const live = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(live.model).toBe('deepseek/deepseek-v4-flash');
    expect(live.reasoning).toEqual({ effort: 'low' });
    expect(live.max_tokens).toBe(3000);
    expect(live.provider).toEqual({ sort: 'throughput', preferred_max_latency: { p90: 3 }, preferred_min_throughput: { p90: 80 } });
    await service.generate('document', {});
    const document = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(document.provider).toBeUndefined(); expect(document.reasoning).toBeUndefined(); expect(document.max_tokens).toBe(7000);
  });
  it('uses a bounded non-reasoning budget only for the focused conversational turn', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'deepseek/deepseek-v4-flash' }] }) })
      .mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }) });
    global.fetch = fetchMock;
    const service = new OpenRouterService(new ConfigService({ OPENROUTER_API_KEY: 'test-key' }));
    await service.generate('turn', {}, { live: true, turn: true });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.reasoning).toEqual({ effort: 'none' });
    expect(body.max_tokens).toBe(1800);
    expect(body.model).toBe('deepseek/deepseek-v4-flash');
  });

  it('exige JSON Schema al proveedor y valida también una respuesta Markdown completa', async () => {
    const schema = z.object({ names: z.array(z.string()) }).strict();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'deepseek/deepseek-v4-flash' }] }) })
      .mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '```json\n{"names":["Ángela"]}\n```' }, finish_reason: 'stop' }] }) });
    global.fetch = fetchMock;
    const service = new OpenRouterService(new ConfigService({ OPENROUTER_API_KEY: 'test-key' }));
    expect(await service.generate('names', {}, { schema })).toEqual({ names: ['Ángela'] });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true, schema: { additionalProperties: false, required: ['names'] } } });
    expect(body.provider.require_parameters).toBe(true);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"names": 42}' }, finish_reason: 'stop' }] }) });
    await expect(service.generate('names', {}, { schema })).rejects.toMatchObject({ code: 'SCHEMA', retryable: false });
  });
  it('rechaza errores HTTP permanentes y respuestas truncadas sin reintentar dentro del cliente', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'deepseek/deepseek-v4-flash' }] }) })
      .mockResolvedValue({ ok: false, status: 401, headers: new Headers() });
    global.fetch = fetchMock;
    const service = new OpenRouterService(new ConfigService({ OPENROUTER_API_KEY: 'test-key' }));
    await expect(service.generate('test', {})).rejects.toMatchObject({ code: 'HTTP_401', retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{}' }, finish_reason: 'length' }] }) });
    await expect(service.generate('test', {})).rejects.toMatchObject({ code: 'TOKEN_LIMIT', retryable: false });
  });

});
