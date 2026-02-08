/**
 * Orchestration 类型定义
 * 基于 Orchestrator-Worker 模式
 */

import type { Agent } from '@openai/agents'

/**
 * 任务定义
 */
export interface Task {
  /** 任务 ID */
  id: string
  /** 任务目标 */
  objective: string
  /** 任务描述 */
  description?: string
  /** 上下文信息 */
  context?: Record<string, unknown>
  /** 优先级 */
  priority?: 'low' | 'medium' | 'high'
}

/**
 * 子任务定义
 */
export interface SubTask {
  /** 子任务 ID */
  id: string
  /** 子任务目标 */
  objective: string
  /** 子任务描述 */
  description?: string
  /** 依赖的子任务 ID 列表 */
  dependencies: string[]
  /** 分配给哪个 Worker（Agent 类型） */
  assignedWorker?: string
  /** 任务状态 */
  status: SubTaskStatus
  /** 执行结果 */
  result?: unknown
  /** 错误信息 */
  error?: string
}

/**
 * 子任务状态
 */
export type SubTaskStatus = 'pending' | 'running' | 'completed' | 'failed'

/**
 * 执行计划
 */
export interface ExecutionPlan {
  /** 任务 ID */
  taskId: string
  /** 子任务列表 */
  subTasks: SubTask[]
  /** 执行阶段 */
  stages: ExecutionStage[]
}

/**
 * 执行阶段
 */
export interface ExecutionStage {
  /** 阶段 ID */
  stageId: string
  /** 阶段名称 */
  name: string
  /** 该阶段包含的子任务 ID 列表 */
  subTaskIds: string[]
  /** 是否可并行执行 */
  parallelizable: boolean
  /** 阶段状态 */
  status?: 'pending' | 'running' | 'completed' | 'failed'
}

/**
 * Worker（Agent）信息
 */
export interface WorkerInfo {
  /** Worker ID */
  id: string
  /** Worker 类型（对应 Agent 预设） */
  type: string
  /** Agent 实例 */
  agent: Agent
  /** 当前状态 */
  status: 'idle' | 'busy' | 'error'
  /** 正在执行的子任务 ID */
  currentTaskId?: string
}

/**
 * 任务执行结果
 */
export interface TaskExecutionResult {
  /** 任务 ID */
  taskId: string
  /** 执行状态 */
  status: 'success' | 'failed' | 'partial'
  /** 最终输出 */
  finalOutput?: unknown
  /** 子任务结果列表 */
  subTaskResults: Array<{
    subTaskId: string
    status: SubTaskStatus
    result?: unknown
    error?: string
  }>
  /** 执行统计 */
  stats: {
    startTime: number
    endTime: number
    duration: number
    totalSubTasks: number
    completedSubTasks: number
    failedSubTasks: number
  }
}
