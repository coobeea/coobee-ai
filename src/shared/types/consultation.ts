/**
 * Consultation Shared Types
 *
 * 前后端共享的会诊类型定义
 */

export interface ExpertOpinion {
  agentId: string;
  roleName: string;
  content: string;
  confidence: number;
  type: 'analysis' | 'suggestion' | 'warning' | 'approval' | 'objection';
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ConsultationSession {
  id: string;
  question: string;
  experts: Array<{
    agentId: string;
    roleName: string;
    specialty: string;
  }>;
  opinions: ExpertOpinion[];
  conclusion?: string;
  status: 'pending' | 'consulting' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
}
