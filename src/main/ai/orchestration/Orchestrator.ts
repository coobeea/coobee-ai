/**
 * 统筹者（Orchestrator）— 程序化多 Agent 编排引擎
 *
 * 核心设计理念：
 *   **控制权在程序，而非 LLM。**
 *
 *   与 Swarm（蜂群模式）的本质区别：
 *   - Swarm：LLM 通过 Handoff 自主决定交接，控制流不确定
 *   - Orchestrator：程序按 ExecutionPlan 调度 Worker，控制流确定
 *
 * 架构：Orchestrator（程序控制） → Planner（LLM 规划） → Workers（LLM 执行）
 *   - Orchestrator: 程序化协调、调度、监控（不是 LLM）
 *   - Planner: LLM 负责任务分解（通过 AgentRuntime）
 *   - Workers: LLM 负责实际执行（通过 AgentRuntime）
 *
 * 基于 AgentRuntime — SDK 无关。
 */

import { createLogger } from '@main/common/logger';
import { Planner, type IPlanner } from './Planner';
import { WorkerCoordinator, type IWorkerCoordinator, type WorkerExecutionResult } from './WorkerCoordinator';
import type { Task, SubTask, ExecutionPlan, TaskExecutionResult, SubTaskExecutionResult } from './types';

const log = createLogger('orchestration');

/**
 * 统筹者配置
 */
export interface OrchestratorConfig {
  /** 是否允许并行执行同 Stage 内的子任务 */
  allowParallel?: boolean;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 是否在失败后自动重新规划 */
  enableReplan?: boolean;
  /** 子任务执行超时（ms，默认 5 分钟） */
  subTaskTimeout?: number;
  /** 总任务执行超时（ms，默认 30 分钟） */
  totalTimeout?: number;
  /** Worker 使用的模型 */
  model?: string;
  /** 工作区根目录 */
  workspaceRoot?: string;
  /** 中止信号 */
  signal?: AbortSignal;
  /**
   * 事件回调
   * Orchestrator 在关键节点发出事件，供上层（如 OrchestratorRuntime）转化为 StreamChunk。
   */
  onEvent?: (event: OrchestratorEvent) => void;
}

/**
 * Orchestrator 事件
 *
 * 用于向上层报告执行进度。
 * OrchestratorRuntime 将这些事件转化为统一的 StreamChunk。
 */
export interface OrchestratorEvent {
  type:
    | 'plan:start'
    | 'plan:done'
    | 'stage:start'
    | 'stage:done'
    | 'subtask:start'
    | 'subtask:done'
    | 'subtask:failed'
    | 'subtask:retry'
    | 'replan:start'
    | 'replan:done'
    | 'aggregate:start'
    | 'aggregate:done';
  data?: Record<string, unknown>;
}

/**
 * 统筹者接口
 */
export interface IOrchestrator {
  /** 执行任务 */
  executeTask(task: Task): Promise<TaskExecutionResult>;
  /** 取消任务 */
  cancelTask(taskId: string): void;
  /** 清理资源 */
  cleanup(): Promise<void>;
}

/**
 * 统筹者实现
 */
export class Orchestrator implements IOrchestrator {
  private readonly resolvedConfig: Required<
    Omit<OrchestratorConfig, 'signal' | 'onEvent' | 'model' | 'workspaceRoot'>
  > & {
    signal?: AbortSignal;
    onEvent?: (event: OrchestratorEvent) => void;
    model?: string;
    workspaceRoot?: string;
  };

  /** 运行中的任务 */
  private runningTasks = new Map<string, { task: Task; startTime: number; aborted: boolean }>();

  /** 子任务结果缓存（供依赖查询） */
  private subTaskResults = new Map<string, WorkerExecutionResult>();

  constructor(
    private readonly planner: IPlanner,
    private readonly workerCoordinator: IWorkerCoordinator,
    config?: OrchestratorConfig
  ) {
    this.resolvedConfig = {
      allowParallel: config?.allowParallel ?? true,
      maxRetries: config?.maxRetries ?? 2,
      enableReplan: config?.enableReplan ?? false,
      subTaskTimeout: config?.subTaskTimeout ?? 5 * 60 * 1000,
      totalTimeout: config?.totalTimeout ?? 30 * 60 * 1000,
      signal: config?.signal,
      onEvent: config?.onEvent,
      model: config?.model,
      workspaceRoot: config?.workspaceRoot
    };
  }

  /**
   * 执行任务
   *
   * 流程（程序化控制）：
   * 1. 规划阶段：Planner（LLM）分解任务
   * 2. 执行阶段：按 Stage 顺序，调度 Worker（LLM）执行子任务
   * 3. 聚合阶段：收集所有子任务结果，生成最终输出
   */
  async executeTask(task: Task): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    log.info(`[Orchestrator] Starting task: ${task.objective}`);

    this.runningTasks.set(task.id, { task, startTime, aborted: false });

    try {
      // ── 1. 规划阶段 ──
      this.emit({ type: 'plan:start', data: { taskId: task.id, objective: task.objective } });
      log.info('[Orchestrator] Phase 1: Planning...');

      const plan = await this.planner.plan(task);

      this.emit({
        type: 'plan:done',
        data: {
          taskId: task.id,
          subTaskCount: plan.subTasks.length,
          stageCount: plan.stages.length
        }
      });

      log.info(`[Orchestrator] Plan created: ${plan.subTasks.length} subtasks, ${plan.stages.length} stages`);

      // ── 2. 执行阶段 ──
      log.info('[Orchestrator] Phase 2: Executing...');
      const subTaskResults = await this.executePlan(task, plan);

      // ── 3. 聚合阶段 ──
      this.emit({ type: 'aggregate:start' });
      log.info('[Orchestrator] Phase 3: Aggregating results...');
      const finalOutput = this.aggregateResults(plan, subTaskResults);
      this.emit({ type: 'aggregate:done', data: { resultCount: subTaskResults.length } });

      // 完成
      this.runningTasks.delete(task.id);
      this.subTaskResults.clear();

      const endTime = Date.now();
      const completedCount = subTaskResults.filter((r) => r.status === 'completed').length;
      const failedCount = subTaskResults.filter((r) => r.status === 'failed').length;

      log.info(
        `[Orchestrator] Task completed: ${completedCount}/${plan.subTasks.length} succeeded, duration=${endTime - startTime}ms`
      );

      return {
        taskId: task.id,
        status: failedCount === 0 ? 'success' : failedCount < plan.subTasks.length ? 'partial' : 'failed',
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
      };
    } catch (error: unknown) {
      this.runningTasks.delete(task.id);
      this.subTaskResults.clear();

      log.error('[Orchestrator] Task failed:', error);

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
      };
    }
  }

  /**
   * 取消任务
   */
  cancelTask(taskId: string): void {
    const entry = this.runningTasks.get(taskId);
    if (entry) {
      entry.aborted = true;
    }
    log.info(`[Orchestrator] Task ${taskId} cancel requested`);
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    for (const [taskId] of this.runningTasks) {
      this.cancelTask(taskId);
    }
    this.runningTasks.clear();
    this.subTaskResults.clear();
    await this.workerCoordinator.clear();
    log.info('[Orchestrator] Cleaned up');
  }

  // ========== 执行引擎（程序化控制） ==========

  /**
   * 按计划执行所有子任务
   *
   * 核心控制逻辑：
   *   for each stage (sequential) {
   *     if (stage.parallel && config.allowParallel) {
   *       await Promise.allSettled(stage.tasks)  // 并行
   *     } else {
   *       for each task in stage { await task }   // 顺序
   *     }
   *   }
   */
  private async executePlan(task: Task, plan: ExecutionPlan): Promise<SubTaskExecutionResult[]> {
    const results: SubTaskExecutionResult[] = [];

    for (const stage of plan.stages) {
      // 检查是否被取消
      if (this.isTaskAborted(task.id)) {
        log.warn(`[Orchestrator] Task ${task.id} aborted, skipping remaining stages`);
        break;
      }

      this.emit({ type: 'stage:start', data: { stageId: stage.id, stageName: stage.name } });
      log.info(`[Orchestrator] Executing stage: ${stage.name} (${stage.tasks.length} tasks)`);

      const stageTasks = stage.tasks;

      if (this.resolvedConfig.allowParallel && stage.parallel) {
        // ── 并行执行 ──
        const stageResults = await Promise.allSettled(
          stageTasks.map((subTask) => this.executeSubTaskWithRetry(subTask, task))
        );

        stageResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push({
              subTaskId: stageTasks[index].id,
              status: 'completed',
              result: result.value.output
            });
          } else {
            results.push({
              subTaskId: stageTasks[index].id,
              status: 'failed',
              error: result.reason?.message || 'Unknown error'
            });
          }
        });
      } else {
        // ── 顺序执行 ──
        for (const subTask of stageTasks) {
          if (this.isTaskAborted(task.id)) break;

          try {
            const workerResult = await this.executeSubTaskWithRetry(subTask, task);
            results.push({
              subTaskId: subTask.id,
              status: 'completed',
              result: workerResult.output
            });
          } catch (error: unknown) {
            results.push({
              subTaskId: subTask.id,
              status: 'failed',
              error: error instanceof Error ? error.message : String(error)
            });
            log.warn(`[Orchestrator] SubTask ${subTask.id} failed, continuing...`);
          }
        }
      }

      this.emit({ type: 'stage:done', data: { stageId: stage.id, stageName: stage.name } });
    }

    return results;
  }

  /**
   * 执行单个子任务（支持重试）
   */
  private async executeSubTaskWithRetry(subTask: SubTask, task: Task): Promise<WorkerExecutionResult> {
    const maxRetries = this.resolvedConfig.maxRetries || 0;
    let lastError: Error | null = null;

    this.emit({
      type: 'subtask:start',
      data: { subTaskId: subTask.id, subTaskName: subTask.name }
    });

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // 指数退避（重试时）
        if (attempt > 0) {
          const backoffTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          this.emit({
            type: 'subtask:retry',
            data: { subTaskId: subTask.id, attempt, maxRetries, backoffTime }
          });
          log.info(`[Orchestrator] Retry attempt ${attempt}/${maxRetries} for ${subTask.id} after ${backoffTime}ms`);
          await this.delay(backoffTime);
        }

        // 获取或创建 Worker
        const worker = await this.workerCoordinator.getOrCreateWorker(subTask.assignedWorker || 'general');

        // 注入依赖子任务的结果到上下文
        this.injectDependencyResults(subTask);

        // 执行子任务
        const result = await this.workerCoordinator.executeSubTask(subTask, worker);

        // 缓存结果（供下游依赖使用）
        this.subTaskResults.set(subTask.id, result);

        this.emit({
          type: 'subtask:done',
          data: {
            subTaskId: subTask.id,
            subTaskName: subTask.name,
            duration: result.duration,
            attempt: attempt > 0 ? attempt : undefined
          }
        });

        log.info(`[Orchestrator] SubTask ${subTask.id} completed${attempt > 0 ? ` (after ${attempt} retries)` : ''}`);

        return result;
      } catch (error) {
        lastError = error as Error;
        log.error(`[Orchestrator] Attempt ${attempt + 1} failed for ${subTask.id}:`, error);

        if (attempt < maxRetries) {
          continue;
        }

        // 尝试重新规划（如果启用）
        if (this.resolvedConfig.enableReplan && attempt === maxRetries) {
          const replanResult = await this.tryReplan(task, subTask.id, lastError.message);
          if (replanResult) {
            return replanResult;
          }
        }

        this.emit({
          type: 'subtask:failed',
          data: {
            subTaskId: subTask.id,
            subTaskName: subTask.name,
            error: lastError.message
          }
        });

        throw lastError;
      }
    }

    throw lastError || new Error('SubTask execution failed');
  }

  /**
   * 注入依赖子任务的结果到子任务上下文
   *
   * 如果子任务声明了 dependencies，将已完成的依赖结果
   * 注入到 subTask.context 中，供 Worker 参考。
   */
  private injectDependencyResults(subTask: SubTask): void {
    if (!subTask.dependencies?.length) return;

    const depResults: Record<string, string> = {};
    for (const depId of subTask.dependencies) {
      const depResult = this.subTaskResults.get(depId);
      if (depResult) {
        depResults[depId] = depResult.output;
      }
    }

    if (Object.keys(depResults).length > 0) {
      subTask.context = {
        ...(subTask.context || {}),
        dependencyResults: depResults
      };
    }
  }

  /**
   * 尝试重新规划
   */
  private async tryReplan(task: Task, failedSubTaskId: string, reason: string): Promise<WorkerExecutionResult | null> {
    try {
      this.emit({ type: 'replan:start', data: { failedSubTaskId, reason } });
      log.info(`[Orchestrator] Attempting replan due to failure of ${failedSubTaskId}`);

      const newPlan = await this.planner.replan(task, { failedSubTaskId, reason });
      this.emit({ type: 'replan:done', data: { newSubTaskCount: newPlan.subTasks.length } });

      // 执行新计划的第一个子任务作为替代
      if (newPlan.subTasks.length > 0) {
        const newSubTask = newPlan.subTasks[0];
        const worker = await this.workerCoordinator.getOrCreateWorker(newSubTask.assignedWorker || 'general');
        return await this.workerCoordinator.executeSubTask(newSubTask, worker);
      }
    } catch (error) {
      log.error('[Orchestrator] Replan failed:', error);
    }
    return null;
  }

  /**
   * 聚合结果
   */
  private aggregateResults(
    plan: ExecutionPlan,
    subTaskResults: SubTaskExecutionResult[]
  ): { summary: string; results: unknown[] } {
    const completed = subTaskResults.filter((r) => r.status === 'completed');
    const failed = subTaskResults.filter((r) => r.status === 'failed');

    const results = completed.filter((r) => r.result).map((r) => r.result);

    const lines: string[] = [`Task completed: ${completed.length}/${subTaskResults.length} subtasks succeeded.`];

    if (failed.length > 0) {
      lines.push(`Failed subtasks: ${failed.map((f) => f.subTaskId).join(', ')}`);
    }

    // 包含所有成功子任务的输出
    for (const r of completed) {
      if (r.result && typeof r.result === 'string' && r.result.length > 0) {
        const subTask = plan.subTasks.find((st) => st.id === r.subTaskId);
        lines.push(`\n--- ${subTask?.name || r.subTaskId} ---`);
        lines.push(r.result as string);
      }
    }

    return {
      summary: lines.join('\n'),
      results
    };
  }

  // ========== 辅助方法 ==========

  private emit(event: OrchestratorEvent): void {
    this.resolvedConfig.onEvent?.(event);
  }

  private isTaskAborted(taskId: string): boolean {
    const entry = this.runningTasks.get(taskId);
    if (entry?.aborted) return true;
    if (this.resolvedConfig.signal?.aborted) return true;
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * 创建 Orchestrator 实例
 *
 * 工厂函数，自动创建 Planner 和 WorkerCoordinator。
 */
export function createOrchestrator(config?: OrchestratorConfig): Orchestrator {
  const planner = new Planner({
    model: config?.model,
    signal: config?.signal
  });

  const workerCoordinator = new WorkerCoordinator({
    model: config?.model,
    workspaceRoot: config?.workspaceRoot,
    signal: config?.signal
  });

  return new Orchestrator(planner, workerCoordinator, config);
}
