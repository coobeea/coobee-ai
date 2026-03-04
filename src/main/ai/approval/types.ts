/**
 * Approval Types
 *
 * 审批流程类型定义
 */

/**
 * 审批请求
 */
export interface ApprovalRequest {
  /** 请求 ID */
  id: string;

  /** 任务 ID */
  taskId: string;

  /** 阶段名称 */
  stageName: string;

  /** 请求类型 */
  type: 'code-change' | 'data-access' | 'external-api' | 'deployment' | 'custom';

  /** 描述 */
  description: string;

  /** 风险等级 */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';

  /** 请求者（Agent ID） */
  requestor: string;

  /** 审批者列表 */
  approvers: string[];

  /** 已审批者 */
  approved: string[];

  /** 已拒绝者 */
  rejected: string[];

  /** 审批意见 */
  comments: Array<{
    approver: string;
    decision: 'approve' | 'reject';
    comment: string;
    timestamp: number;
  }>;

  /** 审批策略 */
  strategy: 'any' | 'all' | 'majority';

  /** 状态 */
  status: 'pending' | 'approved' | 'rejected' | 'expired';

  /** 创建时间 */
  createdAt: number;

  /** 过期时间 */
  expiresAt?: number;
}

/**
 * 审批响应
 */
export interface ApprovalResponse {
  /** 请求 ID */
  requestId: string;

  /** 审批者 */
  approver: string;

  /** 决定 */
  decision: 'approve' | 'reject';

  /** 评论 */
  comment?: string;

  /** 响应时间 */
  timestamp: number;
}

/**
 * 审批策略配置
 */
export interface ApprovalConfig {
  /** 是否启用审批 */
  enabled: boolean;

  /** 默认审批者 */
  defaultApprovers: string[];

  /** 按风险等级配置审批者 */
  approversByRisk: {
    low: string[];
    medium: string[];
    high: string[];
    critical: string[];
  };

  /** 默认审批策略 */
  defaultStrategy: ApprovalRequest['strategy'];

  /** 请求过期时间（毫秒） */
  requestTimeout: number;
}

/**
 * 人工介入点
 */
export interface InterventionPoint {
  /** 介入点 ID */
  id: string;

  /** 名称 */
  name: string;

  /** 描述 */
  description: string;

  /** 触发条件 */
  trigger: (context: unknown) => boolean;

  /** 是否启用 */
  enabled: boolean;
}
