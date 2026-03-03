import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const mockEnvPaths = vi.hoisted(() => ({
  configDir: '',
  secretsDir: ''
}));

vi.mock('@main/common/env', () => ({
  Env: { paths: mockEnvPaths }
}));

vi.mock('@main/common/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}));

const mockSubmit = vi.fn().mockReturnValue({ status: 'accepted', sessionId: 'test-session' });
const mockPiMono = vi.fn().mockReturnValue({
  name: vi.fn().mockReturnThis(),
  mode: vi.fn().mockReturnThis(),
  sessionMode: vi.fn().mockReturnThis(),
  instructions: vi.fn().mockReturnThis(),
  tools: vi.fn().mockReturnThis(),
  skills: vi.fn().mockReturnThis(),
  model: vi.fn().mockReturnThis(),
  thinkingLevel: vi.fn().mockReturnThis()
});

vi.mock('@main/ai/AgentExecutor', () => ({
  agentExecutor: {
    submit: mockSubmit,
    piMono: mockPiMono
  }
}));

vi.mock('@main/ai/agents/AgentStore', () => ({
  AgentStore: {
    getInstance: vi.fn().mockResolvedValue({
      get: vi.fn().mockResolvedValue({
        id: 'task-dispatcher',
        name: '任务分发员',
        instructions: 'test instructions',
        tools: ['delegate_to_agent'],
        skills: []
      })
    })
  }
}));

vi.mock('@main/ai/threads/ThreadStore', () => ({
  ThreadStore: {
    getInstance: vi.fn().mockResolvedValue({
      create: vi.fn().mockResolvedValue({
        id: '123456789',
        sessionId: '123456789'
      })
    })
  }
}));

vi.mock('@main/ai/tools', () => ({
  builtinTools: [{ name: 'delegate_to_agent', description: 'test', execute: vi.fn() }]
}));

vi.mock('@main/ai/tools/registry', () => ({
  ToolRegistry: {
    getInstance: () => ({
      getAll: () => []
    })
  }
}));

vi.mock('@main/ai/skills', () => ({
  SkillManager: vi.fn().mockImplementation(() => ({
    scanSkills: vi.fn(),
    getByName: vi.fn().mockReturnValue(null)
  }))
}));

vi.mock('@main/common/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn()
  }
}));

import taskRouterModule from '../index';

describe('TaskRouter (方案 B: 监听 shared-drive:entry-created)', () => {
  let tempDir: string;
  let mockApi: Record<string, unknown>;
  let registeredEventHandlers: Map<string, ((...args: unknown[]) => void)[]>;

  function makeEntryPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      entryId: 'entry-001',
      agentId: 'researcher',
      topic: 'market-analysis-q1',
      date: '2026-03-03',
      tags: ['market', 'q1'],
      summary: '市场调研报告已完成',
      path: 'researcher/2026-03-03/market-analysis-q1',
      timestamp: Date.now(),
      ...overrides
    };
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-router-test-'));
    mockEnvPaths.configDir = tempDir;
    mockEnvPaths.secretsDir = tempDir;

    registeredEventHandlers = new Map();

    mockApi = {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      eventBus: {
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          const handlers = registeredEventHandlers.get(event) || [];
          handlers.push(handler);
          registeredEventHandlers.set(event, handlers);
        }),
        off: vi.fn(),
        emit: vi.fn()
      },
      registerChannel: vi.fn()
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    taskRouterModule.unregister();
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('register/unregister', () => {
    it('should register event listener on shared-drive:entry-created', async () => {
      await taskRouterModule.register(mockApi as never);

      expect((mockApi.eventBus as Record<string, unknown>).on).toHaveBeenCalledWith(
        'shared-drive:entry-created',
        expect.any(Function)
      );
    });

    it('should unregister event listener on unregister', async () => {
      await taskRouterModule.register(mockApi as never);
      taskRouterModule.unregister();

      expect((mockApi.eventBus as Record<string, unknown>).off).toHaveBeenCalledWith(
        'shared-drive:entry-created',
        expect.any(Function)
      );
    });

    it('should register a channel', async () => {
      await taskRouterModule.register(mockApi as never);

      expect((mockApi as Record<string, unknown>).registerChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'task-router-channel',
          name: 'Task Router Channel'
        })
      );
    });
  });

  describe('shouldDispatch (filtering)', () => {
    it('should skip task-dispatcher own entries (loop prevention)', async () => {
      await taskRouterModule.register(mockApi as never);
      const handler = registeredEventHandlers.get('shared-drive:entry-created')![0];

      handler(makeEntryPayload({ agentId: 'task-dispatcher' }));

      await new Promise((r) => setTimeout(r, 100));
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it('should skip entries with too-short topic', async () => {
      await taskRouterModule.register(mockApi as never);
      const handler = registeredEventHandlers.get('shared-drive:entry-created')![0];

      handler(makeEntryPayload({ topic: 'ab' }));

      await new Promise((r) => setTimeout(r, 100));
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it('should accept valid entry-created events', async () => {
      vi.useFakeTimers();

      await taskRouterModule.register(mockApi as never);
      const handler = registeredEventHandlers.get('shared-drive:entry-created')![0];

      handler(makeEntryPayload());

      vi.advanceTimersByTime(3000);
      vi.useRealTimers();

      await new Promise((r) => setTimeout(r, 200));
      expect(mockSubmit).toHaveBeenCalled();
    });
  });

  describe('dispatch to task-dispatcher', () => {
    it('should create Thread and submit with entry info', async () => {
      vi.useFakeTimers();

      await taskRouterModule.register(mockApi as never);
      const handler = registeredEventHandlers.get('shared-drive:entry-created')![0];

      handler(
        makeEntryPayload({
          entryId: 'entry-42',
          agentId: 'researcher',
          topic: 'competitive-analysis'
        })
      );

      vi.advanceTimersByTime(3000);
      vi.useRealTimers();

      await new Promise((r) => setTimeout(r, 200));

      const { ThreadStore } = await import('@main/ai/threads/ThreadStore');
      const threadStore = await ThreadStore.getInstance();
      expect(threadStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'task-dispatcher',
          title: expect.stringContaining('researcher')
        })
      );

      expect(mockPiMono).toHaveBeenCalled();
      expect(mockSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: '123456789',
          message: expect.stringContaining('entry-42')
        })
      );
    });

    it('should include summary and tags in dispatch message', async () => {
      vi.useFakeTimers();

      await taskRouterModule.register(mockApi as never);
      const handler = registeredEventHandlers.get('shared-drive:entry-created')![0];

      handler(
        makeEntryPayload({
          summary: '这是一份详细的市场分析报告',
          tags: ['market', 'report']
        })
      );

      vi.advanceTimersByTime(3000);
      vi.useRealTimers();

      await new Promise((r) => setTimeout(r, 200));

      expect(mockSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('市场分析报告')
        })
      );
    });
  });

  describe('config disabling', () => {
    it('should respect enabled=false in config', async () => {
      fs.writeFileSync(path.join(tempDir, 'task-routes.json'), JSON.stringify({ enabled: false }), 'utf-8');

      await taskRouterModule.register(mockApi as never);
      const handler = registeredEventHandlers.get('shared-drive:entry-created')![0];

      handler(makeEntryPayload());

      await new Promise((r) => setTimeout(r, 100));
      expect(mockSubmit).not.toHaveBeenCalled();
    });
  });
});
