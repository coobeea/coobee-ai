/**
 * 流式发射器
 *
 * 通过 EventBus 广播事件，供 StreamStore、WebSocket、Monitor 等消费。
 *
 * 核心方法：
 *   forward(chunk) — 接收细粒度 StreamChunk，自动映射为粗粒度 StreamMessage 并广播
 *
 * 设计原则：
 *   - Runtime 只 yield StreamChunk（单一职责）
 *   - AgentExecutor 在消费 chunk 时调用 forward() 进行广播（统一出口）
 *   - StreamChunk → StreamMessage 映射逻辑集中在此处
 */

import { eventBus } from '@main/common/eventbus'
import { SnowflakeIdGenerator } from '@main/utils'
import type { StreamChunk, StreamChunkType } from '../runtime/types'
import type { StreamMessageType, StreamSource } from './types'
import { StreamEventType, type StreamMessage, type StreamEvent } from './types'

/**
 * 流式发射器接口
 */
export interface IStreamEmitter {
  /**
   * 转发 StreamChunk 到 EventBus（核心方法）
   *
   * 自动完成：
   *   1. StreamChunkType → StreamMessageType 映射
   *   2. 添加 id / sequence / timestamp 元数据
   *   3. 生命周期事件（start/end/error）额外触发对应的 StreamEvent
   *
   * 部分仅用于 pull 路径的事件（如 turn:start、llm:start）会被跳过，
   * 因为 WebSocket 消费者不需要这些细粒度生命周期事件。
   */
  forward(chunk: StreamChunk): void

  /** 通用发送方法（按 StreamMessageType 直接广播到 EventBus） */
  emit(type: StreamMessageType, content: string, data?: Record<string, unknown>): Promise<void>
}

// ==================== StreamChunk → StreamMessage 映射 ====================

/**
 * StreamChunkType → StreamMessageType 映射表
 *
 * 返回 null 表示该事件无需广播到 WebSocket/EventBus。
 */
const CHUNK_TO_MESSAGE_MAP: Partial<Record<StreamChunkType, StreamMessageType>> = {
  // 文本
  'text:delta': 'text',
  'reasoning:delta': 'thinking',
  // 工具
  'tool:start': 'tool_call',
  'tool:done': 'tool_result',
  // Handoff / HITL
  'handoff:start': 'handoff',
  'handoff:done': 'handoff',
  'delegate:start': 'delegate',
  'delegate:done': 'delegate',
  'hitl:required': 'hitl',
  'hitl:approved': 'hitl',
  'hitl:rejected': 'hitl',
  // 生命周期
  'run:start': 'start',
  'run:done': 'done',
  'run:error': 'error',
  // HITL 生命周期
  'run:interrupted': 'interrupted',
  'run:resumed': 'resumed'
}

/**
 * 需要额外触发 StreamEvent 生命周期事件的类型
 */
const LIFECYCLE_EVENT_MAP: Partial<Record<StreamChunkType, StreamEventType>> = {
  'run:start': StreamEventType.START,
  'run:done': StreamEventType.END,
  'run:error': StreamEventType.ERROR
}

// ==================== StreamEmitter 实现 ====================

export class StreamEmitter implements IStreamEmitter {
  private idGenerator: SnowflakeIdGenerator
  private sequence = 0

  constructor(
    private readonly sessionId: string,
    private readonly source: StreamSource
  ) {
    this.idGenerator = new SnowflakeIdGenerator(1)
  }

  // ========== 核心方法 ==========

  forward(chunk: StreamChunk): void {
    const messageType = CHUNK_TO_MESSAGE_MAP[chunk.type]

    // 该事件需要广播到 EventBus
    if (messageType) {
      const message = this.buildMessage(
        messageType,
        chunk.content,
        chunk.data as Record<string, unknown> | undefined
      )

      const event: StreamEvent = {
        type: StreamEventType.MESSAGE,
        sessionId: this.sessionId,
        message,
        timestamp: Date.now()
      }
      eventBus.emit(StreamEventType.MESSAGE, event)
    }

    // 生命周期事件需要额外触发 START/END/ERROR
    const lifecycleType = LIFECYCLE_EVENT_MAP[chunk.type]
    if (lifecycleType) {
      const lifecycleEvent: StreamEvent = {
        type: lifecycleType,
        sessionId: this.sessionId,
        source: this.source,
        ...(chunk.type === 'run:error' ? { error: chunk.content } : {}),
        timestamp: Date.now()
      }
      eventBus.emit(lifecycleType, lifecycleEvent)

      // run 结束时重置 sequence
      if (chunk.type === 'run:done' || chunk.type === 'run:error') {
        this.sequence = 0
      }
    }
  }

  // ========== 通用方法 ==========

  async emit(
    type: StreamMessageType,
    content: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    const message = this.buildMessage(type, content, data)

    const event: StreamEvent = {
      type: StreamEventType.MESSAGE,
      sessionId: this.sessionId,
      message,
      timestamp: Date.now()
    }

    eventBus.emit(StreamEventType.MESSAGE, event)
  }

  // ========== 内部方法 ==========

  private buildMessage(
    type: StreamMessageType,
    content: string,
    data?: Record<string, unknown>
  ): StreamMessage {
    const id = this.idGenerator.nextId()
    const sequence = ++this.sequence

    return {
      id,
      sessionId: this.sessionId,
      sequence,
      type,
      content,
      data,
      timestamp: Date.now(),
      source: this.source
    }
  }
}

/**
 * 创建流式发射器
 */
export function createStreamEmitter(sessionId: string, source: StreamSource): IStreamEmitter {
  return new StreamEmitter(sessionId, source)
}
