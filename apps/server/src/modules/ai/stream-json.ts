import { parseModelObject, jsonStreamContent, MAX_MODEL_CHARS } from './model-json';
import { ProviderError, httpProviderError } from './provider-error';
/** Extract only complete top-level arrays. Never parses incomplete strings/objects. */
export function completeArrays(text: string): Record<string, unknown[]> {
  text = jsonStreamContent(text);
  const result: Record<string, unknown[]> = {};
  let i = 0;
  const whitespace = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
  whitespace(); if (text[i++] !== '{') return result;
  while (i < text.length) {
    whitespace(); if (text[i] === ',') { i++; whitespace(); }
    if (text[i] !== '"') break;
    const start = i++; let escaped = false;
    for (; i < text.length; i++) {
      if (escaped) { escaped = false; continue; }
      if (text[i] === '\\') { escaped = true; continue; }
      if (text[i] === '"') break;
    }
    if (i >= text.length) break;
    const key = JSON.parse(text.slice(start, ++i)) as string;
    whitespace(); if (text[i++] !== ':') break;
    whitespace(); if (text[i] !== '[') break;
    const valueStart = i++; let depth = 1, quoted = false; escaped = false;
    for (; i < text.length && depth; i++) {
      const c = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
    }
    if (depth) break;
    if (Object.hasOwn(result, key)) throw new ProviderError('JSON_FORMAT', 'Campo JSON duplicado');
    result[key] = JSON.parse(text.slice(valueStart, i));
  }
  return result;
}

export type StreamMetrics = { generationId?: string; provider?: string; firstContentMs: number | null; totalMs: number; completionTokens: number | null; reasoningTokens: number | null; finishReason: string };
export async function readJsonStream(response: Response, partial: (value: Record<string, unknown[]>) => Promise<void>,
  measured?: (metrics: StreamMetrics) => void, startedAt = Date.now()) {
  if (!response.body) throw new ProviderError('STREAM', 'El proveedor no devolvió stream', true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', content = '', published = '', finish = '';
  let generationId: string | undefined, provider: string | undefined;
  let firstContentMs: number | null = null, completionTokens: number | null = null, reasoningTokens: number | null = null;
  async function event(frame: string) {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let chunk: any;
    try { chunk = JSON.parse(data); } catch { throw new ProviderError('STREAM_FORMAT', 'El proveedor envió un evento ilegible.'); }
    if (typeof chunk.id === 'string') generationId = chunk.id;
    if (typeof chunk.provider === 'string') provider = chunk.provider;
    if (typeof chunk.usage?.completion_tokens === 'number') completionTokens = chunk.usage.completion_tokens;
    if (typeof chunk.usage?.completion_tokens_details?.reasoning_tokens === 'number') reasoningTokens = chunk.usage.completion_tokens_details.reasoning_tokens;
    if (chunk.error) {
      if (Number.isInteger(Number(chunk.error.code))) throw httpProviderError(Number(chunk.error.code));
      throw new ProviderError('STREAM', 'El proveedor interrumpió el stream', true);
    }
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (finish === 'length') throw new ProviderError('TOKEN_LIMIT', 'Respuesta incompleta del proveedor: límite de tokens (incluye razonamiento)');
    if (finish === 'error') throw new ProviderError('STREAM', 'Respuesta incompleta del proveedor: error de generación', true);
    if (choice?.delta?.refusal || finish === 'content_filter') throw new ProviderError('REFUSAL', 'El proveedor rechazó generar esta respuesta.');
    if (typeof choice?.delta?.content !== 'string') return;
    if (choice.delta.content && firstContentMs === null) firstContentMs = Date.now() - startedAt;
    content += choice.delta.content;
    if (content.length > MAX_MODEL_CHARS) throw new ProviderError('OUTPUT_SIZE', 'Respuesta demasiado grande');
    const arrays = completeArrays(content);
    const ready = JSON.stringify(arrays);
    if (ready !== published && Object.keys(arrays).length) { await partial(arrays); published = ready; }
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_MODEL_CHARS * 2) throw new ProviderError('STREAM_SIZE', 'Evento del proveedor demasiado grande.');
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        await event(frame);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) await event(buffer);
    if (finish !== 'stop') throw new ProviderError('STREAM', 'Stream finalizado sin confirmación de cierre', true);
    return parseModelObject(content);
  } finally {
    measured?.({ generationId, provider, firstContentMs, totalMs: Date.now() - startedAt, completionTokens, reasoningTokens, finishReason: finish });
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
