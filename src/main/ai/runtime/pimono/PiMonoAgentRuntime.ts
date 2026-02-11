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
 * API 格式：
 * - 统一使用 OpenAI Chat Completions 格式（openai-completions）
 * - 通过 baseURL 指向不同的 OpenAI 兼容服务端点
 * - 不依赖 Anthropic SDK，不使用 ANTHROPIC_AUTH_TOKEN
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
import type { Model } from '@mariozechner/pi-ai'
import { createStreamEmitter, type IStreamEmitter } from '../../streaming/StreamEmitter'
import type { AgentRuntime } from '../AgentRuntime'
import type { ExecutionConfig, ExecutionResult, StreamChunk, SessionInfo } from '../types'
import type { PiMonoAgentRuntimeOptions } from './types'

/** 默认最大执行轮次（TODO: 接入 maxTurns 配置后启用） */
// const DEFAULT_MAX_TURNS = 25

/** 默认模型 */
const DEFAULT_MODEL = 'MiniMax-M2.1'

/** 默认 Base URL（MiniMax OpenAI 兼容端点） */
const DEFAULT_BASE_URL = 'https://api.minimaxi.com/v1'

/**
 * 自定义 Provider 名称
 *
 * 因为我们构造自定义 Model 对象，使用一个固定的 provider 名称
 * 来注册 API key 到 AuthStorage 中。
 */
const CUSTOM_PROVIDER = 'openai-compat'

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
 * 构造 OpenAI Chat Completions 兼容的 Model 对象
 *
 * 不使用 SDK 内置的 getModel() 来获取 anthropic-messages 类型的模型，
 * 而是手动构造一个 openai-completions 类型的 Model 对象，
 * 指向 OpenAI 兼容的后端 API（MiniMax、DeepSeek 等）。
 */
function createOpenAICompatModel(modelName: string, baseURL: string): Model<'openai-completions'> {
  return {
    id: modelName,
    name: modelName,
    api: 'openai-completions',
    provider: CUSTOM_PROVIDER,
    baseUrl: baseURL,
    reasoning: true,
    input: ['text'],
    cost: {
      input: 0.3,
      output: 1.2,
      cacheRead: 0,
      cacheWrite: 0
    },
    contextWindow: 204800,
    maxTokens: 131072,
    // MiniMax OpenAI 兼容端点的特性
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: true,
      maxTokensField: 'max_tokens'
    }
  }
}

/**
 * Pi-Mono Agent 运行时
 *
 * 基于 pi-coding-agent SDK 实现 AgentRuntime 接口。
 *
 * 职责：
 * 1. 构造 OpenAI 兼容的 Model 对象（openai-completions API）
 * 2. 通过 createAgentSession() 创建 SDK AgentSession
 * 3. 通过 session.subscribe() 订阅事件，映射为 StreamChunk
 * 4. 通过 StreamEmitter 广播事件到 EventBus
 * 5. 管理会话生命周期
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
    const modelName = this.options.model || DEFAULT_MODEL
    const baseURL = this.options.baseURL || DEFAULT_BASE_URL
    const thinkingLevel = this.options.thinkingLevel || 'medium'

    // 1. 构造 OpenAI 兼容的 Model 对象
    const model = createOpenAICompatModel(modelName, baseURL)

    // 2. 认证配置
    //    通过 AuthStorage 注入 API key，使用自定义 provider 名称
    const authStorage = new AuthStorage()
    authStorage.setRuntimeApiKey(CUSTOM_PROVIDER, this.options.apiKey)
    const modelRegistry = new ModelRegistry(authStorage)

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

    // 7. 创建 StreamEmitter
    this.streamEmitter = createStreamEmitter(this.sessionId, {
      type: 'agent',
      id: this.id,
      name: this.name
    })

    log.info(
      `Initialized: ${this.name} ` +
        `(api: openai-completions, model: ${modelName}, ` +
        `baseURL: ${baseURL}, ` +
        `thinking: ${thinkingLevel}, ` +
        `customTools: ${this.options.customTools?.length || 0}, ` +
        `session: ${this.sessionId})`
    )
  }

  async destroy(): Promise<void> {
    if (this.piSession) {
      this.piSession.dispose()
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

      // 去除 <think> 标签（OpenAI 兼容模式下思考内容混在文本中）
      fullOutput = this.stripThinkTags(fullOutput)

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
   * <think> 标签解析：
   *   OpenAI Chat Completions 格式不原生支持思考块，部分 Provider（如 MiniMax）
   *   会将思考内容以 <think>...</think> 标签包裹在文本中返回。
   *   本方法自动检测并分离 <think> 标签，将思考内容作为 reasoning:* 事件发出，
   *   确保无论底层 API 格式如何，上层都能获得一致的事件接口。
   *
   *   状态机：
   *     NORMAL → (遇到 <think>) → IN_THINK → (遇到 </think>) → NORMAL
   *
   * 与 OpenAI 实现的关键差异：
   *   - turn_start / turn_end 由 SDK 直接给出（无需推断）
   *   - thinking_delta 是独立事件（通过 SDK 原生或 <think> 解析）
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

    // <think> 标签解析状态
    let inThinkBlock = false
    let thinkingBuffer = ''
    let realTextStartEmitted = false // 是否已发出去除 <think> 后的真正 text:start

    /**
     * 发出去除 <think> 后的纯文本 delta
     */
    const emitCleanText = (text: string): void => {
      if (!text || text.length === 0) return

      // 确保 text:start 已发出
      if (!realTextStartEmitted) {
        onChunk({ type: 'text:start', content: '' })
        realTextStartEmitted = true
      }

      // 双通道分发
      onTextDelta(text)
      this.streamEmitter.emitText(text)
      onChunk({ type: 'text:delta', content: text, data: { delta: text } })
    }

    /**
     * 处理 text_delta 中的 <think> 标签
     *
     * 将包含 <think>...</think> 的文本流拆分为：
     *   - <think> 内的内容 → reasoning:start/delta/done
     *   - <think> 外的内容 → text:start/delta
     */
    const processTextDelta = (rawDelta: string): void => {
      if (!rawDelta) return

      let remaining = rawDelta

      while (remaining.length > 0) {
        if (!inThinkBlock) {
          // 当前在普通文本模式，查找 <think> 开始标签
          const thinkStart = remaining.indexOf('<think>')
          if (thinkStart === -1) {
            // 无 <think> 标签，整段都是普通文本
            emitCleanText(remaining)
            break
          }

          // <think> 之前的内容作为普通文本
          if (thinkStart > 0) {
            emitCleanText(remaining.slice(0, thinkStart))
          }

          // 进入思考模式
          inThinkBlock = true
          thinkingBuffer = ''
          if (!reasoningStartEmitted) {
            reasoningStartEmitted = true
            onChunk({ type: 'reasoning:start', content: '' })
          }

          remaining = remaining.slice(thinkStart + '<think>'.length)
        } else {
          // 当前在思考模式，查找 </think> 结束标签
          const thinkEnd = remaining.indexOf('</think>')
          if (thinkEnd === -1) {
            // 未找到结束标签，整段都是思考内容
            thinkingBuffer += remaining
            if (remaining.length > 0) {
              this.streamEmitter.emitThinking(remaining)
              onChunk({
                type: 'reasoning:delta',
                content: remaining,
                data: { delta: remaining }
              })
            }
            break
          }

          // </think> 之前的内容作为思考内容
          const thinkContent = remaining.slice(0, thinkEnd)
          if (thinkContent.length > 0) {
            thinkingBuffer += thinkContent
            this.streamEmitter.emitThinking(thinkContent)
            onChunk({
              type: 'reasoning:delta',
              content: thinkContent,
              data: { delta: thinkContent }
            })
          }

          // 结束思考块
          inThinkBlock = false
          onChunk({
            type: 'reasoning:done',
            content: '',
            data: { rawContent: thinkingBuffer }
          })

          remaining = remaining.slice(thinkEnd + '</think>'.length)

          // </think> 后的空白换行也要作为文本发出（与 OpenAI 行为一致）
          // OpenAI 在工具调用轮也会输出 text:start → text:delta("\n\n\n") → text:done({ text: "" })
        }
      }
    }

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
          inThinkBlock = false
          thinkingBuffer = ''
          realTextStartEmitted = false
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
            // ===== 思考流（SDK 原生支持时直接转发）=====
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

            // ===== 文本流（含 <think> 标签自动解析）=====
            case 'text_start':
              textStartEmitted = true
              // 不立即发 text:start，等 processTextDelta 确认有真正文本后再发
              break

            case 'text_delta': {
              const delta = msgEvent.delta || ''
              if (delta) {
                processTextDelta(delta)
              }
              break
            }

            case 'text_end': {
              // 提取去除 <think> 后的纯文本
              const rawFullText = msgEvent.content || this.extractFullText(evt.message)
              const cleanText = this.stripThinkTags(rawFullText)

              // 始终发出 text:start + text:done（即使纯文本为空）
              // 与 OpenAI 行为一致：工具调用轮也会有 text:start/text:done 闭环
              if (!realTextStartEmitted) {
                onChunk({ type: 'text:start', content: '' })
                realTextStartEmitted = true
              }

              onChunk({ type: 'text:done', content: cleanText, data: { text: cleanText } })
              break
            }

            // ===== 停止信号（某些 SDK 版本可能发出）=====
            case 'stop': {
              // 关闭思考流（如果仍在 think 块中）
              if (inThinkBlock) {
                inThinkBlock = false
                onChunk({
                  type: 'reasoning:done',
                  content: '',
                  data: { rawContent: thinkingBuffer }
                })
              }
              // 关闭文本流
              if (textStartEmitted && realTextStartEmitted) {
                const fullText = this.stripThinkTags(this.extractFullText(evt.message))
                onChunk({ type: 'text:done', content: fullText, data: { text: fullText } })
              }
              // 关闭思考流（如果未通过 thinking_end 关闭）
              if (reasoningStartEmitted && !inThinkBlock) {
                // already closed
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
          const rawResult = evt.result

          // 从 pi-SDK 的 AgentToolResult 结构中提取纯文本输出
          // 统一为与 OpenAI SDK 一致的格式：纯 JSON 字符串
          const output = this.extractToolOutput(rawResult)

          // 记录工具调用
          if (toolCalls) {
            toolCalls.push({
              toolName,
              arguments: typeof evt.args === 'object' ? evt.args : {},
              result: output
            })
          }

          // 双通道分发
          this.streamEmitter.emitToolResult(toolName, output)
          onChunk({
            type: 'tool:done',
            content: output,
            data: { toolName, callId: evt.toolCallId, output }
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
   * 从文本中去除 <think>...</think> 标签及其内容
   *
   * OpenAI Chat Completions 格式下，部分 Provider（如 MiniMax）
   * 会将思考内容以 <think>...</think> 标签包裹在文本中返回。
   */
  private stripThinkTags(text: string): string {
    if (!text) return ''
    return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim()
  }

  /**
   * 从 pi-SDK 的 AgentToolResult 中提取纯文本输出
   *
   * pi-SDK 返回结构化的 { content: [{ type: "text", text: "..." }], details: {...} }
   * OpenAI SDK 返回纯 JSON 字符串 "{\"result\":45,...}"
   * 此方法统一为纯字符串格式，与 OpenAI 保持一致。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractToolOutput(result: any): string {
    if (!result) return ''
    if (typeof result === 'string') return result

    // pi-SDK AgentToolResult: { content: [{ type: "text", text: "..." }], details: {...} }
    if (Array.isArray(result.content)) {
      const texts = result.content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => c.text)
      if (texts.length > 0) {
        return texts.join('')
      }
    }

    // fallback：序列化整个对象
    return JSON.stringify(result)
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
