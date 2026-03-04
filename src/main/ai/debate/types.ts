/**
 * Debate Types
 *
 * 智能体辩论类型定义
 */

/**
 * 辩论立场
 */
export type DebateStance = 'pro' | 'con' | 'neutral';

/**
 * 辩论参与者
 */
export interface DebateParticipant {
  /** Agent ID */
  agentId: string;

  /** 立场 */
  stance: DebateStance;

  /** 论点数 */
  argumentCount: number;

  /** 说服力分数 */
  persuasivenessScore: number;
}

/**
 * 辩论论点
 */
export interface DebateArgument {
  /** 论点 ID */
  id: string;

  /** 参与者 */
  participant: string;

  /** 立场 */
  stance: DebateStance;

  /** 论点内容 */
  content: string;

  /** 反驳目标（如果是反驳） */
  rebuttalTo?: string;

  /** 支持证据 */
  evidence?: string[];

  /** 强度（0-1） */
  strength: number;

  /** 时间戳 */
  timestamp: number;
}

/**
 * 辩论会话
 */
export interface DebateSession {
  /** 会话 ID */
  id: string;

  /** 辩题 */
  topic: string;

  /** 参与者 */
  participants: DebateParticipant[];

  /** 论点列表 */
  arguments: DebateArgument[];

  /** 当前轮次 */
  currentRound: number;

  /** 总轮次 */
  totalRounds: number;

  /** 状态 */
  status: 'pending' | 'active' | 'completed';

  /** 裁判结果 */
  verdict?: {
    winner: DebateStance;
    score: { pro: number; con: number; neutral: number };
    reasoning: string;
  };

  /** 创建时间 */
  createdAt: number;

  /** 完成时间 */
  completedAt?: number;
}

/**
 * 辩论规则
 */
export interface DebateRules {
  /** 最大轮次 */
  maxRounds: number;

  /** 每轮发言时长限制（秒） */
  timePerRound: number;

  /** 是否允许中断 */
  allowInterruptions: boolean;

  /** 裁判模式 */
  judgeMode: 'ai' | 'human' | 'hybrid';
}
