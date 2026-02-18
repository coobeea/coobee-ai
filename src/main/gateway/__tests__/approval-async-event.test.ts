/**
 * 异步审批路径 hitl:approved/rejected 事件发出测试
 *
 * 验证 hitl.decide 的异步路径在用户审批后：
 *   1. 通过 AgentEventWriter 发出 hitl:approved / hitl:rejected 事件
 *   2. 事件包含正确的 index、toolName、action 数据
 *   3. 同时发出 thread:wake 事件
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('@main/common/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}));

let tmpDir: string;

vi.mock('@main/common/env', () => ({
  get Env() {
    return { paths: { workspacesDir: tmpDir } };
  }
}));

const mockEventBusEmit = vi.fn();
vi.mock('@main/common/eventbus', () => ({
  eventBus: { emit: (...args: unknown[]) => mockEventBusEmit(...args), on: vi.fn(), removeListener: vi.fn() }
}));

const mockDispatchForSession = vi.fn();
vi.mock('@main/ai/AgentEventWriter', () => ({
  AgentEventWriter: { dispatchForSession: (...args: unknown[]) => mockDispatchForSession(...args) }
}));

import { hitlApprovalManager } from '@main/ai/hitl/HitlApprovalManager';

describe('approval.ts 异步路径事件发出', () => {
  let approvalMethods: typeof import('../methods/approval').approvalMethods;
  let CheckpointManager: typeof import('@main/ai/threads/CheckpointManager').CheckpointManager;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-async-test-'));
    vi.clearAllMocks();
    vi.resetModules();

    const cpMod = await import('@main/ai/threads/CheckpointManager');
    CheckpointManager = cpMod.CheckpointManager;
    CheckpointManager.resetInstance();

    const mod = await import('../methods/approval');
    approvalMethods = mod.approvalMethods;
  });

  afterEach(() => {
    hitlApprovalManager.cleanupAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function callDecide(params: Record<string, unknown>): Promise<unknown> {
    return approvalMethods.methods.decide(params, null as never);
  }

  it('异步审批 approve-once 发出 hitl:approved 事件', async () => {
    const mgr = CheckpointManager.getInstance();
    const threadId = 'async-test-001';

    await mgr.save({
      threadId,
      updatedAt: new Date().toISOString(),
      runStatus: 'approval-pending',
      pendingOperation: {
        type: 'approval',
        approvalId: `${threadId}:0`,
        toolName: 'exec',
        toolCallId: 'tc-1',
        agentSessionId: threadId
      }
    });

    const result = await callDecide({ sessionId: threadId, index: 0, decision: 'approve-once' });
    expect(result).toEqual({ ok: true });

    expect(mockDispatchForSession).toHaveBeenCalledWith(threadId, {
      type: 'hitl:approved',
      content: 'approved: exec',
      data: { index: 0, toolName: 'exec', action: 'approved' }
    });

    expect(mockEventBusEmit).toHaveBeenCalledWith(
      'thread:wake',
      expect.objectContaining({
        threadId,
        reason: 'approval-done',
        approvalDecision: 'approve-once',
        toolName: 'exec'
      })
    );
  });

  it('异步审批 reject 发出 hitl:rejected 事件', async () => {
    const mgr = CheckpointManager.getInstance();
    const threadId = 'async-test-002';

    await mgr.save({
      threadId,
      updatedAt: new Date().toISOString(),
      runStatus: 'approval-pending',
      pendingOperation: {
        type: 'approval',
        approvalId: `${threadId}:0`,
        toolName: 'write',
        toolCallId: 'tc-2',
        agentSessionId: threadId
      }
    });

    const result = await callDecide({ sessionId: threadId, index: 0, decision: 'reject' });
    expect(result).toEqual({ ok: true });

    expect(mockDispatchForSession).toHaveBeenCalledWith(threadId, {
      type: 'hitl:rejected',
      content: 'rejected: write',
      data: { index: 0, toolName: 'write', action: 'rejected' }
    });
  });

  it('异步审批 approve-always 发出 hitl:approved 事件', async () => {
    const mgr = CheckpointManager.getInstance();
    const threadId = 'async-test-003';

    await mgr.save({
      threadId,
      updatedAt: new Date().toISOString(),
      runStatus: 'approval-pending',
      pendingOperation: {
        type: 'approval',
        approvalId: `${threadId}:1`,
        toolName: 'edit',
        toolCallId: 'tc-3',
        agentSessionId: threadId
      }
    });

    const result = await callDecide({ sessionId: threadId, index: 1, decision: 'approve-always' });
    expect(result).toEqual({ ok: true });

    expect(mockDispatchForSession).toHaveBeenCalledWith(threadId, {
      type: 'hitl:approved',
      content: 'approved: edit',
      data: { index: 1, toolName: 'edit', action: 'approved' }
    });
  });

  it('同步模式不走异步路径（不调用 AgentEventWriter）', async () => {
    const { hitlApprovalManager: manager } = await import('@main/ai/hitl/HitlApprovalManager');
    const approvalId = 'sync-test:0';
    manager.waitForSingleDecision(approvalId);

    const result = await callDecide({ sessionId: 'sync-test', index: 0, decision: 'approve-once' });
    expect(result).toEqual({ ok: true });

    expect(mockDispatchForSession).not.toHaveBeenCalled();
  });

  it('checkpoint 不是 approval-pending 时抛出错误', async () => {
    const mgr = CheckpointManager.getInstance();
    const threadId = 'idle-test';

    await mgr.save({
      threadId,
      updatedAt: new Date().toISOString(),
      runStatus: 'idle'
    });

    await expect(callDecide({ sessionId: threadId, index: 0, decision: 'approve-once' })).rejects.toThrow(
      'No pending approval'
    );

    expect(mockDispatchForSession).not.toHaveBeenCalled();
    expect(mockEventBusEmit).not.toHaveBeenCalled();
  });

  it('toolName 从 checkpoint pendingOperation 回退获取', async () => {
    const mgr = CheckpointManager.getInstance();
    const threadId = 'fallback-tool-test';

    await mgr.save({
      threadId,
      updatedAt: new Date().toISOString(),
      runStatus: 'approval-pending',
      pendingOperation: {
        type: 'approval',
        approvalId: `${threadId}:0`,
        toolName: 'search',
        toolCallId: 'tc-x',
        agentSessionId: threadId
      }
    });

    await callDecide({ sessionId: threadId, index: 0, decision: 'approve-once' });

    expect(mockDispatchForSession).toHaveBeenCalledWith(
      threadId,
      expect.objectContaining({
        data: expect.objectContaining({ toolName: 'search' })
      })
    );
  });
});
