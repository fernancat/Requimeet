import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChat } from './useChat';

vi.mock('../lib/api', () => ({
  api: vi.fn().mockResolvedValue([]),
  ApiError: class ApiError extends Error {},
}));

type EmitCall = { event: string; payload: { body: string; clientRef: string }; ack: (a: unknown) => void };

class FakeSocket {
  emits: EmitCall[] = [];
  handlers = new Map<string, ((...args: never[]) => void)[]>();

  on(event: string, handler: (...args: never[]) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  off() {
    return this;
  }

  emit(event: string, payload: { body: string; clientRef: string }, ack: (a: unknown) => void) {
    this.emits.push({ event, payload, ack });
  }
}

describe('useChat', () => {
  let socket: FakeSocket;

  beforeEach(() => {
    socket = new FakeSocket();
    vi.useRealTimers();
  });

  function renderChat() {
    return renderHook(() =>
      useChat('ABC123', 'token', socket as never, 'p-local', 'Yo', false),
    );
  }

  it('reenvio tras error reusa el MISMO clientRef', async () => {
    const { result } = renderChat();

    act(() => result.current.send('hola'));
    expect(socket.emits).toHaveLength(1);
    const firstRef = socket.emits[0].payload.clientRef;

    act(() => {
      socket.emits[0].ack({ ok: false, clientRef: firstRef, error: 'x' });
    });
    expect(result.current.pending[0].status).toBe('error');

    act(() => result.current.retry(firstRef));

    expect(socket.emits).toHaveLength(2);
    expect(socket.emits[1].payload.clientRef).toBe(firstRef);
    expect(result.current.pending[0].status).toBe('sending');
  });

  it('ack ok limpia el pendiente y agrega el mensaje', async () => {
    const { result } = renderChat();

    act(() => result.current.send('hola'));
    const firstRef = socket.emits[0].payload.clientRef;

    act(() => {
      socket.emits[0].ack({
        ok: true,
        clientRef: firstRef,
        message: {
          id: 'm1',
          meetingId: 'x',
          authorParticipantId: 'p-local',
          authorName: 'Yo',
          body: 'hola',
          createdAt: '2026-01-01T00:00:00Z',
          clientRef: firstRef,
        },
      });
    });

    await waitFor(() => {
      expect(result.current.pending).toHaveLength(0);
    });
    expect(result.current.messages.map((m) => m.id)).toContain('m1');
  });
});
