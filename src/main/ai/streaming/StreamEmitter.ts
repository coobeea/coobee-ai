/**
 * 流式发射器接口
 * 为 Agent/Team Runtime 提供统一的流式输出接口
 */

import type { StreamMessageType, StreamSource } from './types'

/**
 * 流式发射器接口
 */
export interface IStreamEmitter {
  /**
   * 发送文本消息
   * @param content 文本内容
   * @param data 额外数据
   */
  emitText(content: string, data?: Record<string, unknown>): Promise<void>

  /**
   * 发送思考过程
   * @param content 思考内容
   */
  emitThinking(content: string): Promise<void>

  /**
   * 发送工具调用
   * @param toolName 工具名称
   * @param args 工具参数
   */
  emitToolCall(toolName: string, args: Record<string, unknown>): Promise<void>

  /**
   * 发送工具结果
   * @param toolName 工具名称
   * @param result 工具结果
   */
  emitToolResult(toolName: string, result: unknown): Promise<void>

  /**
   * 发送技能调用
   * @param skillId 技能 ID
   * @param input 技能输入
   */
  emitSkillCall(skillId: string, input: unknown): Promise<void>

  /**
   * 发送技能结果
   * @param skillId 技能 ID
   * @param result 技能结果
   */
  emitSkillResult(skillId: string, result: unknown): Promise<void>

  /**
   * 开始流
   */
  emitStart(): Promise<void>

  /**
   * 结束流
   */
  emitDone(): Promise<void>

  /**
   * 发送错误
   * @param error 错误信息
   */
  emitError(error: string | Error): Promise<void>

  /**
   * 通用发送方法
   * @param type 消息类型
   * @param content 消息内容
   * @param data 额外数据
   */
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

  async emitText(content: string, data?: Record<string, unknown>): Promise<void> {
    await this.emit('text', content, data)
  }

  async emitThinking(content: string): Promise<void> {
    await this.emit('thinking', content)
  }

  async emitToolCall(toolName: string, args: Record<string, unknown>): Promise<void> {
    await this.emit('tool_call', `Calling tool: ${toolName}`, { toolName, args })
  }

  async emitToolResult(toolName: string, result: unknown): Promise<void> {
    await this.emit('tool_result', `Tool result: ${toolName}`, { toolName, result })
  }

  async emitSkillCall(skillId: string, input: unknown): Promise<void> {
    await this.emit('skill_call', `Calling skill: ${skillId}`, { skillId, input })
  }

  async emitSkillResult(skillId: string, result: unknown): Promise<void> {
    await this.emit('skill_result', `Skill result: ${skillId}`, { skillId, result })
  }

  async emitStart(): Promise<void> {
    await this.emit('start', '[Stream Started]')

    // 发送 START 事件
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

    // 发送 END 事件
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

    // 发送 ERROR 事件
    const event: StreamEvent = {
      type: StreamEventType.ERROR,
      sessionId: this.sessionId,
      source: this.source,
      error: errorMessage,
      timestamp: Date.now()
    }
    eventBus.emit(StreamEventType.ERROR, event)
  }

  async emit(
    type: StreamMessageType,
    content: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    // 1. 生成消息 ID
    const id = this.idGenerator.nextId()

    // 2. 获取或初始化序号
    let sequence = this.sequenceCounters.get(this.sessionId) || 0
    sequence++
    this.sequenceCounters.set(this.sessionId, sequence)

    // 3. 构建消息
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

    // 4. 发送事件（通过 EventBus）
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
