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

vi.mock('@main/ai/shared-drive/SharedDriveStore', () => ({
  SharedDriveStore: {
    getInstance: vi.fn().mockResolvedValue({
      list: vi.fn().mockResolvedValue([])
    })
  }
}));

vi.mock('@main/common/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn()
  }
}));

import taskRouterModule from '../index';

describe('TaskRouter (方案 B: LLM 驱动分发)', () => {
  let tempDir: string;
  let mockApi: Record<string, unknown>;
  let registeredEventHandlers: Map<string, ((...args: unknown[]) => void)[]>;

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
    it('should register event listener on agent:done', async () => {
      await taskRouterModule.register(mockApi as never);

      expect(mockApi.eventBus).toBeDefined();
      expect((mockApi.eventBus as Record<string, unknown>).on).toHaveBeenCalledWith('agent:done', expect.any(Function));
    });

    it('should unregister event listener on unregister', async () => {
      await taskRouterModule.register(mockApi as never);
      taskRouterModule.unregister();

      expect((mockApi.eventBus as Record<string, unknown>).off).toHaveBeenCalledWith(
        'agent:done',
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

  describe('shouldDispatch (filtering logic)', () => {
    it('should skip failed events', async () => {
      await taskRouterModule.register(mockApi as never);
      const handlers = registeredEventHandlers.get('agent:done') || [];
      expect(handlers.length).toBe(1);

      const handler = handlers[0];
      handler({ agentId: 'test', success: false, summary: 'some long summary text here' });

      // 不应 dispatch（no setTimeout called）
      await new Promise((r) => setTimeout(r, 100));
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it('should skip task-dispatcher events (loop prevention)', async () => {
      await taskRouterModule.register(mockApi as never);
      const handler = registeredEventHandlers.get('agent:done')![0];

      handler({
        agentId: 'task-dispatcher',
        success: true,
        summary: 'A long enough summary to pass the length check'
      });

      await new Promise((r) => setTimeout(r, 100));
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it('should skip events with short summary', async () => {
      await taskRouterModule.register(mockApi as never);
      const handler = registeredEventHandlers.get('agent:done')![0];

      handler({ agentId: 'researcher', success: true, summary: 'short' });

      await new Promise((r) => setTimeout(r, 100));
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it('should skip delegate sub-sessions', async () => {
      await taskRouterModule.register(mockApi as never);
      const handler = registeredEventHandlers.get('agent:done')![0];

      handler({
        agentId: 'researcher',
        sessionId: 'abc:delegate:xyz',
        success: true,
        summary: 'A long enough summary to pass the length check'
      });

      await new Promise((r) => setTimeout(r, 100));
      expect(mockSubmit).not.toHaveBeenCalled();
    });
  });

  describe('dispatch to task-dispatcher', () => {
    it('should create Thread and submit to task-dispatcher', async () => {
      vi.useFakeTimers();

      await taskRouterModule.register(mockApi as never);
      const handler = registeredEventHandlers.get('agent:done')![0];

      handler({
        agentId: 'researcher',
        agentName: '研究员',
        sessionId: '2839494949',
        success: true,
        durationMs: 5000,
        summary: '市场调研报告已完成，包含 Q1 数据分析和竞品对比'
      });

      // 快进到 delay 完成
      vi.advanceTimersByTime(4000);
      vi.useRealTimers();

      // 等待异步完成
      await new Promise((r) => setTimeout(r, 200));

      const { ThreadStore } = await import('@main/ai/threads/ThreadStore');
      const threadStore = await ThreadStore.getInstance();
      expect(threadStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'task-dispatcher',
          title: expect.stringContaining('研究员')
        })
      );

      expect(mockPiMono).toHaveBeenCalled();
      expect(mockSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: '123456789',
          message: expect.stringContaining('市场调研报告已完成')
        })
      );
    });
  });

  describe('config disabling', () => {
    it('should respect enabled=false in config', async () => {
      const config = { enabled: false };
      fs.writeFileSync(path.join(tempDir, 'task-routes.json'), JSON.stringify(config), 'utf-8');

      await taskRouterModule.register(mockApi as never);
      const handler = registeredEventHandlers.get('agent:done')![0];

      handler({
        agentId: 'researcher',
        success: true,
        summary: 'Long enough summary for dispatch check'
      });

      await new Promise((r) => setTimeout(r, 100));
      expect(mockSubmit).not.toHaveBeenCalled();
    });
  });

  describe('buildDispatchMessage', () => {
    it('should include sharedDriveEntryId when present', async () => {
      vi.useFakeTimers();

      await taskRouterModule.register(mockApi as never);
      const handler = registeredEventHandlers.get('agent:done')![0];

      handler({
        agentId: 'researcher',
        agentName: 'Researcher',
        sessionId: '999',
        success: true,
        durationMs: 3000,
        summary: 'Task completed with shared drive entry',
        sharedDriveEntryId: 'entry-001'
      });

      vi.advanceTimersByTime(4000);
      vi.useRealTimers();

      await new Promise((r) => setTimeout(r, 200));

      expect(mockSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('entry-001')
        })
      );
    });
  });
});
