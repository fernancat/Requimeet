/** One playback channel per browser; synthetic audio never enters LiveKit capture. */
export class VoicePlayer {
  private source?: AudioBufferSourceNode;
  private buffer?: AudioBuffer;
  private offset = 0;
  private startedAt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private speaking = false;
  private allowed = false;
  private disposed = false;
  constructor(readonly context: AudioContext, private readonly notify: (playing: boolean) => void) {}
  async unlock() { await this.context.resume(); }
  load(buffer: AudioBuffer) { this.clear(); this.buffer = buffer; this.schedule(); }
  gate(speaking: boolean, allowed: boolean) {
    this.speaking = speaking; this.allowed = allowed;
    clearTimeout(this.timer);
    if (speaking || !allowed) this.pause();
    else this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.buffer || this.source || this.speaking || !this.allowed || this.disposed) return;
    this.timer = setTimeout(() => this.play(), 1200);
  }
  private play() {
    if (!this.buffer || this.source || this.speaking || !this.allowed || this.disposed || this.context.state !== 'running') return;
    const source = this.context.createBufferSource(); source.buffer = this.buffer;
    source.connect(this.context.destination); this.source = source; this.startedAt = this.context.currentTime;
    source.onended = () => { if (this.source !== source) return; source.disconnect(); this.source = undefined; this.buffer = undefined; this.offset = 0; this.notify(false); };
    source.start(0, this.offset); this.notify(true);
  }
  private pause() {
    const source = this.source;
    if (!source) return;
    this.offset = Math.min(this.buffer?.duration ?? 0, this.offset + this.context.currentTime - this.startedAt);
    this.source = undefined; source.onended = null; source.stop(); source.disconnect(); this.notify(false);
    if (this.buffer && this.offset >= this.buffer.duration) { this.buffer = undefined; this.offset = 0; }
  }
  clear() { clearTimeout(this.timer); this.pause(); this.buffer = undefined; this.offset = 0; }
  dispose() { this.disposed = true; this.clear(); void this.context.close(); }
}
