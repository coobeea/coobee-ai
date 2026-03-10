/**
 * 训练系统类型定义
 *
 * 覆盖训练会话、训练任务、训练目标、训练结果等核心类型
 */

// ==================== 训练任务 ====================

/**
 * 训练任务定义
 */
export interface TrainingTask {
  /** 任务唯一标识 */
  id: string;

  /** 任务描述（清晰、具体、包含所有要求） */
  description: string;

  /** 难度等级（1=简单，5=困难） */
  difficulty: 1 | 2 | 3 | 4 | 5;

  /** 任务类型（algorithm, data-structure, async, utils, oop 等） */
  category: string;

  /** 测试用例（可执行的代码或描述） */
  testCase?: string;

  /** 期望输出的简要描述 */
  expectedOutput?: string;

  /** 标签（用于分类和检索） */
  tags?: string[];

  /** 元数据 */
  metadata?: {
    /** 是否为自动生成的任务 */
    isGenerated?: boolean;
    /** 生成时间 */
    generatedAt?: number;
    /** 针对的弱点维度 */
    targetDimension?: string;
  };
}

// ==================== 训练目标 ====================

/**
 * 训练目标（基于 dimension-architect）
 */
export interface TrainingGoal {
  /** 目标名称 */
  name: string;

  /** 目标描述 */
  description?: string;

  /** 评估维度定义 */
  dimensions: TrainingDimension[];

  /** 达标分数线 */
  threshold: number;

  /** 优秀分数线（可选） */
  excellentThreshold?: number;
}

/**
 * 训练维度
 */
export interface TrainingDimension {
  /** 维度名称（如 correctness, quality） */
  name: string;

  /** 维度显示名称（如"正确性"） */
  label: string;

  /** 维度描述 */
  description: string;

  /** 权重（百分比，总和应为 100） */
  weight: number;

  /** 评估标准 */
  criteria: string;
}

// ==================== 训练数据集 ====================

/**
 * 训练数据集
 */
export interface TrainingDataset {
  /** 数据集名称 */
  name: string;

  /** 数据集版本 */
  version: string;

  /** 数据集类别（与训练目标对应） */
  category: string;

  /** 训练集（80%） */
  trainSet: TrainingTask[];

  /** 测试集（20%） */
  testSet: TrainingTask[];

  /** 元数据 */
  metadata?: {
    /** 创建时间 */
    createdAt: number;
    /** 任务总数 */
    totalCount: number;
    /** 难度分布 */
    difficultyDistribution?: Record<number, number>;
  };
}

// ==================== 训练评估 ====================

/**
 * 训练评估结果
 */
export interface TrainingEvaluation {
  /** 总分（0-100） */
  score: number;

  /** 是否达标（score >= threshold） */
  passed: boolean;

  /** 各维度得分 */
  dimensions: Record<string, number>;

  /** 详细反馈 */
  feedback: string;

  /** 执行结果（代码类任务的运行结果） */
  executionResult?: string;

  /** 评估耗时（毫秒） */
  evaluationTime?: number;
}

/**
 * 训练教练建议
 */
export interface CoachAdvice {
  /** 改进建议列表 */
  suggestions: string[];

  /** 根因分析 */
  rootCause?: string;

  /** 优先级（1=高，2=中，3=低） */
  priority?: number;
}

// ==================== 训练结果 ====================

/**
 * 单轮训练结果
 */
export interface TrainingRoundResult {
  /** 轮次 */
  round: number;

  /** 任务 ID */
  taskId: string;

  /** 任务描述 */
  taskDescription: string;

  /** 任务难度 */
  taskDifficulty: number;

  /** 智能体输出 */
  output: string;

  /** 评估结果 */
  evaluation: TrainingEvaluation;

  /** 是否使用了教练建议 */
  usedCoachAdvice: boolean;

  /** 教练建议（如果使用了） */
  coachAdvice?: CoachAdvice;

  /** 改进后的输出（如果有 refinement） */
  refinedOutput?: string;

  /** 改进后的评估（如果有 refinement） */
  refinedEvaluation?: TrainingEvaluation;

  /** 开始时间 */
  startTime: number;

  /** 结束时间 */
  endTime: number;

  /** 耗时（毫秒） */
  duration: number;
}

// ==================== 训练会话 ====================

/**
 * 训练会话状态
 */
export type TrainingStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';

/**
 * 训练策略
 */
export type TrainingStrategy = 'sequential' | 'parallel' | 'adaptive' | 'weakness-targeted';

/**
 * 训练会话
 */
export interface TrainingSession {
  /** 会话唯一标识 */
  id: string;

  /** 被训练的智能体 ID */
  agentId: string;

  /** 训练目标 */
  goal: TrainingGoal;

  /** 训练数据集 */
  dataset: TrainingDataset;

  /** 最大训练轮次 */
  maxRounds: number;

  /** 训练策略 */
  strategy: TrainingStrategy;

  /** 并行度（仅 parallel 策略） */
  parallelCount?: number;

  /** 当前状态 */
  status: TrainingStatus;

  /** 训练进度 */
  progress: TrainingProgress;

  /** 训练结果 */
  results: TrainingRoundResult[];

  /** 开始时间 */
  startTime: number;

  /** 结束时间 */
  endTime?: number;

  /** 父会话 ID（增量训练时） */
  parentSessionId?: string;

  /** 元数据 */
  metadata?: {
    /** 是否为增量训练 */
    isIncremental?: boolean;
    /** 针对的弱点维度 */
    targetedDimensions?: string[];
    /** 训练备注 */
    notes?: string;
  };
}

/**
 * 训练进度
 */
export interface TrainingProgress {
  /** 当前轮次 */
  currentRound: number;

  /** 总轮次 */
  totalRounds: number;

  /** 完成的轮次 */
  completedRounds: number;

  /** 达标轮次 */
  passedRounds: number;

  /** 当前得分 */
  currentScore?: number;

  /** 平均得分 */
  avgScore?: number;

  /** 最高得分 */
  maxScore?: number;

  /** 最低得分 */
  minScore?: number;

  /** 暂停时间（如果暂停） */
  pausedAt?: number;
}

// ==================== 训练报告 ====================

/**
 * 训练报告
 */
export interface TrainingReport {
  /** 会话 ID */
  sessionId: string;

  /** 智能体 ID */
  agentId: string;

  /** 训练目标 */
  goalName: string;

  /** 基本统计 */
  summary: {
    /** 训练轮次 */
    totalRounds: number;
    /** 达标轮次 */
    passedRounds: number;
    /** 达标率 */
    passRate: number;
    /** 最终得分 */
    finalScore: number;
    /** 平均得分 */
    avgScore: number;
    /** 初始得分 */
    initialScore: number;
    /** 得分提升 */
    improvement: number;
    /** 总耗时（分钟） */
    totalTimeMinutes: number;
  };

  /** 维度分析 */
  dimensionAnalysis: {
    /** 维度名称 */
    dimension: string;
    /** 初始得分 */
    initialScore: number;
    /** 最终得分 */
    finalScore: number;
    /** 平均得分 */
    avgScore: number;
    /** 提升幅度 */
    improvement: number;
  }[];

  /** 难度分析 */
  difficultyAnalysis: {
    /** 难度等级 */
    difficulty: number;
    /** 任务数 */
    count: number;
    /** 平均得分 */
    avgScore: number;
    /** 达标率 */
    passRate: number;
  }[];

  /** 训练曲线（得分随轮次变化） */
  trainingCurve: {
    round: number;
    score: number;
    passed: boolean;
  }[];

  /** 测试集验证（如果有） */
  testSetValidation?: {
    /** 测试集得分 */
    testScore: number;
    /** 训练集得分 */
    trainScore: number;
    /** 泛化差距 */
    generalizationGap: number;
    /** 是否过拟合 */
    isOverfitting: boolean;
  };

  /** 弱点分析 */
  weaknessAnalysis?: {
    /** 弱点维度 */
    dimension: string;
    /** 平均得分 */
    avgScore: number;
    /** 失败次数 */
    failureCount: number;
  }[];

  /** 生成时间 */
  generatedAt: number;
}

// ==================== 创建训练参数 ====================

/**
 * 创建训练会话的参数
 */
export interface CreateTrainingParams {
  /** 被训练的智能体 ID */
  agentId: string;

  /** 训练目标 */
  goal: TrainingGoal;

  /** 数据集（可以是文件路径或内联数据） */
  dataset: TrainingDataset | string;

  /** 最大训练轮次 */
  maxRounds: number;

  /** 训练策略 */
  strategy?: TrainingStrategy;

  /** 并行度（parallel 策略时） */
  parallelCount?: number;

  /** 父会话 ID（增量训练时） */
  parentSessionId?: string;

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ==================== 训练配置 ====================

/**
 * 训练执行器配置
 */
export interface TrainingExecutorConfig {
  /** Agent 调用超时时间（毫秒） */
  agentTimeout: number;

  /** Agent 调用最大重试次数 */
  maxRetries: number;

  /** 是否启用测试集验证 */
  enableTestSet: boolean;

  /** 是否启用训练教练 */
  enableCoach: boolean;

  /** 提前终止条件（连续 N 轮达标） */
  earlyStopThreshold: number;

  /** 进度更新间隔（毫秒） */
  progressUpdateInterval: number;
}

/**
 * 默认配置常量
 */
export const DEFAULT_TRAINING_CONFIG: TrainingExecutorConfig = {
  agentTimeout: 30000, // 30s
  maxRetries: 3,
  enableTestSet: true,
  enableCoach: true,
  earlyStopThreshold: 20, // 连续 20 轮达标提前结束
  progressUpdateInterval: 1000 // 每秒更新一次进度
} as const;
