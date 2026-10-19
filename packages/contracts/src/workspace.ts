export type QuestionStatus = 'PENDING' | 'ASKED' | 'RESOLVED' | 'DISCARDED';
export type QuestionCategory = 'permissions' | 'validations' | 'rules' | 'exceptions' | 'missing';
export interface QuestionDto {
 id: string; text: string; category: QuestionCategory; reason: string; priority: 'HIGH' | 'MEDIUM' | 'LOW';
 sourceIds: string[]; status: QuestionStatus; answer: string; evidenceIds: string[]; version: number;
}
export interface AnalysisStatus {
 enabled: boolean; model: string;
 jobs: { id: string; kind: string; status: string; error: string | null; createdAt: string; updatedAt: string }[];
}
export interface WorkspaceChanged { code: string; resource: 'transcripts' | 'requirements' | 'questions' | 'analysis' | 'entities' | 'document' }
