import { exactQuestions } from './exact-question';
const q = { id: 'q', text: '¿A qué se dedica la empresa?', status: 'PENDING', eligibleSourceIds: ['s'] };
const s = { id: 's', text: '¿A qué se dedica la empresa? Vendemos muebles.', speakerRole: 'host' };
it('reconoce la pregunta literal y conserva la cita original', () => {
  expect(exactQuestions([q], [s])).toEqual([{ questionId: 'q', sourceId: 's', quote: '¿A qué se dedica la empresa?' }]);
});
it('no confunde una mención, afirmación, voz invitada ni fuente inelegible con la pregunta', () => {
  for (const other of [{ ...s, text: 'Mencionó: ¿A qué se dedica la empresa?' }, { ...s, text: 'La empresa se dedica a vender muebles.' }, { ...s, speakerRole: 'guest' }, { ...s, id: 'old' }])
    expect(exactQuestions([q], [other])).toEqual([]);
  expect(exactQuestions([{ ...q, status: 'RESOLVED' }], [s])).toEqual([]);
});

it('reconoce la pregunta completa repartida entre segmentos con puntuación de ASR', () => {
  const segments = [
    { ...s, id: 's', text: 'A que se dedica la', createdAtMs: 1 },
    { ...s, id: 's2', text: 'empresa.', createdAtMs: 2 },
  ];
  expect(exactQuestions([{ ...q, eligibleSourceIds: ['s', 's2'] }], segments)).toEqual([{ questionId: 'q', sourceId: 's', quote: 'A que se dedica la' }]);
  expect(exactQuestions([q], segments.slice(0, 1))).toEqual([]);
  expect(exactQuestions([{ ...q, eligibleSourceIds: ['s', 's2'] }], [segments[0], { ...segments[1], speakerRole: 'guest' }])).toEqual([]);
});

it('reconoce la apertura natural sin exigir muletillas ni el determinante literal', () => {
  const opening = { ...q, text: 'Para empezar, ¿a qué se dedica la empresa?' };
  expect(exactQuestions([opening], [{ ...s, text: '¿A qué se dedica tu empresa' }]))
    .toEqual([{ questionId: 'q', sourceId: 's', quote: '¿A qué se dedica tu empresa' }]);
  for (const text of ['Mi empresa se dedica a asuntos jurídicos.', 'Comentaste a qué se dedica tu empresa.', '¿A qué se dedica tu empresa y qué problema tiene?']) {
    const different = text.includes('y qué') ? { ...opening, text: '¿Qué problema tiene tu empresa?' } : opening;
    expect(exactQuestions([different], [{ ...s, text }])).toEqual([]);
  }
});
