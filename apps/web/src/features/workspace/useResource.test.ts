import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useResource } from './useResource';
import { api } from '../../lib/api';
vi.mock('../../lib/api', () => ({ api: vi.fn() }));
beforeEach(() => { vi.mocked(api).mockReset(); });
it('publica el estado aunque lleguen eventos más rápido que REST y agrupa la siguiente lectura', async () => {
  const complete: ((value: unknown) => void)[] = [];
  vi.mocked(api).mockImplementation(() => new Promise(resolve => complete.push(resolve)) as never);
  const view = renderHook(({ refresh }) => useResource('/analysis', 'token', refresh), { initialProps: { refresh: 0 } });
  view.rerender({ refresh: 1 }); view.rerender({ refresh: 2 }); view.rerender({ refresh: 3 });
  expect(api).toHaveBeenCalledTimes(1);
  await act(async () => { complete[0]({ status: 'completed' }); });
  expect(view.result.current.data).toEqual({ status: 'completed' });
  expect(api).toHaveBeenCalledTimes(2);
  await act(async () => { complete[1]({ status: 'failed' }); });
  expect(view.result.current.data).toEqual({ status: 'failed' });
  view.unmount();
});
it('ignora una respuesta antigua al cambiar de reunión y aborta la petición anterior', async () => {
  const complete: ((value: unknown) => void)[] = [];
  vi.mocked(api).mockImplementation(() => new Promise(resolve => complete.push(resolve)) as never);
  const view = renderHook(({ path }) => useResource(path, 'token'), { initialProps: { path: '/a' } });
  const firstSignal = vi.mocked(api).mock.calls[0][1]!.signal;
  view.rerender({ path: '/b' });
  expect(firstSignal!.aborted).toBe(true);
  await act(async () => { complete[0]('reunión anterior'); complete[1]('reunión actual'); });
  expect(view.result.current.data).toBe('reunión actual');
  view.unmount();
});
it('muestra un fallo de conexión sin borrar el último estado guardado', async () => {
  vi.mocked(api).mockResolvedValueOnce({ status: 'completed' }).mockRejectedValueOnce(new Error('Sin conexión'));
  const view = renderHook(({ refresh }) => useResource('/analysis', 'token', refresh), { initialProps: { refresh: 0 } });
  await waitFor(() => expect(view.result.current.data).toEqual({ status: 'completed' }));
  view.rerender({ refresh: 1 });
  await waitFor(() => expect(view.result.current.error).toBe('Sin conexión'));
  expect(view.result.current.data).toEqual({ status: 'completed' });
  view.unmount();
});
