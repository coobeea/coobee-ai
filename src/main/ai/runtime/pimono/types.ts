/**
 * Pi-Mono (pi-coding-agent) SDK 特有类型定义
 *
 * 这些类型仅在 Pi-Mono 实现中使用，不暴露给外层接口。
 * 会话管理、压缩等由 SDK 内置，无需自定义类型。
 */

import type { AgentRuntimeOptions } from '../types'

// ========== Pi-Mono Agent 运行时选项 ==========

/**
 * 思考级别
 *
 * 控制 LLM 的思考深度（与 pi-ai SDK ThinkingLevel 一致）：
 *   - minimal: 最少思考
 *   - low: 简单思考
 *   - medium: 中等思考（默认）
 *   - high: 深度思考
 *   - xhigh: 极深度思考
 */
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/**
 * Provider 类型
 *
 * pi-coding-agent 内置支持多种 Provider。
 * 常用的有 anthropic（Claude）、minimax（MiniMax）、openai 等。
 */
export type PiProvider =
  | 'anthropic'
  | 'openai'
  | 'minimax'
  | 'minimax-cn'
  | 'google'
  | 'mistral'
  | 'xai'
  | 'groq'
  | string

/**
 * PiMonoAgentRuntime 创建选项
 *
 * 扩展通用 AgentRuntimeOptions，添加 pi-coding-agent SDK 特有配置。
 */
export interface PiMonoAgentRuntimeOptions extends AgentRuntimeOptions {
  /** API Key（运行时注入） */
  apiKey: string

  /** Provider 类型（默认 'minimax'） */
  provider?: PiProvider

  /** 思考级别（默认 'medium'） */
  thinkingLevel?: ThinkingLevel

  /** 工作目录（默认 process.cwd()） */
  cwd?: string

  /**
   * 自定义工具定义列表
   *
   * pi-coding-agent 使用 TypeBox 定义参数。
   * 每个 ToolDefinition 需要 name, label, description, parameters, execute。
   * 通过 createAgentSession 的 customTools 传入。
   */
  customTools?: unknown[]

  /**
   * 是否使用内置代码工具（read, bash, edit, write）
   *
   * 默认 false（测试场景不需要文件系统工具）。
   * 设为 true 时加载 codingTools。
   */
  useCodingTools?: boolean

  /**
   * Session 持久化模式
   *
   * - 'memory': 内存模式（默认，适合测试）
   * - 'file': 文件模式（持久化到 cwd/.pi/sessions/）
   */
  sessionMode?: 'memory' | 'file'

  /**
   * 压缩配置
   *
   * SDK 内置自动压缩，通过 SettingsManager 配置。
   * enabled=false 时禁用自动压缩。
   */
  compaction?: {
    enabled?: boolean
  }

  /**
   * 重试配置
   *
   * SDK 内置自动重试，通过 SettingsManager 配置。
   */
  retry?: {
    enabled?: boolean
    maxRetries?: number
    baseDelayMs?: number
  }
}
