type Input = { segments: { id: string }[]; context: { id: string }[]; questions: { id: string }[] };
/** Reversible wire aliases only. Speech, decisions, evidence and versions are untouched. */
export function compactIds(input: Input) {
  const forward = new Map<string, string>();
  for (const segment of [...input.segments, ...input.context]) if (!forward.has(segment.id)) forward.set(segment.id, `s${forward.size + 1}`);
  input.questions.forEach((question, index) => forward.set(question.id, `q${index + 1}`));
  const backward = new Map([...forward].map(([id, alias]) => [alias, id]));
  const keys = new Set(['id', 'questionId', 'sourceId', 'sourceIds', 'eligibleSourceIds']);
  function transform(value: unknown, map: Map<string, string>, key = ''): unknown {
    if (typeof value === 'string') return keys.has(key) ? map.get(value) ?? value : value;
    if (Array.isArray(value)) return value.map(item => transform(item, map, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, transform(item, map, name)]));
    return value;
  }
  return { input: transform(input, forward), expand: (value: unknown) => transform(value, backward) };
}
