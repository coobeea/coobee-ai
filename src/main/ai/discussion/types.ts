/**
 * Discussion Types
 *
 * 智能体讨论系统类型定义
 */

/**
 * 讨论消息
 */
export interface DiscussionMessage {
  /** 消息 ID */
  id: string;

  /** 发言 Agent ID */
  agentId: string;

  /** 消息内容 */
  content: string;

  /** 时间戳 */
  timestamp: number;

  /** 消息类型 */
  type: 'statement' | 'question' | 'answer' | 'objection' | 'agreement' | 'summary';

  /** 引用的消息 ID（回复某条消息） */
  replyTo?: string;

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 讨论参与者
 */
export interface DiscussionParticipant {
  /** Agent ID */
  agentId: string;

  /** Agent 名称 */
  name: string;

  /** 角色（如 "前端专家"、"架构师"） */
  role?: string;

  /** 发言权重（0-1，影响发言顺序） */
  weight?: number;

  /** 是否活跃 */
  active: boolean;
}

/**
 * 讨论会话
 */
export interface DiscussionSession {
  /** 讨论 ID */
  id: string;

  /** 讨论主题 */
  topic: string;

  /** 参与者 */
  participants: DiscussionParticipant[];

  /** 消息历史 */
  messages: DiscussionMessage[];

  /** 讨论状态 */
  status: 'active' | 'paused' | 'completed' | 'archived';

  /** 当前发言者 Agent ID */
  currentSpeaker?: string;

  /** 共识度（0-1） */
  consensusLevel?: number;

  /** 发言策略 */
  turnStrategy?: TurnStrategy;

  /** 共识阈值（0-1，默认 0.7） */
  consensusThreshold?: number;

  /** 最大轮次（默认 20） */
  maxRounds?: number;

  /** 创建时间 */
  createdAt: number;

  /** 更新时间 */
  updatedAt: number;

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 发言调度策略
 */
export type TurnStrategy = 'round-robin' | 'weighted' | 'reactive' | 'moderator-controlled';

/**
 * 共识检测结果
 */
export interface ConsensusResult {
  /** 是否达成共识 */
  achieved: boolean;

  /** 共识度（0-1） */
  level: number;

  /** 共识内容摘要 */
  summary?: string;

  /** 分歧点（如果未达成共识） */
  disagreements?: string[];
}
