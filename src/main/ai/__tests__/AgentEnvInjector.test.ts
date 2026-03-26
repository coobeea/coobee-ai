import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock env globally before importing modules that depend on it
vi.mock('@main/common/env', () => ({
  Env: {
    main: { logLevel: 'info' },
    paths: {
      configDir: '/mock/config',
      logs: '/mock/logs',
      userHome: '/mock/home',
      temp: '/mock/temp',
      homesDir: '/mock/homes',
      agentsMdPath: '/mock/home/AGENTS.md'
    },
    getAgentWorkspaceDir: vi.fn().mockResolvedValue('/mock/workspace'),
    getAgentHomeDir: vi.fn().mockReturnValue('/mock/homes/test')
  }
}));

vi.mock('../agents/AgentHomeManager', () => ({
  AgentHomeManager: class {
    initHome = vi.fn().mockReturnValue('/mock/homes/test');
    readInjectableFiles = vi.fn().mockReturnValue(undefined);
    readAgentsMd = vi.fn().mockReturnValue(undefined);
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

vi.mock('../skills', () => ({
  SkillManager: class {
    size = 1;
    scanSkills = vi.fn();
    getByName = vi.fn().mockReturnValue(undefined);
    static setCurrent = vi.fn();
  }
}));

vi.mock('../skills/CoreSkills', () => ({
  CORE_SKILLS: []
}));

vi.mock('../sandbox', () => ({
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
      getAgentId: vi.fn().mockReturnValue(undefined),
      appendInstructions: vi.fn(),
      skills: vi.fn(),
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
      userHome: '/mock/home'
    });
  });

  it('should inject full environment for agent mode', async () => {
    const result = await injectEnv('session-123', mockBuilder);
    expect(result).toBe('/mock/workspace');
    expect(mockBuilder.sessionDir).toHaveBeenCalled();
    expect(mockBuilder.workspaceRoot).toHaveBeenCalledWith('/mock/workspace');
    expect(mockBuilder.contextDir).toHaveBeenCalled();

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
    expect(mockBuilder.sessionDir).toHaveBeenCalled();
    expect(mockBuilder.workspaceRoot).toHaveBeenCalledWith('/mock/workspace');
    expect(mockBuilder.contextDir).toHaveBeenCalled();

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
