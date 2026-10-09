import { FrameBuffer } from './frame-buffer';

describe('FrameBuffer', () => {
  it('drop-oldest: 60 pushes en capacidad 50 dejan 50 y 10 descartes', () => {
    const buffer = new FrameBuffer<number>(50);
    for (let i = 0; i < 60; i++) buffer.push(i);

    expect(buffer.size).toBe(50);
    expect(buffer.dropped).toBe(10);
  });

  it('descarta los mas viejos primero', async () => {
    const buffer = new FrameBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach((n) => buffer.push(n));

    expect(await buffer.next()).toBe(3);
    expect(await buffer.next()).toBe(4);
    expect(await buffer.next()).toBe(5);
  });

  it('close desbloquea next con null', async () => {
    const buffer = new FrameBuffer<number>(5);
    const pending = buffer.next();
    buffer.close();
    expect(await pending).toBeNull();
  });
});
