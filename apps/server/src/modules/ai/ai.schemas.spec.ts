import { analysisSchema, checkSources, normalize } from './ai.schemas';
describe('respuestas IA', () => {
  it('rechaza salida incompleta, prioridades inválidas y fuentes inventadas', () => {
    expect(() => analysisSchema.parse({ requirements: [] })).toThrow();
    expect(() =>
      analysisSchema.parse({
        requirements: [],
        questions: [
          {
            text: '¿Quién?',
            category: 'permissions',
            priority: 'urgent',
            reason: 'Falta rol',
            sourceIds: ['x'],
          },
        ],
      }),
    ).toThrow();
    expect(() => checkSources(['otra-reunion'], new Set(['a']))).toThrow(
      'desconocidas',
    );
  });
  it('normaliza propuestas repetidas sin alterar el texto guardado', () => {
    expect(normalize(' ¿Quién puede CREAR? ')).toBe(
      normalize('quién puede crear'),
    );
  });
});
