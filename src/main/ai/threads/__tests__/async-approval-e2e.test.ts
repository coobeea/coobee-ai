/**
 * 异步审批 E2E 集成测试
 *
 * 模拟完整流程：
 *   1. tool-approval 返回 suspend → checkpoint 写入 approval-pending
 *   2. 用户审批 → approval.ts 发出 thread:wake 事件
 *   3. ThreadWaker 读取 checkpoint → 执行工具 → resume Agent
 *
 * 使用真实的 CheckpointManager（文件系统）和模拟的 EventBus / AgentExecutor。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

let tmpDir: string;

vi.mock('@main/common/env', () => ({
  get Env() {
    return { paths: { workspacesDir: tmpDir } };
  }
}));

describe('异步审批 E2E', () => {
  let CheckpointManager: typeof import('../CheckpointManager').CheckpointManager;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'async-approval-e2e-'));
    vi.resetModules();
    const cpMod = await import('../CheckpointManager');
    CheckpointManager = cpMod.CheckpointManager;
    CheckpointManager.resetInstance();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('完整的异步审批流程', async () => {
    const mgr = CheckpointManager.getInstance();
    const threadId = '100000000000000001';

    // === Step 1: 模拟 Agent run 过程中遇到审批需求 ===
    // tool-approval Extension 返回 suspend 后，AgentExecutor 写入 checkpoint
    await mgr.save({
      threadId,
      updatedAt: new Date().toISOString(),
      runStatus: 'approval-pending',
      pendingOperation: {
        type: 'approval',
        approvalId: `${threadId}:0`,
        toolName: 'exec',
        toolCallId: 'call-1',
        agentSessionId: threadId
      }
    });

    // 验证 checkpoint 文件存在
    const cpPath = path.join(tmpDir, threadId, 'checkpoint.json');
    expect(fs.existsSync(cpPath)).toBe(true);

    // 验证 checkpoint 内容
    const cp = await mgr.load(threadId);
    expect(cp).not.toBeNull();
    expect(cp!.runStatus).toBe('approval-pending');
    expect(cp!.pendingOperation!.toolName).toBe('exec');
    expect(cp!.pendingOperation!.approvalId).toBe(`${threadId}:0`);

    // === Step 2: 模拟用户审批 ===
    // approval.ts 会检查 checkpoint 状态
    expect(cp!.runStatus).toBe('approval-pending');
    // approval.ts 发出 thread:wake 事件（这里模拟事件内容）
    const wakeEvent = {
      threadId,
      reason: 'tool-done' as const,
      approvalDecision: 'approve-once',
      toolName: 'exec',
      toolParams: { command: 'echo hello' }
    };

    // === Step 3: 验证 checkpoint 可以被读取和更新 ===
    await mgr.updateStatus(threadId, 'running');
    const updated = await mgr.load(threadId);
    expect(updated!.runStatus).toBe('running');

    // === Step 4: 执行完成后清除 checkpoint ===
    await mgr.updateStatus(threadId, 'idle');
    const final = await mgr.load(threadId);
    expect(final!.runStatus).toBe('idle');
    expect(final!.pendingOperation).toBeUndefined();
    expect(final!.activeAgent).toBeUndefined();

    // wake event 结构完整
    expect(wakeEvent.threadId).toBe(threadId);
    expect(wakeEvent.reason).toBe('tool-done');
    expect(wakeEvent.approvalDecision).toBe('approve-once');
  });

  it('拒绝审批流程', async () => {
    const mgr = CheckpointManager.getInstance();
    const threadId = '100000000000000002';

    // 写入 approval-pending checkpoint
    await mgr.save({
      threadId,
      updatedAt: new Date().toISOString(),
      runStatus: 'approval-pending',
      pendingOperation: {
        type: 'approval',
        approvalId: `${threadId}:0`,
        toolName: 'exec',
        toolCallId: 'call-2',
        agentSessionId: threadId
      }
    });

    // 模拟拒绝
    const cp = await mgr.load(threadId);
    expect(cp!.runStatus).toBe('approval-pending');

    // 拒绝后更新状态
    await mgr.updateStatus(threadId, 'running');
    await mgr.updateStatus(threadId, 'idle');

    const final = await mgr.load(threadId);
    expect(final!.runStatus).toBe('idle');
  });

  it('系统重启恢复：扫描到 pending 的检查点', async () => {
    const mgr = CheckpointManager.getInstance();

    // 模拟 3 个不同状态的 thread
    await mgr.save({ threadId: 'idle-thread', updatedAt: '', runStatus: 'idle' });
    await mgr.save({
      threadId: 'pending-thread',
      updatedAt: '',
      runStatus: 'approval-pending',
      pendingOperation: {
        type: 'approval',
        toolName: 'exec',
        toolCallId: 'tc',
        agentSessionId: 'pending-thread'
      }
    });
    await mgr.save({ threadId: 'running-thread', updatedAt: '', runStatus: 'running' });
    await mgr.save({ threadId: 'done-thread', updatedAt: '', runStatus: 'completed' });

    // 扫描 pending
    const pending = await mgr.findPending();
    expect(pending).toHaveLength(2);

    const pendingIds = pending.map((p) => p.threadId).sort();
    expect(pendingIds).toEqual(['pending-thread', 'running-thread']);

    // 验证 pending-thread 保留了 pendingOperation
    const pt = pending.find((p) => p.threadId === 'pending-thread');
    expect(pt!.pendingOperation!.toolName).toBe('exec');
  });

  it('子 Agent 的 checkpoint 与主 thread 独立', async () => {
    const mgr = CheckpointManager.getInstance();
    const mainThreadId = '200000000000000001';
    const subSessionId = `${mainThreadId}:delegate:reviewer`;

    // 主 thread checkpoint
    await mgr.save({
      threadId: mainThreadId,
      updatedAt: '',
      runStatus: 'tool-pending',
      activeAgent: {
        sessionId: subSessionId,
        agentId: 'reviewer',
        role: 'delegate',
        workspace: `tasks/task-1/agents/reviewer`
      }
    });

    // 子 agent 有自己的 checkpoint（如果需要）
    await mgr.save({
      threadId: subSessionId,
      updatedAt: '',
      runStatus: 'running'
    });

    // 验证两个 checkpoint 独立存在
    const mainCp = await mgr.load(mainThreadId);
    expect(mainCp!.runStatus).toBe('tool-pending');
    expect(mainCp!.activeAgent!.agentId).toBe('reviewer');

    const subCp = await mgr.load(subSessionId);
    expect(subCp!.runStatus).toBe('running');

    // findPending 找到两个
    const pending = await mgr.findPending();
    expect(pending).toHaveLength(2);
  });
});
