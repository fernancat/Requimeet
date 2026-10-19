import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
export function useResource<T>(path: string, token: string, refresh = 0) {
 const [data, setData] = useState<T | null>(null);
 const [error, setError] = useState('');
 const sequence = useRef(0);
 const reload = useCallback(async () => {
  const request = ++sequence.current;
  try { const result = await api<T>(path, { token }); if (request === sequence.current) { setData(result); setError(''); } }
  catch (e) { if (request === sequence.current) setError(e instanceof Error ? e.message : 'No se pudo cargar'); }
 }, [path, token]);
 useEffect(() => { void reload(); const timer = setInterval(() => void reload(), 10000); return () => { clearInterval(timer); sequence.current++; }; }, [reload, refresh]);
 return { data, error, reload, setData };
}
export function useUnsaved(dirty: boolean) {
 useEffect(() => {
  if (!dirty) return;
  const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
 }, [dirty]);
}
