import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoicePlayer } from './voice-player';
describe('Brody respects conversational turns', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  function setup() {
    const nodes: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; onended: null | (() => void) }[] = [];
    const context = { currentTime: 0, state: 'running', destination: {}, resume: vi.fn(async () => {}), close: vi.fn(async () => {}), createBufferSource: () => {
      const node = { start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), onended: null }; nodes.push(node); return node;
    } };
    const notify = vi.fn(); const player = new VoicePlayer(context as unknown as AudioContext, notify);
    return { nodes, context, player, notify };
  }
  it('does not start while someone speaks, including when audio arrives during speech', () => {
    const { player, nodes } = setup(); player.gate(true, true); player.load({ duration: 10 } as AudioBuffer);
    vi.advanceTimersByTime(5000); expect(nodes).toHaveLength(0);
    player.gate(false, true); vi.advanceTimersByTime(1199); expect(nodes).toHaveLength(0);
    vi.advanceTimersByTime(1); expect(nodes[0].start).toHaveBeenCalledWith(0, 0); player.dispose();
  });
  it('interrupts immediately and resumes from its position only after a continuous quiet window', () => {
    const { player, nodes, context } = setup(); player.gate(false, true); player.load({ duration: 10 } as AudioBuffer); vi.advanceTimersByTime(1200);
    context.currentTime = 2; player.gate(true, true); expect(nodes[0].stop).toHaveBeenCalledTimes(1);
    player.gate(false, true); vi.advanceTimersByTime(700); player.gate(true, true); vi.advanceTimersByTime(1500); expect(nodes).toHaveLength(1);
    player.gate(false, true); vi.advanceTimersByTime(1200); expect(nodes[1].start).toHaveBeenCalledWith(0, 2); player.dispose();
  });
  it('cancels obsolete audio, disconnects nodes and leaves no delayed playback after exit', () => {
    const { player, nodes, context } = setup(); player.gate(false, true); player.load({ duration: 10 } as AudioBuffer); player.dispose(); vi.advanceTimersByTime(5000);
    expect(nodes).toHaveLength(0); expect(context.close).toHaveBeenCalled();
  });
  it('both listeners stop when the room reports a human speaker', () => {
    const host = setup(), guest = setup();
    for (const client of [host, guest]) { client.player.gate(false, true); client.player.load({ duration: 10 } as AudioBuffer); }
    vi.advanceTimersByTime(1200);
    for (const client of [host, guest]) { client.player.gate(true, true); expect(client.nodes[0].stop).toHaveBeenCalledTimes(1); client.player.dispose(); }
  });
});
