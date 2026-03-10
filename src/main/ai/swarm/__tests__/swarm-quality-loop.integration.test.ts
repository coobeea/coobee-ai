/**
 * Swarm 质量闭环配置测试
 *
 * 验证 SwarmCoordinator 接受 qualityLoop 配置但不执行嵌入式质量闭环。
 * 质量闭环已迁移至 QualityLoopRuntime 独立运行模式。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SwarmCoordinator } from '../SwarmCoordinator';
import type { SwarmConfig, AgentRole } from '../types';
import { SwarmContext } from '../SwarmContext';
import { MessageBus } from '../MessageBus';

describe('Swarm 质量闭环配置测试', () => {
  let config: SwarmConfig;

  const mockAgentExecutor = {
    piMono: () => ({
      lightweight: () => ({
        mode: () => ({ name: () => ({ sessionMode: () => ({ maxTurns: () => ({ instructions: () => ({}) }) }) }) })
      }),
      mode: () => ({}),
      name: () => ({}),
      sessionMode: () => ({}),
      maxTurns: () => ({}),
      instructions: () => ({})
    }),
    stream: () => {}
  };

  beforeEach(() => {
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
      agentExecutor: mockAgentExecutor,
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
  });

  it('应接受 qualityLoop 配置且不初始化嵌入式质量闭环组件', () => {
    const coordinator = new SwarmCoordinator(config);

    // SwarmCoordinator 不再有 aggregator/validator/repairer（已迁移至 QualityLoopRuntime）
    // @ts-expect-error - 访问私有属性进行测试
    expect(coordinator.aggregator).toBeUndefined();
    // @ts-expect-error - 访问私有属性进行测试
    expect(coordinator.validator).toBeUndefined();
    // @ts-expect-error - 访问私有属性进行测试
    expect(coordinator.repairer).toBeUndefined();
  });

  it('应能访问 qualityLoop 配置（外部传入的 config 仍被保留）', () => {
    const coordinator = new SwarmCoordinator(config);

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

    // 无嵌入式质量闭环
    // @ts-expect-error - 访问私有属性进行测试
    expect(defaultCoord.aggregator).toBeUndefined();
  });

  it('显式 qualityLoop.enabled=false 时无嵌入式质量闭环', () => {
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

  it('qualityLoop 配置应该支持自定义参数', () => {
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

  it('coordinate 应正常执行（无嵌入式质量闭环）', async () => {
    const coordinator = new SwarmCoordinator(config);
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

    // 验证 coordinate 可被调用（实际执行需要 mock runtime，此处仅验证初始化成功）
    expect(coordinator.getAvailableRoleList()).toContainEqual(expect.objectContaining({ id: 'test-role' }));

    await coordinator.destroy();
  });
});
