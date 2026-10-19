export type QuestionStatus = 'PENDING' | 'ASKED' | 'RESOLVED' | 'DISCARDED';
export type QuestionCategory =
  'permissions' | 'validations' | 'rules' | 'exceptions' | 'missing';
export interface QuestionDto {
  id: string;
  text: string;
  category: QuestionCategory;
  reason: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  sourceIds: string[];
  status: QuestionStatus;
  answer: string;
  evidenceIds: string[];
  version: number;
}
export interface AnalysisStatus {
  enabled: boolean;
  model: string;
  jobs: {
    id: string;
    kind: string;
    status: string;
    error: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
}
export interface WorkspaceChanged {
  code: string;
  resource:
    | 'transcripts'
    | 'requirements'
    | 'questions'
    | 'analysis'
    | 'entities'
    | 'document';
}

export interface EntityModel {
  entities: {
    id: string;
    name: string;
    sourceIds: string[];
    attributes: {
      id: string;
      name: string;
      type: string;
      required: boolean;
      identifier: boolean;
    }[];
  }[];
  relations: {
    id: string;
    name: string;
    from: string;
    to: string;
    cardinality: '1:1' | '1:N' | 'N:M';
    sourceIds: string[];
  }[];
}
export interface ArtifactDto<T> {
  id: string;
  kind: string;
  content: T;
  sourceFingerprint: string;
  version: number;
  reviewed: boolean;
  stale: boolean;
  createdAt: string;
  history: { version: number; content: T; at: string; author: string }[];
}
export interface ArtifactList<T> {
  items: ArtifactDto<T>[];
  selectedId: string | null;
  excludedCount: number;
}

export const DOCUMENT_SECTIONS = [
  'scope',
  'roles',
  'requirements',
  'business_rules',
  'priorities',
  'acceptance',
  'contradictions',
  'pending',
] as const;
export type DocumentSectionKey = (typeof DOCUMENT_SECTIONS)[number];
export const DOCUMENT_LABELS: Record<DocumentSectionKey, string> = {
  scope: 'Alcance',
  roles: 'Roles',
  requirements: 'Requerimientos aprobados',
  business_rules: 'Reglas de negocio',
  priorities: 'Prioridades',
  acceptance: 'Criterios de aceptación',
  contradictions: 'Contradicciones',
  pending: 'Pendientes',
};
export interface FinalDocument {
  title: string;
  sections: {
    key: DocumentSectionKey;
    items: { text: string; sourceIds: string[] }[];
  }[];
  entities: EntityModel;
}
