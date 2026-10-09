/**
 * Regla de una sola presentacion (a nivel UI, documentada en
 * docs/ARCHITECTURE.md): si OTRO participante ya comparte pantalla, el
 * intento local se bloquea con aviso hasta que la actual termine.
 */
export interface ScreenSharerInfo {
  identity: string;
  name: string;
  isLocal: boolean;
}

export function screenShareBlockReason(sharers: ScreenSharerInfo[]): string | null {
  const other = sharers.find((s) => !s.isLocal);
  if (other) {
    return `${other.name || 'Otro participante'} está presentando; espera a que termine`;
  }
  return null;
}
