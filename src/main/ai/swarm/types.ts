/**
 * Swarm 群体智能模块类型定义
 *
 * SDK 无关 — 不依赖任何特定 LLM SDK。
 * Agent 通过 AgentRuntime 抽象运行，Handoff 通过工具调用 + 协调器循环实现。
 */

import type { ToolDefinition } from '../tools/types';
import type { AgentRuntime } from '../runtime/AgentRuntime';

// ========== 角色定义 ==========

/**
 * Agent 角色模板
 */
export interface AgentRole {
  /** 角色唯一标识 */
  id: string;
  /** 角色名称 */
  name: string;
  /** 角色描述 */
  description: string;
  /** Agent 系统指令 */
  instructions: string;
  /** 使用的模型 */
  model?: string;
  /** 可用工具列表（SDK 无关的 ToolDefinition） */
  tools?: ToolDefinition[];
  /** Handoff 描述（LLM 看到的描述，用于判断何时交接） */
  handoffDescription: string;
  /** 能力标签（用于自动匹配） */
  capabilities: string[];
  /** 角色优先级（数值越大优先级越高） */
  priority?: number;
}

/**
 * 角色注册表项
 */
export interface RoleRegistryEntry {
  /** 角色定义 */
  role: AgentRole;
  /** 是否内置角色 */
  builtin: boolean;
  /** 注册时间 */
  registeredAt: number;
}

// ========== Swarm 配置 ==========

/**
 * Swarm 配置
 */
export interface SwarmConfig {
  /** Swarm 唯一标识 */
  id: string;
  /** Swarm 名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 父 sessionId（= threadId），用于子 sessionId 命名 */
  parentSessionId?: string;
  /** 最大并发 Agent 数 */
  maxConcurrentAgents: number;
  /** Agent 空闲超时时间（ms） */
  agentIdleTimeout: number;
  /** 最大 Handoff 深度（防止无限交接） */
  maxHandoffDepth: number;
  /** 可用角色 ID 列表（为空则使用所有注册角色） */
  availableRoles?: string[];
  /** Triage Agent 使用的模型 */
  triageModel?: string;
  /** Triage Agent 自定义指令（追加到默认指令后） */
  triageInstructions?: string;
  /** 是否启用共享上下文 */
  enableSharedContext: boolean;
  /** 是否启用执行监控 */
  enableMonitoring: boolean;
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 默认 Swarm 配置
 */
export const DEFAULT_SWARM_CONFIG: Omit<SwarmConfig, 'id' | 'name'> = {
  maxConcurrentAgents: 10,
  agentIdleTimeout: 15 * 60 * 1000,
  maxHandoffDepth: 10,
  triageModel: 'gpt-4o',
  enableSharedContext: true,
  enableMonitoring: true
};

// ========== 任务定义 ==========

/**
 * Swarm 任务
 */
export interface SwarmTask {
  /** 任务 ID */
  id: string;
  /** 用户输入 */
  input: string;
  /** 任务上下文 */
  context?: Record<string, unknown>;
  /** 约束条件 */
  constraints?: string[];
  /** 期望的输出格式 */
  expectedOutputFormat?: string;
  /** 创建时间 */
  createdAt: number;
}

// ========== Agent 池 ==========

/**
 * Agent 池中的条目状态
 */
export type PoolAgentStatus = 'idle' | 'busy' | 'retiring';

/**
 * Agent 池条目（使用 AgentRuntime 而非 SDK Agent）
 */
export interface PoolAgentEntry {
  /** AgentRuntime 实例 */
  runtime: AgentRuntime;
  /** 分配的角色 */
  role: AgentRole;
  /** 唯一标识（池内） */
  poolId: string;
  /** 当前状态 */
  status: PoolAgentStatus;
  /** 创建时间 */
  createdAt: number;
  /** 最后活跃时间 */
  lastActiveAt: number;
  /** 执行任务计数 */
  taskCount: number;
  /** 成功任务计数 */
  successCount: number;
  /** 失败任务计数 */
  failCount: number;
}

// ========== Handoff 记录 ==========

/**
 * Handoff 记录
 */
export interface HandoffRecord {
  /** 记录 ID */
  id: string;
  /** 发起交接的 Agent 角色 ID */
  fromRoleId: string;
  /** 接收交接的 Agent 角色 ID */
  toRoleId: string;
  /** 交接原因 */
  reason?: string;
  /** 交接时携带的输入数据 */
  inputData?: unknown;
  /** 交接发生的时间 */
  timestamp: number;
  /** 当前 Handoff 深度 */
  depth: number;
}

// ========== Swarm 运行状态 ==========

/**
 * Swarm 执行状态
 */
export type SwarmExecutionStatus = 'idle' | 'triaging' | 'executing' | 'completed' | 'failed';

/**
 * Swarm 运行状态
 */
export interface SwarmState {
  /** 当前执行状态 */
  status: SwarmExecutionStatus;
  /** 活跃的 Agent 列表 */
  activeAgents: Array<{
    poolId: string;
    roleId: string;
    status: PoolAgentStatus;
  }>;
  /** Handoff 历史 */
  handoffHistory: HandoffRecord[];
  /** 当前 Handoff 深度 */
  currentHandoffDepth: number;
  /** 任务进度（0-100） */
  progress: number;
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 错误信息 */
  error?: string;
}

/**
 * 初始 Swarm 状态
 */
export function createInitialSwarmState(): SwarmState {
  return {
    status: 'idle',
    activeAgents: [],
    handoffHistory: [],
    currentHandoffDepth: 0,
    progress: 0
  };
}

// ========== 共享上下文 ==========

/**
 * 共享上下文中的产物
 */
export interface SwarmArtifact {
  /** 产物名称 */
  name: string;
  /** 产物内容 */
  content: string;
  /** 创建者角色 ID */
  createdBy: string;
  /** 创建时间 */
  createdAt: number;
  /** 产物类型 */
  type?: string;
}

/**
 * 共享上下文数据
 */
export interface SwarmContextData {
  /** 键值对状态 */
  state: Record<string, unknown>;
  /** 中间产物 */
  artifacts: SwarmArtifact[];
  /** 任务进度描述 */
  progressNotes: string[];
}

// ========== 监控指标 ==========

/**
 * Swarm 执行指标
 */
export interface SwarmMetrics {
  /** 总执行次数 */
  totalExecutions: number;
  /** 成功次数 */
  successCount: number;
  /** 失败次数 */
  failCount: number;
  /** 总 Handoff 次数 */
  totalHandoffs: number;
  /** 平均 Handoff 深度 */
  averageHandoffDepth: number;
  /** 最大 Handoff 深度 */
  maxHandoffDepth: number;
  /** 平均执行时间（ms） */
  averageDuration: number;
  /** 各角色使用次数 */
  roleUsageCount: Record<string, number>;
  /** Agent 池统计 */
  poolStats: {
    totalCreated: number;
    currentActive: number;
    totalRetired: number;
  };
}

/**
 * 初始 Swarm 指标
 */
export function createInitialSwarmMetrics(): SwarmMetrics {
  return {
    totalExecutions: 0,
    successCount: 0,
    failCount: 0,
    totalHandoffs: 0,
    averageHandoffDepth: 0,
    maxHandoffDepth: 0,
    averageDuration: 0,
    roleUsageCount: {},
    poolStats: {
      totalCreated: 0,
      currentActive: 0,
      totalRetired: 0
    }
  };
}

// ========== Handoff 工具调用结果 ==========

/**
 * Handoff 信号常量
 * Agent 调用 transfer_to_XXX 工具时返回此前缀，协调器据此截获并执行交接
 */
export const HANDOFF_SIGNAL_PREFIX = '__SWARM_HANDOFF__:';

/**
 * 从工具结果中提取 handoff 目标角色 ID
 */
export function extractHandoffTarget(toolResult: string): string | null {
  if (toolResult.startsWith(HANDOFF_SIGNAL_PREFIX)) {
    return toolResult.slice(HANDOFF_SIGNAL_PREFIX.length);
  }
  return null;
}
