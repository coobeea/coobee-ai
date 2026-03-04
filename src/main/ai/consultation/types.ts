/**
 * Consultation Types
 *
 * 专家会诊系统类型定义
 */

/**
 * 专家意见
 */
export interface ExpertOpinion {
  /** 专家 Agent ID */
  agentId: string;

  /** 专家角色名称 */
  roleName: string;

  /** 意见内容 */
  content: string;

  /** 置信度（0-1） */
  confidence: number;

  /** 意见类型 */
  type: 'analysis' | 'suggestion' | 'warning' | 'approval' | 'objection';

  /** 时间戳 */
  timestamp: number;

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 会诊会话
 */
export interface ConsultationSession {
  /** 会诊 ID */
  id: string;

  /** 问题描述 */
  question: string;

  /** 参与专家 */
  experts: Array<{
    agentId: string;
    roleName: string;
    specialty: string;
  }>;

  /** 专家意见 */
  opinions: ExpertOpinion[];

  /** 综合结论 */
  conclusion?: string;

  /** 会诊状态 */
  status: 'pending' | 'consulting' | 'completed' | 'failed';

  /** 创建时间 */
  createdAt: number;

  /** 完成时间 */
  completedAt?: number;
}

/**
 * 意见聚合策略
 */
export type AggregationStrategy = 'majority-vote' | 'weighted-average' | 'consensus-first' | 'expert-ranking';
