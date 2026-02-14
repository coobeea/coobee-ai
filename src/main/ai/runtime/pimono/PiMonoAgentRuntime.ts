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
 * - 单通道事件分发：onChunk → yield → AgentExecutor.forward() 统一广播
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

import path from 'node:path'
import { z } from 'zod'
import {
  createAgentSession,
  createExtensionRuntime,
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager
} from '@mariozechner/pi-coding-agent'
import type {
  AgentSession,
  AgentSessionEvent,
  ToolDefinition as PiToolDefinition
} from '@mariozechner/pi-coding-agent'
import type { Model } from '@mariozechner/pi-ai'
import { AbstractAgentRuntime } from '../AbstractAgentRuntime'
import { ChunkQueue } from './ChunkQueue'
import type {
  ExecutionConfig,
  ExecutionResult,
  StreamChunk,
  SessionInfo,
  ToolDefinition
} from '../types'
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
export class PiMonoAgentRuntime extends AbstractAgentRuntime {
  readonly type = 'agent' as const
  readonly id: string
  readonly options: PiMonoAgentRuntimeOptions

  // pi-SDK 会话（initialize 后可用）
  private piSession!: AgentSession

  // 会话
  private readonly sessionId: string
  private createdAt: number

  // 中断状态（pi-SDK 通过 Extension 处理，此处始终为 false）
  private _interrupted = false

  constructor(options: PiMonoAgentRuntimeOptions) {
    super()
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

  get supportsHITL(): boolean {
    return false
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
    //    file 模式：用 sessionId 隔离目录，支持外部管理和恢复会话
    //    memory 模式：内存存储，sessionId 仅作标识
    const cwd = this.options.cwd || process.cwd()
    const sessionDir = this.options.sessionDir
      ? path.join(this.options.sessionDir, this.sessionId)
      : path.join(cwd, '.coobee-ai', 'sessions', this.sessionId)
    const sessionManager =
      this.options.sessionMode === 'file'
        ? SessionManager.continueRecent(cwd, sessionDir)
        : SessionManager.inMemory(cwd)

    // 4. Settings（压缩/重试配置）
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: this.options.compaction?.enabled ?? false },
      retry: {
        enabled: this.options.retry?.enabled ?? true,
        maxRetries: this.options.retry?.maxRetries ?? 3,
        baseDelayMs: this.options.retry?.baseDelayMs ?? 1000
      }
    })

    // 5. 自定义 ResourceLoader（不发现文件系统资源，通过选项注入）
    //    - getSystemPrompt: 返回基础 instructions
    //    - getAppendSystemPrompt: 返回追加指令片段
    //    - getSkills: 返回 SkillDefinition → pi-SDK Skill 的转换结果
    const stubRuntime = createExtensionRuntime()
    const piSkills = (this.options.skills || []).map((s) => ({
      name: s.name,
      description: s.description,
      filePath: '',
      baseDir: '',
      source: 'runtime-options',
      disableModelInvocation: false
    }))
    // 如果有 skills，将内容拼接到 appendInstructions 中
    // 因为 pi-SDK 的 Skill 只有 name/description（用于提示词标注），
    // 实际内容需要通过 appendSystemPrompt 注入
    const skillContentParts = (this.options.skills || []).map(
      (s) => `<skill name="${s.name}">\n${s.content}\n</skill>`
    )
    const allAppendParts = [...skillContentParts, ...(this.options.appendInstructions || [])]

    const resourceLoader = {
      getExtensions: () => ({ extensions: [], errors: [], runtime: stubRuntime }),
      getSkills: () => ({ skills: piSkills, diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] as Array<{ path: string; content: string }> }),
      getSystemPrompt: () => this.options.instructions,
      getAppendSystemPrompt: () => allAppendParts,
      getPathMetadata: () => new Map(),
      extendResources: () => {},
      reload: async () => {}
    }

    // 6. 合并工具：sdkTools（SDK 原生）+ tools（统一 ToolDefinition 转换后）
    const allSdkTools: PiToolDefinition[] = [
      ...((this.options.sdkTools as PiToolDefinition[]) || []),
      ...this.convertTools(this.options.tools || [])
    ]

    // 7. 创建 AgentSession
    //    内置 codingTools 默认禁用（tools: [] 覆盖），仅使用显式传入的工具
    const { session } = await createAgentSession({
      cwd: this.options.cwd || process.cwd(),
      model,
      thinkingLevel,
      authStorage,
      modelRegistry,
      sessionManager,
      settingsManager,
      resourceLoader,
      customTools: allSdkTools,
      tools: []
    })

    this.piSession = session

    log.info(
      `Initialized: ${this.name} ` +
        `(api: openai-completions, model: ${modelName}, ` +
        `baseURL: ${baseURL}, ` +
        `thinking: ${thinkingLevel}, ` +
        `tools: ${allSdkTools.length}, ` +
        `skills: ${piSkills.length}, ` +
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

  // run() 由基类 AbstractAgentRuntime 提供（消费 stream()，自动继承快照功能）

  /**
   * 流式执行 Agent（核心实现 — 由基类 stream() 模板方法包装）
   *
   * 通过 session.subscribe() 订阅 pi-SDK 事件，
   * 使用 ChunkQueue 桥接回调式推送到 AsyncGenerator 拉取。
   *
   * 双通道分发：
   *   1. yield chunk — 拉取模式（供 SSE / 直接迭代）
   *   2. StreamEmitter EventBus — 推送模式（广播到 WebSocket）
   *
   * 事件时序：
   *   run:start → turn:start → llm:start → { reasoning:*, text:*, tool:* } → llm:done → turn:done → run:done
   */
  protected async *doStream(
    input: string,
    _config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const startTime = Date.now()
    const queue = new ChunkQueue<StreamChunk>()

    log.info(`Running stream: ${this.name}`)

    try {
      // 1. run:start
      queue.push({ type: 'run:start', content: '' })

      // 2. 设置事件订阅 → push 到 queue
      let fullOutput = ''
      let apiError: string | null = null
      const toolCalls: ExecutionResult['toolCalls'] = []

      const unsubscribe = this.setupEventSubscription(
        (chunk) => queue.push(chunk),
        (text) => {
          fullOutput += text
        },
        toolCalls,
        (errorMessage) => {
          apiError = errorMessage
        }
      )

      // 3. SDK 执行，完成后结束 queue
      this.piSession
        .prompt(input)
        .then(async () => {
          unsubscribe()
          // 等待一个微任务周期，确保 SDK 已排队的事件回调有机会执行完毕
          // （pi-SDK 内部可能通过 Promise/microtask 分发最后的 delta 事件）
          await Promise.resolve()

          if (apiError) {
            // API 返回了错误（如 usage limit exceeded）但 SDK 没有 throw
            queue.push({
              type: 'run:error',
              content: apiError,
              data: { message: apiError }
            })
          } else {
            queue.push({ type: 'run:done', content: '' })
          }
          queue.end()
        })
        .catch(async (err: unknown) => {
          unsubscribe()
          await Promise.resolve()
          queue.push({
            type: 'run:error',
            content: err instanceof Error ? err.message : String(err),
            data: { message: err instanceof Error ? err.message : String(err) }
          })
          queue.end()
        })

      // 4. 逐个 yield 队列中的 chunk
      for await (const chunk of queue) {
        yield chunk
      }

      return {
        output: fullOutput,
        ...(apiError ? { error: apiError } : {}),
        toolCalls,
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
      log.error(`Stream execution failed:`, error)
      throw error
    }
  }

  // runStream() 由基类 AbstractAgentRuntime 提供
  // HITL 方法（approveToolCall, rejectToolCall, resumeStream）由基类提供默认 throw 实现

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

  // ========== 可观测性（Observability） ==========

  /**
   * 获取 session 文件路径（仅 file 模式有值）
   */
  getSessionFilePath(): string | undefined {
    return this.piSession?.sessionFile
  }

  /**
   * 获取 pi-SDK 的 session 上下文
   *
   * 返回 buildSessionContext() 的结果——即发送给 LLM 的完整消息列表。
   * 含压缩摘要、用户消息、助手消息、工具结果等。
   */
  getSessionContext(): { messages: unknown[]; thinkingLevel: string; model: unknown } | null {
    try {
      return this.piSession?.sessionManager?.buildSessionContext() ?? null
    } catch (e) {
      log.warn('Failed to get session context:', e)
      return null
    }
  }

  /**
   * 获取所有原始消息
   */
  getRawMessages(): unknown[] {
    return this.piSession?.messages ?? []
  }

  /**
   * 获取 session 管理器（高级用法，供测试/调试使用）
   */
  getSessionManager(): unknown {
    return this.piSession?.sessionManager ?? null
  }

  // ========== 内部方法 ==========

  /**
   * 设置 pi-SDK 事件订阅
   *
   * 事件分发：
   *   onChunk() → queue → yield → AgentExecutor.forward() 统一广播到 EventBus
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
    toolCalls: ExecutionResult['toolCalls'],
    onApiError?: (errorMessage: string) => void
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

      onTextDelta(text)
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
            // 检测 API 错误（pi-SDK 不 throw，而是将错误记录在 message 中）
            if (evt.message?.stopReason === 'error' || evt.message?.errorMessage) {
              const errorMsg = evt.message.errorMessage || 'Unknown API error'
              log.error(`API error detected: ${errorMsg}`)
              onApiError?.(errorMsg)
            }

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
   * 将统一 ToolDefinition 转换为 pi-coding-agent SDK 原生 PiToolDefinition
   *
   * 核心映射：
   *   - execute 前检查工具策略（isToolAllowed，sandbox 级别拦截）
   *   - yield 的 ToolStreamUpdate 通过 PiMono 的 onUpdate 回调发送增量输出
   *   - return 的 ToolResult.llmContent 作为 AgentToolResult 返回
   *   - 自动注入 SandboxContext（路径边界、工具策略、Docker 等）
   *
   * 注意：PiMono SDK 不支持 HITL（needsApproval），工具直接执行。
   * 安全由工具策略（sandbox tool-policy）和路径守卫保障。
   */
  private convertTools(defs: ToolDefinition[]): PiToolDefinition[] {
    if (!defs.length) return []

    // 构建沙箱上下文（PiMono 用 cwd 作为 workspaceRoot）
    const sandboxContext: import('../../sandbox/types').SandboxContext = {
      mode: 'path-only',
      workspaceRoot: (this.options.cwd as string) || this.options.workspaceRoot || process.cwd(),
      toolPolicy: { allow: [], deny: [] },
      sessionId: this.sessionId
    }

    return defs.map(
      (def) =>
        ({
          name: def.name,
          label: def.name,
          description: def.description,
          // Zod → JSON Schema（PiMono SDK 使用 TypeBox/JSON Schema 格式）
          parameters: z.toJSONSchema(def.parameters),
          execute: async (
            _toolCallId: string,
            params: Record<string, unknown>,
            signal?: AbortSignal,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onUpdate?: (partialResult: any) => void
          ) => {
            let typedParams = params
            const toolStartTime = Date.now()

            // === Extension Hook: before_tool_call ===
            try {
              const { ExtensionManager } = await import('../../../extension')
              const runner = ExtensionManager.getHookRunner()
              if (runner) {
                const hookResult = await runner.runModifyingHook('before_tool_call', {
                  sessionId: sandboxContext.sessionId || '',
                  toolName: def.name,
                  params: typedParams
                })
                if (hookResult) {
                  if (hookResult.block) {
                    const reason = hookResult.blockReason || 'no reason'
                    return {
                      content: [
                        { type: 'text', text: `Error: Tool blocked by extension — ${reason}` }
                      ],
                      details: { name: def.name }
                    }
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
              return {
                content: [{ type: 'text', text: `Error: ${msg}` }],
                details: { name: def.name }
              }
            }

            const gen = def.execute(typedParams, signal, sandboxContext)
            let iterResult = await gen.next()

            // 消费 AsyncGenerator 的增量输出
            while (!iterResult.done) {
              const update = iterResult.value
              // 桥接到 PiMono 的 onUpdate 回调（前端实时展示）
              if (onUpdate) {
                onUpdate({
                  content: [{ type: 'text', text: update.content }],
                  details: {
                    name: def.name,
                    updateType: update.type,
                    percentage: update.percentage
                  }
                })
              }
              iterResult = await gen.next()
            }

            // 最终结果
            const toolResult = iterResult.value
            let text =
              toolResult.llmContent ||
              (toolResult.success ? 'Success' : `Error: ${toolResult.error?.message || 'unknown'}`)

            // === Extension Hook: after_tool_call (void) + tool_result_persist (modifying) ===
            try {
              const { ExtensionManager } = await import('../../../extension')
              const runner = ExtensionManager.getHookRunner()
              if (runner) {
                const toolDuration = Date.now() - toolStartTime
                await runner.runVoidHook('after_tool_call', {
                  sessionId: sandboxContext.sessionId || '',
                  toolName: def.name,
                  params: typedParams,
                  result: text,
                  durationMs: toolDuration
                })

                const persistResult = await runner.runModifyingHook('tool_result_persist', {
                  sessionId: sandboxContext.sessionId || '',
                  toolName: def.name,
                  result: text
                })
                if (persistResult?.result) {
                  text = persistResult.result
                }
              }
            } catch {
              // Extension hook 失败不阻断
            }

            return { content: [{ type: 'text', text }], details: { name: def.name } }
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any as PiToolDefinition
    )
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
