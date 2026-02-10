/**
 * Agent 运行时
 *
 * SDK 原生优先的薄封装，所有配置通过参数传入。
 *
 * 核心能力：
 * - 纯参数驱动：name, instructions, tools, handoffs 全部由调用方传入
 * - FileSession：单层 JSONL 持久化，直接存储 SDK AgentInputItem
 * - 完整流式事件：覆盖 doc 15 所有 RunStreamEvent（text, reasoning, tool, handoff, approval 等）
 * - HITL 工具审批：暂停/审批/恢复执行流程
 * - Handoff 支持：SDK 原生 Agent 间切换
 * - previousResponseId：多轮对话延续
 * - maxTurns：防止无限工具调用循环
 */

import { run, Agent } from '@openai/agents'
import type { StreamedRunResult, RunState, RunToolApprovalItem } from '@openai/agents'
import { FileSession } from './FileSession'
import { createStreamEmitter, type IStreamEmitter } from '../streaming/StreamEmitter'
import type {
  AgentRuntimeOptions,
  IExecutable,
  ExecutionConfig,
  ExecutionResult,
  StreamChunk,
  SessionInfo,
  ToolApprovalInfo
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

  // 多轮对话延续
  private previousResponseId?: string

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

    console.log(
      `[AgentRuntime] Initialized: ${this.name} ` +
        `(tools: ${this.options.tools?.length || 0}, ` +
        `handoffs: ${this.options.handoffs?.length || 0}, ` +
        `session: ${this.sessionId})`
    )
  }

  async destroy(): Promise<void> {
    this.previousResponseId = undefined
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
   * - session：自动管理对话历史读写
   * - maxTurns：防止无限工具调用循环
   * - previousResponseId：多轮对话延续
   * - interruptions：HITL 工具审批
   */
  async run(input: string, config?: ExecutionConfig): Promise<ExecutionResult> {
    const startTime = Date.now()
    const maxTurns = config?.maxTurns ?? this.options.maxTurns ?? DEFAULT_MAX_TURNS

    console.log(`[AgentRuntime] Running: ${this.name}, input: "${input.slice(0, 100)}"`)

    try {
      const result = await run(this.agent, input, {
        session: this.session,
        maxTurns,
        ...(this.previousResponseId ? { previousResponseId: this.previousResponseId } : {})
      })

      // 检查 HITL 中断
      if (result.interruptions && result.interruptions.length > 0) {
        return this.handleInterruptions(result.state, result.interruptions, startTime)
      }

      // 保存 responseId
      if (result.lastResponseId) {
        this.previousResponseId = result.lastResponseId
      }

      const duration = Date.now() - startTime

      return {
        output: (result.finalOutput as string) || '',
        toolCalls: this.extractToolCalls(result.newItems),
        duration,
        metadata: {
          agentId: this.id,
          sessionId: this.sessionId,
          responseId: result.lastResponseId
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

      // 2. SDK 流式执行
      const streamRunResult = await run(this.agent, input, {
        stream: true,
        session: this.session,
        maxTurns,
        ...(this.previousResponseId ? { previousResponseId: this.previousResponseId } : {})
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

      // 6. 保存 responseId
      if (streamResult.lastResponseId) {
        this.previousResponseId = streamResult.lastResponseId
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
          sessionId: this.sessionId,
          responseId: streamResult.lastResponseId
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
        maxTurns,
        ...(this.previousResponseId ? { previousResponseId: this.previousResponseId } : {})
      })

      // 清除中断状态
      this._interrupted = false
      this.pendingState = undefined
      this.pendingInterruptions = []

      // 检查是否再次中断
      if (result.interruptions && result.interruptions.length > 0) {
        return this.handleInterruptions(result.state, result.interruptions, startTime)
      }

      if (result.lastResponseId) {
        this.previousResponseId = result.lastResponseId
      }

      return {
        output: (result.finalOutput as string) || '',
        toolCalls: this.extractToolCalls(result.newItems),
        duration: Date.now() - startTime,
        metadata: {
          agentId: this.id,
          sessionId: this.sessionId,
          responseId: result.lastResponseId
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
        maxTurns,
        ...(this.previousResponseId ? { previousResponseId: this.previousResponseId } : {})
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

      if (streamResult.lastResponseId) {
        this.previousResponseId = streamResult.lastResponseId
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
          sessionId: this.sessionId,
          responseId: streamResult.lastResponseId
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
    this.previousResponseId = undefined
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
    let llmOpen = false
    let hasPendingTools = false // 当前 LLM 是否输出了工具调用

    const openTurn = (): void => {
      if (!turnOpen) {
        turnIndex++
        turnOpen = true
        onChunk({ type: 'turn:start', content: '', data: { turnIndex } })
      }
    }

    const closeTurn = (): void => {
      if (turnOpen) {
        turnOpen = false
        onChunk({ type: 'turn:done', content: '', data: { turnIndex } })
      }
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
            llmOpen = true
            hasPendingTools = false
            onChunk({ type: 'llm:start', content: '' })
          }

          // llm:done
          if (rawType === 'response_done') {
            const response = (rawEvent as { response?: Record<string, unknown> }).response
            const usage = response?.usage as
              | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
              | undefined
            llmOpen = false
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

            // 若本轮 LLM 没有工具调用，则 turn 结束
            if (!hasPendingTools) {
              closeTurn()
            }
          }

          // ---- ④ text: 文本增量 ----

          if (rawType === 'output_text_delta') {
            const delta = (rawEvent as { delta?: string }).delta || ''
            if (delta) {
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
                onChunk({ type: 'text:start', content: '' })
              }
              if (item?.type === 'reasoning') {
                onChunk({ type: 'reasoning:start', content: '' })
              }
              if (item?.type === 'function_call') {
                hasPendingTools = true
                const toolName = (item as { name?: string }).name || 'unknown'
                const callId = (item as { call_id?: string }).call_id
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
                await this.streamEmitter.emitThinking(delta)
                onChunk({ type: 'reasoning:delta', content: delta, data: { delta } })
              }
            }

            // ⑥ tool: 参数增量
            if (rawEventType === 'response.function_call_arguments.delta') {
              const delta = (raw as { delta?: string }).delta || ''
              const callId = (raw as { call_id?: string }).call_id
              if (delta) {
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
            let parsedArgs: Record<string, unknown> = {}
            try {
              const argsStr = (rawItem as { arguments?: string }).arguments || '{}'
              parsedArgs = JSON.parse(argsStr) as Record<string, unknown>
            } catch {
              // 参数解析失败
            }
            hasPendingTools = true
            await this.streamEmitter.emitToolCall(toolName, parsedArgs)
            // 注意：若 tool:start 已由 model 透传触发，此处可作为补充
          }

          // ⑥ tool: 执行完成 → tool:done + turn:done
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

            // 工具执行完成 → 如果 llm 已关闭则关闭 turn（SDK 会接着开下一个 turn）
            if (!llmOpen) {
              closeTurn()
            }
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
}
