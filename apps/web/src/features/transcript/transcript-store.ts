import type { ProcessingResult } from '@requimeet/contracts';

export interface TranscriptSegment {
  resultId: string;
  revision?: number;
  previousPartialText?: string;
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
    previousPartialText?: unknown;
    startMs?: unknown;
    endMs?: unknown;
  };
  const segment: TranscriptSegment = {
    resultId: result.resultId,
    revision: result.revision ?? 1,
    participantId: result.participantId ?? null,
    text: typeof payload.text === 'string' ? payload.text : '',
    startMs: typeof payload.startMs === 'number' ? payload.startMs : null,
    endMs: typeof payload.endMs === 'number' ? payload.endMs : null,
    isFinal: result.isFinal,
    ...(typeof payload.previousPartialText === 'string' ? { previousPartialText: payload.previousPartialText } : {}),
  };
  const existing = segments.findIndex(s => s.resultId === result.resultId);
  if (existing >= 0) {
    if ((segments[existing].revision ?? 0) >= (result.revision ?? 1) || segments[existing].isFinal && !result.isFinal) return segments;
    if (result.isFinal && !segment.previousPartialText && !segments[existing].isFinal && segments[existing].text !== segment.text)
      segment.previousPartialText = segments[existing].text;
    return segments.map((s, i) => i === existing ? segment : s);
  }
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
