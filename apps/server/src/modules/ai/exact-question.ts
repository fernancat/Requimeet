type Segment = { id: string; text: string; speakerRole?: string };
type Question = { id: string; text: string; status: string; eligibleSourceIds: string[] };
/** Only a literal interrogative at the beginning of confirmed host speech.
 * Paraphrases remain the model's responsibility; mentions/guest speech don't qualify. */
export function exactQuestions(questions: Question[], segments: Segment[]) {
  return questions.filter(q => q.status === 'PENDING').flatMap(q => {
    const literal = q.text.trim().replace(/^¿/, '').replace(/\?$/, '').trim();
    if (literal.length < 15) return [];
    const source = segments.find(s => s.speakerRole === 'host' && q.eligibleSourceIds.includes(s.id) &&
      s.text.trim().replace(/^¿/, '').toLocaleLowerCase('es').startsWith(literal.toLocaleLowerCase('es') + '?'));
    if (!source) return [];
    const text = source.text.trim();
    return [{ questionId: q.id, sourceId: source.id, quote: text.slice(0, text.indexOf('?') + 1) }];
  });
}
