/**
 * AI 模块统一导出
 * 基于 @openai/agents SDK
 */

// ========== 核心类型 ==========
export type * from './types'

// ========== 通用工具 ==========
export * from './common'

// ========== @openai/agents SDK ==========
export { Agent, run, type AgentConfiguration, type Tool } from '@openai/agents'

// ========== 技能系统 ==========
export {
  SkillManager,
  builtinSkills,
  webResearchSkill,
  codeGenerationSkill,
  type ISkillManager,
  type AISkill,
  type SkillCategory,
  type SkillActivationOptions,
  type SkillExecutionContext,
  type SkillActivationResult
} from './skills'

// ========== 记忆管理（四类记忆）==========
export {
  // 类型
  type Message,
  type SessionState,
  type Checkpoint,
  type LongTermMemoryEntry,
  type MemoryQuery,
  LongTermMemoryType,
  // Session Memory（会话记忆）
  SessionMemoryStore,
  // Short-Term Memory（短期记忆）
  TrimmingSession,
  SummarizingSession,
  // Working Memory / State（工作记忆 / 状态）
  WorkingMemoryStore,
  // Long-Term Memory（长期记忆）
  LongTermMemoryStore
} from './memory'

// ========== 监控系统 ==========
export {
  MonitoringService,
  type IMonitoringService,
  type MonitoringMetrics,
  type MonitoringEvent
} from './monitoring'

// ========== 工具系统 ==========
export { ToolRegistry, builtinTools } from './tools'

// ========== 数据存储 ==========
export {
  AgentConfigStore,
  agentConfigStore,
  type IAgentConfigStore,
  type AgentConfigData
} from './storage'
export type { Session, SessionStatus, SessionConfig } from './types'

// ========== WebSocket 网关 ==========
export { AgentGateway } from './gateway'

// ========== 流式输出（基于 EventBus）==========
export {
  // 类型
  type StreamMessage,
  type StreamMessageType,
  type StreamSource,
  type StreamEvent,
  StreamEventType,
  // 生产者（发射器）
  type IStreamEmitter,
  StreamEmitter,
  createStreamEmitter,
  // 消费者
  StreamStore,
  streamStore,
  WebSocketBroadcaster,
  webSocketBroadcaster,
  StreamMonitor,
  streamMonitor,
  type SessionStats,
  type ClientMessage,
  type ServerMessage
} from './streaming'

// ========== 统一运行时接口（Agent & Team & Swarm）==========
export {
  // 核心接口和类型
  type IExecutable,
  type ExecutionConfig,
  type ExecutionResult,
  type StreamChunk,
  type StreamChunkType,
  type SessionInfo,
  type AgentRuntimeOptions,
  type ToolApprovalInfo,
  // 运行时
  AgentRuntime,
  TeamRuntime,
  type TeamRuntimeOptions,
  type TeamMemberConfig,
  SwarmRuntime,
  type SwarmRuntimeOptions,
  RuntimeFactory,
  runtimeFactory,
  type RuntimeCreateOptions,
  // Session
  FileSession
} from './runtime'

// ========== Team（多 Agent 协作）==========
export {
  type TeamConfig,
  type TeamMember,
  type TeamConfigData,
  type OrchestrationType,
  type RoutingRule
} from './teams'

// ========== Orchestration（统筹协调）==========
export {
  Orchestrator,
  createOrchestrator,
  Planner,
  WorkerCoordinator,
  type IOrchestrator,
  type IPlanner,
  type IWorkerCoordinator,
  type Task,
  type SubTask,
  type SubTaskStatus,
  type ExecutionPlan,
  type ExecutionStage,
  type WorkerInfo,
  type TaskExecutionResult,
  type OrchestratorConfig
} from './orchestration'

// ========== Swarm（群体智能）==========
export {
  // 核心组件
  SwarmCoordinator,
  type CoordinationResult,
  AgentPool,
  HandoffRouter,
  SwarmContext,
  SwarmMonitor,
  // 并发管理
  ConcurrencyManager,
  type SwarmSubTask,
  type SubTaskResult,
  type ParallelExecutionResult,
  // 消息通信
  MessageBus,
  type SwarmMessage,
  type MessagePriority,
  // 通信工具
  createSwarmTools,
  // 角色系统
  RoleRegistry,
  builtinRoles,
  coderRole,
  researcherRole,
  reviewerRole,
  writerRole,
  analystRole,
  // 类型
  type AgentRole,
  type SwarmConfig,
  type SwarmTask,
  type SwarmState,
  type HandoffRecord,
  type SwarmArtifact,
  type SwarmMetrics,
  type SwarmAlert,
  DEFAULT_SWARM_CONFIG
} from './swarm'
