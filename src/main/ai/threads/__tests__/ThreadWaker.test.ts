/**
 * ThreadWaker 单元测试
 *
 * 覆盖：
 *   - start/stop 监听管理
 *   - 审批恢复（approval-done → resume）
 *   - 拒绝恢复（reject → resume with rejection message）
 *   - 系统重启恢复（restart-recovery）
 *   - 无检查点时跳过
 *   - idle/completed 状态跳过
 *   - recoverOnStartup 扫描并发出 wake 事件
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}));

vi.mock('@main/common/logger', () => ({
  createLogger: () => mockLog
}));

const mockEventBus = vi.hoisted(() => ({
  on: vi.fn(),
  emit: vi.fn(),
  removeListener: vi.fn()
}));

vi.mock('@main/common/eventbus', () => ({
  eventBus: mockEventBus
}));

// Mock CheckpointManager
const mockCheckpointLoad = vi.fn();
const mockCheckpointUpdateStatus = vi.fn();
const mockCheckpointFindPending = vi.fn();

vi.mock('../CheckpointManager', () => ({
  CheckpointManager: {
    getInstance: () => ({
      load: mockCheckpointLoad,
      updateStatus: mockCheckpointUpdateStatus,
      findPending: mockCheckpointFindPending
    })
  }
}));

// Mock AgentExecutor
const mockSubmitViaPipeline = vi.fn().mockReturnValue({ status: 'executing', sessionId: 'test' });
const mockClearPendingApproval = vi.fn();

vi.mock('../../AgentExecutor', () => ({
  agentExecutor: {
    submitViaPipeline: mockSubmitViaPipeline,
    clearPendingApproval: mockClearPendingApproval
  }
}));

// Mock tools (for executeApprovedTool)
vi.mock('../../tools/registry', () => ({
  ToolRegistry: {
    getInstance: () => ({
      getAll: () => []
    })
  }
}));

vi.mock('../../tools/builtin', () => ({
  builtinTools: [
    {
      name: 'test-tool',
      execute: async function* () {
        yield { type: 'progress', data: '' };
        return { success: true, llmContent: 'Tool executed successfully' };
      }
    }
  ]
}));

import { ThreadWaker } from '../ThreadWaker';
import type { ThreadWakeEvent } from '../ThreadWaker';
import type { ThreadCheckpoint } from '../types';

describe('ThreadWaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ThreadWaker.resetInstance();
    mockCheckpointUpdateStatus.mockResolvedValue(undefined);
  });

  afterEach(() => {
    ThreadWaker.resetInstance();
  });

  // ========== start / stop ==========

  describe('start / stop', () => {
    it('start 注册 thread:wake 监听器', () => {
      const waker = ThreadWaker.getInstance();
      waker.start();

      expect(mockEventBus.on).toHaveBeenCalledWith('thread:wake', expect.any(Function));
    });

    it('重复 start 不重复注册', () => {
      const waker = ThreadWaker.getInstance();
      waker.start();
      waker.start();

      expect(mockEventBus.on).toHaveBeenCalledTimes(1);
    });

    it('stop 移除监听器', () => {
      const waker = ThreadWaker.getInstance();
      waker.start();
      waker.stop();

      expect(mockEventBus.removeListener).toHaveBeenCalledWith('thread:wake', expect.any(Function));
    });
  });

  // ========== handleWake ==========

  describe('handleWake', () => {
    it('无检查点时跳过', async () => {
      mockCheckpointLoad.mockResolvedValue(null);

      const waker = ThreadWaker.getInstance();
      waker.start();

      // 提取注册的 handler
      const handler = mockEventBus.on.mock.calls[0][1];
      await handler({ threadId: 'nonexistent', reason: 'approval-done' });

      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('No checkpoint'));
      expect(mockSubmitViaPipeline).not.toHaveBeenCalled();
    });

    it('idle 状态跳过', async () => {
      mockCheckpointLoad.mockResolvedValue({
        threadId: 'thread-idle',
        runStatus: 'idle',
        updatedAt: ''
      } satisfies ThreadCheckpoint);

      const waker = ThreadWaker.getInstance();
      waker.start();
      const handler = mockEventBus.on.mock.calls[0][1];
      await handler({ threadId: 'thread-idle', reason: 'approval-done' });

      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('already idle'));
      expect(mockSubmitViaPipeline).not.toHaveBeenCalled();
    });

    it('completed 状态跳过', async () => {
      mockCheckpointLoad.mockResolvedValue({
        threadId: 't',
        runStatus: 'completed',
        updatedAt: ''
      });

      const waker = ThreadWaker.getInstance();
      waker.start();
      const handler = mockEventBus.on.mock.calls[0][1];
      await handler({ threadId: 't', reason: 'approval-done' });

      expect(mockSubmitViaPipeline).not.toHaveBeenCalled();
    });
  });

  // ========== approval-done ==========

  describe('tool-done (approval resume)', () => {
    const approvalCheckpoint: ThreadCheckpoint = {
      threadId: 'thread-approval',
      updatedAt: '2025-01-01T00:00:00.000Z',
      runStatus: 'approval-pending',
      pendingOperation: {
        type: 'approval',
        approvalId: 'thread-approval:0',
        toolName: 'test-tool',
        toolCallId: 'tc-1',
        agentSessionId: 'thread-approval'
      }
    };

    it('工具执行完成 + 提供 toolResult → 注入结果 resume Agent', async () => {
      mockCheckpointLoad.mockResolvedValue(approvalCheckpoint);

      const waker = ThreadWaker.getInstance();
      waker.start();
      const handler = mockEventBus.on.mock.calls[0][1];

      await handler({
        threadId: 'thread-approval',
        reason: 'tool-done',
        toolResult: 'Tool execution result'
      } satisfies ThreadWakeEvent);

      expect(mockSubmitViaPipeline).toHaveBeenCalledWith(
        'thread-approval',
        expect.stringContaining('Tool execution result'),
        'agent'
      );
    });

    it('工具执行失败 → 注入失败消息', async () => {
      mockCheckpointLoad.mockResolvedValue(approvalCheckpoint);

      const waker = ThreadWaker.getInstance();
      waker.start();
      const handler = mockEventBus.on.mock.calls[0][1];

      await handler({
        threadId: 'thread-approval',
        reason: 'tool-done',
        toolResult: 'Tool "test-tool" failed: execution error'
      } satisfies ThreadWakeEvent);

      expect(mockSubmitViaPipeline).toHaveBeenCalledWith('thread-approval', expect.stringContaining('failed'), 'agent');
    });

    it('无 pendingOperation 时 warn 并跳过', async () => {
      mockCheckpointLoad.mockResolvedValue({
        threadId: 't',
        runStatus: 'approval-pending',
        updatedAt: ''
      });

      const waker = ThreadWaker.getInstance();
      waker.start();
      const handler = mockEventBus.on.mock.calls[0][1];

      await handler({ threadId: 't', reason: 'tool-done' });

      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('No pending approval'));
    });

    it('Pipeline 不可用时 error 并跳过', async () => {
      mockSubmitViaPipeline.mockReturnValueOnce(null);
      mockCheckpointLoad.mockResolvedValue(approvalCheckpoint);

      const waker = ThreadWaker.getInstance();
      waker.start();
      const handler = mockEventBus.on.mock.calls[0][1];

      await handler({
        threadId: 'thread-approval',
        reason: 'tool-done',
        toolResult: 'Test result'
      });

      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('Pipeline not available'));
    });
  });

  // ========== restart-recovery ==========

  describe('restart-recovery', () => {
    it('approval-pending → 恢复消息包含工具名称', async () => {
      mockCheckpointLoad.mockResolvedValue({
        threadId: 't-restart',
        runStatus: 'approval-pending',
        updatedAt: '',
        pendingOperation: {
          type: 'approval',
          toolName: 'exec',
          toolCallId: 'tc',
          agentSessionId: 't-restart'
        }
      });

      const waker = ThreadWaker.getInstance();
      waker.start();
      const handler = mockEventBus.on.mock.calls[0][1];

      await handler({ threadId: 't-restart', reason: 'restart-recovery' });

      expect(mockSubmitViaPipeline).toHaveBeenCalledWith('t-restart', expect.stringContaining('restarted'), 'agent');
    });

    it('running → 恢复消息提示继续', async () => {
      mockCheckpointLoad.mockResolvedValue({
        threadId: 't-running',
        runStatus: 'running',
        updatedAt: ''
      });

      const waker = ThreadWaker.getInstance();
      waker.start();
      const handler = mockEventBus.on.mock.calls[0][1];

      await handler({ threadId: 't-running', reason: 'restart-recovery' });

      expect(mockSubmitViaPipeline).toHaveBeenCalledWith('t-running', expect.stringContaining('in progress'), 'agent');
    });

    it('error 状态不恢复', async () => {
      mockCheckpointLoad.mockResolvedValue({
        threadId: 't-error',
        runStatus: 'error',
        updatedAt: ''
      });

      const waker = ThreadWaker.getInstance();
      waker.start();
      const handler = mockEventBus.on.mock.calls[0][1];

      await handler({ threadId: 't-error', reason: 'restart-recovery' });

      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('no recovery needed'));
    });
  });

  // ========== recoverOnStartup ==========

  describe('recoverOnStartup', () => {
    it('扫描 pending 检查点并发出 wake 事件', async () => {
      mockCheckpointFindPending.mockResolvedValue([
        { threadId: 't-1', runStatus: 'running', updatedAt: '' },
        { threadId: 't-2', runStatus: 'approval-pending', updatedAt: '' }
      ]);

      const waker = ThreadWaker.getInstance();
      await waker.recoverOnStartup();

      expect(mockEventBus.emit).toHaveBeenCalledTimes(2);
      expect(mockEventBus.emit).toHaveBeenCalledWith('thread:wake', {
        threadId: 't-1',
        reason: 'restart-recovery'
      });
      expect(mockEventBus.emit).toHaveBeenCalledWith('thread:wake', {
        threadId: 't-2',
        reason: 'restart-recovery'
      });
    });

    it('无 pending 时不发出事件', async () => {
      mockCheckpointFindPending.mockResolvedValue([]);

      const waker = ThreadWaker.getInstance();
      await waker.recoverOnStartup();

      expect(mockEventBus.emit).not.toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('No pending'));
    });
  });
});
