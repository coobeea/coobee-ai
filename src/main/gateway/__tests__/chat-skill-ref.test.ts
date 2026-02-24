import { describe, expect, it, vi, beforeEach } from 'vitest';

// Track appendInstructions calls on the builder mock
const appendInstructionsCalls: string[][] = [];

vi.mock('@main/common/env', () => ({
  Env: {
    main: {
      logLevel: 'info',
      logMaxSize: 10485760
    },
    paths: {
      builtinSkillsDir: '/tmp/builtin-skills',
      userSkillsDir: '/tmp/user-skills',
      configDir: '/tmp/config',
      logPath: '/tmp',
      secretsDir: '/tmp/secrets'
    }
  }
}));

vi.mock('@main/common/logger', () => {
  const dummy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setConsoleLevel: vi.fn() };
  return { log: dummy, createLogger: vi.fn(() => dummy) };
});

vi.mock('@main/ai/AgentExecutor', () => {
  const mockBuilder = {
    name: vi.fn().mockReturnThis(),
    mode: vi.fn().mockReturnThis(),
    sessionMode: vi.fn().mockReturnThis(),
    instructions: vi.fn().mockReturnThis(),
    tools: vi.fn().mockReturnThis(),
    skills: vi.fn().mockReturnThis(),
    model: vi.fn().mockReturnThis(),
    thinkingLevel: vi.fn().mockReturnThis(),
    appendInstructions: vi.fn((...args: string[]) => {
      appendInstructionsCalls.push(args);
      return mockBuilder;
    })
  };

  const submit = vi.fn(() => ({ status: 'streaming', sessionId: 'tid' }));
  const submitViaPipeline = vi.fn().mockResolvedValue(null);

  return {
    agentExecutor: {
      submit,
      submitViaPipeline,
      abort: vi.fn(),
      setBuilderFactory: vi.fn(),
      piMono: vi.fn(() => mockBuilder),
      applyProviderConfig: vi.fn()
    }
  };
});

vi.mock('@main/ai/orchestration/OrchestratorRuntime', () => ({
  OrchestratorRuntime: vi.fn()
}));

vi.mock('@main/ai/swarm/SwarmRuntime', () => ({
  SwarmRuntime: vi.fn()
}));

vi.mock('@main/ai/threads/ThreadStore', () => ({
  ThreadStore: {
    getInstance: async () => ({
      create: vi.fn().mockResolvedValue({ id: 'tid' })
    })
  }
}));

vi.mock('@main/ai/agents/AgentStore', () => ({
  AgentStore: {
    getInstance: async () => ({
      get: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue([])
    })
  }
}));

vi.mock('@main/ai/tools', () => ({ builtinTools: [] }));
vi.mock('@main/ai/tools/registry', () => ({
  ToolRegistry: { getInstance: () => ({ getAll: () => [] }) }
}));

const mockScanSkills = vi.fn().mockReturnValue([]);
vi.mock('@main/ai/skills', () => {
  return {
    SkillManager: vi.fn(function MockSkillManager(this: Record<string, unknown>) {
      this.scanSkills = mockScanSkills;
      this.getAll = vi.fn().mockReturnValue([]);
      this.size = 0;
    })
  };
});

import { chatMethods } from '../methods/chat';
import type { MethodContext } from '@main/gateway/protocol/types';

const makeCtx = (): MethodContext => ({
  clientId: 'test',
  ws: {} as unknown as MethodContext['ws'],
  meta: {
    connectionId: 'c1',
    connectedAt: Date.now(),
    isAlive: true,
    heartbeatTimer: null,
    subscribedSessions: new Set<string>()
  },
  gateway: {} as unknown as MethodContext['gateway']
});

beforeEach(() => {
  vi.clearAllMocks();
  appendInstructionsCalls.length = 0;
});

describe('chat.send skillRef injection', () => {
  it('injects skill content when skillRef is provided and skill exists', async () => {
    mockScanSkills.mockReturnValue([
      {
        name: 'brain-sync',
        description: 'Brain Sync skill',
        content: '# Brain Sync\n\nSync experience from EvoMap.',
        filePath: '/tmp/builtin-skills/brain-sync/SKILL.md'
      }
    ]);

    const params = { message: '请按照 brain-sync 技能执行', skillRef: 'brain-sync' };
    const res = await chatMethods.methods.send(params, makeCtx());

    expect(res).toMatchObject({ sessionId: 'tid', status: 'streaming' });

    const injected = appendInstructionsCalls.find((args) =>
      args.some((arg) => arg.includes('<active_skill name="brain-sync">'))
    );
    expect(injected).toBeDefined();

    const skillBlock = injected!.find((arg) => arg.includes('<active_skill'));
    expect(skillBlock).toContain('You MUST strictly follow the instructions');
    expect(skillBlock).toContain('Brain Sync');
    expect(skillBlock).toContain('Sync experience from EvoMap.');
  });

  it('does not inject when skillRef is not provided', async () => {
    const params = { message: 'hello' };
    await chatMethods.methods.send(params, makeCtx());

    const injected = appendInstructionsCalls.find((args) =>
      args.some((arg) => typeof arg === 'string' && arg.includes('<active_skill'))
    );
    expect(injected).toBeUndefined();
  });

  it('skips injection gracefully when skillRef skill is not found', async () => {
    mockScanSkills.mockReturnValue([]);

    const params = { message: 'do something', skillRef: 'nonexistent-skill' };
    const res = await chatMethods.methods.send(params, makeCtx());

    expect(res).toMatchObject({ sessionId: 'tid', status: 'streaming' });

    const injected = appendInstructionsCalls.find((args) =>
      args.some((arg) => typeof arg === 'string' && arg.includes('<active_skill'))
    );
    expect(injected).toBeUndefined();
  });
});
