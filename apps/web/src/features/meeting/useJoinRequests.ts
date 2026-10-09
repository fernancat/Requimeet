import { useCallback, useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import type { JoinRequestDto, JoinRequestUpdatedPayload } from '@requimeet/contracts';
import { RT_EVENTS } from '@requimeet/contracts';
import { api, ApiError } from '../../lib/api';

export type RowState = 'working' | 'error';

export interface JoinRequestsState {
  pending: JoinRequestDto[];
  rowStates: Record<string, RowState>;
  decide: (id: string, action: 'accept' | 'reject') => Promise<void>;
}

/**
 * Cola de solicitudes de ingreso (solo host). Estado inicial desde el ack de
 * subscribe (pendingRequests) y actualizacion en vivo por socket. La
 * autorizacion real la fuerza el servidor; esto es solo UI.
 */
export function useJoinRequests(
  socket: Socket | null,
  code: string,
  token: string | null,
  enabled: boolean,
  onNew?: (request: JoinRequestDto) => void,
): JoinRequestsState & { setInitial: (list: JoinRequestDto[]) => void } {
  const [pending, setPending] = useState<JoinRequestDto[]>([]);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;

  const setInitial = useCallback((list: JoinRequestDto[]) => {
    setPending(list.filter((r) => r.status === 'pending'));
  }, []);

  useEffect(() => {
    if (!socket || !enabled) return;
    const onNewRequest = (payload: JoinRequestUpdatedPayload) => {
      if (payload.request.status !== 'pending') return;
      setPending((prev) =>
        prev.some((r) => r.id === payload.request.id)
          ? prev
          : [...prev, payload.request],
      );
      onNewRef.current?.(payload.request);
    };
    const onUpdated = (payload: JoinRequestUpdatedPayload) => {
      // Decision tomada (por aqui u otro cliente): la fila desaparece sin error
      if (payload.request.status !== 'pending') {
        setPending((prev) => prev.filter((r) => r.id !== payload.request.id));
        setRowStates((prev) => {
          const next = { ...prev };
          delete next[payload.request.id];
          return next;
        });
      }
    };
    socket.on(RT_EVENTS.serverJoinRequestNew, onNewRequest);
    socket.on(RT_EVENTS.serverJoinRequestUpdated, onUpdated);
    return () => {
      socket.off(RT_EVENTS.serverJoinRequestNew, onNewRequest);
      socket.off(RT_EVENTS.serverJoinRequestUpdated, onUpdated);
    };
  }, [socket, enabled]);

  const decide = useCallback(
    async (id: string, action: 'accept' | 'reject') => {
      setRowStates((prev) => ({ ...prev, [id]: 'working' }));
      try {
        await api(`/meetings/${code}/join-requests/${id}/${action}`, {
          method: 'POST',
          token,
        });
        setPending((prev) => prev.filter((r) => r.id !== id));
        setRowStates((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setPending((prev) => prev.filter((r) => r.id !== id));
          return;
        }
        setRowStates((prev) => ({ ...prev, [id]: 'error' }));
      }
    },
    [code, token],
  );

  return { pending, rowStates, decide, setInitial };
}
