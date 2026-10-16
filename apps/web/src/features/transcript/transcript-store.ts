import type { ProcessingResult } from '@requimeet/contracts';

export interface TranscriptSegment {
  resultId: string;
  participantId: string | null;
  text: string;
  startMs: number | null;
  endMs: number | null;
  isFinal: boolean;
}

export function applyTranscriptResult(
  segments: TranscriptSegment[],
  result: ProcessingResult,
): TranscriptSegment[] {
  if (result.kind !== 'transcript-partial' && result.kind !== 'transcript-final') {
    return segments;
  }
  const payload = result.payload as {
    text?: unknown;
    startMs?: unknown;
    endMs?: unknown;
  };
  const segment: TranscriptSegment = {
    resultId: result.resultId,
    participantId: result.participantId ?? null,
    text: typeof payload.text === 'string' ? payload.text : '',
    startMs: typeof payload.startMs === 'number' ? payload.startMs : null,
    endMs: typeof payload.endMs === 'number' ? payload.endMs : null,
    isFinal: result.isFinal,
  };
  if (result.replacesResultId) {
    const index = segments.findIndex((s) => s.resultId === result.replacesResultId);
    if (index >= 0) {
      const next = segments.slice();
      next[index] = segment;
      return next;
    }
  }
  return [...segments, segment];
}
