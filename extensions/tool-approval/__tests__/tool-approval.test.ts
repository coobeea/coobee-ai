/**
 * tool-approval Extension 单元测试
 *
 * 覆盖：
 *   - session_start/session_end hooks（计数器管理）
 *   - ExecPolicy 检查（allow/deny/ask）
 *   - needUserConfirm 处理
 *   - 异步模式（suspend + hitl:required）
 *   - 同步模式（waitForSingleDecision）
 *   - 审批超时
 *   - approve-always 学习
 *   - 错误处理
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { ExtensionApi } from '../../../src/main/common/extension';
import toolApprovalExtension from '../index';

// ==================== Mocks ====================

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
};

const mockHitlCleanupSession = vi.fn().mockResolvedValue(undefined);
const mockHitlWaitForSingleDecision = vi.fn();

const mockEventsEmit = vi.fn();

const mockExecPolicyCheck = vi.fn();
const mockExecPolicyLearn = vi.fn();

const mockConfigGet = vi.fn();

const mockAgentEventWriter = {
  dispatchForSession: vi.fn()
};

// Mock ExecPolicy
vi.mock('../../../src/main/ai/sandbox/exec-policy', () => ({
  checkExecPolicy: mockExecPolicyCheck,
  learnExecCommand: mockExecPolicyLearn
}));

// Mock ConfigStore
vi.mock('../../../src/main/common/config/ConfigStore', () => ({
  configStoreInstance: {
    get: mockConfigGet
  }
}));

// Mock AgentEventWriter
vi.mock('../../../src/main/ai/AgentEventWriter', () => ({
  AgentEventWriter: mockAgentEventWriter
}));

// ==================== Test Helpers ====================

interface MockApi extends ExtensionApi {
  getRegisteredHook: (hookName: string) => ((...args: unknown[]) => Promise<unknown>) | undefined;
}

function createMockApi(): MockApi {
  const hooks = new Map<string, Array<{ handler: (...args: unknown[]) => Promise<unknown>; priority: number }>>();

  return {
    id: 'tool-approval',
    logger: mockLogger,
    services: {
      hitl: {
        cleanupSession: mockHitlCleanupSession,
        waitForSingleDecision: mockHitlWaitForSingleDecision as Mock
      },
      events: {
        emit: mockEventsEmit
      }
    },
    on(hookName: string, handler: (...args: unknown[]) => Promise<unknown>, options?: { priority?: number }) {
      if (!hooks.has(hookName)) hooks.set(hookName, []);
      hooks.get(hookName)!.push({ handler, priority: options?.priority ?? 0 });
    },
    getRegisteredHook(hookName: string) {
      return hooks.get(hookName)?.[0]?.handler;
    }
  } as unknown as MockApi;
}

function resetAllMocks(): void {
  vi.clearAllMocks();
  // 默认配置：异步模式enabled
  mockConfigGet.mockImplementation((key) => {
    if (key === 'security') {
      return { approvals: { asyncMode: true, timeoutMs: 300_000 } };
    }
    return undefined;
  });
  mockExecPolicyCheck.mockReturnValue({ action: 'ask', reason: 'default' });
}

// ==================== Tests ====================

describe('tool-approval Extension', () => {
  let api: MockApi;

  beforeEach(async () => {
    resetAllMocks();
    api = createMockApi();

    // 重新注册 extension（这会重置所有 hooks）
    toolApprovalExtension.register(api);

    // 触发 session_start 来重置计数器
    const sessionStart = api.getRegisteredHook('session_start');
    if (sessionStart) {
      await sessionStart({ sessionId: 'test' });
    }
  });

  // ========== session_start / session_end ==========

  describe('session lifecycle hooks', () => {
    it('session_start 重置计数器', async () => {
      const handler = api.getRegisteredHook('session_start');
      expect(handler).toBeDefined();

      await handler({ sessionId: 'test-session' });
      // 无法直接断言 Map.delete，但后续测试会验证计数器从 0 开始
    });

    it('session_end 清理 pending + 重置计数器', async () => {
      const handler = api.getRegisteredHook('session_end');
      expect(handler).toBeDefined();

      await handler({ sessionId: 'test-session' });

      expect(mockHitlCleanupSession).toHaveBeenCalledWith('test-session');
    });

    it('session_end 清理失败不抛错', async () => {
      mockHitlCleanupSession.mockRejectedValueOnce(new Error('cleanup failed'));
      const handler = api.getRegisteredHook('session_end');

      await expect(handler({ sessionId: 'test-session' })).resolves.not.toThrow();
    });
  });

  // ========== ExecPolicy 检查 ==========

  describe('ExecPolicy for exec tool', () => {
    it('allow → 直接放行，无需审批', async () => {
      mockExecPolicyCheck.mockReturnValue({ action: 'allow', reason: 'whitelisted' });

      const handler = api.getRegisteredHook('before_tool_call');
      const result = await handler({
        sessionId: 'test',
        toolName: 'exec',
        params: { command: 'ls' },
        needUserConfirm: false
      });

      expect(result).toBeUndefined(); // 放行
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('ExecPolicy allow'));
      expect(mockEventsEmit).not.toHaveBeenCalled(); // 无需 hitl:required
    });

    it('deny → 阻止执行', async () => {
      mockExecPolicyCheck.mockReturnValue({ action: 'deny', reason: 'dangerous command' });

      const handler = api.getRegisteredHook('before_tool_call');
      const result = await handler({
        sessionId: 'test',
        toolName: 'exec',
        params: { command: 'rm -rf /' },
        needUserConfirm: false
      });

      expect(result).toEqual({
        block: true,
        blockReason: 'Command rejected by security policy: dangerous command'
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('ExecPolicy deny'));
      expect(mockEventsEmit).not.toHaveBeenCalled();
    });

    it('ask + 异步模式 → 发送 hitl:required + suspend', async () => {
      mockExecPolicyCheck.mockReturnValue({ action: 'ask', reason: 'needs approval' });
      // 默认就是异步模式，无需特别设置

      const handler = api.getRegisteredHook('before_tool_call');
      const result = await handler({
        sessionId: 'test',
        toolName: 'exec',
        params: { command: 'sudo systemctl restart nginx' },
        needUserConfirm: false
      });

      expect(mockEventsEmit).toHaveBeenCalledWith('test', {
        type: 'hitl:required',
        content: 'Approval required: exec',
        data: {
          index: 0,
          toolName: 'exec',
          arguments: expect.any(String),
          action: 'required',
          approvalId: 'test:0'
        }
      });

      expect(result).toEqual({
        suspend: true,
        suspendReason: 'approval-pending:test:0:exec'
      });

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Async suspend'));
    });

    it('ask + 同步模式 + approve-once → 放行', async () => {
      mockExecPolicyCheck.mockReturnValue({ action: 'ask' });
      mockConfigGet.mockImplementation((key) => {
        if (key === 'security') {
          return { approvals: { asyncMode: false, timeoutMs: 300_000 } };
        }
        return undefined;
      });
      mockHitlWaitForSingleDecision.mockResolvedValue('approve-once');

      const handler = api.getRegisteredHook('before_tool_call');
      const result = await handler({
        sessionId: 'test',
        toolName: 'exec',
        params: { command: 'git status' },
        needUserConfirm: false
      });

      expect(mockHitlWaitForSingleDecision).toHaveBeenCalledWith('test:0', 300_000); // 默认 5 分钟
      expect(mockAgentEventWriter.dispatchForSession).toHaveBeenCalledWith('test', {
        type: 'hitl:approved',
        content: 'approved: exec',
        data: { index: 0, toolName: 'exec', action: 'approved' }
      });
      expect(result).toBeUndefined(); // 放行
    });

    it('ask + 同步模式 + approve-always → 放行 + 学习', async () => {
      mockExecPolicyCheck.mockReturnValue({ action: 'ask' });
      mockConfigGet.mockImplementation((key) => {
        if (key === 'security') {
          return { approvals: { asyncMode: false, timeoutMs: 300_000 } };
        }
        return undefined;
      });
      mockHitlWaitForSingleDecision.mockResolvedValue('approve-always');

      const handler = api.getRegisteredHook('before_tool_call');
      const result = await handler({
        sessionId: 'test',
        toolName: 'exec',
        params: { command: 'npm install' },
        needUserConfirm: false
      });

      expect(mockExecPolicyLearn).toHaveBeenCalledWith('npm install');
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Learned exec command'));
      expect(result).toBeUndefined(); // 放行
    });

    it('ask + 同步模式 + reject → 阻止', async () => {
      mockExecPolicyCheck.mockReturnValue({ action: 'ask' });
      mockConfigGet.mockImplementation((key) => {
        if (key === 'security') {
          return { approvals: { asyncMode: false, timeoutMs: 300_000 } };
        }
        return undefined;
      });
      mockHitlWaitForSingleDecision.mockResolvedValue('reject');

      const handler = api.getRegisteredHook('before_tool_call');
      const result = await handler({
        sessionId: 'test',
        toolName: 'exec',
        params: { command: 'sudo apt update' },
        needUserConfirm: false
      });

      expect(mockAgentEventWriter.dispatchForSession).toHaveBeenCalledWith('test', {
        type: 'hitl:rejected',
        content: 'rejected: exec',
        data: { index: 0, toolName: 'exec', action: 'rejected' }
      });
      expect(result).toEqual({
        block: true,
        blockReason: 'User rejected tool execution'
      });
    });

    it('ask + 同步模式 + 超时 → 阻止', async () => {
      mockExecPolicyCheck.mockReturnValue({ action: 'ask' });
      mockConfigGet.mockImplementation((key) => {
        if (key === 'security') {
          return { approvals: { asyncMode: false, timeoutMs: 300_000 } };
        }
        return undefined;
      });
      mockHitlWaitForSingleDecision.mockResolvedValue(null); // 超时返回 null

      const handler = api.getRegisteredHook('before_tool_call');
      const result = await handler({
        sessionId: 'test',
        toolName: 'exec',
        params: { command: 'sleep 600' },
        needUserConfirm: false
      });

      expect(mockAgentEventWriter.dispatchForSession).toHaveBeenCalledWith('test', {
        type: 'hitl:rejected',
        content: 'rejected: exec',
        data: { index: 0, toolName: 'exec', action: 'rejected', reason: 'timeout' }
      });
      expect(result).toEqual({
        block: true,
        blockReason: 'Approval timeout — tool execution blocked'
      });
    });
  });

  // ========== needUserConfirm 非 exec 工具 ==========

  describe('needUserConfirm for non-exec tools', () => {
    it('needUserConfirm=false → 直接放行', async () => {
      const handler = api.getRegisteredHook('before_tool_call');
      const result = await handler({
        sessionId: 'test',
        toolName: 'read_file',
        params: { path: '/etc/passwd' },
        needUserConfirm: false
      });

      expect(result).toBeUndefined(); // 放行
      expect(mockEventsEmit).not.toHaveBeenCalled();
    });

    it('needUserConfirm=true + 异步模式 → suspend', async () => {
      // 默认就是异步模式

      const handler = api.getRegisteredHook('before_tool_call');
      const result = await handler({
        sessionId: 'test',
        toolName: 'delete_file',
        params: { path: '/important.txt' },
        needUserConfirm: true
      });

      expect(mockEventsEmit).toHaveBeenCalledWith('test', {
        type: 'hitl:required',
        content: 'Approval required: delete_file',
        data: {
          index: 0,
          toolName: 'delete_file',
          arguments: expect.any(String),
          action: 'required',
          approvalId: 'test:0'
        }
      });

      expect(result).toEqual({
        suspend: true,
        suspendReason: 'approval-pending:test:0:delete_file'
      });
    });

    it('needUserConfirm=true + 同步模式 + approve → 放行', async () => {
      mockConfigGet.mockImplementation((key) => {
        if (key === 'security') {
          return { approvals: { asyncMode: false, timeoutMs: 300_000 } };
        }
        return undefined;
      });
      mockHitlWaitForSingleDecision.mockResolvedValue('approve-once');

      const handler = api.getRegisteredHook('before_tool_call');
      const result = await handler({
        sessionId: 'test',
        toolName: 'send_email',
        params: { to: 'user@example.com' },
        needUserConfirm: true
      });

      expect(result).toBeUndefined(); // 放行
    });
  });

  // ========== 审批索引递增 ==========

  describe('approval index counter', () => {
    it('多次审批索引递增', async () => {
      // 默认异步模式
      const handler = api.getRegisteredHook('before_tool_call');

      // 第一次
      await handler({
        sessionId: 'test',
        toolName: 'tool1',
        params: {},
        needUserConfirm: true
      });
      expect(mockEventsEmit).toHaveBeenLastCalledWith(
        'test',
        expect.objectContaining({
          data: expect.objectContaining({ index: 0, approvalId: 'test:0' })
        })
      );

      // 第二次
      await handler({
        sessionId: 'test',
        toolName: 'tool2',
        params: {},
        needUserConfirm: true
      });
      expect(mockEventsEmit).toHaveBeenLastCalledWith(
        'test',
        expect.objectContaining({
          data: expect.objectContaining({ index: 1, approvalId: 'test:1' })
        })
      );

      // 第三次
      await handler({
        sessionId: 'test',
        toolName: 'tool3',
        params: {},
        needUserConfirm: true
      });
      expect(mockEventsEmit).toHaveBeenLastCalledWith(
        'test',
        expect.objectContaining({
          data: expect.objectContaining({ index: 2, approvalId: 'test:2' })
        })
      );
    });

    it('session_start 后索引重置为 0', async () => {
      // 默认异步模式
      const beforeToolCall = api.getRegisteredHook('before_tool_call');
      const sessionStart = api.getRegisteredHook('session_start');

      // 第一次审批
      await beforeToolCall({
        sessionId: 'test',
        toolName: 'tool1',
        params: {},
        needUserConfirm: true
      });
      expect(mockEventsEmit).toHaveBeenLastCalledWith(
        'test',
        expect.objectContaining({
          data: expect.objectContaining({ index: 0 })
        })
      );

      // session_start 重置
      await sessionStart({ sessionId: 'test' });

      // 再次审批，索引应重置为 0
      await beforeToolCall({
        sessionId: 'test',
        toolName: 'tool2',
        params: {},
        needUserConfirm: true
      });
      expect(mockEventsEmit).toHaveBeenLastCalledWith(
        'test',
        expect.objectContaining({
          data: expect.objectContaining({ index: 0 })
        })
      );
    });
  });

  // ========== 错误处理 ==========

  describe('error handling', () => {
    it('ExecPolicy 检查失败 → 降级到 needUserConfirm', async () => {
      mockExecPolicyCheck.mockImplementation(() => {
        throw new Error('ExecPolicy error');
      });
      // 默认异步模式

      const handler = api.getRegisteredHook('before_tool_call');
      const result = await handler({
        sessionId: 'test',
        toolName: 'exec',
        params: { command: 'ls' },
        needUserConfirm: true
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('ExecPolicy check failed'));
      expect(result).toEqual({
        suspend: true,
        suspendReason: expect.any(String)
      });
    });

    it('events.emit 失败不阻断', async () => {
      mockEventsEmit.mockImplementation(() => {
        throw new Error('emit failed');
      });
      // 默认异步模式

      const handler = api.getRegisteredHook('before_tool_call');
      const result = await handler({
        sessionId: 'test',
        toolName: 'tool1',
        params: {},
        needUserConfirm: true
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to emit hitl:required'));
      expect(result).toEqual({
        suspend: true,
        suspendReason: expect.any(String)
      });
    });

    it('waitForSingleDecision 抛错 → 阻止执行', async () => {
      mockConfigGet.mockImplementation((key) => {
        if (key === 'security') {
          return { approvals: { asyncMode: false, timeoutMs: 300_000 } };
        }
        return undefined;
      });
      mockHitlWaitForSingleDecision.mockRejectedValue(new Error('wait failed'));

      const handler = api.getRegisteredHook('before_tool_call');
      const result = await handler({
        sessionId: 'test',
        toolName: 'tool1',
        params: {},
        needUserConfirm: true
      });

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Wait failed'));
      expect(result).toEqual({
        block: true,
        blockReason: 'Approval wait error — tool execution blocked'
      });
    });

    it('approve-always 学习失败不阻断', async () => {
      mockExecPolicyCheck.mockReturnValue({ action: 'ask' });
      mockConfigGet.mockImplementation((key) => {
        if (key === 'security') {
          return { approvals: { asyncMode: false, timeoutMs: 300_000 } };
        }
        return undefined;
      });
      mockHitlWaitForSingleDecision.mockResolvedValue('approve-always');
      mockExecPolicyLearn.mockImplementation(() => {
        throw new Error('learn failed');
      });

      const handler = api.getRegisteredHook('before_tool_call');
      const result = await handler({
        sessionId: 'test',
        toolName: 'exec',
        params: { command: 'echo test' },
        needUserConfirm: false
      });

      expect(result).toBeUndefined(); // 仍然放行
    });
  });

  // ========== 配置读取 ==========

  describe('configuration', () => {
    it('自定义审批超时', async () => {
      mockExecPolicyCheck.mockReturnValue({ action: 'ask' });
      mockConfigGet.mockImplementation((key) => {
        if (key === 'security') {
          return { approvals: { asyncMode: false, timeoutMs: 120_000 } };
        }
        return undefined;
      });
      mockHitlWaitForSingleDecision.mockResolvedValue('approve-once');

      const handler = api.getRegisteredHook('before_tool_call');
      await handler({
        sessionId: 'test',
        toolName: 'exec',
        params: { command: 'ls' },
        needUserConfirm: false
      });

      expect(mockHitlWaitForSingleDecision).toHaveBeenCalledWith('test:0', 120_000);
    });

    it('未配置超时 → 使用默认 300s', async () => {
      mockExecPolicyCheck.mockReturnValue({ action: 'ask' });
      mockConfigGet.mockImplementation((key) => {
        if (key === 'security') {
          return { approvals: { asyncMode: false } }; // 无 timeoutMs，应使用默认
        }
        return undefined;
      });
      mockHitlWaitForSingleDecision.mockResolvedValue('approve-once');

      const handler = api.getRegisteredHook('before_tool_call');
      await handler({
        sessionId: 'test',
        toolName: 'exec',
        params: { command: 'ls' },
        needUserConfirm: false
      });

      expect(mockHitlWaitForSingleDecision).toHaveBeenCalledWith('test:0', 300_000);
    });
  });
});
