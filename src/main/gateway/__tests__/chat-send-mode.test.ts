import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mocks
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
      logPath: '/tmp'
    }
  }
}));

vi.mock('@main/common/logger', () => {
  const dummy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setConsoleLevel: vi.fn() };
  return { log: dummy, createLogger: vi.fn(() => dummy) };
});

vi.mock('@main/ai/AgentExecutor', () => {
  const submit = vi.fn(() => ({ status: 'streaming', sessionId: 'tid' }));
  const submitViaPipeline = vi.fn();
  return {
    agentExecutor: {
      submit,
      submitViaPipeline,
      abort: vi.fn(),
      setBuilderFactory: vi.fn()
    }
  };
});

const orchInit = vi.fn();
vi.mock('@main/ai/orchestration/OrchestratorRuntime', () => {
  const OrchestratorRuntime = vi.fn(function MockOrchestratorRuntime(this: Record<string, unknown>) {
    this.initialize = orchInit;
  });
  return { OrchestratorRuntime };
});

const swarmInit = vi.fn();
vi.mock('@main/ai/swarm/SwarmRuntime', () => {
  const SwarmRuntime = vi.fn(function MockSwarmRuntime(this: Record<string, unknown>) {
    this.initialize = swarmInit;
  });
  return { SwarmRuntime };
});

vi.mock('@main/ai/threads/ThreadStore', () => ({
  ThreadStore: {
    getInstance: async () => ({
      create: vi.fn().mockResolvedValue({ id: 'tid' })
    })
  }
}));

// Lazy import after mocks
import { chatMethods } from '../methods/chat';
import { agentExecutor } from '@main/ai/AgentExecutor';
import type { MethodContext } from '@main/gateway/protocol/types';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('chat.send modes', () => {
  it('uses OrchestratorRuntime when mode=orchestrator', async () => {
    const params: Record<string, unknown> = { message: 'hello', mode: 'orchestrator' };
    const ctx: MethodContext = {
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
    };
    const res = await chatMethods.methods.send(params, ctx);
    expect(orchInit).toHaveBeenCalled();
    expect(agentExecutor.submit).toHaveBeenCalledWith({
      sessionId: 'tid',
      message: 'hello',
      runtime: expect.any(Object)
    });
    expect(res).toMatchObject({ sessionId: 'tid', status: 'streaming', mode: 'orchestrator' });
  });

  it('uses SwarmRuntime when mode=swarm', async () => {
    const params: Record<string, unknown> = { message: 'hello swarm', mode: 'swarm' };
    const ctx: MethodContext = {
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
    };
    const res = await chatMethods.methods.send(params, ctx);
    expect(swarmInit).toHaveBeenCalled();
    expect(agentExecutor.submit).toHaveBeenCalledWith({
      sessionId: 'tid',
      message: 'hello swarm',
      runtime: expect.any(Object)
    });
    expect(res).toMatchObject({ sessionId: 'tid', status: 'streaming', mode: 'swarm' });
  });
});
