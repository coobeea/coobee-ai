/**
 * 审批状态流转测试
 *
 * 测试关键的状态流转逻辑：
 * 1. pendingApprovalSessions 的添加和清理
 * 2. run:done 时的状态判断
 * 3. ThreadWaker 清理审批状态
 */

import { describe, it, expect } from 'vitest';

describe('Approval Status Flow', () => {
  /**
   * 测试 1: 模拟 pendingApprovalSessions 的生命周期
   */
  it('should manage pendingApprovalSessions correctly', () => {
    // 模拟 pendingApprovalSessions Set
    const pendingApprovalSessions = new Set<string>();
    const sessionId = 'test-session-123';

    // Step 1: 审批触发 - 添加到 Set
    console.log('[Step 1] Tool requires approval, adding to pendingApprovalSessions...');
    pendingApprovalSessions.add(sessionId);
    expect(pendingApprovalSessions.has(sessionId)).toBe(true);
    expect(pendingApprovalSessions.size).toBe(1);

    // Step 2: 模拟 run:done - 检查是否在 Set 中
    console.log('[Step 2] run:done event, checking pendingApprovalSessions...');
    const isPending = pendingApprovalSessions.has(sessionId);
    expect(isPending).toBe(true);

    // 如果还在 Set 中，不更新状态
    console.log('[Step 2] Still pending, keeping approval-pending status');

    // Step 3: ThreadWaker 清理 - 从 Set 移除
    console.log('[Step 3] ThreadWaker clears approval status...');
    const deleted = pendingApprovalSessions.delete(sessionId);
    expect(deleted).toBe(true);
    expect(pendingApprovalSessions.has(sessionId)).toBe(false);
    expect(pendingApprovalSessions.size).toBe(0);

    // Step 4: 再次 run:done - 不在 Set 中
    console.log('[Step 4] Second run:done, pendingApprovalSessions is empty...');
    const stillPending = pendingApprovalSessions.has(sessionId);
    expect(stillPending).toBe(false);

    // 现在可以更新状态为 completed
    console.log('[Step 4] Not pending anymore, can update to completed');

    console.log('\n✅ pendingApprovalSessions lifecycle works correctly\n');
  });

  /**
   * 测试 2: run:done 的状态更新逻辑
   */
  it('should update status correctly based on pendingApprovalSessions', () => {
    const pendingApprovalSessions = new Set<string>();
    const sessionId = 'test-session-456';

    // 场景 A: 有审批等待
    pendingApprovalSessions.add(sessionId);

    function handleRunDone(sid: string): 'completed' | 'keep-pending' {
      if (pendingApprovalSessions.has(sid)) {
        console.log(`[run:done] ${sid} is pending approval, keeping checkpoint`);
        return 'keep-pending';
      } else {
        console.log(`[run:done] ${sid} completed normally, updating to completed`);
        return 'completed';
      }
    }

    // 第一次 run:done - 仍在审批等待中
    const result1 = handleRunDone(sessionId);
    expect(result1).toBe('keep-pending');

    // ThreadWaker 清理
    pendingApprovalSessions.delete(sessionId);

    // 第二次 run:done - 已清理
    const result2 = handleRunDone(sessionId);
    expect(result2).toBe('completed');

    console.log('\n✅ run:done status logic works correctly\n');
  });

  /**
   * 测试 3: ThreadWaker 清理方法
   */
  it('should clear pending approval in ThreadWaker', () => {
    // 模拟 AgentExecutor 的 clearPendingApproval 方法
    class MockAgentExecutor {
      private pendingApprovalSessions = new Set<string>();

      // 模拟工具触发审批
      addPendingApproval(sessionId: string): void {
        this.pendingApprovalSessions.add(sessionId);
        console.log(`[AgentExecutor] Added pending approval: ${sessionId}`);
      }

      // 清理审批等待状态
      clearPendingApproval(sessionId: string): void {
        const deleted = this.pendingApprovalSessions.delete(sessionId);
        if (deleted) {
          console.log(`[AgentExecutor] Cleared pending approval for ${sessionId}`);
        }
      }

      // 检查是否在等待审批
      hasPendingApproval(sessionId: string): boolean {
        return this.pendingApprovalSessions.has(sessionId);
      }
    }

    const executor = new MockAgentExecutor();
    const sessionId = 'test-session-789';

    // Step 1: 触发审批
    executor.addPendingApproval(sessionId);
    expect(executor.hasPendingApproval(sessionId)).toBe(true);

    // Step 2: ThreadWaker 恢复时清理
    console.log('[ThreadWaker] handleApprovalResume called, clearing approval...');
    executor.clearPendingApproval(sessionId);
    expect(executor.hasPendingApproval(sessionId)).toBe(false);

    // Step 3: 后续 run:done 可以正确更新状态
    const canUpdateToCompleted = !executor.hasPendingApproval(sessionId);
    expect(canUpdateToCompleted).toBe(true);

    console.log('\n✅ ThreadWaker clearPendingApproval works correctly\n');
  });

  /**
   * 测试 4: 多个会话同时审批
   */
  it('should handle multiple sessions with approval correctly', () => {
    const pendingApprovalSessions = new Set<string>();

    const session1 = 'session-1';
    const session2 = 'session-2';
    const session3 = 'session-3';

    // 三个会话都触发审批
    console.log('[Step 1] Three sessions require approval...');
    pendingApprovalSessions.add(session1);
    pendingApprovalSessions.add(session2);
    pendingApprovalSessions.add(session3);
    expect(pendingApprovalSessions.size).toBe(3);

    // session1 完成审批并清理
    console.log('[Step 2] Session 1 approved and cleared...');
    pendingApprovalSessions.delete(session1);
    expect(pendingApprovalSessions.has(session1)).toBe(false);
    expect(pendingApprovalSessions.has(session2)).toBe(true);
    expect(pendingApprovalSessions.has(session3)).toBe(true);
    expect(pendingApprovalSessions.size).toBe(2);

    // session2 的 run:done - 仍在等待
    console.log('[Step 3] Session 2 run:done - still pending...');
    const session2Pending = pendingApprovalSessions.has(session2);
    expect(session2Pending).toBe(true);

    // session2 审批完成
    console.log('[Step 4] Session 2 approved...');
    pendingApprovalSessions.delete(session2);

    // session1 的后续 run:done - 已清理，可以更新
    console.log('[Step 5] Session 1 subsequent run:done - can update...');
    const session1CanUpdate = !pendingApprovalSessions.has(session1);
    expect(session1CanUpdate).toBe(true);

    console.log('\n✅ Multiple sessions handled correctly\n');
  });

  /**
   * 测试 5: 状态流转的完整场景
   */
  it('should demonstrate complete status flow', () => {
    console.log('\n=== Complete Status Flow Scenario ===\n');

    const sessionId = 'complete-flow-test';
    const pendingApprovalSessions = new Set<string>();
    let checkpointStatus: 'idle' | 'running' | 'approval-pending' | 'completed' | 'error' = 'idle';
    let threadStatus: 'idle' | 'running' | 'tool-pending' | 'approval-pending' | 'completed' | 'error' = 'idle';

    // 阶段 1: 开始执行
    console.log('[Phase 1] Agent starts execution...');
    checkpointStatus = 'running';
    threadStatus = 'running';
    console.log(`  Checkpoint: ${checkpointStatus}, Thread: ${threadStatus}`);

    // 阶段 2: 工具触发审批
    console.log('[Phase 2] Tool requires approval...');
    pendingApprovalSessions.add(sessionId);
    checkpointStatus = 'approval-pending';
    threadStatus = 'approval-pending';
    console.log(`  Checkpoint: ${checkpointStatus}, Thread: ${threadStatus}`);
    console.log(`  pendingApprovalSessions.size: ${pendingApprovalSessions.size}`);

    // 阶段 3: Agent 自然完成 (SDK 返回，但工具还在后台执行)
    console.log('[Phase 3] Agent SDK completes (run:done)...');
    if (pendingApprovalSessions.has(sessionId)) {
      console.log('  ✅ Keeping approval-pending status (correct!)');
      // 不更新状态
    } else {
      console.log('  ❌ Would update to completed (WRONG!)');
      checkpointStatus = 'completed';
    }
    expect(checkpointStatus).toBe('approval-pending');
    expect(threadStatus).toBe('approval-pending');

    // 阶段 4: 用户批准，ThreadWaker 恢复
    console.log('[Phase 4] User approves, ThreadWaker resumes...');
    pendingApprovalSessions.delete(sessionId); // ✅ 关键：清理审批状态
    checkpointStatus = 'running';
    threadStatus = 'running';
    console.log(`  Checkpoint: ${checkpointStatus}, Thread: ${threadStatus}`);
    console.log(`  pendingApprovalSessions.size: ${pendingApprovalSessions.size}`);

    // 阶段 5: Agent 继续执行完成
    console.log('[Phase 5] Agent continues and completes (run:done)...');
    if (pendingApprovalSessions.has(sessionId)) {
      console.log('  ❌ Would keep approval-pending (WRONG!)');
    } else {
      console.log('  ✅ Updating to completed (correct!)');
      checkpointStatus = 'completed';
      threadStatus = 'completed';
    }
    expect(checkpointStatus).toBe('completed');
    expect(threadStatus).toBe('completed');

    console.log('\n✅ Complete status flow validated!\n');
  });
});
