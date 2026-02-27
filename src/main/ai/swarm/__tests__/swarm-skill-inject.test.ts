/**
 * Swarm Skill 注入集成测试
 *
 * 验证 SwarmCoordinator 的 createTriageRuntime() 和 createRoleRuntime()
 * 使用 mode('agent') 并调用 injectEnv() 注入 Skill 和执行协议
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@main/common/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('@main/ai/provider/LLMService', () => ({
  LLMService: class MockLLMService {
    chat = vi.fn().mockResolvedValue({ content: '{}' });
  }
}));

// 跟踪 injectEnv 是否被调用
const mockInjectEnv = vi.fn().mockResolvedValue('/mock/workspace');
vi.mock('@main/ai/AgentEnvInjector', () => ({
  injectEnv: (...args: unknown[]) => mockInjectEnv(...args)
}));

// Mock AgentExecutor 返回 builder
const mockBuild = vi.fn().mockResolvedValue({
  run: vi.fn().mockResolvedValue({ output: 'test', chunks: [] }),
  stream: vi.fn(),
  destroy: vi.fn()
});

const mockBuilder = {
  name: vi.fn().mockReturnThis(),
  mode: vi.fn().mockReturnThis(),
  sessionMode: vi.fn().mockReturnThis(),
  instructions: vi.fn().mockReturnThis(),
  sessionId: vi.fn().mockReturnThis(),
  model: vi.fn().mockReturnThis(),
  tools: vi.fn().mockReturnThis(),
  build: mockBuild,
  getMode: vi.fn().mockReturnValue('agent')
};

vi.mock('@main/ai/AgentExecutor', () => ({
  agentExecutor: {
    piMono: vi.fn().mockReturnValue(mockBuilder)
  }
}));

import { SwarmCoordinator } from '../SwarmCoordinator';
import type { SwarmConfig, AgentRole } from '../types';
import { SwarmContext } from '../SwarmContext';
import { MessageBus } from '../MessageBus';

describe('Swarm Skill 注入测试', () => {
  let config: SwarmConfig;
  let coordinator: SwarmCoordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    config = {
      id: 'test-swarm',
      name: 'Test Swarm',
      maxConcurrentAgents: 5,
      agentIdleTimeout: 60000,
      maxHandoffDepth: 3,
      enableSharedContext: true,
      enableMonitoring: true,
      qualityLoop: { enabled: true },
      agentExecutor: { piMono: vi.fn(), stream: vi.fn() },
      context: new SwarmContext(),
      messageBus: new MessageBus()
    };
    coordinator = new SwarmCoordinator(config);
  });

  it('createTriageRuntime 应使用 mode("agent")', async () => {
    const roles: AgentRole[] = [
      {
        id: 'code-expert',
        name: 'Code Expert',
        description: 'Handles code tasks',
        instructions: 'You are a code expert',
        handoffDescription: 'Transfer for code tasks',
        capabilities: ['code']
      }
    ];

    // @ts-expect-error - 访问私有方法
    await coordinator.createTriageRuntime(roles);

    expect(mockBuilder.mode).toHaveBeenCalledWith('agent');
    expect(mockInjectEnv).toHaveBeenCalledTimes(1);
    const [sessionId, builder] = mockInjectEnv.mock.calls[0];
    expect(sessionId).toContain('triage');
    expect(builder).toBe(mockBuilder);
  });

  it('createRoleRuntime 应使用 mode("agent")', async () => {
    const role: AgentRole = {
      id: 'code-expert',
      name: 'Code Expert',
      description: 'Handles code tasks',
      instructions: 'You are a code expert',
      handoffDescription: 'Transfer for code tasks',
      capabilities: ['code']
    };

    // @ts-expect-error - 访问私有方法
    await coordinator.createRoleRuntime(role, 'test-session:code-expert');

    expect(mockBuilder.mode).toHaveBeenCalledWith('agent');
    expect(mockInjectEnv).toHaveBeenCalledTimes(1);
    const [sessionId, builder] = mockInjectEnv.mock.calls[0];
    expect(sessionId).toBe('test-session:code-expert');
    expect(builder).toBe(mockBuilder);
  });

  it('createRoleRuntime 应在 injectEnv 后再 build', async () => {
    const role: AgentRole = {
      id: 'test-role',
      name: 'Test Role',
      description: 'Test',
      instructions: 'Test instructions',
      handoffDescription: 'Transfer for test',
      capabilities: ['test']
    };

    const callOrder: string[] = [];
    mockInjectEnv.mockImplementation(async () => {
      callOrder.push('injectEnv');
      return '/mock/workspace';
    });
    mockBuild.mockImplementation(async () => {
      callOrder.push('build');
      return { run: vi.fn(), stream: vi.fn(), destroy: vi.fn() };
    });

    // @ts-expect-error - 访问私有方法
    await coordinator.createRoleRuntime(role, 'test-session');

    expect(callOrder).toEqual(['injectEnv', 'build']);
  });

  it('Triage 应包含 Swarm 通信工具', async () => {
    const roles: AgentRole[] = [
      {
        id: 'role-a',
        name: 'Role A',
        description: 'Test role A',
        instructions: 'You are role A',
        handoffDescription: 'Transfer for A',
        capabilities: ['a']
      },
      {
        id: 'role-b',
        name: 'Role B',
        description: 'Test role B',
        instructions: 'You are role B',
        handoffDescription: 'Transfer for B',
        capabilities: ['b']
      }
    ];

    // @ts-expect-error - 访问私有方法
    await coordinator.createTriageRuntime(roles);

    expect(mockBuilder.tools).toHaveBeenCalled();
    const toolsArg = mockBuilder.tools.mock.calls[0][0];
    expect(Array.isArray(toolsArg)).toBe(true);
    expect(toolsArg.length).toBeGreaterThan(0);
  });
});
