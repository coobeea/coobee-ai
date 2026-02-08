/**
 * 统筹者（Orchestrator）
 * 负责协调 Planner 和 Workers 完成复杂任务
 *
 * 架构：Orchestrator → Planner → Workers
 * - Orchestrator: 协调和监控
 * - Planner: 任务分解
 * - Workers: 实际执行（多个 Agent）
 */

import { Planner, type IPlanner } from './Planner'
import { WorkerCoordinator, type IWorkerCoordinator } from './WorkerCoordinator'
import type { Task, SubTask, ExecutionPlan, TaskExecutionResult } from './types'

/**
 * 统筹者配置
 */
export interface OrchestratorConfig {
  /** 是否启用监控 */
  enableMonitoring?: boolean
  /** 是否允许并行执行 */
  allowParallel?: boolean
  /** 最大重试次数 */
  maxRetries?: number
}

/**
 * 统筹者接口
 */
export interface IOrchestrator {
  /**
   * 执行任务
   * @param task 任务定义
   */
  executeTask(task: Task): Promise<TaskExecutionResult>

  /**
   * 取消任务
   * @param taskId 任务 ID
   */
  cancelTask(taskId: string): void

  /**
   * 清理资源
   */
  cleanup(): void
}

/**
 * 统筹者实现
 */
export class Orchestrator implements IOrchestrator {
  private readonly config: Required<OrchestratorConfig>
  private runningTasks = new Map<string, { task: Task; startTime: number; status: string }>()

  constructor(
    private readonly planner: IPlanner,
    private readonly workerCoordinator: IWorkerCoordinator,
    config?: OrchestratorConfig
  ) {
    this.config = {
      enableMonitoring: config?.enableMonitoring ?? true,
      allowParallel: config?.allowParallel ?? true,
      maxRetries: config?.maxRetries ?? 2
    }
  }

  /**
   * 执行任务
   */
  async executeTask(task: Task): Promise<TaskExecutionResult> {
    const startTime = Date.now()

    console.log(`[Orchestrator] Starting task: ${task.objective}`)

    // 标记任务为运行中
    this.runningTasks.set(task.id, { task, startTime, status: 'running' })

    try {
      // 1️⃣ 规划阶段：调用 Planner 分解任务
      console.log('[Orchestrator] Phase 1: Planning...')
      const plan = await this.planner.plan(task)

      console.log(
        `[Orchestrator] Plan created: ${plan.subTasks.length} subtasks, ${plan.stages.length} stages`
      )

      // 2️⃣ 执行阶段：按计划执行子任务
      console.log('[Orchestrator] Phase 2: Executing...')
      const subTaskResults = await this.executePlan(plan)

      // 3️⃣ 聚合阶段：收集结果
      console.log('[Orchestrator] Phase 3: Aggregating results...')
      const finalOutput = this.aggregateResults(subTaskResults)

      // 完成任务
      this.runningTasks.delete(task.id)

      const endTime = Date.now()
      const completedCount = subTaskResults.filter((r) => r.status === 'completed').length
      const failedCount = subTaskResults.filter((r) => r.status === 'failed').length

      console.log(
        `[Orchestrator] Task completed: ${completedCount}/${plan.subTasks.length} succeeded`
      )

      return {
        taskId: task.id,
        status:
          failedCount === 0 ? 'success' : failedCount < plan.subTasks.length ? 'partial' : 'failed',
        finalOutput,
        subTaskResults,
        stats: {
          startTime,
          endTime,
          duration: endTime - startTime,
          totalSubTasks: plan.subTasks.length,
          completedSubTasks: completedCount,
          failedSubTasks: failedCount
        }
      }
    } catch (error: unknown) {
      this.runningTasks.delete(task.id)

      console.error('[Orchestrator] Task failed:', error)

      return {
        taskId: task.id,
        status: 'failed',
        subTaskResults: [],
        stats: {
          startTime,
          endTime: Date.now(),
          duration: Date.now() - startTime,
          totalSubTasks: 0,
          completedSubTasks: 0,
          failedSubTasks: 0
        }
      }
    }
  }

  /**
   * 执行计划
   */
  private async executePlan(plan: ExecutionPlan): Promise<
    Array<{
      subTaskId: string
      status: 'completed' | 'failed'
      result?: unknown
      error?: string
    }>
  > {
    const results: Array<{
      subTaskId: string
      status: 'completed' | 'failed'
      result?: unknown
      error?: string
    }> = []

    const subTaskMap = new Map(plan.subTasks.map((st) => [st.id, st]))

    // 按阶段执行
    for (const stage of plan.stages) {
      console.log(`[Orchestrator] Executing stage: ${stage.name}`)

      const stageTasks = stage.subTaskIds
        .map((id) => subTaskMap.get(id))
        .filter((st): st is SubTask => st !== undefined)

      // 并行或顺序执行
      if (this.config.allowParallel && stage.parallelizable) {
        // 并行执行
        const stageResults = await Promise.allSettled(
          stageTasks.map((subTask) => this.executeSubTask(subTask))
        )

        stageResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push({
              subTaskId: stageTasks[index].id,
              status: 'completed',
              result: result.value
            })
          } else {
            results.push({
              subTaskId: stageTasks[index].id,
              status: 'failed',
              error: result.reason?.message || 'Unknown error'
            })
          }
        })
      } else {
        // 顺序执行
        for (const subTask of stageTasks) {
          try {
            const result = await this.executeSubTask(subTask)
            results.push({
              subTaskId: subTask.id,
              status: 'completed',
              result
            })
          } catch (error: unknown) {
            results.push({
              subTaskId: subTask.id,
              status: 'failed',
              error: error instanceof Error ? error.message : String(error)
            })

            // 如果是顺序执行，一个失败可能影响后续任务
            console.warn(`[Orchestrator] SubTask ${subTask.id} failed, but continuing...`)
          }
        }
      }
    }

    return results
  }

  /**
   * 执行单个子任务
   */
  private async executeSubTask(subTask: SubTask): Promise<unknown> {
    console.log(`[Orchestrator] Executing subtask: ${subTask.objective}`)

    // 获取或创建 Worker
    const worker = await this.workerCoordinator.getOrCreateWorker(subTask.assignedWorker || 'chat')

    // 执行子任务
    const result = await this.workerCoordinator.executeSubTask(subTask, worker)

    console.log(`[Orchestrator] SubTask ${subTask.id} completed`)

    return result
  }

  /**
   * 聚合结果
   */
  private aggregateResults(
    subTaskResults: Array<{
      subTaskId: string
      status: 'completed' | 'failed'
      result?: unknown
      error?: string
    }>
  ): { summary: string; results: unknown[] } {
    // TODO: 可以使用一个专门的 Aggregator Agent 来整合结果
    // 目前简单合并所有结果

    const results = subTaskResults
      .filter((r) => r.status === 'completed' && r.result)
      .map((r) => r.result)

    return {
      summary: `Completed ${subTaskResults.filter((r) => r.status === 'completed').length}/${subTaskResults.length} subtasks`,
      results
    }
  }

  /**
   * 取消任务
   */
  cancelTask(taskId: string): void {
    this.runningTasks.delete(taskId)
    console.log(`[Orchestrator] Task ${taskId} cancelled`)
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.workerCoordinator.clear()
    this.runningTasks.clear()
  }
}

/**
 * 创建默认的 Orchestrator 实例
 */
export function createOrchestrator(config?: OrchestratorConfig): Orchestrator {
  const planner = new Planner()
  const workerCoordinator = new WorkerCoordinator()

  return new Orchestrator(planner, workerCoordinator, config)
}
