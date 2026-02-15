/**
 * 消息管线类型定义
 */

/** 队列模式 */
export type QueueMode = 'followup' | 'steer' | 'collect' | 'interrupt'

/** 队列设置 */
export interface QueueSettings {
  mode: QueueMode
  /** 排队去抖（ms），默认 500 */
  debounceMs: number
  /** 队列容量，默认 20 */
  cap: number
  /** 满了怎么办 */
  dropPolicy: 'old' | 'new' | 'summarize'
}

/** 默认队列设置 */
export const DEFAULT_QUEUE_SETTINGS: QueueSettings = {
  mode: 'collect',
  debounceMs: 500,
  cap: 20,
  dropPolicy: 'summarize'
}

/** 待处理消息 */
export interface PendingMessage {
  /** 消息唯一 ID */
  id: string
  /** 所属会话 */
  sessionId: string
  /** 消息内容 */
  message: string
  /** 入队时间 */
  enqueuedAt: number
  /** 元数据 */
  metadata?: Record<string, unknown>
}

/** Session 管线状态 */
export interface SessionPipelineState {
  sessionId: string
  settings: QueueSettings
  /** 等待队列 */
  queue: PendingMessage[]
  /** 是否正在执行 */
  isRunning: boolean
  /** 是否正在 drain */
  draining: boolean
  /** 被丢弃的消息计数 */
  droppedCount: number
  /** summarize 模式收集的摘要行 */
  summaryLines: string[]
}

/** 提交选项 */
export interface SubmitOptions {
  metadata?: Record<string, unknown>
}

/** 提交结果 */
export interface SubmitResult {
  status: 'executing' | 'queued' | 'merged' | 'interrupted'
  sessionId: string
  /** 队列中的位置（queued 时有值） */
  queuePosition?: number
}

/** 队列状态 */
export interface QueueStatus {
  sessionId: string
  isRunning: boolean
  queueLength: number
  droppedCount: number
  mode: QueueMode
}
