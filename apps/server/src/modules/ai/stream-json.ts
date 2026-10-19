/** Extract only complete top-level arrays. Never parses incomplete strings/objects. */
export function completeArrays(text: string): Record<string, unknown[]> {
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
    if (Object.hasOwn(result, key)) throw new Error('Campo JSON duplicado');
    result[key] = JSON.parse(text.slice(valueStart, i));
  }
  return result;
}

export async function readJsonStream(response: Response, partial: (value: Record<string, unknown[]>) => Promise<void>) {
  if (!response.body) throw new Error('El proveedor no devolvió stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', content = '', published = '', finish = '';
  async function event(frame: string) {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const chunk = JSON.parse(data);
    if (chunk.error) throw new Error('El proveedor interrumpió el stream');
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (finish === 'length' || finish === 'error') throw new Error('Respuesta incompleta del proveedor');
    if (typeof choice?.delta?.content !== 'string') return;
    content += choice.delta.content;
    if (content.length > 200000) throw new Error('Respuesta demasiado grande');
    const arrays = completeArrays(content);
    const ready = JSON.stringify(arrays);
    if (ready !== published && Object.keys(arrays).length) { await partial(arrays); published = ready; }
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        await event(frame);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) await event(buffer);
    if (finish !== 'stop') throw new Error('Stream finalizado sin confirmación de cierre');
    return JSON.parse(content);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
