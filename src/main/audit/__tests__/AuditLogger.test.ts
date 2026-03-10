/**
 * AuditLogger 和 ComplianceChecker 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AuditLogger } from '../AuditLogger';
import { ComplianceChecker } from '../ComplianceChecker';
import { defaultComplianceRules } from '../rules';
import type { AuditConfig, AuditLog } from '../types';

describe('AuditLogger', () => {
  let tmpDir: string;
  let logger: AuditLogger;

  const config: AuditConfig = {
    enabled: true,
    retentionDays: 90,
    logSensitiveOperations: true,
    alertThreshold: {
      failureRate: 0.1,
      criticalEvents: 5
    }
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
    logger = new AuditLogger(config, tmpDir);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  describe('Event logging', () => {
    it('should log audit event', () => {
      logger.logEvent('task.create', 'agent-1', 'task-123', 'create', 'success', {
        taskType: 'code-review'
      });

      const logs = logger.queryLogs({});
      expect(logs.length).toBe(1);
      expect(logs[0].eventType).toBe('task.create');
    });

    it('should not log when disabled', () => {
      const disabledLogger = new AuditLogger({ ...config, enabled: false }, tmpDir);

      disabledLogger.logEvent('task.create', 'agent-1', 'task-123', 'create', 'success');

      const logs = disabledLogger.queryLogs({});
      expect(logs.length).toBe(0);
    });
  });

  describe('Query logs', () => {
    beforeEach(() => {
      logger.logEvent('task.create', 'agent-1', 'task-1', 'create', 'success');
      logger.logEvent('task.execute', 'agent-1', 'task-1', 'execute', 'success');
      logger.logEvent('task.fail', 'agent-2', 'task-2', 'execute', 'failure');
    });

    it('should filter by event type', () => {
      const logs = logger.queryLogs({ eventType: 'task.create' });
      expect(logs.length).toBe(1);
      expect(logs[0].eventType).toBe('task.create');
    });

    it('should filter by actor', () => {
      const logs = logger.queryLogs({ actor: 'agent-2' });
      expect(logs.length).toBe(1);
      expect(logs[0].actor).toBe('agent-2');
    });

    it('should filter by severity', () => {
      const logs = logger.queryLogs({ severity: 'error' });
      expect(logs.length).toBe(1);
      expect(logs[0].result).toBe('failure');
    });
  });

  describe('Cleanup', () => {
    it('should remove old logs', () => {
      logger.logEvent('task.create', 'agent-1', 'task-1', 'create', 'success');

      const shortRetentionLogger = new AuditLogger({ ...config, retentionDays: 0 }, tmpDir);

      shortRetentionLogger.cleanup();

      const logs = shortRetentionLogger.queryLogs({});
      expect(logs.length).toBe(0);
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      logger.logEvent('task.create', 'agent-1', 'task-1', 'create', 'success');
      logger.logEvent('task.execute', 'agent-1', 'task-1', 'execute', 'success');
      logger.logEvent('task.fail', 'agent-2', 'task-2', 'execute', 'failure');
    });

    it('should calculate statistics', () => {
      const stats = logger.getStatistics();

      expect(stats.totalLogs).toBe(3);
      expect(stats.successRate).toBeCloseTo(2 / 3);
      expect(stats.byEventType['task.create']).toBe(1);
      expect(stats.bySeverity['error']).toBe(1);
    });
  });
});

describe('ComplianceChecker', () => {
  let checker: ComplianceChecker;

  beforeEach(() => {
    checker = new ComplianceChecker();

    for (const rule of defaultComplianceRules) {
      checker.registerRule(rule);
    }
  });

  describe('Rule registration', () => {
    it('should register compliance rules', () => {
      const rules = checker.listRules();
      expect(rules.length).toBeGreaterThan(0);
    });
  });

  describe('Log checking', () => {
    it('should detect violations', () => {
      const auditLog: AuditLog = {
        id: 'log-1',
        eventType: 'file.delete',
        actor: 'agent-1',
        resource: 'important-file.txt',
        action: 'delete',
        result: 'success',
        severity: 'warning',
        details: { authorized: false },
        timestamp: Date.now()
      };

      const violations = checker.checkLog(auditLog);

      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].ruleId).toBe('unauthorized-deletion');
    });

    it('should not flag compliant logs', () => {
      const auditLog: AuditLog = {
        id: 'log-2',
        eventType: 'task.create',
        actor: 'agent-1',
        resource: 'task-1',
        action: 'create',
        result: 'success',
        severity: 'info',
        details: {},
        timestamp: Date.now()
      };

      const violations = checker.checkLog(auditLog);
      expect(violations.length).toBe(0);
    });
  });

  describe('Report generation', () => {
    it('should generate compliance report', () => {
      const logs: AuditLog[] = [
        {
          id: 'log-1',
          eventType: 'task.create',
          actor: 'agent-1',
          resource: 'task-1',
          action: 'create',
          result: 'success',
          severity: 'info',
          details: {},
          timestamp: Date.now()
        },
        {
          id: 'log-2',
          eventType: 'file.delete',
          actor: 'agent-2',
          resource: 'file-1',
          action: 'delete',
          result: 'success',
          severity: 'warning',
          details: { authorized: false },
          timestamp: Date.now()
        }
      ];

      const report = checker.generateReport(logs, {
        start: Date.now() - 86400000,
        end: Date.now()
      });

      expect(report.totalLogs).toBe(2);
      expect(report.violations).toBe(1);
      expect(report.complianceRate).toBe(0.5);
      expect(report.violationDetails[0].ruleId).toBe('unauthorized-deletion');
    });
  });
});
