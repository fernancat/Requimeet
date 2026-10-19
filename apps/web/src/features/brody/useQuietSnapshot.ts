import { useEffect, useState } from 'react';
export const CONVERSATION_PAUSE_MS = 900;
/** Keep the conversation on screen stable through speech and short inhalations.
 * Network requests continue; the newest snapshot is released after a pause. */
export function useQuietSnapshot<T>(data: T | null, speaking: boolean) {
  const [quiet, setQuiet] = useState(!speaking);
  const [visible, setVisible] = useState<T | null>(null);
  useEffect(() => {
    if (speaking) { setQuiet(false); return; }
    const timer = setTimeout(() => setQuiet(true), CONVERSATION_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [speaking]);
  useEffect(() => {
    if (data && (visible === null || (!speaking && quiet))) setVisible(data);
  }, [data, speaking, quiet, visible]);
  return { data: visible, holding: speaking || !quiet };
}
