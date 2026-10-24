import { withTimeout } from './timeout';

it('libera una operación bloqueada dentro del límite y acepta operaciones terminadas', async () => {
  jest.useFakeTimers();
  try {
    await expect(withTimeout(Promise.resolve('ok'), 3000, 'blocked')).resolves.toBe('ok');
    const blocked = withTimeout(new Promise<void>(() => {}), 3000, 'blocked');
    const rejected = expect(blocked).rejects.toThrow('blocked');
    await jest.advanceTimersByTimeAsync(3000);
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
