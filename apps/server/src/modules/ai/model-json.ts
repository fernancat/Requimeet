import { ProviderError } from './provider-error';
export const MAX_MODEL_CHARS = 200_000;
/** Accept one JSON object, optionally enclosed in a single Markdown code fence.
 * Never extract arbitrary braces, repair syntax, eval code, or fill missing data. */
export function parseModelObject(content: unknown): Record<string, unknown> {
  if (typeof content !== 'string' || content.length > MAX_MODEL_CHARS)
    throw new ProviderError('OUTPUT_SIZE', 'El servicio de IA devolvió una respuesta vacía o demasiado grande.');
  let text = content.replace(/^\uFEFF/, '').trim();
  if (text.startsWith('```')) {
    const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*)\r?\n```$/i.exec(text);
    if (!fenced) throw new ProviderError('JSON_FORMAT', 'El servicio de IA devolvió un bloque JSON incompleto o ambiguo.');
    text = fenced[1].trim();
  }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new ProviderError('JSON_FORMAT', 'El servicio de IA devolvió JSON inválido.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ProviderError('JSON_FORMAT', 'El servicio de IA debe devolver un objeto JSON.');
  return value as Record<string, unknown>;
}
/** Only remove a complete opening fence while streaming; strings remain untouched. */
export function jsonStreamContent(content: string) {
  return content.replace(/^\uFEFF/, '').trimStart().replace(/^```(?:json)?[ \t]*\r?\n/i, '');
}
