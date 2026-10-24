/** Cola acotada con politica drop-oldest y contador de descartes. */
export class FrameBuffer<T> {
  private items: T[] = [];
  private waiting: (() => void) | null = null;
  private closed = false;
  dropped = 0;

  constructor(private readonly capacity = 50, private readonly canDrop: (item: T) => boolean = () => true) {}

  push(item: T): void {
    if (this.closed) return;
    this.items.push(item);
    while (this.items.length > this.capacity) {
      const index = this.items.findIndex(this.canDrop);
      // Lifecycle events must survive media backpressure, even if only events remain.
      if (index === -1) break;
      this.items.splice(index, 1);
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
