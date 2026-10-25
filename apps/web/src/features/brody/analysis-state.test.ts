import { describe, it, expect } from 'vitest';
import { analysisState } from './analysis-state';
import type { AnalysisStatus } from '@requimeet/contracts';
const base = { id: '1', kind: 'analysis', status: 'running', error: null, createdAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z' };
const data = (jobs: AnalysisStatus['jobs']): AnalysisStatus => ({ enabled: true, model: 'model', jobs });
describe('estado del análisis conversacional', () => {
  it('no llama analizando a documentos o entidades en ejecución', () => {
    expect(analysisState(data([{ ...base, kind: 'document' }])).working).toBe(false);
  });
  it('distingue espera de reintento, ejecución y fallo terminal', () => {
    expect(analysisState(data([{ ...base, status: 'queued', attempts: 1 }]))).toMatchObject({ retrying: true, failed: false });
    expect(analysisState(data([{ ...base, status: 'failed', error: 'JSON_FORMAT' }]))).toMatchObject({ working: false, failed: true, error: 'JSON_FORMAT' });
  });
  it('usa el estado activo del servidor aunque el historial conserve otro running', () => {
    expect(analysisState({ ...data([base]), activeJob: null }).working).toBe(false);
    expect(analysisState({ ...data([]), activeJob: base }).working).toBe(true);
  });
});
