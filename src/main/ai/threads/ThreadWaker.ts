/**
 * Thread 唤醒器
 *
 * 监听 EventBus 上的 'thread:wake' 事件，从 checkpoint 恢复挂起的 Thread。
 *
 * 唤醒流程：
 *   1. 读取 checkpoint.json 确认挂起状态
 *   2. 如果有 pendingOperation（审批完成后）：
 *      a. 执行被挂起的工具
 *      b. 将工具结果作为系统消息注入
 *      c. 重新启动 Agent run
 *   3. 更新 checkpoint 和 Thread 状态
 *
 * 事件格式：
 *   eventBus.emit('thread:wake', {
 *     threadId: string,
 *     reason: 'approval-done' | 'tool-done' | 'restart-recovery',
 *     toolResult?: string,
 *     approvalDecision?: 'approve-once' | 'approve-always' | 'reject'
 *   })
 */

import { createLogger } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import { CheckpointManager } from './CheckpointManager';
import type { ThreadCheckpoint } from './types';

const log = createLogger('thread-waker');

export interface ThreadWakeEvent {
  threadId: string;
  reason: 'approval-done' | 'tool-done' | 'restart-recovery';
  toolResult?: string;
  approvalDecision?: string;
  /** 被审批的工具名称 */
  toolName?: string;
  /** 被审批的工具参数 */
  toolParams?: Record<string, unknown>;
}

export class ThreadWaker {
  private static instance: ThreadWaker | null = null;
  private listening = false;

  static getInstance(): ThreadWaker {
    if (!ThreadWaker.instance) {
      ThreadWaker.instance = new ThreadWaker();
    }
    return ThreadWaker.instance;
  }

  static resetInstance(): void {
    if (ThreadWaker.instance) {
      ThreadWaker.instance.stop();
    }
    ThreadWaker.instance = null;
  }

  /**
   * 开始监听唤醒事件
   */
  start(): void {
    if (this.listening) return;
    eventBus.on('thread:wake', this.handleWake);
    this.listening = true;
    log.info('[ThreadWaker] Started listening for thread:wake events');
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (!this.listening) return;
    eventBus.removeListener('thread:wake', this.handleWake);
    this.listening = false;
    log.info('[ThreadWaker] Stopped');
  }

  /**
   * 处理唤醒事件
   */
  private handleWake = async (event: ThreadWakeEvent): Promise<void> => {
    const { threadId, reason } = event;
    log.info(`[ThreadWaker] Wake event: threadId=${threadId}, reason=${reason}`);

    try {
      const checkpoint = await CheckpointManager.getInstance().load(threadId);
      if (!checkpoint) {
        log.warn(`[ThreadWaker] No checkpoint found for ${threadId}, skipping`);
        return;
      }

      if (checkpoint.runStatus === 'idle' || checkpoint.runStatus === 'completed') {
        log.info(`[ThreadWaker] Thread ${threadId} already idle/completed, skipping`);
        return;
      }

      await this.resumeThread(threadId, checkpoint, event);
    } catch (error) {
      log.error(`[ThreadWaker] Failed to wake thread ${threadId}:`, error);
    }
  };

  /**
   * 恢复挂起的 Thread
   */
  private async resumeThread(threadId: string, checkpoint: ThreadCheckpoint, event: ThreadWakeEvent): Promise<void> {
    const checkpointMgr = CheckpointManager.getInstance();

    if (event.reason === 'tool-done') {
      // 工具执行完成（由后台任务执行），接收结果并继续
      await this.handleApprovalResume(threadId, checkpoint, event);
    } else if (event.reason === 'approval-done') {
      // 兼容旧的 reason（已废弃）
      log.warn(`[ThreadWaker] Deprecated reason 'approval-done', use 'tool-done' instead`);
      await this.handleApprovalResume(threadId, checkpoint, event);
    } else if (event.reason === 'restart-recovery') {
      await this.handleRestartRecovery(threadId, checkpoint);
    } else {
      log.info(`[ThreadWaker] Unhandled wake reason: ${event.reason}`);
    }

    // 确保 checkpoint 更新
    await checkpointMgr.updateStatus(threadId, 'running');
  }

  /**
   * 审批完成后恢复执行
   *
   * 流程：
   *   1. 接收工具执行结果（已由后台任务执行完成）
   *   2. 将结果作为系统消息注入
   *   3. 继续 Agent run
   *
   * 注意：工具已在 ToolExecutionPipeline 的后台任务中执行，
   *      这里只是接收结果并继续执行流程。
   */
  private async handleApprovalResume(
    threadId: string,
    checkpoint: ThreadCheckpoint,
    event: ThreadWakeEvent
  ): Promise<void> {
    const pending = checkpoint.pendingOperation;
    if (!pending || pending.type !== 'approval') {
      log.warn(`[ThreadWaker] No pending approval operation for ${threadId}`);
      return;
    }

    // 工具结果应该在 event.toolResult 中（由后台任务执行后发送）
    if (!event.toolResult) {
      log.warn(`[ThreadWaker] No toolResult in wake event for ${threadId}`);
      return;
    }

    const resumeMessage = `[System] Tool "${pending.toolName}" execution result:\n${event.toolResult}`;

    // 重新启动 Agent run（注入工具结果）
    await this.submitResumeMessage(threadId, resumeMessage);
  }

  // executeApprovedTool 已移除
  // 工具现在由 ToolExecutionPipeline 的后台任务执行

  /**
   * 系统重启后恢复
   *
   * 不自动重新执行，而是通知用户中断了什么
   */
  private async handleRestartRecovery(threadId: string, checkpoint: ThreadCheckpoint): Promise<void> {
    let message: string;

    if (checkpoint.runStatus === 'approval-pending') {
      const pending = checkpoint.pendingOperation;
      message =
        `[System] The application was restarted while waiting for approval of tool "${pending?.toolName || 'unknown'}". ` +
        `The approval request has been reset. Please retry the operation if needed.`;
    } else if (checkpoint.runStatus === 'running' || checkpoint.runStatus === 'tool-pending') {
      message =
        `[System] The application was restarted while a task was in progress. ` +
        `The previous execution state has been preserved. ` +
        `Please describe what you'd like to do next, or ask me to continue the previous task.`;
    } else {
      log.info(`[ThreadWaker] Thread ${threadId} in status ${checkpoint.runStatus}, no recovery needed`);
      return;
    }

    await this.submitResumeMessage(threadId, message);
  }

  /**
   * 向 Thread 发送恢复消息（重新启动 Agent run）
   */
  private async submitResumeMessage(threadId: string, message: string): Promise<void> {
    try {
      const { agentExecutor } = await import('../AgentExecutor');

      log.info(`[ThreadWaker] Resuming thread ${threadId} with message: ${message.slice(0, 100)}...`);

      // 使用 submitViaPipeline 而非 submit，确保走 MessagePipeline 流程
      // 享受队列、runId 竞态防护、中断等能力
      const result = agentExecutor.submitViaPipeline(threadId, message, 'agent');

      if (!result) {
        log.error(`[ThreadWaker] Pipeline not available, cannot resume thread ${threadId}`);
        return;
      }

      // status: 'executing' | 'queued' | 'merged' | 'interrupted'
      if (result.status === 'executing') {
        log.info(`[ThreadWaker] Thread ${threadId} resumed successfully (executing)`);
      } else {
        log.info(`[ThreadWaker] Thread ${threadId} resume submitted (status: ${result.status})`);
      }
    } catch (error) {
      log.error(`[ThreadWaker] Failed to submit resume message for ${threadId}:`, error);
    }
  }

  /**
   * 系统启动时扫描未完成的 Thread 并恢复
   */
  async recoverOnStartup(): Promise<void> {
    try {
      const checkpointMgr = CheckpointManager.getInstance();
      const pending = await checkpointMgr.findPending();

      if (pending.length === 0) {
        log.info('[ThreadWaker] No pending threads to recover on startup');
        return;
      }

      log.info(`[ThreadWaker] Found ${pending.length} pending thread(s) to recover`);

      for (const cp of pending) {
        eventBus.emit('thread:wake', {
          threadId: cp.threadId,
          reason: 'restart-recovery'
        } satisfies ThreadWakeEvent);
      }
    } catch (error) {
      log.error('[ThreadWaker] Startup recovery scan failed:', error);
    }
  }
}
