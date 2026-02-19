/**
 * 消息管线主入口
 *
 * 替代 AgentExecutor.submit 的 busySessions 简单锁，
 * 提供排队、合并、中断等完整消息处理能力。
 */
import { log } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import { StreamEventType } from '../streaming/types';
import { ExtensionManager } from '../../common/extension/ExtensionManager';
import { AbortManager } from './AbortManager';
import { drainCollect, drainFollowup } from './DrainStrategy';
import { SessionQueue } from './SessionQueue';
import type { QueueMode, QueueSettings, QueueStatus, SubmitOptions, SubmitResult } from './types';
import { DEFAULT_QUEUE_SETTINGS } from './types';

/** 执行器：接收 sessionId + 消息，启动 Agent run */
export type PipelineExecutor = (sessionId: string, message: string, signal?: AbortSignal) => Promise<void>;

/** 队列 TTL（30 分钟无活动后自动清理） */
const QUEUE_TTL_MS = 30 * 60 * 1000;

export class MessagePipeline {
  private queues = new Map<string, SessionQueue>();
  private abortManager = new AbortManager();
  private executor: PipelineExecutor;
  private globalSettings: QueueSettings;

  /** 每个 session 当前活跃的 runId（用于竞态防护） */
  private currentRunIds = new Map<string, number>();
  private nextRunId = 0;

  /** 上次清理时间戳 */
  private lastCleanupTime = Date.now();

  constructor(executor: PipelineExecutor, settings?: Partial<QueueSettings>) {
    this.executor = executor;
    this.globalSettings = { ...DEFAULT_QUEUE_SETTINGS, ...settings };
  }

  /**
   * 提交消息
   */
  submit(sessionId: string, message: string, opts?: SubmitOptions): SubmitResult {
    // 定期清理空闲队列（每 5 分钟检查一次）
    if (Date.now() - this.lastCleanupTime > 5 * 60 * 1000) {
      this.cleanupIdleQueues();
    }

    const queue = this.getOrCreateQueue(sessionId);
    const mode = queue.settings.mode;

    // 空闲 → 直接执行
    if (!queue.isRunning) {
      this.executeWithLifecycle(queue, sessionId, message);
      return { status: 'executing', sessionId };
    }

    // 忙碌 → 按模式处理
    switch (mode) {
      case 'interrupt':
        return this.handleInterrupt(queue, sessionId, message);
      case 'steer':
        return this.handleSteer(queue, sessionId, message, opts);
      case 'collect':
      case 'followup':
        return this.handleQueue(queue, sessionId, message, opts);
      default:
        return this.handleQueue(queue, sessionId, message, opts);
    }
  }

  /**
   * 中断当前 run
   */
  abort(sessionId: string): boolean {
    const aborted = this.abortManager.abort(sessionId);
    const queue = this.queues.get(sessionId);
    if (queue) {
      queue.isRunning = false;
    }
    return aborted;
  }

  /**
   * 获取队列状态
   */
  getQueueStatus(sessionId: string): QueueStatus {
    const queue = this.queues.get(sessionId);
    return {
      sessionId,
      isRunning: queue?.isRunning ?? false,
      queueLength: queue?.length ?? 0,
      droppedCount: queue?.droppedCount ?? 0,
      mode: queue?.settings.mode ?? this.globalSettings.mode
    };
  }

  /**
   * 清空队列
   */
  clearQueue(sessionId: string): number {
    const queue = this.queues.get(sessionId);
    return queue?.clear() ?? 0;
  }

  /**
   * 清理空闲队列（TTL 机制）
   *
   * 移除满足以下条件的队列：
   *   - 不在运行中
   *   - 队列为空
   *   - 最后访问时间超过 TTL（30 分钟）
   */
  private cleanupIdleQueues(): void {
    this.lastCleanupTime = Date.now();
    const now = Date.now();
    let cleanedCount = 0;

    for (const [sessionId, queue] of this.queues.entries()) {
      if (!queue.isRunning && queue.isEmpty() && now - queue.lastAccessTime > QUEUE_TTL_MS) {
        this.queues.delete(sessionId);
        this.currentRunIds.delete(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      log.debug(`[MessagePipeline] Cleaned up ${cleanedCount} idle queues`);
    }
  }

  /**
   * 设置队列模式
   */
  setQueueMode(sessionId: string, mode: QueueMode): void {
    const queue = this.getOrCreateQueue(sessionId);
    queue.setSettings({ mode });
  }

  /**
   * 更新全局设置
   */
  updateGlobalSettings(settings: Partial<QueueSettings>): void {
    this.globalSettings = { ...this.globalSettings, ...settings };
  }

  // ─── 模式处理 ──────────────────────────────────

  private handleInterrupt(queue: SessionQueue, sessionId: string, message: string): SubmitResult {
    // 中断当前 run
    this.abortManager.abort(sessionId);
    queue.clear();
    queue.isRunning = false;

    // 立即执行新消息
    this.executeWithLifecycle(queue, sessionId, message);
    return { status: 'interrupted', sessionId };
  }

  private handleSteer(queue: SessionQueue, sessionId: string, message: string, opts?: SubmitOptions): SubmitResult {
    // steer 模式：将消息作为"注入"处理
    // 基础实现：入队，等当前 run 结束后作为下一条处理
    queue.enqueue(sessionId, message, opts?.metadata);
    this.fireMessageQueued(sessionId, message, queue);
    return { status: 'merged', sessionId };
  }

  private handleQueue(queue: SessionQueue, sessionId: string, message: string, opts?: SubmitOptions): SubmitResult {
    queue.enqueue(sessionId, message, opts?.metadata);
    this.fireMessageQueued(sessionId, message, queue);
    return {
      status: 'queued',
      sessionId,
      queuePosition: queue.length
    };
  }

  // ─── 执行生命周期 ──────────────────────────────

  private executeWithLifecycle(queue: SessionQueue, sessionId: string, message: string): void {
    queue.isRunning = true;
    const runId = ++this.nextRunId;
    this.currentRunIds.set(sessionId, runId);
    const signal = this.abortManager.create(sessionId);

    // 异步执行（不阻塞）
    this.doExecute(queue, sessionId, message, signal, runId).catch((err) => {
      log.error(`[MessagePipeline] Unhandled error in session ${sessionId}:`, err);
      eventBus.emit(StreamEventType.ERROR, {
        type: StreamEventType.ERROR,
        sessionId,
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now()
      });
    });
  }

  private async doExecute(
    queue: SessionQueue,
    sessionId: string,
    message: string,
    signal: AbortSignal,
    runId: number
  ): Promise<void> {
    try {
      await this.executor(sessionId, message, signal);
    } finally {
      // 仅当本 run 仍是当前活跃 run 时才执行清理
      // 被 interrupt 替换后（runId 不匹配），新 run 拥有自己的 controller 和生命周期
      const isCurrentRun = this.currentRunIds.get(sessionId) === runId;

      if (isCurrentRun) {
        // 在 cleanup 前读取 abort 状态（cleanup 会清除 abortedSessions）
        const wasAborted = this.abortManager.isAborted(sessionId);
        this.abortManager.cleanup(sessionId);

        // Drain 队列（abort 后跳过 drain，直接清空）
        if (!queue.isEmpty() && !wasAborted) {
          await this.drainQueue(queue, sessionId, runId);
        } else {
          if (wasAborted) {
            queue.clear();
          }
          queue.isRunning = false;
          this.cleanupSession(sessionId);
        }
      }
    }
  }

  private async drainQueue(queue: SessionQueue, sessionId: string, runId: number): Promise<void> {
    queue.draining = true;
    const mode = queue.settings.mode;
    const strategy = mode === 'collect' ? 'collect' : 'followup';

    // 触发 queue_drain_start 钩子
    this.fireQueueDrainStart(sessionId, strategy, queue.length);

    try {
      const drainExecutor = async (_sid: string, msg: string): Promise<void> => {
        // drain 期间检查 abort 和 runId
        if (this.abortManager.isAborted(sessionId) || this.currentRunIds.get(sessionId) !== runId) {
          queue.clear();
          return;
        }
        this.fireMessageDequeued(sessionId, msg, queue);
        const signal = this.abortManager.create(sessionId);
        try {
          await this.executor(sessionId, msg, signal);
        } finally {
          this.abortManager.cleanup(sessionId);
        }
      };

      if (mode === 'collect') {
        await drainCollect(queue, drainExecutor);
      } else {
        await drainFollowup(queue, drainExecutor);
      }
    } finally {
      queue.draining = false;
      // 仅当仍是当前 run 时才更新状态
      if (this.currentRunIds.get(sessionId) === runId) {
        queue.isRunning = false;
        this.cleanupSession(sessionId);
      }
    }
  }

  /**
   * 清理空闲 session 的队列，防止 Map 无限增长
   */
  private cleanupSession(sessionId: string): void {
    const queue = this.queues.get(sessionId);
    if (queue && !queue.isRunning && queue.isEmpty()) {
      this.queues.delete(sessionId);
      this.currentRunIds.delete(sessionId);
    }
  }

  // ─── 辅助方法 ──────────────────────────────────

  private getOrCreateQueue(sessionId: string): SessionQueue {
    let queue = this.queues.get(sessionId);
    if (!queue) {
      queue = new SessionQueue(sessionId, this.globalSettings);
      this.queues.set(sessionId, queue);
    }
    return queue;
  }

  // ─── Extension Hook 触发 ──────────────────────

  private fireMessageQueued(sessionId: string, message: string, queue: SessionQueue): void {
    ExtensionManager.getHookRunner()
      ?.runVoidHook('message_queued', {
        sessionId,
        message,
        mode: queue.settings.mode,
        queueLength: queue.length
      })
      .catch(() => {
        /* hook 错误不影响主流程 */
      });
  }

  private fireMessageDequeued(sessionId: string, message: string, queue: SessionQueue): void {
    ExtensionManager.getHookRunner()
      ?.runVoidHook('message_dequeued', {
        sessionId,
        message,
        remainingLength: queue.length
      })
      .catch(() => {
        /* hook 错误不影响主流程 */
      });
  }

  private fireQueueDrainStart(sessionId: string, strategy: 'followup' | 'collect', pendingCount: number): void {
    ExtensionManager.getHookRunner()
      ?.runVoidHook('queue_drain_start', {
        sessionId,
        strategy,
        pendingCount
      })
      .catch(() => {
        /* hook 错误不影响主流程 */
      });
  }
}
