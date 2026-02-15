/**
 * Team 类型定义
 *
 * @experimental 设计储备 — 本模块目前未接入产品代码。
 * @deprecated 因与 swarm/ 功能重叠且绑定 OpenAI SDK，建议优先使用 swarm/ 模块。
 *
 * ⚠️ OpenAI SDK 专用：直接依赖 @openai/agents SDK，不可用于 PiMono Runtime。
 */

/**
 * Team 协作模式
 */
export type OrchestrationType = 'sequential' | 'parallel' | 'planner'

/**
 * Team 成员配置
 */
export interface TeamMember {
  id: string
  agentId: string // 引用的 Agent ID
  role: string // 成员角色
  priority?: number // 优先级
}

/**
 * 路由规则
 */
export interface RoutingRule {
  condition: string // 条件描述
  targetRole: string // 目标角色
}

/**
 * Team 配置
 */
export interface TeamConfig {
  id: string
  name: string
  description?: string
  orchestrationType: OrchestrationType
  members: TeamMember[]
  routingRules?: RoutingRule[]
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

/**
 * Team 配置数据（数据库格式）
 */
export interface TeamConfigData {
  id: string
  name: string
  description?: string
  orchestrationType: OrchestrationType
  routingRules?: RoutingRule[]
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}
