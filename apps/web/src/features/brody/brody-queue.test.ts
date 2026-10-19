import { describe, expect, it } from 'vitest';
import type { QuestionDto } from '@requimeet/contracts';
import { nextQuestion } from './brody-queue';
const question = (id: string, status: QuestionDto['status'] = 'PENDING', priority: QuestionDto['priority'] = 'MEDIUM'): QuestionDto => ({ id, status, priority, text: id, reason: '', category: 'rules', answer: '', evidenceIds: [], sourceIds: [], version: 1 });
describe('Brody conversation queue', () => {
  it('does not interrupt the current question when a high priority question arrives', () => {
    expect(nextQuestion([question('first'), question('urgent', 'PENDING', 'HIGH')], [], 'first')?.id).toBe('first');
  });
  it('continues an asked question before starting another', () => {
    expect(nextQuestion([question('urgent', 'PENDING', 'HIGH'), question('asked', 'ASKED')], [])?.id).toBe('asked');
  });
  it('skips resolved, discarded and deferred questions without losing them', () => {
    const items = [question('done', 'RESOLVED'), question('no', 'DISCARDED'), question('later'), question('next')];
    expect(nextQuestion(items, ['later'], 'done')?.id).toBe('next');
    expect(nextQuestion(items, [])?.id).toBe('later');
  });
  it('does not loop over deferred questions', () => {
    expect(nextQuestion([question('later')], ['later'])).toBeUndefined();
  });
});
