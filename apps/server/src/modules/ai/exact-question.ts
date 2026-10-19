type Segment = { id: string; text: string; speakerRole?: string; createdAtMs?: number };
type Question = { id: string; text: string; status: string; eligibleSourceIds: string[] };
const words = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Require the full literal question at the start of consecutive confirmed host
 * segments. ASR punctuation/accents are not reliable. Paraphrases stay with AI. */
export function exactQuestions(questions: Question[], segments: Segment[]) {
  const ordered = [...segments].sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
  return questions.filter(q => q.status === 'PENDING').flatMap(q => {
    const literal = words(q.text);
    if (literal.length < 15) return [];
    for (let start = 0; start < ordered.length; start++) {
      let combined = '';
      for (let end = start; end < Math.min(start + 3, ordered.length); end++) {
        const segment = ordered[end];
        if (segment.speakerRole !== 'host' || !q.eligibleSourceIds.includes(segment.id)) break;
        combined = words(combined + ' ' + segment.text);
        if (combined === literal || combined.startsWith(literal + ' ')) {
          const source = ordered[start];
          let quote = source.text.trim();
          if (start === end) {
            for (let i = 1; i <= quote.length; i++) {
              if (words(quote.slice(0, i)).length >= literal.length) {
                quote = quote.slice(0, i + (/^[?!.]/.test(quote.slice(i)) ? 1 : 0)); break;
              }
            }
          }
          return [{ questionId: q.id, sourceId: source.id, quote }];
        }
        if (!literal.startsWith(combined + ' ')) break;
      }
    }
    return [];
  });
}
