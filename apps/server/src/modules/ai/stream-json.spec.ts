import { completeArrays, readJsonStream } from './stream-json';
import { compactIds } from './compact-ids';
const response = (text: string, step = 7) => new Response(new ReadableStream({ start(controller) {
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i += step) controller.enqueue(bytes.slice(i, i + step));
  controller.close();
} }));
const chunk = (content: string, finish_reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\r\n\r\n`;
describe('streaming de unidades JSON completas', () => {
  it('no publica arrays incompletos ni confunde escapes y llaves de texto', () => {
    const first = JSON.stringify({ askedQuestions: [{ quote: '¿Dijo "sí"? [a]' }] });
    expect(completeArrays(first.slice(0, -3))).toEqual({});
    expect(completeArrays(first.slice(0, -1) + ',"questions":[')).toEqual(JSON.parse(first));
  });
  it('maneja SSE fragmentado, comentarios, unicode y cierre; publica antes del final', async () => {
    const events: unknown[] = [];
    const value = await readJsonStream(response(': heartbeat\r\n\r\n' + chunk('{"askedQuestions":[],') + chunk('"answerSuggestions":[{"text":"Sí, administración"}]') + chunk('}', 'stop') + 'data: [DONE]\r\n\r\n', 1), async data => { events.push(data); });
    expect(events[0]).toEqual({ askedQuestions: [] });
    expect(value).toEqual({ askedQuestions: [], answerSuggestions: [{ text: 'Sí, administración' }] });
  });
  it('rechaza cortes y errores sin presentarlos como finalización correcta', async () => {
    await expect(readJsonStream(response(chunk('{"askedQuestions":[]}')), async () => {})).rejects.toThrow('sin confirmación');
    await expect(readJsonStream(response('data: {"error":{"message":"down"}}\n\n'), async () => {})).rejects.toThrow('interrumpió');
    await expect(readJsonStream(response(chunk('{}', 'length')), async () => {})).rejects.toThrow('incompleta');
  });
  it('compacta referencias sin cambiar una sola palabra de evidencia', () => {
    const original = { segments: [{ id: 'uuid-long', text: 'uuid-long s1 q1', revision: 2 }], context: [], questions: [{ id: 'question-long', eligibleSourceIds: ['uuid-long'] }] };
    const wire = compactIds(original);
    expect(wire.expand(wire.input)).toEqual(original);
    expect(wire.expand({ questionId: 'q1', sourceIds: ['s1'], quotes: [{ sourceId: 's1', text: 's1' }] })).toEqual({ questionId: 'question-long', sourceIds: ['uuid-long'], quotes: [{ sourceId: 'uuid-long', text: 's1' }] });
  });
  it('mide primer contenido y consumo sin publicar el razonamiento como respuesta', async () => {
    const measured = jest.fn();
    const usage = 'data: ' + JSON.stringify({ choices: [], usage: { completion_tokens: 150, completion_tokens_details: { reasoning_tokens: 100 } } }) + '\n\n';
    const reasoning = 'data: ' + JSON.stringify({ choices: [{ delta: { reasoning: 'internal' } }] }) + '\n\n';
    await readJsonStream(response(reasoning + chunk('{"questions":[]}', 'stop') + usage), async () => {}, measured);
    expect(measured).toHaveBeenCalledWith(expect.objectContaining({ completionTokens: 150, reasoningTokens: 100, finishReason: 'stop', firstContentMs: expect.any(Number) }));
  });

  it('acepta cercas Markdown fragmentadas sin esperar el cierre para publicar arrays completos', async () => {
    const events: unknown[] = [];
    const output = await readJsonStream(response(chunk('`') + chunk('``json\n{') + chunk('"questions":[]') + chunk('}\n```', 'stop'), 1), async value => { events.push(value); });
    expect(events).toEqual([{ questions: [] }]);
    expect(output).toEqual({ questions: [] });
  });
  it('no acepta una cerca truncada, contenido adicional ni rechazo del proveedor', async () => {
    await expect(readJsonStream(response(chunk('```json\n{"questions":[]}', 'stop')), async () => {})).rejects.toThrow('incompleto');
    await expect(readJsonStream(response(chunk('{"questions":[]} otra cosa', 'stop')), async () => {})).rejects.toThrow('inválido');
    await expect(readJsonStream(response(chunk('', 'content_filter')), async () => {})).rejects.toThrow('rechazó');
  });
  it('clasifica rate limits recibidos después de HTTP 200', async () => {
    await expect(readJsonStream(response('data: {"error":{"code":429}}\n\n'), async () => {})).rejects.toMatchObject({ retryable: true, code: 'HTTP_429' });
  });

});
