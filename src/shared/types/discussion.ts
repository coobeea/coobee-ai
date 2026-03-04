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
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}
