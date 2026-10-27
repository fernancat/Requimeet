import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BrodyAssistant from './BrodyAssistant';
import { api } from '../../lib/api';
import type { QuestionDto } from '@requimeet/contracts';
vi.mock('./BrodyAvatar', () => ({ default: () => <div>Avatar</div> }));
vi.mock('../../lib/api', () => ({ api: vi.fn() }));
const makeQuestion = (id: string, priority: QuestionDto['priority'] = 'MEDIUM'): QuestionDto => ({ id, text: `Pregunta ${id}`, status: 'PENDING', priority, category: 'rules', reason: 'Falta aclarar', answer: '', sourceIds: [], evidenceIds: [], version: 3 });
let questions: QuestionDto[];
const props = { code: 'TEST', token: 'token', canEdit: true, refreshVersion: 0, connected: true, interrupted: false };
beforeEach(() => {
  questions = [makeQuestion('primera')];
  vi.mocked(api).mockReset().mockImplementation(async (path, options) => {
    if (options?.method === 'PATCH') throw new Error('La pregunta cambió; recarga para comparar');
    if (path.endsWith('/questions')) return questions as never;
    if (path.endsWith('/requirements')) return [] as never;
    return { enabled: true, jobs: [] } as never;
  });
});
describe('Brody live interaction', () => {
  it('keeps the active answer and question when live suggestions arrive', async () => {
    const view = render(<BrodyAssistant {...props} />);
    await screen.findByText('Pregunta primera');
    fireEvent.change(screen.getByLabelText('Respuesta acordada'), { target: { value: 'Solo administradores' } });
    questions = [...questions, makeQuestion('urgente', 'HIGH')];
    view.rerender(<BrodyAssistant {...props} refreshVersion={1} />);
    await waitFor(() => expect(screen.getByText('2 preguntas abiertas')).toBeTruthy());
    expect(screen.getByText('Pregunta primera')).toBeTruthy();
    expect((screen.getByLabelText('Respuesta acordada') as HTMLTextAreaElement).value).toBe('Solo administradores');
    fireEvent.click(screen.getByText('Guardar respuesta y continuar'));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Respuesta acordada') as HTMLTextAreaElement).value).toBe('Solo administradores');
  });
  it('defers a question without writing a discarded state', async () => {
    questions.push(makeQuestion('segunda'));
    render(<BrodyAssistant {...props} />);
    await screen.findByText('Pregunta primera');
    fireEvent.click(screen.getByText('Después'));
    await screen.findByText('Pregunta segunda');
    expect(vi.mocked(api).mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
  });
  it('lets guests read but offers no mutation controls', async () => {
    render(<BrodyAssistant {...props} canEdit={false} />);
    await screen.findByText('Pregunta primera');
    expect(screen.queryByText('Ya la pregunté')).toBeNull();
    expect(screen.queryByLabelText('Respuesta acordada')).toBeNull();
    expect(screen.queryByText('Analizar ahora')).toBeNull();
  });
  it('shows an incoming spoken-answer proposal without overwriting a local draft', async () => {
    questions[0].status = 'ASKED';
    const view = render(<BrodyAssistant {...props} transcriptText="Solo los administradores." />);
    await screen.findByText('Esperando una respuesta hablada');
    fireEvent.change(screen.getByLabelText('Respuesta acordada'), { target: { value: 'Mi precisión manual' } });
    questions = [{ ...questions[0], version: 4, answerSuggestion: { text: 'Solo los administradores.', sourceIds: ['s1'] } }];
    view.rerender(<BrodyAssistant {...props} refreshVersion={1} />);
    await screen.findByText('Necesito aclarar esta respuesta');
    expect((screen.getByLabelText('Respuesta acordada') as HTMLTextAreaElement).value).toBe('Mi precisión manual');
    expect(screen.getByText('Confirmar respuesta y continuar')).toBeTruthy();
  });
  it('explains microphone state and that a second participant is unnecessary', async () => {
    questions[0].status = 'ASKED';
    render(<BrodyAssistant {...props} micOn={false} />);
    await screen.findByText('Activa el micrófono para responder');
    expect(screen.getByText(/no necesitas otro participante/)).toBeTruthy();
  });

  it('advances automatically on a resolved answer and retains a concurrent local draft for correction', async () => {
    questions[0].status = 'ASKED';
    questions.push(makeQuestion('siguiente'));
    const view = render(<BrodyAssistant {...props} />);
    await screen.findByText('Pregunta primera');
    fireEvent.change(screen.getByLabelText('Respuesta acordada'), { target: { value: 'Mi precisión' } });
    questions = [{ ...questions[0], status: 'RESOLVED', answer: 'Solo administradores.', automaticResolution: true }, questions[1]];
    view.rerender(<BrodyAssistant {...props} refreshVersion={1} />);
    await screen.findByText('Pregunta siguiente');
    expect((screen.getByLabelText('Corregir respuesta guardada') as HTMLTextAreaElement).value).toBe('Mi precisión');
    expect(screen.getByText('Guardé una respuesta clara. Podemos continuar.')).toBeTruthy();
  });

  it('guides the host without requiring a question-performed button', async () => {
    render(<BrodyAssistant {...props} />);
    await screen.findByText('Pregunta primera');
    expect(screen.queryByText('Ya la pregunté')).toBeNull();
    expect(screen.getByText(/Haz esta pregunta con tus propias palabras/)).toBeTruthy();
  });

  it('uses the spoken plan as the active interview and keeps its five questions available', async () => {
    const planned = Array.from({ length: 5 }, (_, index) => makeQuestion(`nueva-${index}`));
    questions = [makeQuestion('anterior', 'HIGH'), ...planned];
    vi.mocked(api).mockImplementation(async path => {
      if (path.endsWith('/voice')) return { enabled: true, shared: false, available: true, version: 1, planQuestionIds: planned.map(q => q.id), latest: { id: 'plan', key: 'mention:1', kind: 'reply', status: 'ready', text: 'Actualicé la guía con cinco preguntas.', questionIds: planned.map(q => q.id), createdAt: new Date().toISOString() } } as never;
      if (path.endsWith('/questions')) return questions as never;
      if (path.endsWith('/requirements')) return [] as never;
      return { enabled: true, jobs: [] } as never;
    });
    const view = render(<BrodyAssistant {...props} />);
    await screen.findByText('Guía de preguntas (5)');
    fireEvent.click(screen.getByText('Volver a la pregunta sugerida'));
    await waitFor(() => expect(view.container.querySelector('.brody-question')?.textContent).toBe('Pregunta nueva-0'));
    questions = questions.map(q => q.id === 'nueva-0' ? { ...q, status: 'RESOLVED', version: 4 } : q);
    view.rerender(<BrodyAssistant {...props} refreshVersion={1} />);
    await waitFor(() => expect(view.container.querySelector('.brody-question')?.textContent).toBe('Pregunta nueva-1'));
    expect(view.container.querySelectorAll('.brody-proposed-questions li')).toHaveLength(5);
  });

});
