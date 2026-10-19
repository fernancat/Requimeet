import { exactQuestions } from './exact-question';
const q = { id: 'q', text: '¿A qué se dedica la empresa?', status: 'PENDING', eligibleSourceIds: ['s'] };
const s = { id: 's', text: '¿A qué se dedica la empresa? Vendemos muebles.', speakerRole: 'host' };
it('reconoce la pregunta literal y conserva la cita original', () => {
  expect(exactQuestions([q], [s])).toEqual([{ questionId: 'q', sourceId: 's', quote: '¿A qué se dedica la empresa?' }]);
});
it('no confunde una mención, afirmación, voz invitada ni fuente inelegible con la pregunta', () => {
  for (const other of [{ ...s, text: 'Mencionó: ¿A qué se dedica la empresa?' }, { ...s, text: 'A qué se dedica la empresa.' }, { ...s, speakerRole: 'guest' }, { ...s, id: 'old' }])
    expect(exactQuestions([q], [other])).toEqual([]);
  expect(exactQuestions([{ ...q, status: 'RESOLVED' }], [s])).toEqual([]);
});
