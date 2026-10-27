import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import BrodyVoice from './BrodyVoice';
vi.mock('../workspace/useResource', () => ({ useResource: () => ({ data: {
  enabled: true, shared: false, version: 1, available: true,
  latest: { id: 'reply', key: 'mention:1', kind: 'reply', status: 'ready', text: 'Una respuesta', createdAt: new Date().toISOString() },
}, error: '', reload: vi.fn(), setData: vi.fn() }) }));
const contexts: { resume: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; decodeAudioData: ReturnType<typeof vi.fn> }[] = [];
beforeEach(() => {
  contexts.length = 0;
  vi.stubGlobal('AudioContext', class {
    state = 'running'; currentTime = 0;
    resume = vi.fn(async () => {}); close = vi.fn(async () => {});
    decodeAudioData = vi.fn(async () => ({ duration: 1 }));
    constructor() { contexts.push(this); }
  });
});
afterEach(() => vi.unstubAllGlobals());
const props = { code: 'ONE', token: 'token', canEdit: true, connected: true, speaking: true, refreshVersion: 0 };
it('ignores a late download after switching rooms instead of reading an undefined player context', async () => {
  let deliver!: (response: unknown) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { deliver = resolve; })));
  const view = render(<BrodyVoice {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Escuchar a Brody' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  view.rerender(<BrodyVoice {...props} code="TWO" />);
  await act(async () => { deliver({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }); });
  expect(contexts[0].close).toHaveBeenCalledTimes(1);
  expect(contexts[0].decodeAudioData).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'Escuchar a Brody' })).toBeTruthy();
});
it('ignores decoded audio belonging to a destroyed player', async () => {
  let decoded!: (buffer: unknown) => void;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
  const view = render(<BrodyVoice {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Escuchar a Brody' }));
  contexts[0].decodeAudioData.mockImplementation(() => new Promise(resolve => { decoded = resolve; }));
  await waitFor(() => expect(contexts[0].decodeAudioData).toHaveBeenCalled());
  view.rerender(<BrodyVoice {...props} code="TWO" />);
  await act(async () => decoded({ duration: 1 }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'Escuchar a Brody' })).toBeTruthy();
});
