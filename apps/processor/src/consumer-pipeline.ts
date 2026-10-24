import type { AudioFrame, MediaConsumer, VideoFrame } from '@requimeet/contracts';
import { FrameBuffer } from './frame-buffer';

export type FrameEnvelope =
  | { type: 'audio'; frame: AudioFrame }
  | { type: 'video'; frame: VideoFrame }
  | { type: 'event'; invoke: (consumer: MediaConsumer) => void | Promise<void> };

const LOG_EVERY_DROPS = 100;

/**
 * Alimenta a un consumidor desde una cola acotada (drop-oldest).
 * Un consumidor que lanza se loguea y NO interrumpe la sesion.
 */
export class ConsumerPipeline {
  readonly buffer = new FrameBuffer<FrameEnvelope>(50, envelope => envelope.type !== 'event');
  private worker: Promise<void> | null = null;

  constructor(
    private readonly consumer: MediaConsumer,
    private readonly name: string,
    private readonly logger: (msg: string) => void,
  ) {}

  start(): void {
    if (this.worker) return;
    this.worker = this.run();
  }

  push(envelope: FrameEnvelope): void {
    const before = this.buffer.dropped;
    this.buffer.push(envelope);
    if (this.buffer.dropped >= before + 1 && this.buffer.dropped % LOG_EVERY_DROPS === 0) {
      this.logger(`pipeline ${this.name}: ${this.buffer.dropped} frames descartados (drop-oldest)`);
    }
  }

  get droppedCount(): number {
    return this.buffer.dropped;
  }

  async close(): Promise<void> {
    this.buffer.close();
    await this.worker;
  }

  private async run(): Promise<void> {
    for (;;) {
      const envelope = await this.buffer.next();
      if (envelope === null) return;
      try {
        if (envelope.type === 'audio') {
          await this.consumer.onAudioFrame?.(envelope.frame);
        } else if (envelope.type === 'video') {
          await this.consumer.onVideoFrame?.(envelope.frame);
        } else {
          await envelope.invoke(this.consumer);
        }
      } catch (error) {
        this.logger(`consumidor ${this.name} lanzo (se continua): ${String(error)}`);
      }
    }
  }
}
