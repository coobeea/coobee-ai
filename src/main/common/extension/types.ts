/**
 * Extension 系统类型定义
 *
 * 统一命名：所有公开类型使用 Extension 前缀。
 * Extension 系统提供三种能力注册：Agent 生命周期钩子、工具、Gateway 方法。
 */

import type { ToolDefinition } from '../../ai/tools/types'
import type { MethodHandler } from '../../gateway/protocol/types'

// ==================== Extension 模块 ====================

/** Extension 清单（extension.json） */
export interface ExtensionManifest {
  id: string
  name: string
  version: string
  description?: string
  /**
   * 扩展贡献的 Skill 目录（相对于扩展根目录）
   *
   * 声明后，该目录下的 Skill 会被 Skill 加载器自动发现。
   * @example "skills" → <extensionDir>/skills/
   */
  skills?: string
}

/** Extension 来源 */
export type ExtensionOrigin = 'builtin' | 'user' | 'workspace'

/** Extension 模块导出格式 */
export interface ExtensionModule {
  id: string
  name: string
  register: (api: ExtensionApi) => void
}

/** Extension 日志 */
export interface ExtensionLogger {
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
}

// ==================== ExtensionApi ====================

/**
 * Extension Services — 核心能力的结构化访问接口
 *
 * Extension 通过 api.services 访问系统服务，避免直接 import 核心模块。
 * 服务实例由 ExtensionManager 在注册时注入。
 */
export interface ExtensionServices {
  /** HITL 审批服务 */
  hitl: {
    /** 等待单个工具调用的审批决策 */
    waitForSingleDecision(
      approvalId: string,
      timeoutMs?: number
    ): Promise<import('@shared/stream-protocol').HitlApprovalDecision | null>
    /** 提交单个工具调用的审批决策 */
    submitSingleDecision(
      approvalId: string,
      decision: import('@shared/stream-protocol').HitlApprovalDecision
    ): boolean
    /** 清理指定 session 的所有审批 */
    cleanupSession(sessionId: string): void
  }
  /** 事件发送服务 */
  events: {
    /** 向指定 session 广播流式事件（前端 + EventBus） */
    emit(
      sessionId: string,
      chunk: { type: string; content: string; data?: Record<string, unknown> }
    ): void
  }
}

/** Extension 与系统交互的唯一接口 */
export interface ExtensionApi {
  /** Extension ID */
  id: string
  /** Extension 名称 */
  name: string
  /** 来源 */
  origin: ExtensionOrigin
  /** 日志 */
  logger: ExtensionLogger

  /**
   * 核心服务接口（解耦 Extension 与核心模块的直接依赖）
   *
   * Extension 应通过 api.services 访问 HITL、事件等能力，
   * 而非直接 import 内部模块路径。
   */
  services: ExtensionServices

  /** 注册工具 */
  registerTool(tool: ToolDefinition): void
  /** 注册 Agent 生命周期钩子 */
  on<K extends ExtensionHookName>(
    hookName: K,
    handler: ExtensionHookHandler<K>,
    opts?: { priority?: number }
  ): void
  /** 注册 Gateway RPC 方法 */
  registerGatewayMethod(method: string, handler: MethodHandler): void
}

// ==================== Extension Hook ====================

/** 12 种 Agent 生命周期钩子 */
export type ExtensionHookName =
  | 'before_agent_start' // modifying：注入上下文 / 替换提示词
  | 'agent_end' // void：Agent 执行完成
  | 'before_tool_call' // modifying：修改参数 / 阻止调用
  | 'after_tool_call' // void：工具执行后
  | 'tool_result_persist' // modifying：修改持久化结果
  | 'message_received' // void：收到用户消息
  | 'session_start' // void：会话开始
  | 'session_end' // void：会话结束
  // Phase 1 新增（Turn + Compaction）
  | 'turn_start' // void：轮次开始
  | 'turn_end' // void：轮次完成
  | 'before_compaction' // modifying：压缩前（可自定义压缩 / Memory Flush）
  | 'after_compaction' // void：压缩完成

/** 执行模式 */
export type ExtensionHookMode = 'void' | 'modifying'

export const EXTENSION_HOOK_MODE: Record<ExtensionHookName, ExtensionHookMode> = {
  before_agent_start: 'modifying',
  agent_end: 'void',
  before_tool_call: 'modifying',
  after_tool_call: 'void',
  tool_result_persist: 'modifying',
  message_received: 'void',
  session_start: 'void',
  session_end: 'void',
  // Phase 1 新增
  turn_start: 'void',
  turn_end: 'void',
  before_compaction: 'modifying',
  after_compaction: 'void'
}

// ---- 各 Hook 的 Event / Result ----

export interface BeforeAgentStartEvent {
  sessionId: string
  prompt: string
  systemPrompt?: string
}
export interface BeforeAgentStartResult {
  prependContext?: string
  replaceSystemPrompt?: string
}

export interface BeforeToolCallEvent {
  sessionId: string
  toolName: string
  params: Record<string, unknown>
  /** 工具定义中是否标记需要用户确认（needUserConfirm） */
  needUserConfirm?: boolean
}
export interface BeforeToolCallResult {
  block?: boolean
  blockReason?: string
  params?: Record<string, unknown>
}

export interface ToolResultPersistEvent {
  sessionId: string
  toolName: string
  result: string
}
export interface ToolResultPersistResult {
  result?: string
}

export interface AgentEndEvent {
  sessionId: string
  success: boolean
  output: string
  durationMs: number
}

export interface AfterToolCallEvent {
  sessionId: string
  toolName: string
  params: Record<string, unknown>
  result: string
  durationMs: number
}

export interface MessageReceivedEvent {
  sessionId: string
  message: string
}

export interface SessionEvent {
  sessionId: string
}

// ---- Phase 1 新增：Turn + Compaction ----

export interface TurnStartEvent {
  sessionId: string
  /** 轮次索引（从 1 开始） */
  turnIndex: number
}

export interface TurnEndEvent {
  sessionId: string
  /** 轮次索引 */
  turnIndex: number
  /** 本轮耗时（ms） */
  durationMs: number
  /** 本轮工具调用次数 */
  toolCallCount: number
  /** 本轮 token 用量（如果底层 Runtime 提供） */
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

export interface BeforeCompactionEvent {
  sessionId: string
  /** 待压缩消息数 */
  messageCount: number
  /** 当前 token 总数 */
  totalTokens: number
  /** 触发阈值 */
  threshold: number
}

export interface BeforeCompactionResult {
  /** 跳过默认压缩（由扩展自行实现压缩） */
  skipDefault?: boolean
  /** 自定义压缩摘要（替换默认摘要） */
  customSummary?: string
}

export interface AfterCompactionEvent {
  sessionId: string
  /** 压缩前 token 数 */
  originalTokens: number
  /** 压缩后 token 数 */
  compressedTokens: number
  /** 压缩比 */
  compressionRatio: number
  /** 压缩耗时（ms） */
  duration: number
}

/** Event 映射 */
export type ExtensionHookEventMap = {
  before_agent_start: BeforeAgentStartEvent
  agent_end: AgentEndEvent
  before_tool_call: BeforeToolCallEvent
  after_tool_call: AfterToolCallEvent
  tool_result_persist: ToolResultPersistEvent
  message_received: MessageReceivedEvent
  session_start: SessionEvent
  session_end: SessionEvent
  // Phase 1 新增
  turn_start: TurnStartEvent
  turn_end: TurnEndEvent
  before_compaction: BeforeCompactionEvent
  after_compaction: AfterCompactionEvent
}

/** Result 映射 */
export type ExtensionHookResultMap = {
  before_agent_start: BeforeAgentStartResult | void
  agent_end: void
  before_tool_call: BeforeToolCallResult | void
  after_tool_call: void
  tool_result_persist: ToolResultPersistResult | void
  message_received: void
  session_start: void
  session_end: void
  // Phase 1 新增
  turn_start: void
  turn_end: void
  before_compaction: BeforeCompactionResult | void
  after_compaction: void
}

/** Handler 签名 */
export type ExtensionHookHandler<K extends ExtensionHookName> = (
  event: ExtensionHookEventMap[K]
) => Promise<ExtensionHookResultMap[K]>

/** 已注册的 Hook */
export interface RegisteredExtensionHook<K extends ExtensionHookName = ExtensionHookName> {
  extensionId: string
  hookName: K
  handler: ExtensionHookHandler<K>
  priority: number
}

// ==================== 注册记录 ====================

export interface RegisteredExtensionTool {
  extensionId: string
  tool: ToolDefinition
}

export interface RegisteredExtensionMethod {
  extensionId: string
  method: string
  handler: MethodHandler
}

/** 扩展贡献的 Skill 目录 */
export interface RegisteredExtensionSkillDir {
  extensionId: string
  /** 已解析为绝对路径的 Skill 目录 */
  dir: string
}
