/**
 * AuditLogger - 审计日志记录器
 */

import fs from 'fs';
import path from 'path';
import { createLogger } from '@main/common/logger';
import type { AuditLog, AuditEventType, AuditConfig } from './types';

const log = createLogger('audit-logger');

export class AuditLogger {
  private config: AuditConfig;
  private logFile: string;

  constructor(config: AuditConfig, storageDir: string) {
    this.config = config;
    this.logFile = path.join(storageDir, 'audit.jsonl');

    this.initialize();
  }

  /**
   * 初始化
   */
  private initialize(): void {
    const dir = path.dirname(this.logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, '', 'utf-8');
    }

    log.info(`[AuditLogger] Initialized at ${this.logFile}`);
  }

  /**
   * 记录事件
   */
  logEvent(
    eventType: AuditEventType,
    actor: string,
    resource: string,
    action: string,
    result: AuditLog['result'],
    details: Record<string, unknown> = {}
  ): void {
    if (!this.config.enabled) return;

    const auditLog: AuditLog = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      eventType,
      actor,
      resource,
      action,
      result,
      severity: this.inferSeverity(eventType, result),
      details,
      timestamp: Date.now()
    };

    const line = JSON.stringify(auditLog) + '\n';
    fs.appendFileSync(this.logFile, line, 'utf-8');

    if (auditLog.severity === 'critical' || auditLog.severity === 'error') {
      log.warn(`[AuditLogger] ${eventType} by ${actor} on ${resource}: ${result}`, details);
    } else {
      log.debug(`[AuditLogger] ${eventType} by ${actor} on ${resource}: ${result}`);
    }
  }

  /**
   * 查询日志
   */
  queryLogs(filters: {
    eventType?: AuditEventType;
    actor?: string;
    startTime?: number;
    endTime?: number;
    severity?: AuditLog['severity'];
  }): AuditLog[] {
    if (!fs.existsSync(this.logFile)) return [];

    const content = fs.readFileSync(this.logFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    const logs = lines.map((line) => JSON.parse(line) as AuditLog).reverse();

    return logs.filter((auditLog) => {
      if (filters.eventType && auditLog.eventType !== filters.eventType) return false;
      if (filters.actor && auditLog.actor !== filters.actor) return false;
      if (filters.severity && auditLog.severity !== filters.severity) return false;
      if (filters.startTime && auditLog.timestamp < filters.startTime) return false;
      if (filters.endTime && auditLog.timestamp > filters.endTime) return false;
      return true;
    });
  }

  /**
   * 清理过期日志
   */
  cleanup(): void {
    if (!fs.existsSync(this.logFile)) return;

    const retentionMs = this.config.retentionDays * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - retentionMs;

    const content = fs.readFileSync(this.logFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    const validLines = lines.filter((line) => {
      try {
        const auditLog = JSON.parse(line) as AuditLog;
        return auditLog.timestamp >= cutoffTime;
      } catch {
        return false;
      }
    });

    fs.writeFileSync(this.logFile, validLines.join('\n') + (validLines.length > 0 ? '\n' : ''), 'utf-8');

    log.info(`[AuditLogger] Cleanup complete. Retained ${validLines.length}/${lines.length} logs`);
  }

  /**
   * 推断严重程度
   */
  private inferSeverity(eventType: AuditEventType, result: AuditLog['result']): AuditLog['severity'] {
    if (result === 'failure') return 'error';

    if (eventType.includes('delete') || eventType.startsWith('approval.')) return 'warning';

    if (eventType.startsWith('config.') || eventType.startsWith('user.')) return 'info';

    return 'info';
  }

  /**
   * 获取统计信息
   */
  getStatistics(): {
    totalLogs: number;
    byEventType: Record<string, number>;
    bySeverity: Record<string, number>;
    successRate: number;
  } {
    const logs = this.queryLogs({});

    const byEventType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let successCount = 0;

    for (const auditLog of logs) {
      byEventType[auditLog.eventType] = (byEventType[auditLog.eventType] || 0) + 1;
      bySeverity[auditLog.severity] = (bySeverity[auditLog.severity] || 0) + 1;

      if (auditLog.result === 'success') successCount++;
    }

    return {
      totalLogs: logs.length,
      byEventType,
      bySeverity,
      successRate: logs.length > 0 ? successCount / logs.length : 0
    };
  }
}
