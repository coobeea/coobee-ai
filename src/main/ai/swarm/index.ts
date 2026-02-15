/**
 * ⚠️ OpenAI SDK 专用模块
 *
 * 本模块直接依赖 @openai/agents SDK，不可用于 PiMono Runtime。
 * 计划在未来版本中通过 IAgentFactory 接口抽象，实现 SDK 无关。
 */

/**
 * Swarm 群体智能模块
 *
 * 基于 OpenAI Agents SDK 的 Handoff 机制，实现动态 Agent 自组织协作。
 *
 * 核心组件：
 * - SwarmRuntime: 统一运行时（实现 AgentRuntime）
 * - SwarmCoordinator: 核心协调器（含 Triage Agent）
 * - AgentPool: 动态 Agent 池
 * - HandoffRouter: Handoff 路由管理
 * - SwarmContext: 共享上下文黑板
 * - SwarmMonitor: 执行监控与指标
 * - MessageBus: Agent 间消息总线
 * - ConcurrencyManager: 并发管理器
 * - RoleRegistry: 角色注册表
 * - Swarm Tools: Agent 通信工具（共享上下文 + 消息传递）
 */

// ========== 类型 ==========
export type {
  AgentRole,
  RoleRegistryEntry,
  SwarmConfig,
  SwarmTask,
  PoolAgentStatus,
  PoolAgentEntry,
  HandoffRecord,
  SwarmExecutionStatus,
  SwarmState,
  SwarmArtifact,
  SwarmContextData,
  SwarmMetrics
} from './types'

export { DEFAULT_SWARM_CONFIG, createInitialSwarmState, createInitialSwarmMetrics } from './types'

// ========== 核心组件 ==========
export { SwarmRuntime, type SwarmRuntimeOptions } from './SwarmRuntime'
export { SwarmCoordinator, type CoordinationResult } from './SwarmCoordinator'
export { AgentPool, type AgentPoolEvent, type AgentPoolEventListener } from './AgentPool'
export { HandoffRouter, type HandoffOption, type OnHandoffCallback } from './HandoffRouter'
export { SwarmContext, type ContextChangeEvent, type ContextChangeListener } from './SwarmContext'
export { SwarmMonitor, type SwarmAlert, type AlertListener } from './SwarmMonitor'

// ========== 并发管理 ==========
export {
  ConcurrencyManager,
  type SwarmSubTask,
  type SubTaskResult,
  type ParallelExecutionResult,
  type ConcurrencyEvent,
  type ConcurrencyEventListener
} from './ConcurrencyManager'

// ========== 消息通信 ==========
export {
  MessageBus,
  type SwarmMessage,
  type MessagePriority,
  type MessageBusEvent,
  type MessageBusEventListener
} from './MessageBus'

// ========== 通信工具 ==========
export {
  createSwarmTools,
  createReadContextTool,
  createWriteContextTool,
  createAddArtifactTool,
  createGetArtifactTool,
  createSendMessageTool,
  createGetMessagesTool,
  createReportProgressTool
} from './tools'

// ========== 角色系统 ==========
export {
  RoleRegistry,
  builtinRoles,
  builtinRoleMap,
  coderRole,
  researcherRole,
  reviewerRole,
  writerRole,
  analystRole
} from './roles'
