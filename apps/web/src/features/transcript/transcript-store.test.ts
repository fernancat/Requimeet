import { describe, expect, it } from 'vitest';
import type { ProcessingResult } from '@requimeet/contracts';
import { applyTranscriptResult, TranscriptSegment } from './transcript-store';

function result(overrides: Partial<ProcessingResult>): ProcessingResult {
  return {
    resultId: crypto.randomUUID(),
    meetingId: 'm1',
    kind: 'transcript-partial',
    isFinal: false,
    createdAtMs: Date.now(),
    payload: {},
    ...overrides,
  };
}

describe('applyTranscriptResult', () => {
  it('agrega un parcial nuevo', () => {
    const r = result({ payload: { text: 'hola', startMs: 0, endMs: 500 } });
    const segments = applyTranscriptResult([], r);

    expect(segments).toEqual<TranscriptSegment[]>([
      {
        resultId: r.resultId,
        revision: 1,
        participantId: null,
        text: 'hola',
        startMs: 0,
        endMs: 500,
        isFinal: false,
      },
    ]);
  });

  it('reemplaza el parcial apuntado por replacesResultId sin duplicar', () => {
    const first = result({ payload: { text: 'hol' } });
    const second = result({ replacesResultId: first.resultId, payload: { text: 'hola' } });

    let segments = applyTranscriptResult([], first);
    segments = applyTranscriptResult(segments, second);

    expect(segments).toHaveLength(1);
    expect(segments[0].resultId).toBe(second.resultId);
    expect(segments[0].text).toBe('hola');
  });

  it('el final reemplaza el parcial y marca isFinal', () => {
    const partial = result({ payload: { text: 'hola' } });
    const final = result({
      kind: 'transcript-final',
      isFinal: true,
      replacesResultId: partial.resultId,
      payload: { text: 'hola mundo' },
    });

    let segments = applyTranscriptResult([], partial);
    segments = applyTranscriptResult(segments, final);

    expect(segments).toHaveLength(1);
    expect(segments[0].isFinal).toBe(true);
    expect(segments[0].text).toBe('hola mundo');
  });

  it('paralelo: distintos participantes se acumulan como líneas separadas', () => {
    const a = result({ participantId: 'p1', payload: { text: 'uno' } });
    const b = result({ participantId: 'p2', payload: { text: 'dos' } });

    let segments = applyTranscriptResult([], a);
    segments = applyTranscriptResult(segments, {
      ...b,
      replacesResultId: undefined,
    });

    expect(segments.map((s) => s.text)).toEqual(['uno', 'dos']);
    expect(segments.map((s) => s.participantId)).toEqual(['p1', 'p2']);
  });

  it('ignora resultados que no son de transcripción', () => {
    const demo = result({ kind: 'demo', payload: { audioFrames: 5 } });
    expect(applyTranscriptResult([], demo)).toEqual([]);
  });

  it('replacesResultId inexistente se agrega en lugar de perderse', () => {
    const r = result({ replacesResultId: 'no-existe', payload: { text: 'x' } });
    const segments = applyTranscriptResult([], r);
    expect(segments).toHaveLength(1);
  });

  it('payload sin texto produce segmento vacío', () => {
    const r = result({ payload: {} });
    const segments = applyTranscriptResult([], r);
    expect(segments[0].text).toBe('');
    expect(segments[0].startMs).toBeNull();
  });
});

 it('ignora reintentos y revisiones atrasadas del mismo segmento', () => {
   const final = { resultId: 'stable', meetingId: 'm', revision: 3, kind: 'transcript-final' as const, isFinal: true, createdAtMs: 1, payload: { text: 'final' } };
   const state = applyTranscriptResult([], final);
   expect(applyTranscriptResult(state, final)).toEqual(state);
   expect(applyTranscriptResult(state, { ...final, revision: 2, kind: 'transcript-partial', isFinal: false })).toEqual(state);
 });
