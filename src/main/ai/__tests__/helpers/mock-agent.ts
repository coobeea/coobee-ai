/**
 * Mock helpers for @openai/agents SDK
 * 用于测试中 mock Agent、run、tool、handoff 等 SDK 函数
 */
import { vi } from 'vitest';

/**
 * Mock RunResult 返回值
 */
export function createMockRunResult(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    finalOutput: 'mocked output',
    lastAgent: null,
    newItems: [],
    history: [],
    lastResponseId: 'resp_mock_001',
    ...overrides
  };
}

/**
 * Mock Agent 配置
 */
export function createMockAgent(config?: Record<string, unknown>): Record<string, unknown> {
  return {
    name: 'MockAgent',
    instructions: 'You are a mock agent.',
    model: 'gpt-4o',
    tools: [],
    handoffs: [],
    ...config
  };
}

/**
 * 设置 @openai/agents mock
 * 在测试文件顶部调用 vi.mock('@openai/agents', ...) 时使用
 */
export function createAgentsSdkMock(): Record<string, unknown> {
  return {
    Agent: vi.fn().mockImplementation((config: Record<string, unknown>) => ({
      ...config,
      name: config.name || 'MockAgent',
      instructions: config.instructions || '',
      tools: config.tools || [],
      handoffs: config.handoffs || []
    })),
    run: vi.fn().mockResolvedValue(createMockRunResult()),
    tool: vi.fn().mockImplementation((config: Record<string, unknown>) => ({
      type: 'function',
      name: config.name,
      description: config.description,
      parameters: config.parameters,
      execute: config.execute
    })),
    handoff: vi.fn().mockImplementation((agent: unknown, opts?: Record<string, unknown>) => ({
      type: 'handoff',
      agent,
      toolNameOverride: opts?.toolNameOverride,
      toolDescriptionOverride: opts?.toolDescriptionOverride,
      onHandoff: opts?.onHandoff
    }))
  };
}
