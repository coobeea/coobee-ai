import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock env globally before importing modules that depend on it
vi.mock('@main/common/env', () => ({
  Env: {
    main: { logLevel: 'info' },
    paths: {
      configDir: '/mock/config',
      logs: '/mock/logs',
      userHome: '/mock/home',
      memoryDir: '/mock/memory',
      temp: '/mock/temp'
    },
    getAgentWorkspaceDir: vi.fn().mockResolvedValue('/mock/workspace')
  }
}));

vi.mock('@main/common/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: console.warn,
    error: console.error,
    debug: vi.fn()
  }),
  log: {
    info: vi.fn(),
    warn: console.warn,
    error: console.error,
    debug: vi.fn()
  }
}));

import { injectEnv } from '../AgentEnvInjector';
import * as envModule from '@main/common/env';

import * as agentEnvModule from '../AgentEnv';

vi.mock('../AgentEnv', () => ({
  buildAgentEnv: vi.fn(),
  formatRuntimePaths: vi.fn().mockReturnValue('<runtime_paths />')
}));

vi.mock('../skills/SkillManager', () => {
  return {
    SkillManager: class {
      size = 1;
      scanSkills = vi.fn();
      getByName = vi.fn().mockReturnValue(undefined);
      static setCurrent = vi.fn();
    }
  };
});

vi.mock('../runtime/shared/sandbox', () => ({
  createPathOnlyContext: vi.fn().mockReturnValue({ mode: 'path-only' }),
  resolveSandboxContext: vi.fn()
}));

vi.mock('../agents/AgentStore', () => ({
  AgentStore: {
    getInstance: vi.fn().mockResolvedValue({
      list: vi.fn().mockResolvedValue([{ id: 'test-agent', name: 'Test Agent', description: 'A test agent' }])
    })
  }
}));

describe('AgentEnvInjector', () => {
  let mockBuilder: any; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeEach(() => {
    vi.clearAllMocks();
    mockBuilder = {
      getMode: vi.fn().mockReturnValue('agent'),
      getName: vi.fn().mockReturnValue('mock-builder'),
      appendInstructions: vi.fn(),
      sandboxContext: vi.fn(),
      sessionDir: vi.fn(),
      workspaceRoot: vi.fn(),
      contextDir: vi.fn()
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (envModule.Env.getAgentWorkspaceDir as any).mockResolvedValue('/mock/workspace');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agentEnvModule.buildAgentEnv as any).mockResolvedValue({
      workspace: '/mock/workspace',
      skillPaths: ['/mock/skills'],
      sessionId: 'session-123',
      configDir: '/mock/config',
      userHome: '/mock/home',
      memoryDir: '/mock/memory'
    });
  });

  it('should inject full environment for agent mode', async () => {
    const result = await injectEnv('session-123', mockBuilder);
    expect(result).toBe('/mock/workspace');
    expect(mockBuilder.sessionDir).toHaveBeenCalledWith('/mock/workspace/sessions');
    expect(mockBuilder.workspaceRoot).toHaveBeenCalledWith('/mock/workspace');
    expect(mockBuilder.contextDir).toHaveBeenCalledWith('/mock/workspace/contexts');

    expect(mockBuilder.appendInstructions).toHaveBeenCalled();
    expect(mockBuilder.sandboxContext).toHaveBeenCalled();

    const appendArgs = mockBuilder.appendInstructions.mock.calls[0];
    expect(appendArgs.length).toBeGreaterThanOrEqual(2);
    expect(appendArgs[0]).toContain('<execution_protocol>');
    expect(appendArgs[1]).toBe('<runtime_paths />');
  });

  it('should not reference manage_agent in agent discovery', async () => {
    const result = await injectEnv('session-123', mockBuilder);
    expect(result).toBe('/mock/workspace');

    const allArgs = mockBuilder.appendInstructions.mock.calls[0];
    const fullText = allArgs.join(' ');
    expect(fullText).not.toContain('manage_agent');
  });

  it('should inject partial environment for chat mode', async () => {
    mockBuilder.getMode.mockReturnValue('chat');

    const result = await injectEnv('session-123', mockBuilder);

    expect(result).toBe('/mock/workspace');
    expect(mockBuilder.sessionDir).toHaveBeenCalledWith('/mock/workspace/sessions');
    expect(mockBuilder.workspaceRoot).toHaveBeenCalledWith('/mock/workspace');
    expect(mockBuilder.contextDir).toHaveBeenCalledWith('/mock/workspace/contexts');

    expect(mockBuilder.appendInstructions).not.toHaveBeenCalled();
    expect(mockBuilder.sandboxContext).not.toHaveBeenCalled();
  });

  it('should return undefined if error occurs', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (envModule.Env.getAgentWorkspaceDir as any).mockRejectedValue(new Error('Test error'));

    const result = await injectEnv('session-123', mockBuilder);
    expect(result).toBeUndefined();
  });
});
