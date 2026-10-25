import { z } from 'zod';
export const sources = z.array(z.string().min(1)).min(1).max(50);
export const analysisSchema = z.object({
  askedQuestions: z.array(z.object({
    questionId: z.string().min(1), sourceId: z.string().min(1),
    quote: z.string().trim().min(1).max(5000),
  })).max(12).default([]),
  answerSuggestions: z.array(z.object({
    questionId: z.string().min(1),
    clarity: z.enum(['clear', 'uncertain', 'contradictory']).default('uncertain'),
    reason: z.string().max(2000).default('Revisa si esta respuesta refleja lo acordado.'),
    quotes: z.array(z.object({ sourceId: z.string(), text: z.string().trim().min(1).max(5000) })).max(50).default([]),
    text: z.string().trim().min(1).max(5000),
    sourceIds: sources,
  })).max(12).default([]),
  requirements: z
    .array(z.object({ text: z.string().min(1).max(5000), sourceIds: sources }))
    .max(30),
  questions: z
    .array(
      z.object({
        text: z.string().min(1).max(2000),
        category: z.enum([
          'permissions',
          'validations',
          'rules',
          'exceptions',
          'missing',
        ]),
        reason: z.string().min(1).max(2000),
        priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
        sourceIds: sources,
      }),
    )
    .max(12),
});
export function normalize(text: string) {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
export function checkSources(ids: string[], allowed: Set<string>) {
  if (ids.some((id) => !allowed.has(id)))
    throw new Error('La IA devolvió fuentes desconocidas');
}

/** Provider contracts are derived from the same runtime validators. */
export const analysisOutputSchema = z.object({
  askedQuestions: analysisSchema.shape.askedQuestions,
  answerSuggestions: analysisSchema.shape.answerSuggestions,
  questions: analysisSchema.shape.questions,
  requirements: analysisSchema.shape.requirements,
}).strict();
export const followupOutputSchema = analysisOutputSchema.pick({ questions: true, requirements: true });
