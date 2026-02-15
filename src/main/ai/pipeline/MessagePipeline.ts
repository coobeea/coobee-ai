/**
 * 消息管线主入口
 *
 * 替代 AgentExecutor.submit 的 busySessions 简单锁，
 * 提供排队、合并、中断等完整消息处理能力。
 */
import { AbortManager } from './AbortManager'
import { drainCollect, drainFollowup } from './DrainStrategy'
import { SessionQueue } from './SessionQueue'
import type { QueueMode, QueueSettings, QueueStatus, SubmitOptions, SubmitResult } from './types'
import { DEFAULT_QUEUE_SETTINGS } from './types'

/** 执行器：接收 sessionId + 消息，启动 Agent run */
export type PipelineExecutor = (
  sessionId: string,
  message: string,
  signal?: AbortSignal
) => Promise<void>

export class MessagePipeline {
  private queues = new Map<string, SessionQueue>()
  private abortManager = new AbortManager()
  private executor: PipelineExecutor
  private globalSettings: QueueSettings

  constructor(executor: PipelineExecutor, settings?: Partial<QueueSettings>) {
    this.executor = executor
    this.globalSettings = { ...DEFAULT_QUEUE_SETTINGS, ...settings }
  }

  /**
   * 提交消息
   */
  submit(sessionId: string, message: string, opts?: SubmitOptions): SubmitResult {
    const queue = this.getOrCreateQueue(sessionId)
    const mode = queue.settings.mode

    // 空闲 → 直接执行
    if (!queue.isRunning) {
      this.executeWithLifecycle(queue, sessionId, message)
      return { status: 'executing', sessionId }
    }

    // 忙碌 → 按模式处理
    switch (mode) {
      case 'interrupt':
        return this.handleInterrupt(queue, sessionId, message)
      case 'steer':
        return this.handleSteer(queue, sessionId, message, opts)
      case 'collect':
      case 'followup':
        return this.handleQueue(queue, sessionId, message, opts)
      default:
        return this.handleQueue(queue, sessionId, message, opts)
    }
  }

  /**
   * 中断当前 run
   */
  abort(sessionId: string): boolean {
    const aborted = this.abortManager.abort(sessionId)
    const queue = this.queues.get(sessionId)
    if (queue) {
      queue.isRunning = false
    }
    return aborted
  }

  /**
   * 获取队列状态
   */
  getQueueStatus(sessionId: string): QueueStatus {
    const queue = this.queues.get(sessionId)
    return {
      sessionId,
      isRunning: queue?.isRunning ?? false,
      queueLength: queue?.length ?? 0,
      droppedCount: queue?.droppedCount ?? 0,
      mode: queue?.settings.mode ?? this.globalSettings.mode
    }
  }

  /**
   * 清空队列
   */
  clearQueue(sessionId: string): number {
    const queue = this.queues.get(sessionId)
    return queue?.clear() ?? 0
  }

  /**
   * 设置队列模式
   */
  setQueueMode(sessionId: string, mode: QueueMode): void {
    const queue = this.getOrCreateQueue(sessionId)
    queue.setSettings({ mode })
  }

  /**
   * 更新全局设置
   */
  updateGlobalSettings(settings: Partial<QueueSettings>): void {
    this.globalSettings = { ...this.globalSettings, ...settings }
  }

  // ─── 模式处理 ──────────────────────────────────

  private handleInterrupt(queue: SessionQueue, sessionId: string, message: string): SubmitResult {
    // 中断当前 run
    this.abortManager.abort(sessionId)
    queue.clear()
    queue.isRunning = false

    // 立即执行新消息
    this.executeWithLifecycle(queue, sessionId, message)
    return { status: 'interrupted', sessionId }
  }

  private handleSteer(
    queue: SessionQueue,
    sessionId: string,
    message: string,
    opts?: SubmitOptions
  ): SubmitResult {
    // steer 模式：将消息作为"注入"处理
    // 基础实现：入队，等当前 run 结束后作为下一条处理
    queue.enqueue(sessionId, message, opts?.metadata)
    return { status: 'merged', sessionId }
  }

  private handleQueue(
    queue: SessionQueue,
    sessionId: string,
    message: string,
    opts?: SubmitOptions
  ): SubmitResult {
    queue.enqueue(sessionId, message, opts?.metadata)
    return {
      status: 'queued',
      sessionId,
      queuePosition: queue.length
    }
  }

  // ─── 执行生命周期 ──────────────────────────────

  private executeWithLifecycle(queue: SessionQueue, sessionId: string, message: string): void {
    queue.isRunning = true
    const signal = this.abortManager.create(sessionId)

    // 异步执行（不阻塞）
    this.doExecute(queue, sessionId, message, signal).catch(() => {
      // 错误已在 doExecute 内处理
    })
  }

  private async doExecute(
    queue: SessionQueue,
    sessionId: string,
    message: string,
    signal: AbortSignal
  ): Promise<void> {
    try {
      await this.executor(sessionId, message, signal)
    } finally {
      this.abortManager.cleanup(sessionId)

      // Drain 队列
      if (!queue.isEmpty()) {
        await this.drainQueue(queue, sessionId)
      } else {
        queue.isRunning = false
      }
    }
  }

  private async drainQueue(queue: SessionQueue, sessionId: string): Promise<void> {
    queue.draining = true
    const mode = queue.settings.mode

    try {
      const drainExecutor = async (_sid: string, msg: string): Promise<void> => {
        const signal = this.abortManager.create(sessionId)
        try {
          await this.executor(sessionId, msg, signal)
        } finally {
          this.abortManager.cleanup(sessionId)
        }
      }

      if (mode === 'collect') {
        await drainCollect(queue, drainExecutor)
      } else {
        // followup / steer / interrupt 都用逐条模式
        await drainFollowup(queue, drainExecutor)
      }
    } finally {
      queue.draining = false
      queue.isRunning = false
    }
  }

  // ─── 辅助方法 ──────────────────────────────────

  private getOrCreateQueue(sessionId: string): SessionQueue {
    let queue = this.queues.get(sessionId)
    if (!queue) {
      queue = new SessionQueue(sessionId, this.globalSettings)
      this.queues.set(sessionId, queue)
    }
    return queue
  }
}
