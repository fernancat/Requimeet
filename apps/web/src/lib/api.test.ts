import { describe, expect, it, vi, beforeEach } from 'vitest';
import { api, ApiError } from './api';

describe('api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('error 403 -> ApiError con status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'forbidden' }), { status: 403 }),
      ),
    );

    const promise = api('/meetings/X/media-token', { method: 'POST', token: 't' });
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ status: 403, message: 'forbidden' });
  });

  it('envia Authorization y parsea la respuesta', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const data = await api<{ ok: boolean }>('/auth/me', { token: 'tok' });

    expect(data.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('fallo de red -> ApiError status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(api('/x')).rejects.toMatchObject({ status: 0 });
  });
});
