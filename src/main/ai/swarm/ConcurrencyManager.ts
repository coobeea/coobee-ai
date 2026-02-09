/**
 * ConcurrencyManager - 并发管理器
 *
 * 管理 Swarm 中 Agent 的并行执行：
 * - 任务分解：将复杂任务拆分为可并行的子任务
 * - 并行执行：多个 Agent 同时处理不同子任务
 * - 同步屏障：等待所有并行任务完成
 * - 结果聚合：合并多个 Agent 的输出
 * - 并发控制：信号量机制限制同时运行的 Agent 数
 */

import { Agent, run } from '@openai/agents'
import type { SwarmConfig } from './types'

// ========== 类型定义 ==========

/**
 * 子任务定义
 */
export interface SwarmSubTask {
  /** 子任务 ID */
  id: string
  /** 子任务描述/指令 */
  input: string
  /** 分配的角色 ID */
  roleId: string
  /** 依赖的子任务 ID 列表（这些必须先完成） */
  dependencies?: string[]
  /** 优先级（数值越大越优先） */
  priority?: number
}

/**
 * 子任务执行结果
 */
export interface SubTaskResult {
  /** 子任务 ID */
  taskId: string
  /** 角色 ID */
  roleId: string
  /** 输出内容 */
  output: string
  /** 是否成功 */
  success: boolean
  /** 错误信息 */
  error?: string
  /** 执行耗时（ms） */
  duration: number
  /** 开始时间 */
  startedAt: number
  /** 完成时间 */
  completedAt: number
}

/**
 * 并行执行结果
 */
export interface ParallelExecutionResult {
  /** 所有子任务结果 */
  results: SubTaskResult[]
  /** 聚合后的最终输出 */
  aggregatedOutput: string
  /** 成功的子任务数 */
  successCount: number
  /** 失败的子任务数 */
  failCount: number
  /** 总耗时（ms） */
  totalDuration: number
}

/**
 * 并发执行事件
 */
export interface ConcurrencyEvent {
  type:
    | 'task_started'
    | 'task_completed'
    | 'task_failed'
    | 'phase_started'
    | 'phase_completed'
    | 'all_completed'
  taskId?: string
  roleId?: string
  phase?: number
  message: string
  timestamp: number
}

export type ConcurrencyEventListener = (event: ConcurrencyEvent) => void

/**
 * 并发管理器
 */
export class ConcurrencyManager {
  /** 并发信号量：当前运行数 */
  private runningCount = 0

  /** 事件监听器 */
  private eventListeners: ConcurrencyEventListener[] = []

  constructor(private readonly config: SwarmConfig) {}

  // ========== 并行执行 ==========

  /**
   * 并行执行多个子任务
   *
   * 自动处理依赖关系：
   * - 无依赖的子任务并行执行
   * - 有依赖的子任务等待依赖完成后执行
   * - 同一轮内的任务尊重并发限制
   *
   * @param subTasks 子任务列表
   * @param agents 可用 Agent 映射（roleId -> Agent）
   * @returns 并行执行结果
   */
  async executeParallel(
    subTasks: SwarmSubTask[],
    agents: Map<string, Agent>
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now()
    const allResults: SubTaskResult[] = []
    const completedTaskIds = new Set<string>()

    // 按依赖关系分阶段
    const phases = this.buildExecutionPhases(subTasks)

    for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex++) {
      const phase = phases[phaseIndex]

      this.emitEvent({
        type: 'phase_started',
        phase: phaseIndex,
        message: `阶段 ${phaseIndex + 1}/${phases.length} 开始，包含 ${phase.length} 个任务`,
        timestamp: Date.now()
      })

      // 同一阶段内的任务并行执行（受并发限制）
      const phaseResults = await this.executePhase(phase, agents)
      allResults.push(...phaseResults)

      // 记录已完成的任务 ID
      for (const result of phaseResults) {
        if (result.success) {
          completedTaskIds.add(result.taskId)
        }
      }

      this.emitEvent({
        type: 'phase_completed',
        phase: phaseIndex,
        message: `阶段 ${phaseIndex + 1} 完成，成功 ${phaseResults.filter((r) => r.success).length}/${phaseResults.length}`,
        timestamp: Date.now()
      })
    }

    // 聚合结果
    const aggregatedOutput = this.aggregateResults(allResults)

    const totalDuration = Date.now() - startTime

    this.emitEvent({
      type: 'all_completed',
      message: `全部完成，共 ${allResults.length} 个任务，耗时 ${totalDuration}ms`,
      timestamp: Date.now()
    })

    return {
      results: allResults,
      aggregatedOutput,
      successCount: allResults.filter((r) => r.success).length,
      failCount: allResults.filter((r) => !r.success).length,
      totalDuration
    }
  }

  /**
   * 简单并行执行（无依赖关系，所有任务同时开始）
   */
  async executeSimpleParallel(
    tasks: Array<{ id: string; input: string; agent: Agent; roleId: string }>,
    concurrencyLimit?: number
  ): Promise<SubTaskResult[]> {
    const limit = concurrencyLimit || this.config.maxConcurrentAgents
    const results: SubTaskResult[] = []
    const queue = [...tasks]

    // 使用信号量控制并发
    const executing: Promise<void>[] = []

    for (const task of queue) {
      // 等待并发数降下来
      if (executing.length >= limit) {
        await Promise.race(executing)
      }

      const promise = this.executeSingleTask(task.id, task.input, task.agent, task.roleId)
        .then((result) => {
          results.push(result)
        })
        .then(() => {
          // 从 executing 中移除
          const idx = executing.indexOf(promise)
          if (idx !== -1) executing.splice(idx, 1)
        })

      executing.push(promise)
    }

    // 等待所有剩余任务完成
    await Promise.all(executing)

    return results
  }

  // ========== 执行阶段 ==========

  /**
   * 执行一个阶段内的所有任务（并发限制）
   */
  private async executePhase(
    tasks: SwarmSubTask[],
    agents: Map<string, Agent>
  ): Promise<SubTaskResult[]> {
    const limit = this.config.maxConcurrentAgents
    const results: SubTaskResult[] = []
    const executing: Promise<void>[] = []

    // 按优先级排序
    const sorted = [...tasks].sort((a, b) => (b.priority || 0) - (a.priority || 0))

    for (const task of sorted) {
      const agent = agents.get(task.roleId)
      if (!agent) {
        results.push({
          taskId: task.id,
          roleId: task.roleId,
          output: '',
          success: false,
          error: `Agent not found for role: ${task.roleId}`,
          duration: 0,
          startedAt: Date.now(),
          completedAt: Date.now()
        })
        continue
      }

      // 并发控制
      if (executing.length >= limit) {
        await Promise.race(executing)
      }

      const promise = this.executeSingleTask(task.id, task.input, agent, task.roleId)
        .then((result) => {
          results.push(result)
        })
        .then(() => {
          const idx = executing.indexOf(promise)
          if (idx !== -1) executing.splice(idx, 1)
        })

      executing.push(promise)
    }

    // 同步屏障：等待本阶段所有任务完成
    await Promise.all(executing)

    return results
  }

  /**
   * 执行单个任务
   */
  private async executeSingleTask(
    taskId: string,
    input: string,
    agent: Agent,
    roleId: string
  ): Promise<SubTaskResult> {
    const startedAt = Date.now()
    this.runningCount++

    this.emitEvent({
      type: 'task_started',
      taskId,
      roleId,
      message: `任务 ${taskId} 开始执行 (${roleId})`,
      timestamp: startedAt
    })

    try {
      const result = await run(agent, input, { maxTurns: 25 })
      const completedAt = Date.now()
      this.runningCount--

      this.emitEvent({
        type: 'task_completed',
        taskId,
        roleId,
        message: `任务 ${taskId} 执行完成 (${completedAt - startedAt}ms)`,
        timestamp: completedAt
      })

      return {
        taskId,
        roleId,
        output: result.finalOutput || '',
        success: true,
        duration: completedAt - startedAt,
        startedAt,
        completedAt
      }
    } catch (error) {
      const completedAt = Date.now()
      this.runningCount--
      const errorMessage = error instanceof Error ? error.message : String(error)

      this.emitEvent({
        type: 'task_failed',
        taskId,
        roleId,
        message: `任务 ${taskId} 执行失败: ${errorMessage}`,
        timestamp: completedAt
      })

      return {
        taskId,
        roleId,
        output: '',
        success: false,
        error: errorMessage,
        duration: completedAt - startedAt,
        startedAt,
        completedAt
      }
    }
  }

  // ========== 依赖分析 ==========

  /**
   * 根据依赖关系构建执行阶段
   *
   * 拓扑排序：同一阶段的任务可以并行，后续阶段依赖前面的阶段
   */
  buildExecutionPhases(subTasks: SwarmSubTask[]): SwarmSubTask[][] {
    const phases: SwarmSubTask[][] = []
    const resolved = new Set<string>()
    let remaining = [...subTasks]

    while (remaining.length > 0) {
      // 找出当前轮可执行的任务（依赖已全部解决）
      const currentPhase: SwarmSubTask[] = []
      const nextRemaining: SwarmSubTask[] = []

      for (const task of remaining) {
        const deps = task.dependencies || []
        const allDepsResolved = deps.every((dep) => resolved.has(dep))

        if (allDepsResolved) {
          currentPhase.push(task)
        } else {
          nextRemaining.push(task)
        }
      }

      // 如果没有任何任务可执行，说明存在循环依赖
      if (currentPhase.length === 0 && nextRemaining.length > 0) {
        console.warn(
          '[ConcurrencyManager] Circular dependency detected, forcing execution of remaining tasks'
        )
        // 强制执行剩余任务
        currentPhase.push(...nextRemaining)
        nextRemaining.length = 0
      }

      // 标记为已解决
      for (const task of currentPhase) {
        resolved.add(task.id)
      }

      phases.push(currentPhase)
      remaining = nextRemaining
    }

    return phases
  }

  // ========== 结果聚合 ==========

  /**
   * 聚合多个子任务的结果
   */
  private aggregateResults(results: SubTaskResult[]): string {
    const successResults = results.filter((r) => r.success)
    const failedResults = results.filter((r) => !r.success)

    const parts: string[] = []

    if (successResults.length > 0) {
      for (const result of successResults) {
        parts.push(`### ${result.roleId} (${result.taskId})\n\n${result.output}`)
      }
    }

    if (failedResults.length > 0) {
      parts.push('\n---\n### 执行失败的任务\n')
      for (const result of failedResults) {
        parts.push(`- **${result.taskId}** (${result.roleId}): ${result.error}`)
      }
    }

    return parts.join('\n\n')
  }

  // ========== 状态查询 ==========

  /**
   * 获取当前并发运行数
   */
  getRunningCount(): number {
    return this.runningCount
  }

  /**
   * 是否达到并发上限
   */
  isAtCapacity(): boolean {
    return this.runningCount >= this.config.maxConcurrentAgents
  }

  // ========== 事件系统 ==========

  addEventListener(listener: ConcurrencyEventListener): void {
    this.eventListeners.push(listener)
  }

  removeEventListener(listener: ConcurrencyEventListener): void {
    const index = this.eventListeners.indexOf(listener)
    if (index !== -1) {
      this.eventListeners.splice(index, 1)
    }
  }

  private emitEvent(event: ConcurrencyEvent): void {
    console.log(`[ConcurrencyManager] ${event.message}`)
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('[ConcurrencyManager] Event listener error:', error)
      }
    }
  }

  // ========== 清理 ==========

  destroy(): void {
    this.eventListeners = []
    this.runningCount = 0
  }
}
