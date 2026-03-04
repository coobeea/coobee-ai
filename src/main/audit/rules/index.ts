/**
 * 内置合规性规则
 */

import type { ComplianceRule, AuditLog } from '../types';

/**
 * 检查未授权的文件删除
 */
export const unauthorizedDeletionRule: ComplianceRule = {
  id: 'unauthorized-deletion',
  name: 'Unauthorized File Deletion',
  description: '检测未经授权的文件删除操作',
  severity: 'critical',
  enabled: true,
  check: (auditLog: AuditLog) => {
    if (auditLog.eventType === 'file.delete' && auditLog.result === 'success') {
      return !auditLog.details.authorized;
    }
    return false;
  }
};

/**
 * 检查失败的审批请求
 */
export const failedApprovalRule: ComplianceRule = {
  id: 'failed-approval',
  name: 'Failed Approval Request',
  description: '检测被拒绝的审批请求',
  severity: 'medium',
  enabled: true,
  check: (auditLog: AuditLog) => {
    return auditLog.eventType === 'approval.respond' && auditLog.details.decision === 'reject';
  }
};

/**
 * 检查高频 API 调用
 */
export const highFrequencyAPIRule: ComplianceRule = {
  id: 'high-frequency-api',
  name: 'High Frequency API Calls',
  description: '检测异常高频的 API 调用',
  severity: 'high',
  enabled: true,
  check: (auditLog: AuditLog) => {
    if (auditLog.eventType === 'api.call') {
      const callCount = (auditLog.details.recentCallCount as number) || 0;
      return callCount > 100;
    }
    return false;
  }
};

/**
 * 检查敏感配置变更
 */
export const sensitiveConfigChangeRule: ComplianceRule = {
  id: 'sensitive-config-change',
  name: 'Sensitive Configuration Change',
  description: '检测敏感配置的修改',
  severity: 'critical',
  enabled: true,
  check: (auditLog: AuditLog) => {
    if (auditLog.eventType === 'config.change') {
      const key = auditLog.details.key as string;
      return key?.includes('secret') || key?.includes('token') || key?.includes('password');
    }
    return false;
  }
};

export const defaultComplianceRules: ComplianceRule[] = [
  unauthorizedDeletionRule,
  failedApprovalRule,
  highFrequencyAPIRule,
  sensitiveConfigChangeRule
];
