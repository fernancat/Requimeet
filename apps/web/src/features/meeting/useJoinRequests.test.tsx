import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JoinRequestDto } from '@requimeet/contracts';
import { useJoinRequests } from './useJoinRequests';

const apiMock = vi.fn().mockResolvedValue({});

vi.mock('../../lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

type Handler = (payload: { request: JoinRequestDto }) => void;

class FakeSocket {
  handlers = new Map<string, Handler[]>();

  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  off() {
    return this;
  }

  trigger(event: string, request: JoinRequestDto) {
    for (const handler of this.handlers.get(event) ?? []) {
      handler({ request });
    }
  }
}

const req = (id: string, status = 'pending'): JoinRequestDto => ({
  id,
  displayName: `Guest ${id}`,
  status: status as JoinRequestDto['status'],
  createdAt: '2026-01-01T00:00:00Z',
});

describe('useJoinRequests', () => {
  let socket: FakeSocket;

  beforeEach(() => {
    socket = new FakeSocket();
    apiMock.mockClear();
  });

  function renderRequests(onNew?: (r: JoinRequestDto) => void) {
    return renderHook(() =>
      useJoinRequests(socket as never, 'CODE1', 'token', true, onNew),
    );
  }

  it('estado inicial desde pendingRequests del ack', () => {
    const { result } = renderRequests();
    act(() => result.current.setInitial([req('r1'), req('r2', 'accepted')]));
    expect(result.current.pending.map((r) => r.id)).toEqual(['r1']);
  });

  it('join-request:new agrega y notifica; join-request:updated resuelve', () => {
    const onNew = vi.fn();
    const { result } = renderRequests(onNew);

    act(() => socket.trigger('join-request:new', req('r1')));
    expect(result.current.pending).toHaveLength(1);
    expect(onNew).toHaveBeenCalledTimes(1);

    // updated con status pending no resuelve
    act(() => socket.trigger('join-request:updated', req('r1')));
    expect(result.current.pending).toHaveLength(1);

    act(() => socket.trigger('join-request:updated', req('r1', 'accepted')));
    expect(result.current.pending).toHaveLength(0);
  });

  it('decide llama al endpoint correcto y marca working mientras procesa', async () => {
    let resolveApi: (v: unknown) => void = () => {};
    apiMock.mockImplementationOnce(
      () => new Promise((r) => { resolveApi = r; }),
    );
    const { result } = renderRequests();
    act(() => result.current.setInitial([req('r1')]));

    let promise: Promise<void> = Promise.resolve();
    act(() => {
      promise = result.current.decide('r1', 'accept');
    });
    expect(apiMock).toHaveBeenCalledWith(
      '/meetings/CODE1/join-requests/r1/accept',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.current.rowStates.r1).toBe('working');

    await act(async () => {
      resolveApi({});
      await promise;
    });
    expect(result.current.pending).toHaveLength(0);
    expect(result.current.rowStates.r1).toBeUndefined();
  });

  it('error en decide marca la fila como error sin quitarla', async () => {
    apiMock.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderRequests();
    act(() => result.current.setInitial([req('r1')]));

    await act(async () => {
      await result.current.decide('r1', 'reject');
    });
    expect(result.current.pending).toHaveLength(1);
    expect(result.current.rowStates.r1).toBe('error');
  });

  it('updated que pisa una decision en curso quita la fila sin error', async () => {
    let resolveApi: (v: unknown) => void = () => {};
    apiMock.mockImplementationOnce(
      () => new Promise((r) => { resolveApi = r; }),
    );
    const { result } = renderRequests();
    act(() => result.current.setInitial([req('r1')]));

    let promise: Promise<void> = Promise.resolve();
    act(() => {
      promise = result.current.decide('r1', 'accept');
    });
    act(() => socket.trigger('join-request:updated', req('r1', 'rejected')));

    expect(result.current.pending).toHaveLength(0);
    await act(async () => {
      resolveApi({});
      await promise;
    });
  });
});
