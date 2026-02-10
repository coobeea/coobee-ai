/**
 * 流式输出类型定义
 *
 * 对齐 runtime/types.ts 的 8 层 24 种事件设计。
 * StreamEmitter 层使用较粗粒度的消息分类，
 * 细粒度的 prefix:event 事件通过 StreamChunk 直接传递给消费者。
 */

/**
 * 流式消息类型（StreamEmitter 粗粒度分类）
 *
 * StreamEmitter 不需要 1:1 映射所有 24 种 StreamChunkType，
 * 它负责通过 EventBus 广播关键事件供 Monitor/Store 消费。
 * 更细粒度的事件通过 onChunk 回调直接传递。
 */
export type StreamMessageType =
  // 文本
  | 'text' // 文本增量 → text:delta
  | 'thinking' // 推理增量 → reasoning:delta
  // 工具
  | 'tool_call' // 工具调用 → tool:start
  | 'tool_result' // 工具结果 → tool:done
  // Handoff / HITL
  | 'handoff' // Handoff 事件
  | 'hitl' // HITL 审批事件
  | 'agent_updated' // Agent 切换
  // 生命周期
  | 'start' // 流开始 → run:start
  | 'done' // 流结束 → run:done
  | 'error' // 错误 → run:error

/**
 * 流式消息来源
 */
export interface StreamSource {
  /** 来源类型 */
  type: 'agent' | 'team' | 'swarm'
  /** 来源 ID */
  id: string
  /** 来源名称 */
  name: string
}

/**
 * 流式消息
 */
export interface StreamMessage {
  /** 消息唯一 ID（雪花 ID） */
  id: string

  /** 会话 ID */
  sessionId: string

  /** 消息序号（单调递增，从 1 开始） */
  sequence: number

  /** 消息类型 */
  type: StreamMessageType

  /** 消息内容 */
  content: string

  /** 额外数据 */
  data?: Record<string, unknown>

  /** 时间戳 */
  timestamp: number

  /** 来源 */
  source: StreamSource
}

/**
 * 流式事件类型
 */
export enum StreamEventType {
  /** 消息块 */
  MESSAGE = 'stream:message',

  /** 流开始 */
  START = 'stream:start',

  /** 流结束 */
  END = 'stream:end',

  /** 流错误 */
  ERROR = 'stream:error'
}

/**
 * 流式事件数据
 */
export interface StreamEvent {
  /** 事件类型 */
  type: StreamEventType

  /** 会话 ID */
  sessionId: string

  /** 消息数据（MESSAGE 事件） */
  message?: StreamMessage

  /** 来源信息（START/END/ERROR 事件） */
  source?: StreamSource

  /** 错误信息（ERROR 事件） */
  error?: string

  /** 事件时间戳 */
  timestamp: number
}
