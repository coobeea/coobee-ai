/**
 * Pi-Mono (pi-coding-agent) SDK 特有类型定义
 *
 * 这些类型仅在 Pi-Mono 实现中使用，不暴露给外层接口。
 * 会话管理、压缩等由 SDK 内置，无需自定义类型。
 *
 * 设计原则：
 *   统一使用 OpenAI Chat Completions 格式的后端 API（openai-completions），
 *   通过 baseURL 指向不同的 OpenAI 兼容服务（MiniMax、DeepSeek 等）。
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
 * PiMonoAgentRuntime 创建选项
 *
 * 扩展通用 AgentRuntimeOptions，添加 pi-coding-agent SDK 特有配置。
 *
 * API 格式统一：
 *   所有后端 API 均使用 OpenAI Chat Completions 格式（openai-completions）。
 *   通过 apiKey + baseURL 组合指向不同的 OpenAI 兼容服务端点。
 */
export interface PiMonoAgentRuntimeOptions extends AgentRuntimeOptions {
  /** API Key（运行时注入，OpenAI 格式的 Bearer token） */
  apiKey: string

  /**
   * OpenAI 兼容 API 的 Base URL
   *
   * 所有后端统一使用 OpenAI Chat Completions 格式。
   * 通过 baseURL 指向不同的服务端点：
   *   - MiniMax: https://api.minimaxi.com/v1
   *   - DeepSeek: https://api.deepseek.com/v1
   *   - OpenAI: https://api.openai.com/v1
   *
   * 默认：https://api.minimaxi.com/v1
   */
  baseURL?: string

  /** 思考级别（默认 'medium'） */
  thinkingLevel?: ThinkingLevel

  /** 工作目录（默认 process.cwd()） */
  cwd?: string

  /**
   * SDK 原生工具定义列表
   *
   * 直接传入 pi-coding-agent 的 ToolDefinition 实例（TypeBox 参数 + SDK execute 签名）。
   * 与 AgentRuntimeOptions.tools（统一格式）共存，SDK 原生工具优先。
   * 命名与 OpenAI Runtime 的 sdkTools 统一。
   */
  sdkTools?: unknown[]

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

  /**
   * 模型元数据（从 coobee.json5 模型配置透传）
   *
   * 用于动态构造 pi-SDK Model 对象，替代硬编码默认值。
   * 由 PiMonoBuilder.build() 从 ProviderConfig 中提取并注入。
   */
  modelMeta?: {
    /** 是否支持推理/思考模式 */
    reasoning?: boolean
    /** 上下文窗口大小 */
    contextWindow?: number
    /** 最大输出 token 数 */
    maxOutputTokens?: number
    /** 最大思维链 token 数 */
    maxThinkingTokens?: number
    /** 是否支持工具调用 */
    functionCalling?: boolean
  }
}
