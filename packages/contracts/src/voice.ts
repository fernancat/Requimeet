/** Audio is fetched separately with meeting authorization; never embed provider credentials. */
export interface BrodyUtteranceDto {
  questionIds?: string[]; id: string; key: string; kind: string; text: string; status: string; error: string | null; createdAt: string;
}
export interface BrodyVoiceState {
  enabled: boolean; shared: boolean; version: number; available: boolean;
  latest: BrodyUtteranceDto | null;
  planQuestionIds?: string[];
}
export interface BrodyVoiceSettings { enabled: boolean; shared: boolean; version: number }
