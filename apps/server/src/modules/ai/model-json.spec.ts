import { parseModelObject } from './model-json';
import { ProviderError, classifyAiError, httpProviderError } from './provider-error';
describe('frontera JSON del proveedor', () => {
  it.each(['{"text":"á, 漢字 y `literal`"}', '\uFEFF  {"text":"á, 漢字 y `literal`"} ', '```json\n{"text":"á, 漢字 y `literal`"}\n```', '```\r\n{"text":"á, 漢字 y `literal`"}\r\n```'])('acepta un único objeto sin alterar el texto: %s', input => {
    expect(parseModelObject(input)).toEqual({ text: 'á, 漢字 y `literal`' });
  });
  it.each(['', 'null', '[]', 'respuesta: {"a":1}', '{"a":1} después', '```json\n{"a":1}', '```json\n{}\n```\n```json\n{}\n```', '{"a":', '{"a":1,}', '```python\n{}\n```'])('rechaza sin reparar ni filtrar contenido ambiguo: %s', input => {
    expect(() => parseModelObject(input)).toThrow(ProviderError);
  });
  it('no expone texto del usuario en el error', () => {
    try { parseModelObject('SECRETO_DEL_USUARIO'); } catch (e) { expect(String(e)).not.toContain('SECRETO_DEL_USUARIO'); }
    expect(() => parseModelObject(' '.repeat(200001))).toThrow('demasiado grande');
  });
  it('clasifica fallos recuperables y respeta Retry-After', () => {
    expect(httpProviderError(401).retryable).toBe(false);
    expect(httpProviderError(402).retryable).toBe(false);
    expect(httpProviderError(429, '15')).toMatchObject({ retryable: true, retryAfterMs: 15000 });
    expect(classifyAiError(new DOMException('timeout', 'TimeoutError')).retryable).toBe(true);
    expect(classifyAiError(new TypeError('fetch failed')).retryable).toBe(true);
    expect(classifyAiError(new SyntaxError('private text')).retryable).toBe(false);
  });
});
