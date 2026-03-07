/**
 * Discussion Shared Types
 *
 * 前后端共享的讨论类型定义
 */

export interface DiscussionMessage {
  id: string;
  agentId: string;
  content: string;
  timestamp: number;
  type: 'statement' | 'question' | 'answer' | 'objection' | 'agreement' | 'summary';
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

export interface DiscussionParticipant {
  agentId: string;
  name: string;
  role?: string;
  weight?: number;
  active: boolean;
}

export interface DiscussionSession {
  id: string;
  topic: string;
  participants: DiscussionParticipant[];
  messages: DiscussionMessage[];
  status: 'active' | 'paused' | 'completed' | 'archived';
  currentSpeaker?: string;
  consensusLevel?: number;
  turnStrategy?: TurnStrategy;
  consensusThreshold?: number;
  maxRounds?: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export type TurnStrategy =
  | 'round-robin' // 顺序发言（轮流）
  | 'concurrent' // 并发发言（同时）
  | 'weighted' // 加权发言（未来）
  | 'reactive' // 响应式发言（未来）
  | 'moderator-controlled'; // 主持人控制（未来）

export interface ConsensusResult {
  achieved: boolean;
  level: number;
  summary?: string;
  disagreements?: string[];
}
