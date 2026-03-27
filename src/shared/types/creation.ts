export type CreationTargetType = 'skill' | 'agent' | 'knowledge';

export type CreationStatus = 'requirements' | 'autopilot' | 'completed' | 'paused' | 'failed';

export type PhaseId = 'requirements' | 'design' | 'implement' | 'validate' | 'iterate' | 'release';

export type PhaseStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed';

export interface PhaseState {
  status: PhaseStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface KnowledgeItem {
  id: string;
  type: 'file' | 'directory' | 'text';
  name: string;
  path?: string;
  content?: string;
  addedAt: number;
}

export interface CreationSessionMeta {
  id: string;
  targetType: CreationTargetType;
  name: string;
  userRequirement: string;
  status: CreationStatus;
  currentPhase: PhaseId;
  phases: Record<PhaseId, PhaseState>;
  knowledgeBase: KnowledgeItem[];
  createdAt: number;
  updatedAt: number;
}

export interface FileInfo {
  filename: string;
  phase: PhaseId | 'meta' | 'knowledge';
  status: 'completed' | 'writing' | 'pending';
  size: number;
  updatedAt: number;
}

export const PHASE_ORDER: PhaseId[] = ['requirements', 'design', 'implement', 'validate', 'iterate', 'release'];

export const PHASE_NUM: Record<PhaseId, number> = {
  requirements: 1,
  design: 2,
  implement: 3,
  validate: 4,
  iterate: 5,
  release: 6
};

export const PHASE_LABELS: Record<PhaseId, string> = {
  requirements: '需求分析',
  design: '方案设计',
  implement: '实施生成',
  validate: '验证测试',
  iterate: '迭代优化',
  release: '发布'
};

export const PHASE_AGENTS: Record<PhaseId, string> = {
  requirements: 'requirements-analyst',
  design: 'solution-designer',
  implement: 'skill-builder',
  validate: 'quality-validator',
  iterate: 'iteration-optimizer',
  release: 'creation-orchestrator'
};

export const KB_PHASE_AGENTS: Record<PhaseId, string> = {
  requirements: 'kb-requirements-analyst',
  design: 'kb-structure-designer',
  implement: 'kb-content-builder',
  validate: 'quality-validator',
  iterate: 'iteration-optimizer',
  release: 'kb-release-handler'
};
