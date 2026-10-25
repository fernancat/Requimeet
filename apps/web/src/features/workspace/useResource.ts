import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
export function useResource<T>(path: string, token: string, refresh = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const inflight = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);
  const refreshQueued = useRef(false);
  const lastRefresh = useRef(refresh);
  const reload = useCallback((): Promise<void> => {
    // Socket bursts coalesce into one follow-up read. The current response is
    // still published, instead of being invalidated by every new notification.
    if (inflight.current) { refreshQueued.current = true; return inflight.current.promise; }
    const request = ++sequence.current;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    const work = async () => {
      try {
        const result = await api<T>(path, { token, signal: controller.signal });
        if (request === sequence.current) { setData(result); setError(''); }
      } catch (e) {
        if (request === sequence.current && (!controller.signal.aborted || timedOut))
          setError(timedOut ? 'El servidor tardó demasiado en responder.' : e instanceof Error ? e.message : 'No se pudo cargar');
      } finally {
        clearTimeout(timeout);
        if (inflight.current?.controller === controller) {
          inflight.current = null;
          if (refreshQueued.current && !controller.signal.aborted) {
            refreshQueued.current = false;
            void reload();
          }
        }
      }
    };
    const promise = work();
    inflight.current = { controller, promise };
    return promise;
  }, [path, token]);
  useEffect(() => {
    setData(null); setError('');
    void reload();
    const timer = setInterval(() => void reload(), 10000);
    return () => {
      clearInterval(timer);
      sequence.current++;
      inflight.current?.controller.abort();
      inflight.current = null;
      refreshQueued.current = false;
    };
  }, [reload]);
  useEffect(() => {
    if (lastRefresh.current !== refresh) { lastRefresh.current = refresh; void reload(); }
  }, [refresh, reload]);
  return { data, error, reload, setData };
}
const dirtyEditors = new Set<symbol>();
const beforeUnload = (event: BeforeUnloadEvent) => {
  event.preventDefault();
  event.returnValue = '';
};
export function confirmLeaving() {
  return (
    !dirtyEditors.size ||
    window.confirm('Hay cambios sin guardar. ¿Deseas salir?')
  );
}
const navigate = (event: MouseEvent) => {
  const link = (event.target as HTMLElement)?.closest('a');
  if (link && link.target !== '_blank' && link.href && !confirmLeaving()) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
};
export function useUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const id = Symbol('editor');
    if (!dirtyEditors.size) {
      window.addEventListener('beforeunload', beforeUnload);
      document.addEventListener('click', navigate, true);
    }
    dirtyEditors.add(id);
    return () => {
      dirtyEditors.delete(id);
      if (!dirtyEditors.size) {
        window.removeEventListener('beforeunload', beforeUnload);
        document.removeEventListener('click', navigate, true);
      }
    };
  }, [dirty]);
}
