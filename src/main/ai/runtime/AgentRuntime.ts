/**
 * Agent 运行时
 *
 * SDK 原生优先的薄封装，所有配置通过参数传入。
 *
 * 核心能力：
 * - 纯参数驱动：name, instructions, tools, handoffs 全部由调用方传入
 * - FileSession：JSONL 持久化，带序号的 SessionItem 格式（智能上下文构建）
 * - 完整流式事件：覆盖 doc 15 所有 RunStreamEvent（text, reasoning, tool, handoff, approval 等）
 * - HITL 工具审批：暂停/审批/恢复执行流程
 * - Handoff 支持：SDK 原生 Agent 间切换
 * - maxTurns：防止无限工具调用循环
 */

import { run, Agent } from '@openai/agents'
import type { StreamedRunResult, RunState, RunToolApprovalItem } from '@openai/agents'
import { FileSession } from './FileSession'
import { SessionCompressor } from './SessionCompressor'
import { createStreamEmitter, type IStreamEmitter } from '../streaming/StreamEmitter'
import type {
  AgentRuntimeOptions,
  IExecutable,
  ExecutionConfig,
  ExecutionResult,
  StreamChunk,
  SessionInfo,
  ContextSnapshot,
  ToolApprovalInfo,
  CompressionResult
} from './types'

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
    const prefix = '[AgentRuntime]'
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
 * Agent 运行时
 *
 * 职责：
 * 1. 根据传入的配置创建 SDK Agent
 * 2. 通过 FileSession 管理对话历史持久化
 * 3. 执行 Agent（同步/流式），输出完整的流式事件
 * 4. 处理 HITL 工具审批的暂停/恢复
 */
export class AgentRuntime implements IExecutable {
  readonly type = 'agent' as const
  readonly id: string

  // Agent 配置（构造时传入，不可变）
  private readonly options: AgentRuntimeOptions

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

  constructor(options: AgentRuntimeOptions) {
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

  // ========== 生命周期 ==========

  async initialize(): Promise<void> {
    // 1. 创建 SDK Agent（纯配置，成本极低）
    this.agent = new Agent({
      name: this.options.name,
      instructions: this.options.instructions,
      model: this.options.model || DEFAULT_MODEL,
      ...(this.options.modelSettings ? { modelSettings: this.options.modelSettings } : {}),
      ...(this.options.tools && this.options.tools.length > 0 ? { tools: this.options.tools } : {}),
      ...(this.options.handoffs && this.options.handoffs.length > 0
        ? { handoffs: this.options.handoffs }
        : {})
    })

    // 2. 创建 FileSession（单层持久化）
    this.session = new FileSession(this.sessionId)

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
        `(tools: ${this.options.tools?.length || 0}, ` +
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

  /**
   * 同步执行 Agent
   *
   * SDK 特性：
   * - session：自动管理对话历史读写（FileSession JSONL 持久化）
   * - maxTurns：防止无限工具调用循环
   * - interruptions：HITL 工具审批
   */
  async run(input: string, config?: ExecutionConfig): Promise<ExecutionResult> {
    const startTime = Date.now()
    const maxTurns = config?.maxTurns ?? this.options.maxTurns ?? DEFAULT_MAX_TURNS

    log.info(`Running: ${this.name}, input: "${input.slice(0, 100)}"`)

    try {
      // 执行前检查 session 压缩
      await this.compressSessionIfNeeded()

      const result = await run(this.agent, input, {
        session: this.session,
        maxTurns
      })

      // 检查 HITL 中断
      if (result.interruptions && result.interruptions.length > 0) {
        return this.handleInterruptions(result.state, result.interruptions, startTime)
      }

      const duration = Date.now() - startTime

      return {
        output: (result.finalOutput as string) || '',
        toolCalls: this.extractToolCalls(result.newItems),
        duration,
        metadata: {
          agentId: this.id,
          sessionId: this.sessionId
        }
      }
    } catch (error: unknown) {
      log.error(`Execution failed:`, error)
      throw error
    }
  }

  /**
   * 流式执行 Agent
   *
   * 8 层闭环事件输出：
   *   run:start → turn:start → llm:start → { text:*, reasoning:*, tool:* } → llm:done → turn:done → run:done
   */
  async runStream(
    input: string,
    config: ExecutionConfig,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult> {
    const startTime = Date.now()
    const maxTurns = config?.maxTurns ?? this.options.maxTurns ?? DEFAULT_MAX_TURNS

    log.info(`Running stream: ${this.name}`)

    try {
      // 1. run:start
      await this.streamEmitter.emitStart()
      onChunk({ type: 'run:start', content: '' })

      // 1.5 执行前检查 session 压缩（传入 onChunk 以发送压缩事件）
      await this.compressSessionIfNeeded(onChunk)

      // 2. SDK 流式执行
      const streamRunResult = await run(this.agent, input, {
        stream: true,
        session: this.session,
        maxTurns
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const streamResult = streamRunResult as StreamedRunResult<unknown, any>

      // 3. 消费流事件（内含 turn/llm/text/reasoning/tool/hitl/handoff 闭环）
      let fullOutput = ''
      await this.consumeStreamEvents(streamResult, onChunk, (text) => {
        fullOutput += text
      })

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
          onChunk({
            type: 'hitl:required',
            content: `Approval required: ${item.name || 'unknown'}`,
            data: {
              index: i,
              toolName: item.name || 'unknown',
              arguments: item.arguments,
              approvalItem: item
            }
          })
        }
        // run:interrupted
        onChunk({ type: 'run:interrupted', content: '' })
        await this.streamEmitter.emitDone()
        return interruptResult
      }

      const output = (streamResult.finalOutput as string) || fullOutput

      // 7. run:done
      await this.streamEmitter.emitDone()
      onChunk({ type: 'run:done', content: '' })

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
      await this.streamEmitter.emitError(error instanceof Error ? error : new Error(String(error)))
      onChunk({
        type: 'run:error',
        content: error instanceof Error ? error.message : String(error),
        data: { message: error instanceof Error ? error.message : String(error) }
      })
      log.error(`Stream execution failed:`, error)
      throw error
    }
  }

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

      return {
        output: (result.finalOutput as string) || '',
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
   * 恢复被中断的流式执行
   */
  async resumeStream(
    config: ExecutionConfig,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult> {
    if (!this._interrupted || !this.pendingState) {
      throw new Error('No pending interruption to resume')
    }

    const startTime = Date.now()
    const maxTurns = config?.maxTurns ?? this.options.maxTurns ?? DEFAULT_MAX_TURNS

    log.info(`Resuming stream execution: ${this.name}`)

    try {
      await this.streamEmitter.emitStart()
      onChunk({ type: 'run:resumed', content: '' })

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
      await this.consumeStreamEvents(streamResult, onChunk, (text) => {
        fullOutput += text
      })

      await streamResult.completed

      // 检查是否再次中断
      if (streamResult.interruptions && streamResult.interruptions.length > 0) {
        const interruptResult = this.handleInterruptions(
          streamResult.state,
          streamResult.interruptions,
          startTime
        )
        onChunk({ type: 'run:interrupted', content: '' })
        await this.streamEmitter.emitDone()
        return interruptResult
      }

      const output = (streamResult.finalOutput as string) || fullOutput

      await this.streamEmitter.emitDone()
      onChunk({ type: 'run:done', content: '' })

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
      await this.streamEmitter.emitError(error instanceof Error ? error : new Error(String(error)))
      onChunk({
        type: 'run:error',
        content: error instanceof Error ? error.message : String(error),
        data: { message: error instanceof Error ? error.message : String(error) }
      })
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
   * 消费 SDK 流事件，映射到 8 层闭环 StreamChunk
   *
   * 嵌套关系：
   *   run ⊃ turn ⊃ llm ⊃ { text, reasoning, tool } + hitl + handoff
   *
   * 核心信号（基于真实 SDK 事件流分析，见 docs/2.openai-sdk/17-sdk-stream-event-analysis.md）：
   *
   *   response_started  = 关闭上一轮 turn:done + 开启新一轮 turn:start + llm:start
   *   output_text_delta = text:delta（首次自动补 text:start）
   *   response_done     = llm:done（携带 usage）+ text:done
   *   tool_called       = tool:start
   *   tool_output       = tool:done
   *   流结束             = 关闭最后一轮 turn:done
   *
   * 一轮的完整生命周期：
   *   response_started → output_text_delta ×N → response_done
   *     → message_output_created → tool_called ×N → tool_output ×N
   *     → [下一个 response_started 触发 turn:done]
   */
  private async consumeStreamEvents(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    streamResult: StreamedRunResult<unknown, any>,
    onChunk: (chunk: StreamChunk) => void,
    onTextDelta: (text: string) => void
  ): Promise<void> {
    let turnIndex = 0
    let turnOpen = false
    let textStartEmitted = false

    for await (const event of streamResult) {
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
            if (turnOpen) {
              onChunk({ type: 'turn:done', content: '', data: { turnIndex } })
            }
            turnIndex++
            turnOpen = true
            textStartEmitted = false
            onChunk({ type: 'turn:start', content: '', data: { turnIndex } })
            onChunk({ type: 'llm:start', content: '' })
          }

          // output_text_delta → text:delta（首次自动补 text:start）
          if (rawType === 'output_text_delta') {
            const delta = (rawEvent as { delta?: string }).delta || ''
            if (delta) {
              if (!textStartEmitted) {
                textStartEmitted = true
                onChunk({ type: 'text:start', content: '' })
              }
              onTextDelta(delta)
              await this.streamEmitter.emitText(delta)
              onChunk({ type: 'text:delta', content: delta, data: { delta } })
            }
          }

          // response_done → llm:done（携带 usage）
          if (rawType === 'response_done') {
            const response = (rawEvent as { response?: Record<string, unknown> }).response
            const usage = response?.usage as
              | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
              | undefined
            // text:done（从 response_done.output 提取完整文本）
            if (textStartEmitted) {
              const outputs = response?.output as
                | Array<{
                    type?: string
                    content?: Array<{ text?: string }>
                  }>
                | undefined
              const msgOutput = outputs?.find((o) => o.type === 'message')
              const fullText = msgOutput?.content?.map((c) => c.text || '').join('') || ''
              onChunk({ type: 'text:done', content: fullText, data: { text: fullText } })
            }

            onChunk({
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
            // response_done 不是 turn 的结束
            // tool_called/tool_output 在 response_done 之后到达，仍属于当前 turn
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
            let parsedArgs: Record<string, unknown> = {}
            try {
              parsedArgs = JSON.parse(
                (rawItem as { arguments?: string }).arguments || '{}'
              ) as Record<string, unknown>
            } catch {
              // 参数解析失败
            }
            onChunk({ type: 'tool:start', content: toolName, data: { toolName, callId } })
            await this.streamEmitter.emitToolCall(toolName, parsedArgs)
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
            await this.streamEmitter.emitToolResult(toolName, output)
            onChunk({
              type: 'tool:done',
              content: typeof output === 'string' ? output : JSON.stringify(output),
              data: { toolName, callId, output }
            })
          }

          // handoff: 请求
          if (eventName === 'handoff_requested') {
            const agentName =
              (item as unknown as { agent?: { name?: string } }).agent?.name || 'unknown'
            await this.streamEmitter.emitHandoff(agentName)
            onChunk({
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
            await this.streamEmitter.emitHandoff(targetAgent)
            onChunk({
              type: 'handoff:done',
              content: `Switched to ${targetAgent}`,
              data: { toAgent: targetAgent }
            })
          }

          // hitl: 审批请求
          if (eventName === 'tool_approval_requested' && item.type === 'tool_approval_item') {
            const approvalItem = item as RunToolApprovalItem
            await this.streamEmitter.emitToolApproval(approvalItem.name || 'unknown')
            onChunk({
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
          await this.streamEmitter.emitAgentUpdated(agentName)
          break
        }
      }
    }

    // 关闭最后一轮
    if (turnOpen) {
      onChunk({ type: 'turn:done', content: '', data: { turnIndex } })
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

  // ========== Session 压缩 ==========

  /**
   * 检查并执行 session 压缩（如果需要）
   *
   * 在每次 run / runStream 前自动调用。
   * 压缩失败不影响主流程（只打日志）。
   *
   * @param onChunk 可选的流式事件回调（传入时发送 compression:start/done 事件）
   */
  private async compressSessionIfNeeded(
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<CompressionResult | null> {
    if (!this.compressor) return null

    try {
      const model = this.options.model || DEFAULT_MODEL

      // 获取压缩前的状态信息（用于 compression:start 事件）
      const status = await this.compressor.getCompressionStatus(this.session)

      const result = await this.compressor.compressIfNeeded(this.session, model)

      if (result.compressed) {
        // 发送压缩事件（仅在流式模式下）
        if (onChunk && status) {
          onChunk({
            type: 'compression:start',
            content: 'Session compression triggered',
            data: {
              reason: `tokens ${status.totalTokens} >= threshold ${status.threshold}`,
              totalTokens: status.totalTokens,
              threshold: status.threshold
            }
          })
          onChunk({
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
        }

        log.info(
          `Session compressed: ` +
            `${result.summarizedCount} messages summarized ` +
            `(seq ${result.summarizedSeqs?.[0]}-${result.endSeq}), ` +
            `${result.keptCount} kept, ${result.duration}ms`
        )
      }

      return result
    } catch (error) {
      log.error('Session compression failed (non-fatal):', error)
      return null
    }
  }

  /**
   * 手动触发 session 压缩
   *
   * 外部调用方可主动触发（例如在 UI 上提供"压缩对话"按钮）。
   * - force=true：跳过阈值检查，只要消息数 >= 2 就执行压缩
   * - 如果未配置压缩器，会创建一个临时压缩器执行一次
   */
  async compressSession(options?: { force?: boolean }): Promise<CompressionResult> {
    const model = this.options.model || DEFAULT_MODEL

    if (options?.force) {
      // force 模式：直接创建一个超低阈值的压缩器
      const forceCompressor = new SessionCompressor({
        enabled: true,
        minMessageCount: 2,
        contextWindowSize: 1, // 极小窗口，确保超过阈值
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
