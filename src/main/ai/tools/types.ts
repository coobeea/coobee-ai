/**
 * 工具类型定义
 * 基于 @openai/agents SDK 的工具系统
 */

import type { Tool as OpenAITool } from '@openai/agents'

/**
 * 工具定义（导出 OpenAI 的 Tool 类型）
 */
export type Tool = OpenAITool

/**
 * 工具执行上下文
 */
export interface ToolExecutionContext {
  /** 会话 ID */
  sessionId: string
  /** 用户 ID（可选） */
  userId?: string
  /** 其他上下文信息 */
  [key: string]: unknown
}
