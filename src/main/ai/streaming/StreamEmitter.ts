/**
 * 流式发射器
 *
 * 为 Agent/Team Runtime 提供统一的流式输出接口。
 * 通过 EventBus 广播事件，供 StreamStore、WebSocket、Monitor 等消费。
 *
 * StreamEmitter 使用粗粒度消息类型（StreamMessageType），
 * 细粒度的 prefix:event 事件直接通过 onChunk 回调传递。
 */

import type { StreamMessageType, StreamSource } from './types'

/**
 * 流式发射器接口
 *
 * 提供关键事件的快捷方法，供 Monitor/Store 等消费者使用。
 */
export interface IStreamEmitter {
  // ---- 文本 ----
  /** 发送文本增量 */
  emitText(content: string, data?: Record<string, unknown>): Promise<void>
  /** 发送推理增量 */
  emitThinking(content: string): Promise<void>

  // ---- 工具 ----
  /** 发送工具调用事件 */
  emitToolCall(toolName: string, args: Record<string, unknown>): Promise<void>
  /** 发送工具结果 */
  emitToolResult(toolName: string, result: unknown): Promise<void>

  // ---- Handoff / HITL / Agent ----
  /** 发送 Handoff 事件 */
  emitHandoff(agentName: string, data?: Record<string, unknown>): Promise<void>
  /** 发送 HITL 审批事件 */
  emitToolApproval(toolName: string, data?: Record<string, unknown>): Promise<void>
  /** 发送 Agent 切换事件 */
  emitAgentUpdated(agentName: string): Promise<void>

  // ---- 生命周期 ----
  /** 开始流 */
  emitStart(): Promise<void>
  /** 结束流 */
  emitDone(): Promise<void>
  /** 发送错误 */
  emitError(error: string | Error): Promise<void>

  /** 通用发送方法 */
  emit(type: StreamMessageType, content: string, data?: Record<string, unknown>): Promise<void>
}

/**
 * 流式发射器实现（基于 EventBus）
 */
import { eventBus } from '@main/common/eventbus'
import { SnowflakeIdGenerator } from '@main/utils'
import { StreamEventType, type StreamMessage, type StreamEvent } from './types'

export class StreamEmitter implements IStreamEmitter {
  private idGenerator: SnowflakeIdGenerator
  private sequenceCounters = new Map<string, number>()

  constructor(
    private readonly sessionId: string,
    private readonly source: StreamSource
  ) {
    this.idGenerator = new SnowflakeIdGenerator(1) // workerId = 1
  }

  // ========== 文本 ==========

  async emitText(content: string, data?: Record<string, unknown>): Promise<void> {
    await this.emit('text', content, data)
  }

  async emitThinking(content: string): Promise<void> {
    await this.emit('thinking', content)
  }

  // ========== 工具 ==========

  async emitToolCall(toolName: string, args: Record<string, unknown>): Promise<void> {
    await this.emit('tool_call', `Calling tool: ${toolName}`, { toolName, args })
  }

  async emitToolResult(toolName: string, result: unknown): Promise<void> {
    await this.emit('tool_result', `Tool result: ${toolName}`, { toolName, result })
  }

  // ========== Handoff / HITL / Agent ==========

  async emitHandoff(agentName: string, data?: Record<string, unknown>): Promise<void> {
    await this.emit('handoff', `Handoff: ${agentName}`, { agentName, ...data })
  }

  async emitToolApproval(toolName: string, data?: Record<string, unknown>): Promise<void> {
    await this.emit('hitl', `Approval: ${toolName}`, { toolName, ...data })
  }

  async emitAgentUpdated(agentName: string): Promise<void> {
    await this.emit('agent_updated', `Agent updated: ${agentName}`, { agentName })
  }

  // ========== 生命周期事件 ==========

  async emitStart(): Promise<void> {
    await this.emit('start', '[Stream Started]')

    const event: StreamEvent = {
      type: StreamEventType.START,
      sessionId: this.sessionId,
      source: this.source,
      timestamp: Date.now()
    }
    eventBus.emit(StreamEventType.START, event)
  }

  async emitDone(): Promise<void> {
    await this.emit('done', '[Stream Ended]')

    const event: StreamEvent = {
      type: StreamEventType.END,
      sessionId: this.sessionId,
      source: this.source,
      timestamp: Date.now()
    }
    eventBus.emit(StreamEventType.END, event)
  }

  async emitError(error: string | Error): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : error

    await this.emit('error', errorMessage)

    const event: StreamEvent = {
      type: StreamEventType.ERROR,
      sessionId: this.sessionId,
      source: this.source,
      error: errorMessage,
      timestamp: Date.now()
    }
    eventBus.emit(StreamEventType.ERROR, event)
  }

  // ========== 通用方法 ==========

  async emit(
    type: StreamMessageType,
    content: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    const id = this.idGenerator.nextId()

    let sequence = this.sequenceCounters.get(this.sessionId) || 0
    sequence++
    this.sequenceCounters.set(this.sessionId, sequence)

    const message: StreamMessage = {
      id,
      sessionId: this.sessionId,
      sequence,
      type,
      content,
      data,
      timestamp: Date.now(),
      source: this.source
    }

    const event: StreamEvent = {
      type: StreamEventType.MESSAGE,
      sessionId: this.sessionId,
      message,
      timestamp: Date.now()
    }

    eventBus.emit(StreamEventType.MESSAGE, event)
  }
}

/**
 * 创建流式发射器
 */
export function createStreamEmitter(sessionId: string, source: StreamSource): IStreamEmitter {
  return new StreamEmitter(sessionId, source)
}
