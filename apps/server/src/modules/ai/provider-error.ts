/** Stable, safe errors for persistence/UI; provider payloads may contain user data. */
export class ProviderError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false, readonly retryAfterMs = 0) {
    super(message);
    this.name = 'ProviderError';
  }
}
export function httpProviderError(status: number, retryAfter?: string | null) {
  const seconds = Number(retryAfter);
  const delay = !retryAfter ? 0 : Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
  return new ProviderError(`HTTP_${status}`, `El servicio de IA respondió ${status}.`,
    [408, 429, 500, 502, 503, 504].includes(status), Math.max(0, Number.isFinite(delay) ? delay : 0));
}
export function classifyAiError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error && typeof error === 'object' && 'name' in error && ['TimeoutError', 'AbortError'].includes(String(error.name)))
    return new ProviderError('TIMEOUT', 'El servicio de IA excedió el tiempo de espera.', true);
  if (error instanceof TypeError && /fetch|network|terminated/i.test(error.message))
    return new ProviderError('NETWORK', 'Se interrumpió la conexión con el servicio de IA.', true);
  return new ProviderError('VALIDATION', 'La respuesta de IA no superó la validación. Los cambios ya guardados se conservan.');
}
