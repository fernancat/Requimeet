import type { QuestionDto } from '@requimeet/contracts';
const priority = { HIGH: 0, MEDIUM: 1, LOW: 2 };
export function nextQuestion(items: QuestionDto[], deferred: string[], currentId?: string) {
  const open = items.filter(q => q.status === 'PENDING' || q.status === 'ASKED');
  // Preserve the current conversation even when a higher-priority suggestion arrives.
  const current = open.find(q => q.id === currentId && !deferred.includes(q.id));
  return current ?? open.filter(q => !deferred.includes(q.id)).sort((a, b) =>
    Number(b.status === 'ASKED') - Number(a.status === 'ASKED') || priority[a.priority] - priority[b.priority])[0];
}
