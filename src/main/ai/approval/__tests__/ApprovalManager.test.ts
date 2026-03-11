/**
 * ApprovalManager 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalManager } from '../ApprovalManager';
import { InterventionManager } from '../InterventionManager';
import type { ApprovalConfig, InterventionPoint } from '../types';

describe('ApprovalManager', () => {
  let manager: ApprovalManager;

  const config: ApprovalConfig = {
    enabled: true,
    defaultApprovers: ['user-1'],
    approversByRisk: {
      low: ['user-1'],
      medium: ['user-1', 'user-2'],
      high: ['user-1', 'user-2', 'admin-1'],
      critical: ['admin-1', 'admin-2']
    },
    defaultStrategy: 'majority',
    requestTimeout: 3600000
  };

  beforeEach(() => {
    manager = new ApprovalManager(config);
  });

  describe('Request creation', () => {
    it('should create approval request', () => {
      const request = manager.createRequest('task-1', 'deployment', 'deployment', '部署到生产环境', 'agent-1');

      expect(request.id).toBeDefined();
      expect(request.status).toBe('pending');
      expect(request.riskLevel).toBe('high');
      expect(request.approvers.length).toBeGreaterThan(0);
    });

    it('should assign approvers based on risk level', () => {
      const lowRisk = manager.createRequest('task-1', 'code', 'code-change', 'Minor fix', 'agent-1', 'low');

      expect(lowRisk.approvers.length).toBe(1);

      const highRisk = manager.createRequest(
        'task-2',
        'deploy',
        'deployment',
        'Production deploy',
        'agent-1',
        'critical'
      );

      expect(highRisk.approvers.length).toBe(2);
    });
  });

  describe('Approval response', () => {
    it('should accept approval from valid approver', () => {
      const request = manager.createRequest('task-1', 'test', 'code-change', 'Test', 'agent-1');

      const success = manager.respond(request.id, {
        approver: request.approvers[0],
        decision: 'approve',
        comment: 'LGTM'
      });

      expect(success).toBe(true);

      const updated = manager.getRequest(request.id);
      expect(updated?.approved).toContain(request.approvers[0]);
    });

    it('should reject response from non-approver', () => {
      const request = manager.createRequest('task-1', 'test', 'code-change', 'Test', 'agent-1');

      const success = manager.respond(request.id, {
        approver: 'non-approver',
        decision: 'approve'
      });

      expect(success).toBe(false);
    });
  });

  describe('Approval strategies', () => {
    it('should approve with "any" strategy', () => {
      const request = manager.createRequest('task-1', 'test', 'code-change', 'Test', 'agent-1');
      request.strategy = 'any';
      request.approvers = ['user-1', 'user-2'];

      manager.respond(request.id, {
        approver: 'user-1',
        decision: 'approve'
      });

      const updated = manager.getRequest(request.id);
      expect(updated?.status).toBe('approved');
    });

    it('should require all with "all" strategy', () => {
      const request = manager.createRequest('task-1', 'test', 'code-change', 'Test', 'agent-1');
      request.strategy = 'all';
      request.approvers = ['user-1', 'user-2'];

      manager.respond(request.id, {
        approver: 'user-1',
        decision: 'approve'
      });

      let updated = manager.getRequest(request.id);
      expect(updated?.status).toBe('pending');

      manager.respond(request.id, {
        approver: 'user-2',
        decision: 'approve'
      });

      updated = manager.getRequest(request.id);
      expect(updated?.status).toBe('approved');
    });

    it('should reject immediately with "all" strategy on single rejection', () => {
      const request = manager.createRequest('task-1', 'test', 'code-change', 'Test', 'agent-1');
      request.strategy = 'all';
      request.approvers = ['user-1', 'user-2'];

      manager.respond(request.id, {
        approver: 'user-1',
        decision: 'reject',
        comment: 'Not safe'
      });

      const updated = manager.getRequest(request.id);
      expect(updated?.status).toBe('rejected');
    });

    it('should approve with majority', () => {
      const request = manager.createRequest('task-1', 'test', 'code-change', 'Test', 'agent-1');
      request.strategy = 'majority';
      request.approvers = ['user-1', 'user-2', 'user-3'];

      manager.respond(request.id, { approver: 'user-1', decision: 'approve' });
      manager.respond(request.id, { approver: 'user-2', decision: 'approve' });

      const updated = manager.getRequest(request.id);
      expect(updated?.status).toBe('approved');
    });
  });
});

describe('InterventionManager', () => {
  let manager: InterventionManager;

  beforeEach(() => {
    manager = new InterventionManager();
  });

  describe('Point registration', () => {
    it('should register intervention point', () => {
      const point: InterventionPoint = {
        id: 'test-point',
        name: 'Test Intervention',
        description: 'Test',
        trigger: () => false,
        enabled: true
      };

      expect(() => manager.registerPoint(point)).not.toThrow();
    });

    it('should list registered points', () => {
      const point: InterventionPoint = {
        id: 'test-point',
        name: 'Test',
        description: 'Test',
        trigger: () => false,
        enabled: true
      };

      manager.registerPoint(point);

      const points = manager.listPoints();
      expect(points.length).toBe(1);
      expect(points[0].id).toBe('test-point');
    });
  });

  describe('Intervention checking', () => {
    it('should trigger intervention on condition', () => {
      const point: InterventionPoint = {
        id: 'critical-error',
        name: 'Critical Error',
        description: 'Stop on critical error',
        trigger: (ctx: unknown) => {
          return (ctx as { hasError: boolean }).hasError === true;
        },
        enabled: true
      };

      manager.registerPoint(point);

      const triggered = manager.checkIntervention({ hasError: true });
      expect(triggered.length).toBe(1);
      expect(triggered[0].id).toBe('critical-error');
    });

    it('should not trigger disabled points', () => {
      const point: InterventionPoint = {
        id: 'test-point',
        name: 'Test',
        description: 'Test',
        trigger: () => true,
        enabled: false
      };

      manager.registerPoint(point);

      const triggered = manager.checkIntervention({});
      expect(triggered.length).toBe(0);
    });
  });

  describe('Point management', () => {
    it('should enable/disable points', () => {
      const point: InterventionPoint = {
        id: 'test-point',
        name: 'Test',
        description: 'Test',
        trigger: () => true,
        enabled: true
      };

      manager.registerPoint(point);
      manager.setEnabled('test-point', false);

      const triggered = manager.checkIntervention({});
      expect(triggered.length).toBe(0);
    });

    it('should remove points', () => {
      const point: InterventionPoint = {
        id: 'test-point',
        name: 'Test',
        description: 'Test',
        trigger: () => false,
        enabled: true
      };

      manager.registerPoint(point);
      manager.removePoint('test-point');

      const points = manager.listPoints();
      expect(points.length).toBe(0);
    });
  });
});
