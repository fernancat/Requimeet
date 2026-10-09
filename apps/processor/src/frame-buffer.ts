/** Cola acotada con politica drop-oldest y contador de descartes. */
export class FrameBuffer<T> {
  private items: T[] = [];
  private waiting: (() => void) | null = null;
  private closed = false;
  dropped = 0;

  constructor(private readonly capacity = 50) {}

  push(item: T): void {
    if (this.closed) return;
    this.items.push(item);
    while (this.items.length > this.capacity) {
      this.items.shift();
      this.dropped += 1;
    }
    this.waiting?.();
  }

  get size(): number {
    return this.items.length;
  }

  async next(): Promise<T | null> {
    for (;;) {
      const item = this.items.shift();
      if (item !== undefined) return item;
      if (this.closed) return null;
      await new Promise<void>((resolve) => {
        this.waiting = resolve;
      });
      this.waiting = null;
    }
  }

  close(): void {
    this.closed = true;
    this.waiting?.();
  }
}
