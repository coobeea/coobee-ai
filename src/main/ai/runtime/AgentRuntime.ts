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

    console.log(
      `[AgentRuntime] Initialized: ${this.name} ` +
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
    console.log(`[AgentRuntime] Destroyed: ${this.name}`)
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

    console.log(`[AgentRuntime] Running: ${this.name}, input: "${input.slice(0, 100)}"`)

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
      console.error(`[AgentRuntime] Execution failed:`, error)
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

    console.log(`[AgentRuntime] Running stream: ${this.name}`)

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
      console.error(`[AgentRuntime] Stream execution failed:`, error)
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
    console.log(`[AgentRuntime] Approved tool call: ${item.name} (index: ${index})`)
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
    console.log(`[AgentRuntime] Rejected tool call: ${item.name} (index: ${index})`)
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

    console.log(`[AgentRuntime] Resuming execution: ${this.name}`)

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
      console.error(`[AgentRuntime] Resume failed:`, error)
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

    console.log(`[AgentRuntime] Resuming stream execution: ${this.name}`)

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
    console.log(`[AgentRuntime] Clearing session: ${this.sessionId}`)
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
   * Turn 边界检测：
   *   - turn:start ← 每次 response_started 时触发
   *   - turn:done ← tool_output 后 / 无工具时 llm:done 后
   *
   * SDK 事件来源：
   *   Layer 1: raw_model_stream_event → llm:start/done, text:start/delta, reasoning:start/delta, tool:delta/pending
   *   Layer 2: run_item_stream_event → tool:start, tool:done, handoff:*, hitl:required, text:done, reasoning:done
   *   Layer 3: agent_updated_stream_event → handoff 辅助
   */
  private async consumeStreamEvents(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    streamResult: StreamedRunResult<unknown, any>,
    onChunk: (chunk: StreamChunk) => void,
    onTextDelta: (text: string) => void
  ): Promise<void> {
    // Turn 状态追踪
    let turnIndex = 0
    let turnOpen = false

    // 闭环 start 事件追踪（Chat Completions 模式下自动补发）
    let textStartEmitted = false
    let reasoningStartEmitted = false
    // tool:start 按 callId 追踪
    const toolStartEmittedSet = new Set<string>()

    const closeTurn = (): void => {
      if (turnOpen) {
        turnOpen = false
        onChunk({ type: 'turn:done', content: '', data: { turnIndex } })
      }
    }

    const openTurn = (): void => {
      // 先关闭上一个 turn（确保 tool 事件包含在 turn 内）
      closeTurn()
      turnIndex++
      turnOpen = true
      onChunk({ type: 'turn:start', content: '', data: { turnIndex } })
    }

    for await (const event of streamResult) {
      switch (event.type) {
        // ===== Layer 1: 原始模型流事件 =====
        case 'raw_model_stream_event': {
          const rawEvent = event.data
          if (!rawEvent || typeof rawEvent !== 'object') break

          const rawType = (rawEvent as { type?: string }).type

          // ---- ③ llm: 模型调用 ----

          // llm:start + turn:start
          if (rawType === 'response_started') {
            openTurn()
            onChunk({ type: 'llm:start', content: '' })
          }

          // llm:done
          if (rawType === 'response_done') {
            const response = (rawEvent as { response?: Record<string, unknown> }).response
            const usage = response?.usage as
              | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
              | undefined
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

            // 重置 start 追踪（下一轮 LLM 需要重新检测）
            textStartEmitted = false
            reasoningStartEmitted = false

            // 注意：不在这里关闭 turn。
            // Chat Completions 模式下，tool_called/tool_output 事件在 response_done 之后到达，
            // 如果这里就 closeTurn()，tool 事件会落在 turn 之外。
            // 正确做法：turn 由下一个 openTurn()（即 response_started）或流结束时的 closeTurn() 关闭，
            // 这样 tool 事件始终被包含在当前 turn 内。
          }

          // ---- ④ text: 文本增量 ----

          if (rawType === 'output_text_delta') {
            const delta = (rawEvent as { delta?: string }).delta || ''
            if (delta) {
              // 自动补发 text:start（Chat Completions 模式下无 output_item.added）
              if (!textStartEmitted) {
                textStartEmitted = true
                onChunk({ type: 'text:start', content: '' })
              }
              onTextDelta(delta)
              await this.streamEmitter.emitText(delta)
              onChunk({ type: 'text:delta', content: delta, data: { delta } })
            }
          }

          // ---- model 透传事件 ----

          if (rawType === 'model') {
            const raw = (rawEvent as { event?: Record<string, unknown> }).event
            if (!raw) break
            const rawEventType = (raw as { type?: string }).type

            // output_item.added → text:start / reasoning:start / tool:start
            if (rawEventType === 'response.output_item.added') {
              const item = (raw as { item?: { type?: string } }).item
              if (item?.type === 'message') {
                textStartEmitted = true
                onChunk({ type: 'text:start', content: '' })
              }
              if (item?.type === 'reasoning') {
                reasoningStartEmitted = true
                onChunk({ type: 'reasoning:start', content: '' })
              }
              if (item?.type === 'function_call') {
                const toolName = (item as { name?: string }).name || 'unknown'
                const callId = (item as { call_id?: string }).call_id
                if (callId) toolStartEmittedSet.add(callId)
                onChunk({
                  type: 'tool:start',
                  content: toolName,
                  data: { toolName, callId }
                })
              }
            }

            // ⑤ reasoning: 增量
            if (
              rawEventType === 'response.reasoning_text.delta' ||
              rawEventType === 'response.reasoning_summary_text.delta'
            ) {
              const delta = (raw as { delta?: string }).delta || ''
              if (delta) {
                // 自动补发 reasoning:start
                if (!reasoningStartEmitted) {
                  reasoningStartEmitted = true
                  onChunk({ type: 'reasoning:start', content: '' })
                }
                await this.streamEmitter.emitThinking(delta)
                onChunk({ type: 'reasoning:delta', content: delta, data: { delta } })
              }
            }

            // ⑥ tool: 参数增量
            if (rawEventType === 'response.function_call_arguments.delta') {
              const delta = (raw as { delta?: string }).delta || ''
              const callId = (raw as { call_id?: string }).call_id
              if (delta) {
                // 自动补发 tool:start（Chat Completions 模式下无 output_item.added）
                if (callId && !toolStartEmittedSet.has(callId)) {
                  toolStartEmittedSet.add(callId)
                  onChunk({
                    type: 'tool:start',
                    content: '',
                    data: { toolName: 'unknown', callId }
                  })
                }
                onChunk({
                  type: 'tool:delta',
                  content: delta,
                  data: { delta, callId }
                })
              }
            }

            // ⑥ tool: 参数完成 → tool:pending（等待执行）
            if (rawEventType === 'response.function_call_arguments.done') {
              const args = (raw as { arguments?: string }).arguments || '{}'
              const callId = (raw as { call_id?: string }).call_id
              onChunk({
                type: 'tool:pending',
                content: '',
                data: { callId, arguments: args }
              })
            }
          }

          break
        }

        // ===== Layer 2: SDK RunItem 事件 =====
        case 'run_item_stream_event': {
          const item = event.item
          if (!item) break

          const eventName = event.name

          // ⑥ tool: 开始（备用路径 —— 当 model 透传未触发 tool:start 时）
          if (eventName === 'tool_called' && item.type === 'tool_call_item') {
            const rawItem = item.rawItem
            const toolName = (rawItem as { name?: string }).name || 'unknown'
            const callId = (rawItem as { call_id?: string }).call_id
            let parsedArgs: Record<string, unknown> = {}
            try {
              const argsStr = (rawItem as { arguments?: string }).arguments || '{}'
              parsedArgs = JSON.parse(argsStr) as Record<string, unknown>
            } catch {
              // 参数解析失败
            }
            // 自动补发 tool:start（如果之前的路径未触发）
            const toolKey = callId || toolName
            if (!toolStartEmittedSet.has(toolKey)) {
              toolStartEmittedSet.add(toolKey)
              onChunk({
                type: 'tool:start',
                content: toolName,
                data: { toolName, callId }
              })
            }
            await this.streamEmitter.emitToolCall(toolName, parsedArgs)
          }

          // ⑥ tool: 执行完成 → tool:done
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

            // 不在这里关闭 turn —— turn 由下一个 openTurn() 或流结束时统一关闭
          }

          // ⑧ handoff: 请求
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

          // ⑧ handoff: 完成
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

          // ⑦ hitl: 审批请求
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

          // ⑤ reasoning: 完成
          if (eventName === 'reasoning_item_created') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rawItem = (item as any).rawItem as
              | {
                  content?: Array<{ text?: string }>
                  rawContent?: Array<{ text?: string }>
                }
              | undefined
            const summary = rawItem?.content?.map((c) => c.text).join('') || ''
            const rawContent = rawItem?.rawContent?.map((c) => c.text).join('') || undefined
            onChunk({
              type: 'reasoning:done',
              content: summary || 'Reasoning completed',
              data: { summary, rawContent }
            })
          }

          // ④ text: 完成
          if (eventName === 'message_output_created') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const fullText = (item as any).content || ''
            onChunk({
              type: 'text:done',
              content: fullText,
              data: { text: fullText }
            })
          }

          break
        }

        // ===== Layer 3: Agent 切换事件 =====
        case 'agent_updated_stream_event': {
          const agentName = event.agent?.name || 'unknown'
          await this.streamEmitter.emitAgentUpdated(agentName)
          // agent_updated 不单独映射到新事件，handoff:done 已覆盖
          break
        }
      }
    }

    // 确保最后一个 turn 关闭
    closeTurn()
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

    console.log(
      `[AgentRuntime] Execution interrupted: ${interruptions.length} tool(s) need approval`
    )

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

        console.log(
          `[AgentRuntime] Session compressed: ` +
            `${result.summarizedCount} messages summarized ` +
            `(seq ${result.summarizedSeqs?.[0]}-${result.endSeq}), ` +
            `${result.keptCount} kept, ${result.duration}ms`
        )
      }

      return result
    } catch (error) {
      console.error('[AgentRuntime] Session compression failed (non-fatal):', error)
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
