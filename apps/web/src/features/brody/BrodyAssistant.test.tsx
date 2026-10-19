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
});
