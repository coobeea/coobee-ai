/**
 * 训练系统共享类型（前后端共用）
 */

// ==================== 训练任务 ====================

export interface TrainingTask {
  id: string;
  description: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  category: string;
  testCase?: string;
  expectedOutput?: string;
  tags?: string[];
  metadata?: {
    isGenerated?: boolean;
    generatedAt?: number;
    targetDimension?: string;
  };
}

// ==================== 训练目标 ====================

export interface TrainingGoal {
  name: string;
  description?: string;
  dimensions: TrainingDimension[];
  threshold: number;
  excellentThreshold?: number;
}

export interface TrainingDimension {
  name: string;
  label: string;
  description: string;
  weight: number;
  criteria: string;
}

// ==================== 训练数据集 ====================

export interface TrainingDataset {
  name: string;
  version: string;
  category: string;
  trainSet: TrainingTask[];
  testSet: TrainingTask[];
  metadata?: {
    createdAt: number;
    totalCount: number;
    difficultyDistribution?: Record<number, number>;
  };
}

// ==================== 训练评估 ====================

export interface TrainingEvaluation {
  score: number;
  passed: boolean;
  dimensions: Record<string, number>;
  feedback: string;
  executionResult?: string;
  evaluationTime?: number;
}

export interface CoachAdvice {
  suggestions: string[];
  rootCause?: string;
  priority?: number;
}

// ==================== 训练结果 ====================

export interface TrainingRoundResult {
  round: number;
  taskId: string;
  taskDescription: string;
  taskDifficulty: number;
  output: string;
  evaluation: TrainingEvaluation;
  usedCoachAdvice: boolean;
  coachAdvice?: CoachAdvice;
  refinedOutput?: string;
  refinedEvaluation?: TrainingEvaluation;
  startTime: number;
  endTime: number;
  duration: number;
}

// ==================== 训练会话 ====================

export type TrainingStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';

export type TrainingStrategy = 'sequential' | 'parallel' | 'adaptive' | 'weakness-targeted';

export interface TrainingSession {
  id: string;
  agentId: string;
  goal: TrainingGoal;
  dataset: TrainingDataset;
  maxRounds: number;
  strategy: TrainingStrategy;
  parallelCount?: number;
  status: TrainingStatus;
  progress: TrainingProgress;
  results: TrainingRoundResult[];
  startTime: number;
  endTime?: number;
  parentSessionId?: string;
  metadata?: {
    isIncremental?: boolean;
    targetedDimensions?: string[];
    notes?: string;
  };
}

export interface TrainingProgress {
  currentRound: number;
  totalRounds: number;
  completedRounds: number;
  passedRounds: number;
  currentScore?: number;
  avgScore?: number;
  maxScore?: number;
  minScore?: number;
  pausedAt?: number;
}

// ==================== 训练报告 ====================

export interface TrainingReport {
  sessionId: string;
  agentId: string;
  goalName: string;
  summary: {
    totalRounds: number;
    passedRounds: number;
    passRate: number;
    finalScore: number;
    avgScore: number;
    initialScore: number;
    improvement: number;
    totalTimeMinutes: number;
  };
  dimensionAnalysis: {
    dimension: string;
    initialScore: number;
    finalScore: number;
    avgScore: number;
    improvement: number;
  }[];
  difficultyAnalysis: {
    difficulty: number;
    count: number;
    avgScore: number;
    passRate: number;
  }[];
  trainingCurve: {
    round: number;
    score: number;
    passed: boolean;
  }[];
  testSetValidation?: {
    testScore: number;
    trainScore: number;
    generalizationGap: number;
    isOverfitting: boolean;
  };
  weaknessAnalysis?: {
    dimension: string;
    avgScore: number;
    failureCount: number;
  }[];
  generatedAt: number;
}

// ==================== 创建参数 ====================

export interface CreateTrainingParams {
  agentId: string;
  goal: TrainingGoal;
  dataset: TrainingDataset | string;
  maxRounds: number;
  strategy?: TrainingStrategy;
  parallelCount?: number;
  parentSessionId?: string;
  metadata?: Record<string, unknown>;
}
