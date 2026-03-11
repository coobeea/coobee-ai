/**
 * ComplianceChecker - 合规性检查器
 */

import { createLogger } from '@main/common/logger';
import type { AuditLog, ComplianceRule, ComplianceReport } from './types';

const log = createLogger('compliance-checker');

export class ComplianceChecker {
  private rules: ComplianceRule[] = [];

  /**
   * 注册规则
   */
  registerRule(rule: ComplianceRule): void {
    this.rules.push(rule);
    log.info(`[ComplianceChecker] Registered rule: ${rule.name}`);
  }

  /**
   * 检查单个日志
   */
  checkLog(auditLog: AuditLog): Array<{ ruleId: string; ruleName: string; severity: string }> {
    const violations: Array<{ ruleId: string; ruleName: string; severity: string }> = [];

    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      try {
        const violated = rule.check(auditLog);
        if (violated) {
          violations.push({
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity
          });
        }
      } catch (err) {
        log.error(`[ComplianceChecker] Rule "${rule.name}" check failed:`, err);
      }
    }

    return violations;
  }

  /**
   * 生成合规性报告
   */
  generateReport(logs: AuditLog[], timeRange: { start: number; end: number }): ComplianceReport {
    log.info(`[ComplianceChecker] Generating compliance report for ${logs.length} logs`);

    const violationDetails: ComplianceReport['violationDetails'] = [];

    for (const auditLog of logs) {
      const violations = this.checkLog(auditLog);

      for (const violation of violations) {
        violationDetails.push({
          ruleId: violation.ruleId,
          ruleName: violation.ruleName,
          logId: auditLog.id,
          severity: violation.severity,
          timestamp: auditLog.timestamp
        });
      }
    }

    const report: ComplianceReport = {
      id: `report-${Date.now()}`,
      timeRange,
      totalLogs: logs.length,
      violations: violationDetails.length,
      violationDetails,
      complianceRate: logs.length > 0 ? 1 - violationDetails.length / logs.length : 1,
      generatedAt: Date.now()
    };

    log.info(
      `[ComplianceChecker] Report generated: ${violationDetails.length} violations, ${(report.complianceRate * 100).toFixed(1)}% compliance`
    );

    return report;
  }

  /**
   * 列出所有规则
   */
  listRules(): ComplianceRule[] {
    return [...this.rules];
  }
}
