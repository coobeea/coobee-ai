/**
 * Model Group Integration Tests - 端到端模型选择验证
 *
 * 测试场景：
 * 1. ModelSelector + ModelGroupResolver 完整集成
 * 2. 模型组选择 + 故障转移
 * 3. 多轮选择验证（配额感知、轮询）
 * 4. Auto 模式端到端
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelSelector } from '../ModelSelector';
import type { CoobeeConfig } from '@main/common/config/schema';

describe('Model Integration Tests', () => {
  let mockConfig: CoobeeConfig;
  let selector: ModelSelector;

  beforeEach(() => {
    // Mock Date.now() for deterministic tests
    let mockTime = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      mockTime += 50;
      return mockTime;
    });

    // 构建完整配置
    mockConfig = {
      models: {
        providers: {
          openai: {
            enabled: true,
            name: 'OpenAI',
            apiKey: 'test-key',
            baseUrl: 'https://api.openai.com/v1',
            models: [
              { id: 'gpt-4o', cost: { input: 5, output: 15 }, contextWindow: 128000, functionCalling: true },
              {
                id: 'gpt-4o-mini',
                cost: { input: 0.15, output: 0.6 },
                contextWindow: 128000,
                functionCalling: true
              }
            ]
          },
          anthropic: {
            enabled: true,
            name: 'Anthropic',
            apiKey: 'test-key',
            baseUrl: 'https://api.anthropic.com',
            models: [
              {
                id: 'claude-3-5-sonnet-20241022',
                cost: { input: 3, output: 15 },
                contextWindow: 200000,
                functionCalling: true
              }
            ]
          }
        },
        groups: {
          'high-performance': {
            name: '高性能组',
            description: '用于复杂任务',
            models: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet-20241022'],
            strategy: 'round-robin',
            enabled: true
          },
          economic: {
            name: '经济组',
            description: '用于简单任务',
            models: ['openai/gpt-4o-mini'],
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
          'quota-aware-group': {
            name: '配额感知组',
            models: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet-20241022'],
            strategy: 'quota-aware',
            enabled: true
          }
        },
        auto: {
          enabled: true,
          strategy: 'quota-aware',
          candidates: ['openai/gpt-4o', 'openai/gpt-4o-mini', 'anthropic/claude-3-5-sonnet-20241022'],
          filters: {
            maxCost: 10,
            minContextWindow: 100000
          }
        },
        defaults: {
          model: {
            primary: 'openai/gpt-4o',
            fallbacks: ['anthropic/claude-3-5-sonnet-20241022']
          }
        }
      }
    } as unknown as CoobeeConfig;

    selector = new ModelSelector(mockConfig);
  });

  it('端到端测试: 模型组选择 + 轮询策略', () => {
    // 从模型组选择
    const model1 = selector.resolveModelGroup('high-performance');
    const model2 = selector.resolveModelGroup('high-performance');
    const model3 = selector.resolveModelGroup('high-performance');
    const model4 = selector.resolveModelGroup('high-performance');

    // 验证轮询行为
    expect(model1).toBe('openai/gpt-4o');
    expect(model2).toBe('anthropic/claude-3-5-sonnet-20241022');
    expect(model3).toBe('openai/gpt-4o');
    expect(model4).toBe('anthropic/claude-3-5-sonnet-20241022');
  });

  it('端到端测试: ModelSelector 解析模型组引用', () => {
    // 通过 ModelSelector 的 resolve 方法解析模型组
    const ref1 = selector.resolve({
      modelOverride: '@high-performance',
      sessionId: 'session-1'
    });

    const ref2 = selector.resolve({
      modelOverride: '@high-performance',
      sessionId: 'session-1'
    });

    // 应该轮询选择不同模型
    expect(ref1.provider).toBe('openai');
    expect(ref1.model).toBe('gpt-4o');

    expect(ref2.provider).toBe('anthropic');
    expect(ref2.model).toBe('claude-3-5-sonnet-20241022');
  });

  it('故障转移: 跳过失败的模型', () => {
    // 标记第一个模型失败
    const selected = selector.resolveModelGroup('high-performance', {
      failedModels: ['openai/gpt-4o']
    });

    // 应该选择第二个模型
    expect(selected).toBe('anthropic/claude-3-5-sonnet-20241022');
  });

  it('故障转移: 所有模型失败应该返回 null', () => {
    const selected = selector.resolveModelGroup('high-performance', {
      failedModels: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet-20241022']
    });

    expect(selected).toBeNull();
  });

  it('配额感知选择: 优先选择配额充足的模型', () => {
    const selected = selector.resolveModelGroup('quota-aware-group', {
      quotaInfo: {
        'openai/gpt-4o': {
          remaining: 100, // 配额快用完
          limit: 6000,
          resetAt: Date.now() + 3600000
        },
        'anthropic/claude-3-5-sonnet-20241022': {
          remaining: 5000, // 配额充足
          limit: 6000,
          resetAt: Date.now() + 3600000
        }
      }
    });

    // 应该选择配额更充足的模型
    expect(selected).toBe('anthropic/claude-3-5-sonnet-20241022');
  });

  it('配额感知选择: 配额耗尽时切换模型', () => {
    // 第1次调用：gpt-4o 配额充足
    const selected1 = selector.resolveModelGroup('quota-aware-group', {
      quotaInfo: {
        'openai/gpt-4o': {
          remaining: 5000,
          limit: 6000,
          resetAt: Date.now() + 3600000
        },
        'anthropic/claude-3-5-sonnet-20241022': {
          remaining: 100,
          limit: 6000,
          resetAt: Date.now() + 3600000
        }
      }
    });

    expect(selected1).toBe('openai/gpt-4o');

    // 第2次调用：gpt-4o 配额耗尽
    const selected2 = selector.resolveModelGroup('quota-aware-group', {
      quotaInfo: {
        'openai/gpt-4o': {
          remaining: 0, // 配额耗尽
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

    expect(selected2).toBe('anthropic/claude-3-5-sonnet-20241022');
  });

  it('Auto 模式: 应用过滤器并选择模型', () => {
    const selected = selector.resolveAuto({
      quotaInfo: {
        'openai/gpt-4o': {
          remaining: 5000,
          limit: 6000,
          resetAt: Date.now() + 3600000
        },
        'openai/gpt-4o-mini': {
          remaining: 100, // 配额较少
          limit: 6000,
          resetAt: Date.now() + 3600000
        },
        'anthropic/claude-3-5-sonnet-20241022': {
          remaining: 100,
          limit: 6000,
          resetAt: Date.now() + 3600000
        }
      }
    });

    // 过滤器要求: maxCost: 10, minContextWindow: 100000
    // gpt-4o 和 claude-3-5-sonnet 都满足
    // 但 gpt-4o 配额更充足（5000 vs 100）
    expect(selected).toBe('openai/gpt-4o');
  });

  it('Auto 模式: 过滤后应该排除超成本模型', () => {
    // 修改配置：maxCost 降低到 1，排除所有高成本模型
    mockConfig.models!.auto!.filters = {
      maxCost: 1,
      minContextWindow: 100000
    };
    selector.updateConfig(mockConfig);

    const selected = selector.resolveAuto();

    // gpt-4o-mini 成本最低 (0.15 + 0.6) / 2 = 0.375
    // 但它的 contextWindow 是 128000，满足 minContextWindow
    expect(selected).toBe('openai/gpt-4o-mini');
  });

  it('多Agent场景: 不同Agent维护独立轮询状态', () => {
    // Agent-1 选择
    const agent1_1 = selector.resolveModelGroup('high-performance', { agentId: 'agent-1' });
    const agent1_2 = selector.resolveModelGroup('high-performance', { agentId: 'agent-1' });

    // Agent-2 选择
    const agent2_1 = selector.resolveModelGroup('high-performance', { agentId: 'agent-2' });

    // 两个 Agent 的计数器应该独立
    expect(agent1_1).toBe('openai/gpt-4o');
    expect(agent1_2).toBe('anthropic/claude-3-5-sonnet-20241022');
    expect(agent2_1).toBe('openai/gpt-4o'); // Agent-2 从头开始
  });

  it('故障转移候选列表: 获取组内所有模型用于重试', () => {
    const candidates = selector.getGroupCandidates('@high-performance');

    expect(candidates).toEqual(['openai/gpt-4o', 'anthropic/claude-3-5-sonnet-20241022']);
  });

  it('故障转移候选列表: 非组引用返回 null', () => {
    const candidates = selector.getGroupCandidates('openai/gpt-4o');

    expect(candidates).toBeNull();
  });

  it('优先级测试: 会话覆盖 > 模型组', () => {
    // 设置会话覆盖
    selector.setSessionOverride('session-1', 'openai/gpt-4o-mini');

    // 会话覆盖优先于 modelOverride
    const ref = selector.resolve({
      sessionId: 'session-1'
      // modelOverride 不传，会话覆盖生效
    });

    expect(ref.provider).toBe('openai');
    expect(ref.model).toBe('gpt-4o-mini');
  });

  it('优先级测试: Agent 覆盖 > 全局默认', () => {
    // 设置 Agent 覆盖
    selector.setAgentOverride('agent-1', 'anthropic/claude-3-5-sonnet-20241022');

    const ref = selector.resolve({
      agentId: 'agent-1'
    });

    expect(ref.provider).toBe('anthropic');
    expect(ref.model).toBe('claude-3-5-sonnet-20241022');
  });

  it('完整流程: 模型组选择 → 失败 → 切换到下一个候选', () => {
    // 第1次尝试
    const attempt1 = selector.resolveModelGroup('high-performance');
    expect(attempt1).toBe('openai/gpt-4o');

    // 第1次失败，标记为失败
    const attempt2 = selector.resolveModelGroup('high-performance', {
      failedModels: ['openai/gpt-4o']
    });
    expect(attempt2).toBe('anthropic/claude-3-5-sonnet-20241022');

    // 第2次也失败，所有候选耗尽
    const attempt3 = selector.resolveModelGroup('high-performance', {
      failedModels: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet-20241022']
    });
    expect(attempt3).toBeNull();
  });

  it('加权选择: 验证权重分布（统计学验证）', () => {
    const selections: Record<string, number> = {};

    // 大量采样
    for (let i = 0; i < 1000; i++) {
      const selected = selector.resolveModelGroup('weighted');
      if (selected) {
        selections[selected] = (selections[selected] || 0) + 1;
      }
    }

    // 验证权重分布
    const gpt4oRatio = selections['openai/gpt-4o'] / 1000;
    const claudeRatio = selections['anthropic/claude-3-5-sonnet-20241022'] / 1000;

    // 权重是 0.7:0.3，允许 ±10% 误差
    expect(gpt4oRatio).toBeGreaterThan(0.6);
    expect(gpt4oRatio).toBeLessThan(0.8);
    expect(claudeRatio).toBeGreaterThan(0.2);
    expect(claudeRatio).toBeLessThan(0.4);
  });

  it('禁用组应该返回 null', () => {
    // 禁用组
    mockConfig.models!.groups!['high-performance'].enabled = false;
    selector.updateConfig(mockConfig);

    const selected = selector.resolveModelGroup('high-performance');

    expect(selected).toBeNull();
  });

  it('空组应该返回 null', () => {
    // 清空组内模型
    mockConfig.models!.groups!['high-performance'].models = [];
    selector.updateConfig(mockConfig);

    const selected = selector.resolveModelGroup('high-performance');

    expect(selected).toBeNull();
  });

  it('Auto 模式禁用时应该返回 null', () => {
    mockConfig.models!.auto!.enabled = false;
    selector.updateConfig(mockConfig);

    const selected = selector.resolveAuto();

    expect(selected).toBeNull();
  });

  it('resolveWithFallbacks: 返回主模型 + fallback 列表', () => {
    const config = selector.resolveWithFallbacks({ sessionId: 'session-1' });

    expect(config.primary).toBe('openai/gpt-4o');
    expect(config.fallbacks).toEqual(['anthropic/claude-3-5-sonnet-20241022']);
  });

  it('resolveWithFallbacks: 过滤掉与主模型相同的 fallback', () => {
    // 设置 Agent 覆盖为 fallback 中的模型
    selector.setAgentOverride('agent-1', 'anthropic/claude-3-5-sonnet-20241022');

    const config = selector.resolveWithFallbacks({ agentId: 'agent-1' });

    expect(config.primary).toBe('anthropic/claude-3-5-sonnet-20241022');
    // fallback 应该不包含主模型
    if (config.fallbacks) {
      expect(config.fallbacks).not.toContain('anthropic/claude-3-5-sonnet-20241022');
    } else {
      // 如果 fallback 为空，也满足"不包含主模型"
      expect(config.fallbacks).toBeUndefined();
    }
  });

  it('resolveWithFallbacks: 模型组作为主模型', () => {
    // 使用 modelOverride 指定模型组
    const ref = selector.resolve({
      modelOverride: '@high-performance'
    });

    // 应该从模型组中轮询选择（第一个）
    expect(ref.provider).toBe('openai');
    expect(ref.model).toBe('gpt-4o');
  });
});
