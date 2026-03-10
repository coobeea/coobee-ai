/**
 * ProactiveAgent 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProactiveAgent } from '../ProactiveAgent';
import { OpportunityScanner } from '../OpportunityScanner';
import type { ProactiveConfig, ScanContext, ScanRule, Opportunity } from '../types';

describe('ProactiveAgent', () => {
  let agent: ProactiveAgent;

  const config: ProactiveConfig = {
    enabled: true,
    scanInterval: 5000,
    minPriority: 5,
    notificationMethod: 'console'
  };

  const scanContext: ScanContext = {
    workspaceDir: '/test/workspace',
    gitRepoPath: '/test/workspace/.git'
  };

  beforeEach(() => {
    agent = new ProactiveAgent(config);
  });

  afterEach(() => {
    agent.stop();
  });

  describe('Lifecycle', () => {
    it('should start and stop scanning', () => {
      expect(() => agent.start(scanContext)).not.toThrow();
      expect(() => agent.stop()).not.toThrow();
    });

    it('should not start if disabled', () => {
      const disabledAgent = new ProactiveAgent({ ...config, enabled: false });
      disabledAgent.start(scanContext);
      disabledAgent.stop();
    });
  });

  describe('Opportunity management', () => {
    it('should acknowledge opportunity', () => {
      expect(() => agent.acknowledgeOpportunity('opp-1')).not.toThrow();
    });

    it('should plan opportunity', () => {
      expect(() => agent.planOpportunity('opp-1')).not.toThrow();
    });

    it('should dismiss opportunity', () => {
      expect(() => agent.dismissOpportunity('opp-1')).not.toThrow();
    });

    it('should get opportunities with filters', () => {
      const opportunities = agent.getOpportunities({ minPriority: 7 });
      expect(Array.isArray(opportunities)).toBe(true);
    });
  });
});

describe('OpportunityScanner', () => {
  let scanner: OpportunityScanner;

  beforeEach(() => {
    scanner = new OpportunityScanner();
  });

  describe('Rule registration', () => {
    it('should register scan rules', () => {
      const mockRule: ScanRule = {
        id: 'test-rule',
        name: 'Test Rule',
        type: 'bug',
        enabled: true,
        interval: 60000,
        check: vi.fn(async () => [])
      };

      expect(() => scanner.registerRule(mockRule)).not.toThrow();
    });
  });

  describe('Scanning', () => {
    it('should execute enabled rules', async () => {
      const checkFn = vi.fn(async (): Promise<Opportunity[]> => [
        {
          id: 'opp-1',
          type: 'bug',
          title: 'Test opportunity',
          description: 'Test',
          priority: 8,
          estimatedImpact: 'high',
          confidence: 0.9,
          source: 'test-rule',
          status: 'new',
          discoveredAt: Date.now()
        }
      ]);

      const rule: ScanRule = {
        id: 'test-rule',
        name: 'Test Rule',
        type: 'bug',
        enabled: true,
        interval: 60000,
        check: checkFn
      };

      scanner.registerRule(rule);

      const result = await scanner.scan({ workspaceDir: '/test' });

      expect(checkFn).toHaveBeenCalled();
      expect(result.length).toBe(1);
      expect(result[0].title).toBe('Test opportunity');
    });

    it('should filter out dismissed opportunities', async () => {
      const rule: ScanRule = {
        id: 'test-rule',
        name: 'Test Rule',
        type: 'bug',
        enabled: true,
        interval: 60000,
        check: async () => [
          {
            id: 'opp-1',
            type: 'bug',
            title: 'Test',
            description: 'Test',
            priority: 8,
            estimatedImpact: 'high',
            confidence: 0.9,
            source: 'test',
            status: 'new',
            discoveredAt: Date.now()
          }
        ]
      };

      scanner.registerRule(rule);
      await scanner.scan({ workspaceDir: '/test' });

      scanner.updateStatus('opp-1', 'dismissed');

      const opportunities = scanner.getOpportunities();
      expect(opportunities.length).toBe(0);
    });
  });
});
