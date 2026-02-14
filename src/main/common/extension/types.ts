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

/** 8 种 Agent 生命周期钩子 */
export type ExtensionHookName =
  | 'before_agent_start' // modifying：注入上下文 / 替换提示词
  | 'agent_end' // void：Agent 执行完成
  | 'before_tool_call' // modifying：修改参数 / 阻止调用
  | 'after_tool_call' // void：工具执行后
  | 'tool_result_persist' // modifying：修改持久化结果
  | 'message_received' // void：收到用户消息
  | 'session_start' // void：会话开始
  | 'session_end' // void：会话结束

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
  session_end: 'void'
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
