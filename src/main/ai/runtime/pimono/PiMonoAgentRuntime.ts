/**
 * Pi-Mono Agent 运行时
 *
 * 基于 pi-coding-agent SDK 的 AgentRuntime 实现。
 *
 * 核心能力：
 * - 单智能体模式：createAgentSession() 创建 AgentSession
 * - 四层事件体系：agent > turn > message > tool，SDK 直接提供 turn 边界
 * - 独立思考流：thinking_delta 独立于 text_delta，无需解析 <think> 标签
 * - 工具执行进度：tool_execution_update 提供实时进度
 * - 内置压缩/重试：SDK 自动管理
 * - 双通道事件分发：onChunk 回调 + StreamEmitter EventBus 广播
 *
 * 与 OpenAI 实现的关键差异：
 * - Turn 边界由 SDK 直接给出（无需从 response_started 推断）
 * - 思考内容通过 thinking_delta 独立传递（无需解析 <think> 标签）
 * - 工具执行有进度事件（tool_execution_update）
 * - 会话/压缩/重试全部由 SDK 内置管理
 */

import {
  createAgentSession,
  createExtensionRuntime,
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager
} from '@mariozechner/pi-coding-agent'
import type { AgentSession, AgentSessionEvent, ToolDefinition } from '@mariozechner/pi-coding-agent'
import { getModel } from '@mariozechner/pi-ai'
import { createStreamEmitter, type IStreamEmitter } from '../../streaming/StreamEmitter'
import type { AgentRuntime } from '../AgentRuntime'
import type { ExecutionConfig, ExecutionResult, StreamChunk, SessionInfo } from '../types'
import type { PiMonoAgentRuntimeOptions } from './types'

/** 默认最大执行轮次（TODO: 接入 maxTurns 配置后启用） */
// const DEFAULT_MAX_TURNS = 25

/** 默认模型 */
const DEFAULT_MODEL = 'MiniMax-M2.1'

/** 默认 Provider */
const DEFAULT_PROVIDER = 'minimax-cn'

// ========== Logger ==========

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
    return createLogger('pimono-runtime') as RuntimeLogger
  } catch {
    const prefix = '[PiMonoAgentRuntime]'
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
 * Pi-Mono Agent 运行时
 *
 * 基于 pi-coding-agent SDK 实现 AgentRuntime 接口。
 *
 * 职责：
 * 1. 通过 createAgentSession() 创建 SDK AgentSession
 * 2. 通过 session.subscribe() 订阅事件，映射为 StreamChunk
 * 3. 通过 StreamEmitter 广播事件到 EventBus
 * 4. 管理会话生命周期
 */
export class PiMonoAgentRuntime implements AgentRuntime {
  readonly type = 'agent' as const
  readonly id: string
  readonly options: PiMonoAgentRuntimeOptions

  // pi-SDK 会话（initialize 后可用）
  private piSession!: AgentSession

  // StreamEmitter — 通过 EventBus 广播事件
  private streamEmitter!: IStreamEmitter

  // 会话
  private readonly sessionId: string
  private createdAt: number

  // 中断状态（pi-SDK 通过 Extension 处理，此处始终为 false）
  private _interrupted = false

  // 保存的 ANTHROPIC_AUTH_TOKEN（destroy 时恢复）
  private savedAuthToken?: string

  constructor(options: PiMonoAgentRuntimeOptions) {
    this.options = options
    this.id = `pi-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.sessionId = options.sessionId || `pi-session-${Date.now()}`
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
    const provider = this.options.provider || DEFAULT_PROVIDER
    const modelName = this.options.model || DEFAULT_MODEL
    const thinkingLevel = this.options.thinkingLevel || 'medium'

    // 1. 认证配置
    // 清除可能冲突的环境变量（Anthropic SDK 0.73+ 会同时读取 ANTHROPIC_AUTH_TOKEN 和 apiKey，
    // 导致 Authorization: Bearer 和 x-api-key 发送不同的 key）
    this.savedAuthToken = process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.ANTHROPIC_AUTH_TOKEN

    // 同时设置环境变量和 AuthStorage runtime override，确保 SDK 能找到 key
    const envKeyMap: Record<string, string> = {
      minimax: 'MINIMAX_API_KEY',
      'minimax-cn': 'MINIMAX_CN_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY'
    }
    const envKey = envKeyMap[provider]
    if (envKey && this.options.apiKey) {
      process.env[envKey] = this.options.apiKey
    }
    const authStorage = new AuthStorage()
    authStorage.setRuntimeApiKey(provider, this.options.apiKey)
    const modelRegistry = new ModelRegistry(authStorage)

    // 2. 获取模型
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = getModel(provider as any, modelName as any)

    // 3. Session 管理
    const sessionManager =
      this.options.sessionMode === 'file'
        ? SessionManager.create(this.options.cwd || process.cwd())
        : SessionManager.inMemory()

    // 4. Settings（压缩/重试配置）
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: this.options.compaction?.enabled ?? false },
      retry: {
        enabled: this.options.retry?.enabled ?? true,
        maxRetries: this.options.retry?.maxRetries ?? 3,
        baseDelayMs: this.options.retry?.baseDelayMs ?? 1000
      }
    })

    // 5. 自定义 ResourceLoader（不发现文件系统资源）
    const stubRuntime = createExtensionRuntime()
    const resourceLoader = {
      getExtensions: () => ({ extensions: [], errors: [], runtime: stubRuntime }),
      getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] as Array<{ path: string; content: string }> }),
      getSystemPrompt: () => this.options.instructions,
      getAppendSystemPrompt: () => [] as string[],
      getPathMetadata: () => new Map(),
      extendResources: () => {},
      reload: async () => {}
    }

    // 6. 创建 AgentSession
    const { session } = await createAgentSession({
      cwd: this.options.cwd || process.cwd(),
      model,
      thinkingLevel,
      authStorage,
      modelRegistry,
      sessionManager,
      settingsManager,
      resourceLoader,
      customTools: (this.options.customTools as ToolDefinition[]) || [],
      ...(this.options.useCodingTools ? {} : { tools: [] })
    })

    this.piSession = session

    // NOTE: ANTHROPIC_AUTH_TOKEN 保持清除状态，因为 Anthropic SDK 的 client 是在 prompt() 时
    // 延迟创建的。如果恢复该变量，client 创建时仍会读取到冲突的 authToken。

    // 7. 创建 StreamEmitter
    this.streamEmitter = createStreamEmitter(this.sessionId, {
      type: 'agent',
      id: this.id,
      name: this.name
    })

    log.info(
      `Initialized: ${this.name} ` +
        `(provider: ${provider}, model: ${modelName}, ` +
        `thinking: ${thinkingLevel}, ` +
        `customTools: ${this.options.customTools?.length || 0}, ` +
        `session: ${this.sessionId})`
    )
  }

  async destroy(): Promise<void> {
    if (this.piSession) {
      this.piSession.dispose()
    }
    // 恢复被清除的 ANTHROPIC_AUTH_TOKEN
    if (this.savedAuthToken) {
      process.env.ANTHROPIC_AUTH_TOKEN = this.savedAuthToken
      this.savedAuthToken = undefined
    }
    this._interrupted = false
    log.info(`Destroyed: ${this.name}`)
  }

  // ========== 执行方法 ==========

  /**
   * 同步执行 Agent
   *
   * 通过 session.prompt() 执行，收集完整输出后返回。
   */
  async run(input: string, _config?: ExecutionConfig): Promise<ExecutionResult> {
    const startTime = Date.now()

    log.info(`Running: ${this.name}, input: "${input.slice(0, 100)}"`)

    try {
      let fullOutput = ''
      const toolCalls: ExecutionResult['toolCalls'] = []

      // 订阅事件收集结果
      const unsubscribe = this.piSession.subscribe((event: AgentSessionEvent) => {
        if (event.type === 'message_update') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const msgEvent = (event as any).assistantMessageEvent
          if (msgEvent?.type === 'text_delta') {
            fullOutput += msgEvent.delta || ''
          }
        }
        if (event.type === 'tool_execution_end') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const evt = event as any
          toolCalls.push({
            toolName: evt.toolName || 'unknown',
            arguments: typeof evt.args === 'object' ? evt.args : {},
            result: evt.result
          })
        }
      })

      await this.piSession.prompt(input)
      unsubscribe()

      return {
        output: fullOutput,
        toolCalls,
        duration: Date.now() - startTime,
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
   * 通过 session.subscribe() 订阅 pi-SDK 事件，
   * 双通道分发：onChunk 回调 + StreamEmitter EventBus 广播。
   *
   * 事件时序：
   *   run:start → turn:start → llm:start → { reasoning:*, text:*, tool:* } → llm:done → turn:done → run:done
   */
  async runStream(
    input: string,
    _config: ExecutionConfig,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult> {
    const startTime = Date.now()

    log.info(`Running stream: ${this.name}`)

    try {
      // 1. run:start
      await this.streamEmitter.emitStart()
      onChunk({ type: 'run:start', content: '' })

      // 2. 设置事件订阅
      let fullOutput = ''
      const toolCalls: ExecutionResult['toolCalls'] = []

      const unsubscribe = this.setupEventSubscription(
        onChunk,
        (text) => {
          fullOutput += text
        },
        toolCalls
      )

      // 3. 执行 prompt
      await this.piSession.prompt(input)

      // 4. 取消订阅
      unsubscribe()

      // 5. run:done
      await this.streamEmitter.emitDone()
      onChunk({ type: 'run:done', content: '' })

      return {
        output: fullOutput,
        toolCalls,
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
      log.error(`Stream execution failed:`, error)
      throw error
    }
  }

  // ========== HITL 工具审批（pi-SDK 通过 Extension 处理） ==========

  approveToolCall(_index: number, _options?: { alwaysApprove?: boolean }): void {
    throw new Error(
      'PiMonoAgentRuntime does not support HITL tool approval. ' +
        'Use pi-coding-agent Extensions (tool_call event interception) instead.'
    )
  }

  rejectToolCall(_index: number, _options?: { alwaysReject?: boolean }): void {
    throw new Error(
      'PiMonoAgentRuntime does not support HITL tool rejection. ' +
        'Use pi-coding-agent Extensions (tool_call event interception) instead.'
    )
  }

  async resume(): Promise<ExecutionResult> {
    throw new Error(
      'PiMonoAgentRuntime does not support resume. ' +
        'Use pi-coding-agent Extensions for workflow control.'
    )
  }

  async resumeStream(
    _config: ExecutionConfig,
    _onChunk: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult> {
    throw new Error(
      'PiMonoAgentRuntime does not support resumeStream. ' +
        'Use pi-coding-agent Extensions for workflow control.'
    )
  }

  // ========== 会话管理 ==========

  async getSession(): Promise<SessionInfo> {
    const messages = this.piSession.messages || []
    return {
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      messageCount: messages.length,
      metadata: {
        agentId: this.id,
        agentName: this.name,
        piSessionId: this.piSession.sessionId
      }
    }
  }

  async clearSession(): Promise<void> {
    log.info(`Clearing session: ${this.sessionId}`)
    // pi-SDK 的 SessionManager.inMemory() 在 dispose 后重建即可
    // 对于 file 模式，需要重新创建会话
  }

  // ========== 内部方法 ==========

  /**
   * 设置 pi-SDK 事件订阅
   *
   * 双通道分发：
   *   1. onChunk() — 细粒度 StreamChunk 直接回调给调用方
   *   2. streamEmitter.emitXxx() — 粗粒度广播到 EventBus
   *
   * 与 OpenAI 实现的关键差异：
   *   - turn_start / turn_end 由 SDK 直接给出（无需推断）
   *   - thinking_delta 是独立事件（无需解析 <think> 标签）
   *   - tool_execution_update 提供工具执行进度
   *
   * @returns 取消订阅函数
   */
  private setupEventSubscription(
    onChunk: (chunk: StreamChunk) => void,
    onTextDelta: (text: string) => void,
    toolCalls: ExecutionResult['toolCalls']
  ): () => void {
    let turnIndex = 0
    let textStartEmitted = false
    let reasoningStartEmitted = false

    return this.piSession.subscribe((event: AgentSessionEvent) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const evt = event as any

      log.debug(`[Pi Event] ${event.type}`, JSON.stringify(event))

      switch (event.type) {
        // ===== Agent 生命周期 =====
        // agent_start / agent_end 由 runStream 外部处理（run:start/run:done）

        // ===== Turn（SDK 直接给！无需推断！）=====
        case 'turn_start':
          turnIndex++
          textStartEmitted = false
          reasoningStartEmitted = false
          onChunk({ type: 'turn:start', content: '', data: { turnIndex } })
          break

        case 'turn_end':
          onChunk({ type: 'turn:done', content: '', data: { turnIndex } })
          break

        // ===== Message（LLM 流式）=====
        case 'message_start':
          // 只为 assistant 消息发出 llm:start（user 消息不是 LLM 调用）
          if (evt.message?.role === 'assistant') {
            onChunk({ type: 'llm:start', content: '' })
          }
          break

        case 'message_update': {
          const msgEvent = evt.assistantMessageEvent
          if (!msgEvent) break

          switch (msgEvent.type) {
            // ===== 思考流（pi-SDK 独有优势：独立事件！）=====
            case 'thinking_start':
              reasoningStartEmitted = true
              onChunk({ type: 'reasoning:start', content: '' })
              break

            case 'thinking_delta': {
              const delta = msgEvent.delta || ''
              if (delta) {
                // 双通道分发
                this.streamEmitter.emitThinking(delta)
                onChunk({
                  type: 'reasoning:delta',
                  content: delta,
                  data: { delta }
                })
              }
              break
            }

            case 'thinking_end':
              onChunk({
                type: 'reasoning:done',
                content: '',
                data: {
                  rawContent: msgEvent.content || ''
                }
              })
              break

            // ===== 文本流 =====
            case 'text_start':
              textStartEmitted = true
              onChunk({ type: 'text:start', content: '' })
              break

            case 'text_delta': {
              const delta = msgEvent.delta || ''
              if (delta) {
                // 双通道分发
                onTextDelta(delta)
                this.streamEmitter.emitText(delta)
                onChunk({ type: 'text:delta', content: delta, data: { delta } })
              }
              break
            }

            case 'text_end': {
              const fullText = msgEvent.content || this.extractFullText(evt.message)
              onChunk({ type: 'text:done', content: fullText, data: { text: fullText } })
              break
            }

            // ===== 停止信号（某些 SDK 版本可能发出）=====
            case 'stop': {
              // 关闭文本流（如果未通过 text_end 关闭）
              if (textStartEmitted) {
                const fullText = this.extractFullText(evt.message)
                onChunk({ type: 'text:done', content: fullText, data: { text: fullText } })
              }
              // 关闭思考流（如果未通过 thinking_end 关闭）
              if (reasoningStartEmitted) {
                onChunk({ type: 'reasoning:done', content: '' })
              }
              break
            }

            // input_json_delta: 工具参数流式，不需要前端展示
            default:
              break
          }
          break
        }

        case 'message_end': {
          // 只为 assistant 消息发出 llm:done
          if (evt.message?.role === 'assistant') {
            const usage = evt.message?.usage
            onChunk({
              type: 'llm:done',
              content: '',
              data: {
                usage: usage
                  ? {
                      inputTokens: usage.input || usage.inputTokens || 0,
                      outputTokens: usage.output || usage.outputTokens || 0,
                      totalTokens: usage.totalTokens || (usage.input || 0) + (usage.output || 0)
                    }
                  : undefined
              }
            })
          }
          break
        }

        // ===== Tool（含执行进度！）=====
        case 'tool_execution_start': {
          const toolName = evt.toolName || 'unknown'
          const args = evt.args || {}
          // 双通道分发
          this.streamEmitter.emitToolCall(toolName, typeof args === 'object' ? args : {})
          onChunk({
            type: 'tool:start',
            content: toolName,
            data: { toolName, callId: evt.toolCallId }
          })
          break
        }

        case 'tool_execution_update': {
          // OpenAI SDK 完全没有对应事件！pi-SDK 独有。
          onChunk({
            type: 'tool:delta',
            content: JSON.stringify(evt.partialResult),
            data: { delta: JSON.stringify(evt.partialResult), callId: evt.toolCallId }
          })
          break
        }

        case 'tool_execution_end': {
          const toolName = evt.toolName || 'unknown'
          const result = evt.result
          const isError = evt.isError || false

          // 记录工具调用
          if (toolCalls) {
            toolCalls.push({
              toolName,
              arguments: typeof evt.args === 'object' ? evt.args : {},
              result
            })
          }

          // 双通道分发
          this.streamEmitter.emitToolResult(toolName, result)
          onChunk({
            type: 'tool:done',
            content: typeof result === 'string' ? result : JSON.stringify(result),
            data: { toolName, callId: evt.toolCallId, output: result, isError }
          })
          break
        }

        // ===== 压缩（SDK 内置！）=====
        case 'auto_compaction_start':
          onChunk({
            type: 'compression:start',
            content: `Compaction triggered: ${evt.reason}`,
            data: { reason: evt.reason || 'threshold', totalTokens: 0, threshold: 0 }
          })
          break

        case 'auto_compaction_end':
          onChunk({
            type: 'compression:done',
            content: evt.aborted ? 'Compaction aborted' : 'Compaction done',
            data: {
              summarizedSeqs: [],
              endSeq: 0,
              originalTokens: 0,
              summaryTokens: 0,
              compressionRatio: 0,
              duration: 0
            }
          })
          break

        // ===== 重试（可选日志）=====
        case 'auto_retry_start':
          log.info(
            `Auto retry: attempt ${evt.attempt}/${evt.maxAttempts}, ` +
              `delay ${evt.delayMs}ms, reason: ${evt.errorMessage}`
          )
          break

        case 'auto_retry_end':
          log.info(`Auto retry end: success=${evt.success}, attempt=${evt.attempt}`)
          break

        default:
          // 未知事件类型，仅记录日志
          log.debug(`[Pi Event] Unhandled: ${event.type}`)
          break
      }
    })
  }

  /**
   * 从 AgentMessage 中提取完整文本
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractFullText(message: any): string {
    if (!message) return ''

    // 尝试从 content 数组提取
    if (Array.isArray(message.content)) {
      return (
        message.content
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((c: any) => c.type === 'text')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((c: any) => c.text || '')
          .join('')
      )
    }

    // 尝试直接取 text 字段
    if (typeof message.text === 'string') {
      return message.text
    }

    return ''
  }
}
