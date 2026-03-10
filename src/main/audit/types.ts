/**
 * Audit Types
 *
 * 审计日志类型定义
 */

/**
 * 审计事件类型
 */
export type AuditEventType =
  | 'agent.create'
  | 'agent.update'
  | 'agent.delete'
  | 'task.create'
  | 'task.execute'
  | 'task.complete'
  | 'task.fail'
  | 'approval.request'
  | 'approval.respond'
  | 'api.call'
  | 'config.change'
  | 'user.login'
  | 'user.logout'
  | 'file.read'
  | 'file.write'
  | 'file.delete';

/**
 * 审计日志
 */
export interface AuditLog {
  /** 日志 ID */
  id: string;

  /** 事件类型 */
  eventType: AuditEventType;

  /** 操作者（用户或 Agent ID） */
  actor: string;

  /** 操作对象（资源 ID） */
  resource: string;

  /** 操作动作 */
  action: string;

  /** 结果 */
  result: 'success' | 'failure' | 'partial';

  /** 严重程度 */
  severity: 'info' | 'warning' | 'error' | 'critical';

  /** IP 地址 */
  ipAddress?: string;

  /** 详细信息 */
  details: Record<string, unknown>;

  /** 时间戳 */
  timestamp: number;
}

/**
 * 合规性检查规则
 */
export interface ComplianceRule {
  /** 规则 ID */
  id: string;

  /** 规则名称 */
  name: string;

  /** 描述 */
  description: string;

  /** 严重程度 */
  severity: 'low' | 'medium' | 'high' | 'critical';

  /** 检查函数 */
  check: (log: AuditLog) => boolean;

  /** 是否启用 */
  enabled: boolean;
}

/**
 * 合规性报告
 */
export interface ComplianceReport {
  /** 报告 ID */
  id: string;

  /** 检查时间范围 */
  timeRange: {
    start: number;
    end: number;
  };

  /** 总日志数 */
  totalLogs: number;

  /** 违规数 */
  violations: number;

  /** 违规详情 */
  violationDetails: Array<{
    ruleId: string;
    ruleName: string;
    logId: string;
    severity: string;
    timestamp: number;
  }>;

  /** 合规率 */
  complianceRate: number;

  /** 生成时间 */
  generatedAt: number;
}

/**
 * 审计配置
 */
export interface AuditConfig {
  /** 是否启用 */
  enabled: boolean;

  /** 日志保留天数 */
  retentionDays: number;

  /** 是否记录敏感操作 */
  logSensitiveOperations: boolean;

  /** 实时告警阈值 */
  alertThreshold: {
    failureRate: number;
    criticalEvents: number;
  };
}
