import { z } from 'zod';
export const sources = z.array(z.string().min(1)).min(1).max(50);
export const analysisSchema = z.object({
  answerSuggestions: z.array(z.object({
    questionId: z.string().min(1),
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
