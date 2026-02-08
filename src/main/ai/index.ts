/**
 * AI 模块统一导出
 * 基于 @openai/agents SDK
 */

// ========== 核心类型 ==========
export type * from './types'

// ========== @openai/agents SDK ==========
export { Agent, run, type AgentConfiguration, type Tool } from '@openai/agents'

// ========== Agent 配置和管理 ==========
export {
  agentPresets,
  chatAgentPreset,
  codeAgentPreset,
  researchAgentPreset,
  type AgentPresetType,
  AgentFactory,
  agentFactory,
  type AgentCreateOptions
} from './agents'

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

// ========== 记忆管理 ==========
export { SessionMemory, type ISessionMemory } from './memory'

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

// ========== 统一运行时接口（Agent & Team）==========
export {
  // 核心接口
  type IExecutable,
  type ExecutionConfig,
  type ExecutionResult,
  type StreamChunk,
  type SessionInfo,
  type MemorySummary,
  type ToolInfo,
  type SkillInfo,
  type ExecutionContext,
  // 运行时
  AgentRuntime,
  TeamRuntime,
  RuntimeFactory,
  runtimeFactory,
  type RuntimeType,
  type RuntimeCreateOptions
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
