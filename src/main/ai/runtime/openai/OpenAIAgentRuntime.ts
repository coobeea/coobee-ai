/**
 * OpenAI Agent 运行时
 *
 * 基于 OpenAI Agents SDK 实现 AgentRuntime 接口。
 *
 * 核心能力：
 * - 纯参数驱动：name, instructions, tools, handoffs 全部由调用方传入
 * - FileSession：JSONL 持久化，带序号的 SessionItem 格式（智能上下文构建）
 * - 完整流式事件：覆盖 doc 15 所有 RunStreamEvent（text, reasoning, tool, handoff, approval 等）
 * - HITL 工具审批：暂停/审批/恢复执行流程
 * - Handoff 支持：SDK 原生 Agent 间切换
 * - maxTurns：防止无限工具调用循环
 */

import { run, Agent, tool } from '@openai/agents'
import type { StreamedRunResult, RunState, RunToolApprovalItem, Tool } from '@openai/agents'
import { FileSession } from './FileSession'
import { SessionCompressor } from './SessionCompressor'
import { ThinkTagParser, stripThinkTags } from './ThinkTagParser'
import { createStreamEmitter, type IStreamEmitter } from '../../streaming/StreamEmitter'
import { AbstractAgentRuntime } from '../AbstractAgentRuntime'
import {
  buildInstructions,
  type ExecutionConfig,
  type ExecutionResult,
  type StreamChunk,
  type SessionInfo,
  type ToolApprovalInfo,
  type ToolDefinition
} from '../types'
import type { OpenAIAgentRuntimeOptions, ContextSnapshot, CompressionResult } from './types'

/** 默认最大执行轮次 */
const DEFAULT_MAX_TURNS = 25

/** 默认模型 */
const DEFAULT_MODEL = 'gpt-4o'

// ========== Logger ==========
// 尝试使用 electron-log（生产环境），fallback 到 console（测试环境）
// 这样无论在 Electron 还是 vitest 中都能输出日志

interface RuntimeLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
}

const createRuntimeLogger = (): RuntimeLogger => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createLogger } = require('@main/common/logger')
    return createLogger('agent-runtime') as RuntimeLogger
  } catch {
    // Electron 环境不可用（如测试），fallback 到 console
    const prefix = '[OpenAIAgentRuntime]'
    return {
      info: (msg: string, ...args: unknown[]) => console.log(`${prefix} ${msg}`, ...args),
      warn: (msg: string, ...args: unknown[]) => console.warn(`${prefix} ${msg}`, ...args),
      error: (msg: string, ...args: unknown[]) => console.error(`${prefix} ${msg}`, ...args),
      debug: (msg: string, ...args: unknown[]) => console.debug(`${prefix} ${msg}`, ...args)
    }
  }
}

const log = createRuntimeLogger()

/**
 * OpenAI Agent 运行时
 *
 * 基于 OpenAI Agents SDK 实现 AgentRuntime 接口。
 *
 * 职责：
 * 1. 根据传入的配置创建 SDK Agent
 * 2. 通过 FileSession 管理对话历史持久化
 * 3. 执行 Agent（同步/流式），输出完整的流式事件
 * 4. 处理 HITL 工具审批的暂停/恢复
 */
export class OpenAIAgentRuntime extends AbstractAgentRuntime {
  readonly type = 'agent' as const
  readonly id: string

  // Agent 配置（构造时传入，不可变）
  readonly options: OpenAIAgentRuntimeOptions

  // Agent 实例（initialize 后可用）
  private agent!: Agent

  // 会话
  private session!: FileSession
  private readonly sessionId: string

  // 流式输出
  private streamEmitter!: IStreamEmitter

  // Session 压缩器
  private compressor?: SessionCompressor

  // HITL 状态
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pendingState?: RunState<any, any>
  private pendingInterruptions: RunToolApprovalItem[] = []
  private _interrupted = false

  // 时间
  private createdAt: number

  constructor(options: OpenAIAgentRuntimeOptions) {
    super()
    this.options = options
    this.id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.sessionId = options.sessionId || `session-${Date.now()}`
    this.createdAt = Date.now()
  }

  get name(): string {
    return this.options.name
  }

  get interrupted(): boolean {
    return this._interrupted
  }

  get supportsHITL(): boolean {
    return true
  }

  // ========== 生命周期 ==========

  async initialize(): Promise<void> {
    // 1. 合并工具：sdkTools（SDK 原生）+ tools（统一 ToolDefinition 转换后）
    const allTools: Tool[] = [
      ...(this.options.sdkTools || []),
      ...this.convertTools(this.options.tools || [])
    ]

    // 2. 构建最终系统提示词：instructions + skills + appendInstructions
    const finalInstructions = buildInstructions(
      this.options.instructions,
      this.options.skills,
      this.options.appendInstructions
    )

    // 3. 创建 SDK Agent（纯配置，成本极低）
    this.agent = new Agent({
      name: this.options.name,
      instructions: finalInstructions,
      model: this.options.model || DEFAULT_MODEL,
      ...(this.options.modelSettings ? { modelSettings: this.options.modelSettings } : {}),
      ...(allTools.length > 0 ? { tools: allTools } : {}),
      ...(this.options.handoffs && this.options.handoffs.length > 0
        ? { handoffs: this.options.handoffs }
        : {})
    })

    // 2. 创建 FileSession（单层持久化）
    this.session = new FileSession(this.sessionId, this.options.sessionDir)

    // 3. 创建流式发射器
    this.streamEmitter = createStreamEmitter(this.sessionId, {
      type: 'agent',
      id: this.id,
      name: this.name
    })

    // 4. 创建 Session 压缩器（如果配置启用）
    if (this.options.compression?.enabled) {
      this.compressor = new SessionCompressor(this.options.compression)
    }

    log.info(
      `Initialized: ${this.name} ` +
        `(tools: ${allTools.length}, ` +
        `skills: ${this.options.skills?.length || 0}, ` +
        `handoffs: ${this.options.handoffs?.length || 0}, ` +
        `compression: ${this.options.compression?.enabled ? 'on' : 'off'}, ` +
        `session: ${this.sessionId})`
    )
  }

  async destroy(): Promise<void> {
    this.pendingState = undefined
    this.pendingInterruptions = []
    this._interrupted = false
    log.info(`Destroyed: ${this.name}`)
  }

  // ========== 执行方法 ==========

  // run() 由基类 AbstractAgentRuntime 提供（消费 stream()，自动继承快照功能）

  /**
   * 流式执行 Agent（核心实现 — 由基类 stream() 模板方法包装）
   *
   * 8 层闭环事件输出：
   *   run:start → turn:start → llm:start → { text:*, reasoning:*, tool:* } → llm:done → turn:done → run:done
   *
   * SDK 的 StreamedRunResult 本身是 AsyncIterable，直接 for await + yield。
   */
  protected async *doStream(
    input: string,
    config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const startTime = Date.now()
    const maxTurns = config?.maxTurns ?? this.options.maxTurns ?? DEFAULT_MAX_TURNS

    log.info(`Running stream: ${this.name}`)

    try {
      // 1. run:start
      yield { type: 'run:start', content: '' }

      // 1.5 执行前检查 session 压缩
      const compressionChunks = await this.compressSessionWithChunks()
      for (const chunk of compressionChunks) {
        yield chunk
      }

      // 2. SDK 流式执行
      const streamRunResult = await run(this.agent, input, {
        stream: true,
        session: this.session,
        maxTurns
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const streamResult = streamRunResult as StreamedRunResult<unknown, any>

      // 3. 消费流事件（AsyncGenerator — 直接 yield）
      let fullOutput = ''
      for await (const chunk of this.generateStreamEvents(streamResult, (text) => {
        fullOutput += text
      })) {
        yield chunk
      }

      // 4. 等待完成
      await streamResult.completed

      // 5. 检查 HITL 中断
      if (streamResult.interruptions && streamResult.interruptions.length > 0) {
        const interruptResult = this.handleInterruptions(
          streamResult.state,
          streamResult.interruptions,
          startTime
        )
        // 发送 hitl:required 事件
        for (let i = 0; i < streamResult.interruptions.length; i++) {
          const item = streamResult.interruptions[i]
          yield {
            type: 'hitl:required',
            content: `Approval required: ${item.name || 'unknown'}`,
            data: {
              index: i,
              toolName: item.name || 'unknown',
              arguments: item.arguments,
              approvalItem: item
            }
          }
        }
        // run:interrupted
        yield { type: 'run:interrupted', content: '' }
        return interruptResult
      }

      const rawOutput = (streamResult.finalOutput as string) || fullOutput
      const output = stripThinkTags(rawOutput) || rawOutput

      // 7. run:done
      yield { type: 'run:done', content: '' }

      const duration = Date.now() - startTime

      return {
        output,
        toolCalls: this.extractToolCalls(streamResult.newItems),
        duration,
        metadata: {
          agentId: this.id,
          sessionId: this.sessionId
        }
      }
    } catch (error: unknown) {
      yield {
        type: 'run:error',
        content: error instanceof Error ? error.message : String(error),
        data: { message: error instanceof Error ? error.message : String(error) }
      }
      log.error(`Stream execution failed:`, error)
      throw error
    }
  }

  // runStream() 由基类 AbstractAgentRuntime 提供

  // ========== HITL 工具审批 ==========

  /**
   * 批准工具调用
   */
  approveToolCall(index: number, options?: { alwaysApprove?: boolean }): void {
    if (!this._interrupted || !this.pendingState) {
      throw new Error('No pending interruption to approve')
    }
    const item = this.pendingInterruptions[index]
    if (!item) {
      throw new Error(`Invalid interruption index: ${index}`)
    }
    this.pendingState.approve(item, options)
    log.info(`Approved tool call: ${item.name} (index: ${index})`)
  }

  /**
   * 拒绝工具调用
   */
  rejectToolCall(index: number, options?: { alwaysReject?: boolean }): void {
    if (!this._interrupted || !this.pendingState) {
      throw new Error('No pending interruption to reject')
    }
    const item = this.pendingInterruptions[index]
    if (!item) {
      throw new Error(`Invalid interruption index: ${index}`)
    }
    this.pendingState.reject(item, options)
    log.info(`Rejected tool call: ${item.name} (index: ${index})`)
  }

  /**
   * 恢复被中断的执行（同步模式）
   */
  async resume(): Promise<ExecutionResult> {
    if (!this._interrupted || !this.pendingState) {
      throw new Error('No pending interruption to resume')
    }

    const startTime = Date.now()
    const maxTurns = this.options.maxTurns ?? DEFAULT_MAX_TURNS

    log.info(`Resuming execution: ${this.name}`)

    try {
      // 传入之前的 RunState 继续执行
      const result = await run(this.agent, this.pendingState, {
        session: this.session,
        maxTurns
      })

      // 清除中断状态
      this._interrupted = false
      this.pendingState = undefined
      this.pendingInterruptions = []

      // 检查是否再次中断
      if (result.interruptions && result.interruptions.length > 0) {
        return this.handleInterruptions(result.state, result.interruptions, startTime)
      }

      const rawOutput = (result.finalOutput as string) || ''
      return {
        output: stripThinkTags(rawOutput) || rawOutput,
        toolCalls: this.extractToolCalls(result.newItems),
        duration: Date.now() - startTime,
        metadata: {
          agentId: this.id,
          sessionId: this.sessionId
        }
      }
    } catch (error: unknown) {
      log.error(`Resume failed:`, error)
      throw error
    }
  }

  /**
   * 恢复被中断的流式执行（AsyncGenerator 模式）
   */
  async *resumeStream(
    config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    if (!this._interrupted || !this.pendingState) {
      throw new Error('No pending interruption to resume')
    }

    const startTime = Date.now()
    const maxTurns = config?.maxTurns ?? this.options.maxTurns ?? DEFAULT_MAX_TURNS

    log.info(`Resuming stream execution: ${this.name}`)

    try {
      yield { type: 'run:resumed', content: '' }

      const streamRunResult = await run(this.agent, this.pendingState, {
        stream: true,
        session: this.session,
        maxTurns
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const streamResult = streamRunResult as StreamedRunResult<unknown, any>

      // 清除中断状态
      this._interrupted = false
      this.pendingState = undefined
      this.pendingInterruptions = []

      let fullOutput = ''
      for await (const chunk of this.generateStreamEvents(streamResult, (text) => {
        fullOutput += text
      })) {
        yield chunk
      }

      await streamResult.completed

      // 检查是否再次中断
      if (streamResult.interruptions && streamResult.interruptions.length > 0) {
        const interruptResult = this.handleInterruptions(
          streamResult.state,
          streamResult.interruptions,
          startTime
        )
        yield { type: 'run:interrupted', content: '' }
        return interruptResult
      }

      const rawOutput = (streamResult.finalOutput as string) || fullOutput
      const output = stripThinkTags(rawOutput) || rawOutput

      yield { type: 'run:done', content: '' }

      return {
        output,
        toolCalls: this.extractToolCalls(streamResult.newItems),
        duration: Date.now() - startTime,
        metadata: {
          agentId: this.id,
          sessionId: this.sessionId
        }
      }
    } catch (error: unknown) {
      yield {
        type: 'run:error',
        content: error instanceof Error ? error.message : String(error),
        data: { message: error instanceof Error ? error.message : String(error) }
      }
      throw error
    }
  }

  // ========== 会话管理 ==========

  async getSession(): Promise<SessionInfo> {
    const count = await this.session.getItemCount()
    return {
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      messageCount: count,
      metadata: {
        agentId: this.id,
        agentName: this.name
      }
    }
  }

  async clearSession(): Promise<void> {
    log.info(`Clearing session: ${this.sessionId}`)
    await this.session.clearSession()
  }

  /**
   * 获取上下文快照（调试/监控用）
   *
   * 返回当前 Session 的完整状态：
   *   - contextItems：getItems() 返回的内容（即下次 LLM 调用时的上下文）
   *   - allSessionItems：getAllSessionItems() 返回的完整存储记录
   *   - lastSummary：最后一个 summary 的元数据
   *   - stats：统计信息（消息数、summary 数、总 token 估算）
   */
  async getContextSnapshot(): Promise<ContextSnapshot> {
    const contextItems = await this.session.getItems()
    const allSessionItems = await this.session.getAllSessionItems()
    const lastSummary = await this.session.getLastSummary()

    const messageCount = allSessionItems.filter((si) => si.type === 'message').length
    const summaryCount = allSessionItems.filter((si) => si.type === 'summary').length

    return {
      contextItems,
      allSessionItems,
      lastSummary: lastSummary || null,
      stats: {
        contextItemCount: contextItems.length,
        totalSessionItems: allSessionItems.length,
        messageCount,
        summaryCount
      }
    }
  }

  // ========== 内部方法 ==========

  /**
   * SDK 流事件 → StreamChunk AsyncGenerator
   *
   * 嵌套关系：
   *   run ⊃ turn ⊃ llm ⊃ { reasoning, text, tool } + hitl + handoff
   *
   * 关键改进（v2）：
   *   通过 ThinkTagParser 将 <think>...</think> 标签实时拆分为
   *   独立的 reasoning:start/delta/done 事件，text:delta 只包含纯净文本。
   *   前端零解析负担。
   *
   * 内部使用缓冲数组收集 ThinkTagParser 回调产生的同步 chunk，
   * 然后在每次 SDK 事件迭代后 yield 所有收集的 chunk。
   */
  private async *generateStreamEvents(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    streamResult: StreamedRunResult<unknown, any>,
    onTextDelta: (text: string) => void
  ): AsyncGenerator<StreamChunk, void, unknown> {
    let turnIndex = 0
    let turnOpen = false
    let textStartEmitted = false
    let reasoningStartEmitted = false
    let fullReasoningText = ''

    // 同步缓冲：ThinkTagParser 回调产生的 chunk 先存这里，每轮 yield
    const buffer: StreamChunk[] = []
    const emit = (chunk: StreamChunk): void => {
      buffer.push(chunk)
    }

    // ---- ThinkTagParser：实时拆分 <think> 标签 ----
    const thinkParser = new ThinkTagParser({
      onText: (text) => {
        if (!textStartEmitted) {
          textStartEmitted = true
          emit({ type: 'text:start', content: '' })
        }
        onTextDelta(text)
        emit({ type: 'text:delta', content: text, data: { delta: text } })
      },

      onReasoningStart: () => {
        if (!reasoningStartEmitted) {
          reasoningStartEmitted = true
          emit({ type: 'reasoning:start', content: '' })
        }
      },

      onReasoning: (text) => {
        fullReasoningText += text
        emit({ type: 'reasoning:delta', content: text, data: { delta: text } })
      },

      onReasoningDone: () => {
        emit({
          type: 'reasoning:done',
          content: '',
          data: { rawContent: fullReasoningText }
        })
      }
    })

    for await (const event of streamResult) {
      // 清空缓冲
      buffer.length = 0

      // ---- debug 日志：记录原始 SDK 事件 ----
      if (event.type === 'raw_model_stream_event') {
        const rawEvent = event.data as { type?: string; event?: { type?: string } } | undefined
        const rawType = rawEvent?.type
        const innerType = rawType === 'model' ? rawEvent?.event?.type : undefined
        log.debug(
          `[SDK Event] ${event.type} | rawType=${rawType}${innerType ? ` | innerType=${innerType}` : ''}`,
          JSON.stringify(event.data)
        )
      } else if (event.type === 'run_item_stream_event') {
        const itemType = (event.item as { type?: string })?.type
        log.debug(
          `[SDK Event] ${event.type} | name=${event.name} | itemType=${itemType}`,
          JSON.stringify(event.item?.rawItem ?? event.item)
        )
      } else {
        log.debug(`[SDK Event] ${event.type}`, JSON.stringify(event))
      }

      switch (event.type) {
        // ===== raw_model_stream_event =====
        case 'raw_model_stream_event': {
          const rawEvent = event.data
          if (!rawEvent || typeof rawEvent !== 'object') break
          const rawType = (rawEvent as { type?: string }).type

          // response_started → 关上一轮 + 开新一轮 + llm:start
          if (rawType === 'response_started') {
            thinkParser.flush()

            if (turnOpen) {
              emit({ type: 'turn:done', content: '', data: { turnIndex } })
            }
            turnIndex++
            turnOpen = true
            textStartEmitted = false
            reasoningStartEmitted = false
            fullReasoningText = ''
            thinkParser.reset()
            emit({ type: 'turn:start', content: '', data: { turnIndex } })
            emit({ type: 'llm:start', content: '' })
          }

          // output_text_delta → 通过 ThinkTagParser 分流
          if (rawType === 'output_text_delta') {
            const delta = (rawEvent as { delta?: string }).delta || ''
            if (delta) {
              thinkParser.feed(delta)
            }
          }

          // response_done → 关闭 reasoning/text + llm:done（携带 usage）
          if (rawType === 'response_done') {
            thinkParser.flush()

            const response = (rawEvent as { response?: Record<string, unknown> }).response
            const usage = response?.usage as
              | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
              | undefined

            if (reasoningStartEmitted && thinkParser.isInThinking) {
              emit({
                type: 'reasoning:done',
                content: '',
                data: { rawContent: fullReasoningText }
              })
            }

            if (textStartEmitted) {
              const outputs = response?.output as
                | Array<{
                    type?: string
                    content?: Array<{ text?: string }>
                  }>
                | undefined
              const msgOutput = outputs?.find((o) => o.type === 'message')
              const rawFullText = msgOutput?.content?.map((c) => c.text || '').join('') || ''
              const cleanText = stripThinkTags(rawFullText)
              emit({ type: 'text:done', content: cleanText, data: { text: cleanText } })
            }

            emit({
              type: 'llm:done',
              content: '',
              data: {
                responseId: response?.id as string | undefined,
                usage: usage
                  ? {
                      inputTokens: usage.inputTokens || 0,
                      outputTokens: usage.outputTokens || 0,
                      totalTokens: usage.totalTokens || 0
                    }
                  : undefined
              }
            })
          }

          break
        }

        // ===== run_item_stream_event =====
        case 'run_item_stream_event': {
          const item = event.item
          if (!item) break
          const eventName = event.name

          // tool_called → tool:start
          if (eventName === 'tool_called' && item.type === 'tool_call_item') {
            const rawItem = item.rawItem
            const toolName = (rawItem as { name?: string }).name || 'unknown'
            const callId = (rawItem as { call_id?: string }).call_id
            emit({ type: 'tool:start', content: toolName, data: { toolName, callId } })
          }

          // tool_output → tool:done
          if (eventName === 'tool_output') {
            const rawItem = (item as { rawItem?: Record<string, unknown> }).rawItem || {}
            const toolName = (rawItem as { name?: string }).name || 'unknown'
            const callId =
              (rawItem as { callId?: string; call_id?: string }).callId ||
              (rawItem as { call_id?: string }).call_id
            const output =
              (item as { output?: string }).output || (rawItem as { output?: string }).output || ''
            emit({
              type: 'tool:done',
              content: typeof output === 'string' ? output : JSON.stringify(output),
              data: { toolName, callId, output }
            })
          }

          // handoff: 请求
          if (eventName === 'handoff_requested') {
            const agentName =
              (item as unknown as { agent?: { name?: string } }).agent?.name || 'unknown'
            emit({
              type: 'handoff:start',
              content: `Handoff to ${agentName}`,
              data: { toAgent: agentName }
            })
          }

          // handoff: 完成
          if (eventName === 'handoff_occurred') {
            const targetAgent =
              (item as unknown as { targetAgent?: { name?: string } }).targetAgent?.name ||
              (item as unknown as { agent?: { name?: string } }).agent?.name ||
              'unknown'
            emit({
              type: 'handoff:done',
              content: `Switched to ${targetAgent}`,
              data: { toAgent: targetAgent }
            })
          }

          // hitl: 审批请求
          if (eventName === 'tool_approval_requested' && item.type === 'tool_approval_item') {
            const approvalItem = item as RunToolApprovalItem
            emit({
              type: 'hitl:required',
              content: `Approval required: ${approvalItem.name || 'unknown'}`,
              data: {
                index: this.pendingInterruptions.length,
                toolName: approvalItem.name || 'unknown',
                arguments: approvalItem.arguments,
                approvalItem
              }
            })
          }

          break
        }

        // ===== agent_updated_stream_event =====
        case 'agent_updated_stream_event': {
          const agentName = event.agent?.name || 'unknown'
          await this.streamEmitter.emit('agent_updated', `Agent updated: ${agentName}`, {
            agentName
          })
          break
        }
      }

      // yield 本轮收集的所有 chunk
      for (const chunk of buffer) {
        yield chunk
      }
    }

    // 关闭最后一轮
    if (turnOpen) {
      thinkParser.flush()
      // flush 可能产生额外 chunk
      for (const chunk of buffer) {
        yield chunk
      }
      yield { type: 'turn:done', content: '', data: { turnIndex } }
    }
  }

  /**
   * 处理 HITL 中断
   */
  private handleInterruptions(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state: RunState<any, any>,
    interruptions: RunToolApprovalItem[],
    startTime: number
  ): ExecutionResult {
    this._interrupted = true
    this.pendingState = state
    this.pendingInterruptions = interruptions

    const approvalInfos: ToolApprovalInfo[] = interruptions.map((item, index) => ({
      index,
      toolName: item.name || 'unknown',
      arguments: item.arguments || '{}'
    }))

    log.info(`Execution interrupted: ${interruptions.length} tool(s) need approval`)

    return {
      output: '',
      interrupted: true,
      interruptions: approvalInfos,
      duration: Date.now() - startTime,
      metadata: {
        agentId: this.id,
        sessionId: this.sessionId,
        interruptionCount: interruptions.length
      }
    }
  }

  /**
   * 从 RunItem[] 中提取工具调用记录
   */
  private extractToolCalls(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    newItems: any[]
  ): ExecutionResult['toolCalls'] {
    if (!newItems) return []

    return (
      newItems
        .filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (item: any) => item.type === 'tool_call_item' && item.rawItem?.type === 'function_call'
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((item: any) => {
          const rawItem = item.rawItem
          let parsedArgs: Record<string, unknown> = {}
          try {
            parsedArgs = JSON.parse(rawItem.arguments || '{}') as Record<string, unknown>
          } catch {
            // ignore
          }
          return {
            toolName: rawItem.name || 'unknown',
            arguments: parsedArgs,
            result: rawItem.output
          }
        })
    )
  }

  /**
   * 将统一 ToolDefinition 转换为 @openai/agents SDK 原生 Tool
   *
   * 核心映射：
   *   - needUserConfirm → SDK needsApproval（HITL 审批触发）
   *   - execute 前检查工具策略（isToolAllowed，sandbox 级别拦截）
   *   - yield 的 ToolStreamUpdate 通过 StreamEmitter 发送 tool:delta 事件给前端
   *   - return 的 ToolResult.llmContent 作为工具返回值发送回 LLM
   *   - 自动注入 SandboxContext（路径边界、工具策略、Docker 等）
   */
  private convertTools(defs: ToolDefinition[]): Tool[] {
    if (!defs.length) return []

    // 优先使用注入的沙箱上下文，否则降级为 path-only
    const sandboxContext: import('../../sandbox/types').SandboxContext = this.options
      .sandboxContext || {
      mode: 'path-only',
      workspaceRoot: this.options.workspaceRoot || process.cwd(),
      toolPolicy: { allow: [], deny: [] },
      sessionId: this.sessionId
    }

    return defs.map((def) =>
      tool({
        name: def.name,
        description: def.description,
        parameters: def.parameters,
        // HITL: 将工具定义的 needUserConfirm 映射为 SDK 的 needsApproval
        // needsApproval=true → SDK 自动触发 tool_approval_requested 事件
        needsApproval: def.needUserConfirm ?? false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        execute: async (params: any) => {
          let typedParams = params as Record<string, unknown>
          const toolStartTime = Date.now()

          // === Extension Hook: before_tool_call ===
          try {
            const { ExtensionManager } = await import('../../../common/extension')
            const runner = ExtensionManager.getHookRunner()
            if (runner) {
              const hookResult = await runner.runModifyingHook('before_tool_call', {
                sessionId: sandboxContext.sessionId || '',
                toolName: def.name,
                params: typedParams
              })
              if (hookResult) {
                if (hookResult.block) {
                  return `Error: Tool blocked by extension — ${hookResult.blockReason || 'no reason'}`
                }
                if (hookResult.params) {
                  typedParams = { ...typedParams, ...hookResult.params }
                }
              }
            }
          } catch {
            // Extension hook 失败不阻断工具执行
          }

          // 工具策略检查：sandbox 级别拦截
          const { isToolAllowed, formatToolBlockedMessage } = await import('../../sandbox')
          if (!isToolAllowed(def.name, sandboxContext.toolPolicy)) {
            const msg = formatToolBlockedMessage(
              def.name,
              sandboxContext.toolPolicy as import('../../sandbox/types').ResolvedToolPolicy
            )
            log.warn(`[Tool Policy] ${msg}`)
            return `Error: ${msg}`
          }

          const gen = def.execute(typedParams, undefined, sandboxContext)
          let iterResult = await gen.next()

          // 消费 AsyncGenerator 的增量输出
          while (!iterResult.done) {
            const update = iterResult.value
            // 桥接到 StreamChunk: tool:delta → forward 自动映射为 StreamMessage
            this.streamEmitter?.forward({
              type: 'tool:delta',
              content: update.content,
              data: { delta: update.content }
            })
            iterResult = await gen.next()
          }

          // 最终结果
          const toolResult = iterResult.value
          let resultText =
            toolResult.llmContent ||
            (toolResult.success ? 'Success' : `Error: ${toolResult.error?.message || 'unknown'}`)

          // === Extension Hook: after_tool_call (void) + tool_result_persist (modifying) ===
          try {
            const { ExtensionManager } = await import('../../../common/extension')
            const runner = ExtensionManager.getHookRunner()
            if (runner) {
              const toolDuration = Date.now() - toolStartTime
              await runner.runVoidHook('after_tool_call', {
                sessionId: sandboxContext.sessionId || '',
                toolName: def.name,
                params: typedParams,
                result: resultText,
                durationMs: toolDuration
              })

              const persistResult = await runner.runModifyingHook('tool_result_persist', {
                sessionId: sandboxContext.sessionId || '',
                toolName: def.name,
                result: resultText
              })
              if (persistResult?.result) {
                resultText = persistResult.result
              }
            }
          } catch {
            // Extension hook 失败不阻断
          }

          return resultText
        }
      })
    )
  }

  // ========== Session 压缩 ==========

  /**
   * 检查并执行 session 压缩（如果需要），返回产生的 StreamChunk 数组
   */
  private async compressSessionWithChunks(): Promise<StreamChunk[]> {
    if (!this.compressor) return []

    const chunks: StreamChunk[] = []

    try {
      const model = this.options.model || DEFAULT_MODEL

      const status = await this.compressor.getCompressionStatus(this.session)
      const result = await this.compressor.compressIfNeeded(this.session, model)

      if (result.compressed && status) {
        chunks.push({
          type: 'compression:start',
          content: 'Session compression triggered',
          data: {
            reason: `tokens ${status.totalTokens} >= threshold ${status.threshold}`,
            totalTokens: status.totalTokens,
            threshold: status.threshold
          }
        })
        chunks.push({
          type: 'compression:done',
          content: `Compressed ${result.summarizedCount} messages`,
          data: {
            summarizedSeqs: result.summarizedSeqs || [],
            endSeq: result.endSeq || 0,
            originalTokens: result.originalTokens || 0,
            summaryTokens: result.summaryTokens || 0,
            compressionRatio: result.compressionRatio || 0,
            duration: result.duration || 0
          }
        })

        log.info(
          `Session compressed: ` +
            `${result.summarizedCount} messages summarized ` +
            `(seq ${result.summarizedSeqs?.[0]}-${result.endSeq}), ` +
            `${result.keptCount} kept, ${result.duration}ms`
        )
      }
    } catch (error) {
      log.error('Session compression failed (non-fatal):', error)
    }

    return chunks
  }

  /**
   * 手动触发 session 压缩
   */
  async compressSession(options?: { force?: boolean }): Promise<CompressionResult> {
    const model = this.options.model || DEFAULT_MODEL

    if (options?.force) {
      const forceCompressor = new SessionCompressor({
        enabled: true,
        minMessageCount: 2,
        contextWindowSize: 1,
        thresholdRatio: 0,
        keepRatio: this.options.compression?.keepRatio ?? 0.3,
        summaryModel: this.options.compression?.summaryModel,
        debug: this.options.compression?.debug
      })
      return forceCompressor.compressIfNeeded(this.session, model)
    }

    const compressor =
      this.compressor ||
      new SessionCompressor({
        enabled: true,
        ...(this.options.compression || {})
      })

    return compressor.compressIfNeeded(this.session, model)
  }
}
