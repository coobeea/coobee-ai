import { describe, it, expect, beforeEach } from 'vitest';
import { ModelGroupResolver, type ModelGroup } from '../ModelGroupResolver';

describe('ModelGroupResolver', () => {
  let resolver: ModelGroupResolver;
  const mockGroups: Record<string, ModelGroup> = {
    'high-performance': {
      name: '高性能组',
      models: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet-20241022', 'google/gemini-2.0-flash-thinking-exp'],
      strategy: 'round-robin',
      enabled: true
    },
    economic: {
      name: '经济组',
      models: ['openai/gpt-4o-mini', 'google/gemini-2.0-flash-exp'],
      strategy: 'random',
      enabled: true
    },
    weighted: {
      name: '加权组',
      models: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet-20241022'],
      strategy: 'weighted',
      weights: {
        'openai/gpt-4o': 0.7,
        'anthropic/claude-3-5-sonnet-20241022': 0.3
      },
      enabled: true
    },
    'fallback-chain': {
      name: '故障转移链',
      models: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet-20241022', 'google/gemini-2.0-flash-exp'],
      strategy: 'fallback',
      enabled: true
    }
  };

  beforeEach(() => {
    resolver = new ModelGroupResolver(mockGroups);
  });

  describe('round-robin strategy', () => {
    it('should rotate through models in sequence', () => {
      const group = 'high-performance';
      const models = mockGroups[group].models;

      const selected1 = resolver.resolveModel(group);
      const selected2 = resolver.resolveModel(group);
      const selected3 = resolver.resolveModel(group);
      const selected4 = resolver.resolveModel(group);

      expect(selected1).toBe(models[0]);
      expect(selected2).toBe(models[1]);
      expect(selected3).toBe(models[2]);
      expect(selected4).toBe(models[0]);
    });

    it('should maintain separate counters per agent', () => {
      const group = 'high-performance';
      const models = mockGroups[group].models;

      const agent1_1 = resolver.resolveModel(group, { agentId: 'agent-1' });
      const agent1_2 = resolver.resolveModel(group, { agentId: 'agent-1' });
      const agent2_1 = resolver.resolveModel(group, { agentId: 'agent-2' });

      expect(agent1_1).toBe(models[0]);
      expect(agent1_2).toBe(models[1]);
      expect(agent2_1).toBe(models[0]);
    });
  });

  describe('random strategy', () => {
    it('should select a random model from the group', () => {
      const group = 'economic';
      const models = mockGroups[group].models;

      const selected = resolver.resolveModel(group);

      expect(models).toContain(selected);
    });

    it('should select different models over multiple calls', () => {
      const group = 'economic';
      const selections = new Set<string>();

      for (let i = 0; i < 20; i++) {
        const selected = resolver.resolveModel(group);
        selections.add(selected!);
      }

      expect(selections.size).toBeGreaterThan(1);
    });
  });

  describe('weighted strategy', () => {
    it('should select models according to weights', () => {
      const group = 'weighted';
      const selections: Record<string, number> = {};

      for (let i = 0; i < 1000; i++) {
        const selected = resolver.resolveModel(group);
        if (selected) {
          selections[selected] = (selections[selected] || 0) + 1;
        }
      }

      const gpt4oRatio = selections['openai/gpt-4o'] / 1000;
      const claudeRatio = selections['anthropic/claude-3-5-sonnet-20241022'] / 1000;

      expect(gpt4oRatio).toBeGreaterThan(0.6);
      expect(gpt4oRatio).toBeLessThan(0.8);
      expect(claudeRatio).toBeGreaterThan(0.2);
      expect(claudeRatio).toBeLessThan(0.4);
    });
  });

  describe('quota-aware strategy', () => {
    it('should prefer models with higher remaining quota', () => {
      const group: ModelGroup = {
        name: '配额感知组',
        models: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet-20241022'],
        strategy: 'quota-aware',
        enabled: true
      };

      const resolverWithQuota = new ModelGroupResolver({
        'quota-aware-test': group
      });

      const selected = resolverWithQuota.resolveModel('quota-aware-test', {
        quotaInfo: {
          'openai/gpt-4o': {
            remaining: 100,
            limit: 6000,
            resetAt: Date.now() + 3600000
          },
          'anthropic/claude-3-5-sonnet-20241022': {
            remaining: 5000,
            limit: 6000,
            resetAt: Date.now() + 3600000
          }
        }
      });

      expect(selected).toBe('anthropic/claude-3-5-sonnet-20241022');
    });

    it('should fallback to random if no quota info provided', () => {
      const group: ModelGroup = {
        name: '配额感知组',
        models: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet-20241022'],
        strategy: 'quota-aware',
        enabled: true
      };

      const resolverWithQuota = new ModelGroupResolver({
        'quota-aware-test': group
      });

      const selected = resolverWithQuota.resolveModel('quota-aware-test');

      expect(selected).toBeTruthy();
      expect(group.models).toContain(selected!);
    });
  });

  describe('fallback strategy', () => {
    it('should always select the first model', () => {
      const group = 'fallback-chain';
      const models = mockGroups[group].models;

      const selected1 = resolver.resolveModel(group);
      const selected2 = resolver.resolveModel(group);

      expect(selected1).toBe(models[0]);
      expect(selected2).toBe(models[0]);
    });

    it('should skip failed models', () => {
      const group = 'fallback-chain';
      const models = mockGroups[group].models;

      const selected = resolver.resolveModel(group, {
        failedModels: [models[0]]
      });

      expect(selected).toBe(models[1]);
    });
  });

  describe('error handling', () => {
    it('should return null for non-existent group', () => {
      const selected = resolver.resolveModel('non-existent');
      expect(selected).toBeNull();
    });

    it('should return null for disabled group', () => {
      const disabledGroups: Record<string, ModelGroup> = {
        disabled: {
          name: '已禁用组',
          models: ['openai/gpt-4o'],
          strategy: 'random',
          enabled: false
        }
      };

      const resolverWithDisabled = new ModelGroupResolver(disabledGroups);
      const selected = resolverWithDisabled.resolveModel('disabled');

      expect(selected).toBeNull();
    });

    it('should return null if all models are failed', () => {
      const group = 'economic';
      const models = mockGroups[group].models;

      const selected = resolver.resolveModel(group, {
        failedModels: models
      });

      expect(selected).toBeNull();
    });
  });

  describe('counter management', () => {
    it('should reset counter for specific group and agent', () => {
      const group = 'high-performance';
      const models = mockGroups[group].models;

      resolver.resolveModel(group, { agentId: 'agent-1' });
      resolver.resolveModel(group, { agentId: 'agent-1' });

      resolver.resetCounter(group, 'agent-1');

      const selected = resolver.resolveModel(group, { agentId: 'agent-1' });
      expect(selected).toBe(models[0]);
    });

    it('should clear all counters', () => {
      const group = 'high-performance';
      const models = mockGroups[group].models;

      resolver.resolveModel(group, { agentId: 'agent-1' });
      resolver.resolveModel(group, { agentId: 'agent-2' });

      resolver.clearAllCounters();

      const agent1 = resolver.resolveModel(group, { agentId: 'agent-1' });
      const agent2 = resolver.resolveModel(group, { agentId: 'agent-2' });

      expect(agent1).toBe(models[0]);
      expect(agent2).toBe(models[0]);
    });
  });
});
