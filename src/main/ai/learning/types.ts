/**
 * Learning Types
 *
 * 自主学习类型定义
 */

/**
 * 学习记录
 */
export interface LearningRecord {
  /** 记录 ID */
  id: string;

  /** 任务 ID */
  taskId: string;

  /** Agent ID */
  agentId: string;

  /** 任务类型 */
  taskType: string;

  /** 执行策略 */
  strategy: string;

  /** 执行结果 */
  outcome: 'success' | 'failure' | 'partial';

  /** 质量分数（0-1） */
  qualityScore: number;

  /** 耗时（毫秒） */
  duration: number;

  /** 上下文信息 */
  context: {
    inputLength: number;
    outputLength: number;
    iterations: number;
    [key: string]: unknown;
  };

  /** 创建时间 */
  createdAt: number;
}

/**
 * 学习模式
 */
export interface LearningPattern {
  /** 模式 ID */
  id: string;

  /** 模式名称 */
  name: string;

  /** 任务类型 */
  taskType: string;

  /** 推荐策略 */
  recommendedStrategy: string;

  /** 置信度（0-1） */
  confidence: number;

  /** 支持记录数 */
  supportCount: number;

  /** 平均质量分数 */
  avgQualityScore: number;

  /** 最后更新 */
  lastUpdated: number;
}

/**
 * 策略优化建议
 */
export interface StrategyRecommendation {
  /** 当前策略 */
  currentStrategy: string;

  /** 推荐策略 */
  recommendedStrategy: string;

  /** 预期改进 */
  expectedImprovement: number;

  /** 置信度 */
  confidence: number;

  /** 理由 */
  reason: string;
}

/**
 * 学习配置
 */
export interface LearningConfig {
  /** 是否启用自主学习 */
  enabled: boolean;

  /** 最小样本数（触发学习的最小记录数） */
  minSampleSize: number;

  /** 模式置信度阈值 */
  confidenceThreshold: number;

  /** 学习周期（毫秒） */
  learningInterval: number;
}
