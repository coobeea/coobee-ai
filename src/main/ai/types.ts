/**
 * AI 模块类型定义
 * 基于 @openai/agents SDK
 */

// 导出 @openai/agents 的核心类型
export type { Agent, AgentConfiguration, Tool } from '@openai/agents'

/**
 * Session 状态
 */
export type SessionStatus = 'active' | 'paused' | 'completed' | 'error'

/**
 * Session 配置
 */
export interface SessionConfig {
  sessionId?: string
  agentPreset?: 'chat' | 'code' | 'research'
  customConfig?: Record<string, unknown>
}

/**
 * Session 信息
 */
export interface Session {
  id: string
  agentType: string
  model: string
  config: Record<string, unknown>
  status: SessionStatus
  messageCount: number
  createdAt: number
  updatedAt: number
}
