import { api } from '../../lib/api';

export type RequirementStatus =
  | 'PENDING'
  | 'CORRECTED'
  | 'APPROVED';

export interface Requirement {
  id: string;
  meetingId: string;
  transcriptSegmentId: string;
  originalText: string;
  text: string;
  status: RequirementStatus;
  createdAt: string;
  updatedAt: string;
  transcriptSegment: {
    id: string;
    resultId: string;
    meetingId: string;
    participantId: string | null;
    trackSid: string | null;
    text: string;
    startMs: number | null;
    endMs: number | null;
    createdAtMs: number;
    createdAt: string;
    participant: {
      id: string;
      displayName: string;
    } | null;
  };
}

export interface UpdateRequirementInput {
  text?: string;
  status?: RequirementStatus;
}

export function getRequirements(code: string, token: string) {
  return api<Requirement[]>(
    `/meetings/${encodeURIComponent(code)}/requirements`,
    { token },
  );
}

export function updateRequirement(
  code: string,
  requirementId: string,
  token: string,
  input: UpdateRequirementInput,
) {
  return api<Requirement>(
    `/meetings/${encodeURIComponent(code)}/requirements/${encodeURIComponent(requirementId)}`,
    {
      method: 'PATCH',
      token,
      body: input,
    },
  );
}