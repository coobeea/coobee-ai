/**
 * 流式输出类型定义
 *
 * 核心数据类型（StreamMessage、StreamSource、StreamMessageType）
 * 统一定义在 @shared/stream-protocol.ts，前后端共享。
 * 本文件重新导出并补充后端专用的 EventBus 事件类型。
 */

// 从 shared 导入协议类型供本文件使用
import type {
  StreamMessageType as _StreamMessageType,
  StreamSource as _StreamSource,
  StreamMessage as _StreamMessage
} from '@shared/stream-protocol'

// 重新导出（后端消费者继续从 streaming/types 导入即可）
export type StreamMessageType = _StreamMessageType
export type StreamSource = _StreamSource
export type StreamMessage = _StreamMessage

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
