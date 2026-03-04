/**
 * Consensus Types
 *
 * 共识机制类型定义
 */

/**
 * 投票选项
 */
export interface VoteOption {
  /** 选项 ID */
  id: string;

  /** 选项内容 */
  content: string;

  /** 得票数 */
  votes: number;

  /** 投票者列表 */
  voters: string[];
}

/**
 * 投票
 */
export interface Vote {
  /** 投票 ID */
  id: string;

  /** 议题 */
  topic: string;

  /** 选项列表 */
  options: VoteOption[];

  /** 投票状态 */
  status: 'open' | 'closed' | 'cancelled';

  /** 投票类型 */
  type: 'single-choice' | 'multiple-choice' | 'ranking';

  /** 参与者（Agent IDs） */
  participants: string[];

  /** 创建时间 */
  createdAt: number;

  /** 截止时间 */
  deadline?: number;

  /** 投票结果 */
  result?: VoteResult;
}

/**
 * 投票结果
 */
export interface VoteResult {
  /** 获胜选项（可能多个，如平票） */
  winners: string[];

  /** 投票率 */
  turnout: number;

  /** 是否达到法定人数 */
  quorumReached: boolean;

  /** 各选项得票统计 */
  statistics: Record<string, number>;
}

/**
 * Agent 权重（基于历史表现）
 */
export interface AgentWeight {
  agentId: string;
  weight: number;
  reason: string;
  updatedAt: number;
}

/**
 * 共识配置
 */
export interface ConsensusConfig {
  /** 投票算法 */
  algorithm: 'simple-majority' | 'weighted-majority' | 'unanimous' | 'super-majority';

  /** 法定人数比例（0-1） */
  quorum?: number;

  /** 超级多数阈值（0-1，如 2/3） */
  superMajorityThreshold?: number;

  /** 是否使用权重 */
  useWeights?: boolean;
}
