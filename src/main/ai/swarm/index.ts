/**
 * Swarm 群体智能模块 — 动态 Agent 自组织协作
 *
 * SDK 无关 — 基于 AgentRuntime 抽象层，不依赖任何特定 LLM SDK。
 * Handoff 机制通过工具调用 + 协调器循环实现。
 *
 * 与 Orchestration（统筹者模式）的区别：
 * - 统筹者：先有计划，程序按计划执行 → 结构化、可预测
 * - 蜂群：无预先计划，Agent 自主决定 Handoff → 灵活、探索性
 *
 * 核心组件：
 * - SwarmRuntime: 统一运行时（实现 AgentRuntime）
 * - SwarmCoordinator: 核心协调器（Triage → Handoff 循环）
 * - AgentPool: 动态 Agent 池（管理 AgentRuntime 实例）
 * - HandoffRouter: Handoff 路由管理（纯逻辑）
 * - SwarmContext: 共享上下文黑板
 * - SwarmMonitor: 执行监控与指标
 * - MessageBus: Agent 间消息总线
 * - ConcurrencyManager: 并发管理器
 * - RoleRegistry: 角色注册表
 * - Swarm Tools: Agent 通信 + Handoff 工具
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
} from './types';

export {
  DEFAULT_SWARM_CONFIG,
  createInitialSwarmState,
  createInitialSwarmMetrics,
  HANDOFF_SIGNAL_PREFIX,
  extractHandoffTarget
} from './types';

// ========== 核心组件 ==========
export { SwarmRuntime, type SwarmRuntimeOptions } from './SwarmRuntime';
export {
  SwarmCoordinator,
  type CoordinationResult,
  type SwarmEvent,
  type SwarmEventCallback
} from './SwarmCoordinator';
export { AgentPool, type AgentPoolEvent, type AgentPoolEventListener } from './AgentPool';
export { HandoffRouter, type OnHandoffCallback } from './HandoffRouter';
export { SwarmContext, type ContextChangeEvent, type ContextChangeListener } from './SwarmContext';
export { SwarmMonitor, type SwarmAlert, type AlertListener } from './SwarmMonitor';

// ========== 并发管理 ==========
export {
  ConcurrencyManager,
  type SwarmSubTask,
  type SubTaskResult,
  type ParallelExecutionResult,
  type ConcurrencyEvent,
  type ConcurrencyEventListener
} from './ConcurrencyManager';

// ========== 消息通信 ==========
export {
  MessageBus,
  type SwarmMessage,
  type MessagePriority,
  type MessageBusEvent,
  type MessageBusEventListener
} from './MessageBus';

// ========== 通信工具 ==========
export {
  createSwarmTools,
  createSwarmCommTools,
  createHandoffTools,
  createReadContextTool,
  createWriteContextTool,
  createAddArtifactTool,
  createGetArtifactTool,
  createSendMessageTool,
  createGetMessagesTool,
  createReportProgressTool
} from './tools';

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
} from './roles';
