/**
 * 流式输出类型定义
 */

/**
 * 流式消息类型
 */
export type StreamMessageType =
  | 'text' // 普通文本
  | 'thinking' // 思考过程
  | 'tool_call' // 工具调用
  | 'tool_result' // 工具结果
  | 'skill_call' // 技能调用
  | 'skill_result' // 技能结果
  | 'start' // 流开始
  | 'done' // 流结束
  | 'error' // 错误

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
