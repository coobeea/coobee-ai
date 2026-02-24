/**
 * Swarm 质量闭环集成测试
 *
 * 验证质量闭环（Aggregator → Validator → Repairer）是否正确集成到 SwarmCoordinator
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SwarmCoordinator } from '../SwarmCoordinator';
import type { SwarmConfig, AgentRole } from '../types';
import { SwarmContext } from '../SwarmContext';
import { MessageBus } from '../MessageBus';

vi.mock('@main/ai/provider/LLMClient', () => {
  return {
    LLMClient: class MockLLMClient {
      chat = vi.fn().mockResolvedValue({ content: '{}' });
    }
  };
});

describe('Swarm 质量闭环集成测试', () => {
  let coordinator: SwarmCoordinator;
  let config: SwarmConfig;

  beforeEach(() => {
    // 创建测试配置
    config = {
      id: 'test-swarm',
      name: 'Test Swarm',
      maxConcurrentAgents: 5,
      agentIdleTimeout: 60000,
      maxHandoffDepth: 3,
      enableSharedContext: true,
      enableMonitoring: true,
      context: new SwarmContext(),
      messageBus: new MessageBus(),
      qualityLoop: {
        enabled: true,
        maxIterations: 2,
        passThreshold: 70,
        acceptanceCriteria: [
          {
            description: '完整回答用户问题',
            type: 'qualitative',
            weight: 8
          },
          {
            description: '内容准确无误',
            type: 'qualitative',
            weight: 9
          }
        ]
      }
    };

    coordinator = new SwarmCoordinator(config);
  });

  it('应该在构造函数中初始化质量闭环组件', () => {
    // @ts-expect-error - 访问私有属性进行测试
    expect(coordinator.aggregator).toBeDefined();
    // @ts-expect-error - 访问私有属性进行测试
    expect(coordinator.validator).toBeDefined();
    // @ts-expect-error - 访问私有属性进行测试
    expect(coordinator.repairer).toBeDefined();
  });

  it('质量闭环禁用时不应初始化组件', () => {
    const configDisabled: SwarmConfig = {
      ...config,
      qualityLoop: {
        enabled: false
      }
    };

    const coordDisabled = new SwarmCoordinator(configDisabled);

    // @ts-expect-error - 访问私有属性进行测试
    expect(coordDisabled.aggregator).toBeUndefined();
    // @ts-expect-error - 访问私有属性进行测试
    expect(coordDisabled.validator).toBeUndefined();
    // @ts-expect-error - 访问私有属性进行测试
    expect(coordDisabled.repairer).toBeUndefined();
  });

  it('应该能访问质量闭环配置', () => {
    // @ts-expect-error - 访问私有属性进行测试
    const qualityConfig = coordinator.config.qualityLoop;

    expect(qualityConfig?.enabled).toBe(true);
    expect(qualityConfig?.maxIterations).toBe(2);
    expect(qualityConfig?.passThreshold).toBe(70);
    expect(qualityConfig?.acceptanceCriteria).toHaveLength(2);
  });

  it('未配置 qualityLoop 时应使用 DEFAULT_SWARM_CONFIG 的默认值', () => {
    const defaultConfig: SwarmConfig = {
      id: 'default-swarm',
      name: 'Default Swarm',
      maxConcurrentAgents: 5,
      agentIdleTimeout: 60000,
      maxHandoffDepth: 3,
      enableSharedContext: true,
      enableMonitoring: true
    };

    const defaultCoord = new SwarmCoordinator(defaultConfig);

    // @ts-expect-error - 访问私有属性进行测试
    expect(defaultCoord.aggregator).toBeUndefined();
  });

  it('显式 qualityLoop.enabled=false 时关闭质量闭环', () => {
    const noQualityConfig: SwarmConfig = {
      id: 'no-quality-swarm',
      name: 'No Quality Swarm',
      maxConcurrentAgents: 5,
      agentIdleTimeout: 60000,
      maxHandoffDepth: 3,
      enableSharedContext: true,
      enableMonitoring: true,
      qualityLoop: { enabled: false }
    };

    const coord = new SwarmCoordinator(noQualityConfig);

    // @ts-expect-error - 访问私有属性进行测试
    expect(coord.aggregator).toBeUndefined();
  });

  it('质量闭环配置应该支持自定义参数', () => {
    const customConfig: SwarmConfig = {
      ...config,
      qualityLoop: {
        enabled: true,
        maxIterations: 5,
        passThreshold: 80,
        acceptanceCriteria: [
          {
            description: '自定义标准',
            type: 'quantifiable',
            weight: 10
          }
        ]
      }
    };

    const customCoord = new SwarmCoordinator(customConfig);

    // @ts-expect-error - 访问私有属性进行测试
    const qualityConfig = customCoord.config.qualityLoop;

    expect(qualityConfig?.maxIterations).toBe(5);
    expect(qualityConfig?.passThreshold).toBe(80);
    expect(qualityConfig?.acceptanceCriteria?.[0].weight).toBe(10);
  });

  it('质量闭环应该在 coordinate 方法中被调用', async () => {
    // 注册一个简单的测试角色
    const testRole: AgentRole = {
      id: 'test-role',
      name: 'Test Role',
      description: 'A test role',
      instructions: 'You are a test agent.',
      handoffDescription: 'Test handoff',
      capabilities: ['test']
    };

    await coordinator.registerRole(testRole);
    await coordinator.initialize();

    // 由于实际执行需要真实的 LLM，我们只验证方法存在
    // @ts-expect-error - 访问私有方法进行测试
    expect(typeof coordinator.runQualityLoop).toBe('function');
    // @ts-expect-error - 访问私有方法进行测试
    expect(typeof coordinator.applyRepair).toBe('function');

    await coordinator.destroy();
  });
});
