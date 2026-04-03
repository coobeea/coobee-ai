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
import { AggregatorAgent, type IAggregator } from './AggregatorAgent';
import type { Task, SubTask, ExecutionPlan, TaskExecutionResult, SubTaskExecutionResult, Stage } from './types';

const log = createLogger('orchestration');

/**
 * 统筹者配置
 */
export interface OrchestratorConfig {
  /** 父 sessionId（= threadId），传递给 Planner/Worker 用于 sessionId 命名 */
  parentSessionId?: string;
  /** 是否允许并行执行同 Stage 内的子任务 */
  allowParallel?: boolean;
  /** 最大重试次数（默认 2） */
  maxRetries?: number;
  /** 是否在失败后自动重新规划（默认 false） */
  enableReplan?: boolean;
  /** 最大重新规划次数（默认 3） */
  maxReplanAttempts?: number;
  /** 子任务执行超时（ms，默认 5 分钟） */
  subTaskTimeout?: number;
  /** 总任务执行超时（ms，默认 30 分钟） */
  totalTimeout?: number;
  /** 每种类型最多 Worker 数量（默认 3） */
  maxWorkersPerType?: number;
  /** 总共最多 Worker 数量（默认 10） */
  maxTotalWorkers?: number;
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
    | 'analysis:start'
    | 'analysis:done'
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
    Omit<OrchestratorConfig, 'parentSessionId' | 'signal' | 'onEvent' | 'model' | 'workspaceRoot'>
  > & {
    parentSessionId?: string;
    signal?: AbortSignal;
    onEvent?: (event: OrchestratorEvent) => void;
    model?: string;
    workspaceRoot?: string;
  };

  /** 运行中的任务 */
  private runningTasks = new Map<string, { task: Task; startTime: number; aborted: boolean }>();

  /** 子任务结果缓存（供依赖查询） */
  private subTaskResults = new Map<string, WorkerExecutionResult>();

  /** 🆕 已完成的子任务结果列表（用于依赖校验） */
  private completedSubTaskResults: SubTaskExecutionResult[] = [];

  /** 🆕 重新规划计数器 */
  private replanCounts = new Map<string, number>();

  /** 🆕 项目空间路径（所有 Worker 共享的代码开发目录） */
  // @ts-expect-error - Used for state tracking, may be read in future features
  private _projectDir?: string;

  constructor(
    private readonly planner: IPlanner,
    private readonly workerCoordinator: IWorkerCoordinator,
    private readonly aggregator: IAggregator,
    config?: OrchestratorConfig
  ) {
    this.resolvedConfig = {
      allowParallel: config?.allowParallel ?? true,
      maxRetries: config?.maxRetries ?? 2,
      enableReplan: config?.enableReplan ?? false,
      maxReplanAttempts: config?.maxReplanAttempts ?? 3,
      subTaskTimeout: config?.subTaskTimeout ?? 5 * 60 * 1000,
      totalTimeout: config?.totalTimeout ?? 30 * 60 * 1000,
      maxWorkersPerType: config?.maxWorkersPerType ?? 3,
      maxTotalWorkers: config?.maxTotalWorkers ?? 10,
      parentSessionId: config?.parentSessionId,
      signal: config?.signal,
      onEvent: config?.onEvent,
      model: config?.model,
      workspaceRoot: config?.workspaceRoot
    };
  }

  /**
   * 执行任务
   *
   * 新流程（更自然）：
   * 0. 需求分析：RequirementAnalyzer（LLM）分析需求，判断任务类型
   * 1. 决策：如果是简单任务，直接返回；如果是复杂任务，继续
   * 2. POC 生命周期初始化：生成需求分析文档和其他生命周期文件
   * 3. 规划阶段：Planner（LLM）基于需求分析分解任务
   * 4. 执行阶段：WorkerCoordinator 按 Stage 调度 Worker 执行
   * 5. 聚合阶段：Aggregator 汇总结果，生成验收报告
   */
  async executeTask(task: Task): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    log.info(`[Orchestrator] Starting task: ${task.objective}`);

    this.runningTasks.set(task.id, { task, startTime, aborted: false });

    try {
      // ── 0. 需求分析阶段 ──
      log.info('[Orchestrator] Phase 0: Requirement Analysis...');
      this.emit({ type: 'analysis:start', data: { taskId: task.id } });

      const { RequirementAnalyzer } = await import('./RequirementAnalyzer');
      const analyzer = new RequirementAnalyzer();

      const analysisResult = await analyzer.analyze(task);

      this.emit({
        type: 'analysis:done',
        data: {
          taskId: task.id,
          taskType: analysisResult.taskType,
          needsOrchestration: analysisResult.needsOrchestration
        }
      });

      log.info(
        `[Orchestrator] Analysis complete: taskType=${analysisResult.taskType}, ` +
          `needsOrchestration=${analysisResult.needsOrchestration}`
      );

      // ── 1. 决策阶段 ──
      if (!analysisResult.needsOrchestration) {
        log.info(`[Orchestrator] Task ${task.id} is a simple ${analysisResult.taskType}, should not use orchestration`);

        // 🔥 抛出特殊错误，让上层（OrchestratorRuntime / Gateway）捕获并降级到 agent 模式
        // 这样用户会得到自然的对话回复，而不是技术性的"不需要编排"消息
        const error = new Error('SIMPLE_TASK_DETECTED') as Error & {
          taskType?: string;
          reason?: string;
        };
        error.taskType = analysisResult.taskType;
        error.reason = analysisResult.reason;
        throw error;
      }

      // ── 2. 需求分析阶段（仅复杂任务） ──
      log.info('[Orchestrator] Phase 1: Analyzing requirements...');

      if (!this.resolvedConfig.parentSessionId) {
        throw new Error('parentSessionId is required for complex tasks');
      }

      // 确保项目空间存在
      const projectDir = await this.ensureProjectDir();
      log.info(`[Orchestrator] Project directory: ${projectDir}`);

      // 将项目空间传递给 WorkerCoordinator
      (this.workerCoordinator as { setProjectDir?: (dir: string) => void }).setProjectDir?.(projectDir);

      // 准备任务工作区
      const { Env: TaskEnv } = await import('@main/common/env');
      const taskPath = await import('node:path');
      const taskFs = await import('node:fs/promises');
      const taskWorkspaceDir = await TaskEnv.getAgentWorkspaceDir(this.resolvedConfig.parentSessionId);
      const taskDirPath = taskPath.join(taskWorkspaceDir, 'tasks', task.id);
      await taskFs.mkdir(taskDirPath, { recursive: true });

      // 生成并保存需求分析结果
      const requirementAnalysisContent = await this.generateRequirementAnalysis(taskDirPath, task, analysisResult);

      log.info(`[Orchestrator] Task directory initialized at: ${taskDirPath}`);

      // ── 3. 宏观规划阶段 ──
      this.emit({ type: 'plan:start', data: { taskId: task.id, objective: task.objective } });
      log.info('[Orchestrator] Phase 2: Macro Planning...');

      const macroStages = await this.planner.planMacroStages(task, requirementAnalysisContent);

      this.emit({
        type: 'plan:done',
        data: {
          taskId: task.id,
          subTaskCount: 0, // 此时还没有子任务
          stageCount: macroStages.length
        }
      });

      log.info(`[Orchestrator] Macro plan created: ${macroStages.length} stages`);

      // ── 4. 动态执行阶段 ──
      log.info('[Orchestrator] Phase 3: Executing (Dynamic Planning)...');

      // 🆕 添加总任务超时控制
      const totalTimeoutMs = this.resolvedConfig.totalTimeout;
      const executionPromise = this.executeDynamicPlan(task, macroStages, projectDir);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Task ${task.id} execution timeout after ${totalTimeoutMs}ms`)),
          totalTimeoutMs
        )
      );

      const { subTaskResults, finalPlan } = await Promise.race([executionPromise, timeoutPromise]);

      // 保存任务定义和完整的最终计划到文件
      await this.saveTaskDefinitionAndPlan(task, finalPlan);

      // 🆕 保存每个子任务的结果到 tasks/{taskId}/results/
      await this.saveSubTaskResults(task.id, subTaskResults);

      // ── 5. 聚合阶段 ──
      this.emit({ type: 'aggregate:start' });
      log.info('[Orchestrator] Phase 4: Aggregating results...');

      // 🔄 修改：委托给 Aggregator Agent，而非直接调用 LLM
      const { Env: AggEnv } = await import('@main/common/env');
      const aggPath = await import('node:path');
      const aggWorkspaceDir = await AggEnv.getAgentWorkspaceDir(this.resolvedConfig.parentSessionId || task.id);
      const aggTaskDirPath = aggPath.join(aggWorkspaceDir, 'tasks', task.id);

      const aggregationResult = await this.aggregator.aggregate(task, finalPlan, subTaskResults, aggTaskDirPath);

      this.emit({
        type: 'aggregate:done',
        data: { resultCount: subTaskResults.length, duration: aggregationResult.duration }
      });

      // 构建最终输出（包含汇总内容）
      const finalOutput = {
        summary: aggregationResult.summary,
        results: subTaskResults.filter((r) => r.result).map((r) => r.result)
      };

      // 🆕 保存最终汇总结果到主会话
      await this.saveFinalSummary(task.id, finalOutput, subTaskResults);

      // 🆕 导出所有 Worker 产出文件
      const artifacts = await this.exportWorkerArtifacts(finalPlan.subTasks);

      // 完成
      this.runningTasks.delete(task.id);

      // 清理当前任务的子任务缓存，避免误删并行运行的其他任务结果
      for (const subTask of finalPlan.subTasks) {
        this.subTaskResults.delete(subTask.id);
      }

      const endTime = Date.now();
      const completedCount = subTaskResults.filter((r) => r.status === 'completed').length;
      const failedCount = subTaskResults.filter((r) => r.status === 'failed').length;

      log.info(
        `[Orchestrator] Task completed: ${completedCount}/${finalPlan.subTasks.length} succeeded, duration=${endTime - startTime}ms`
      );

      return {
        taskId: task.id,
        status: failedCount === 0 ? 'success' : failedCount < finalPlan.subTasks.length ? 'partial' : 'failed',
        finalOutput,
        subTaskResults,
        artifacts,
        stats: {
          startTime,
          endTime,
          duration: endTime - startTime,
          totalSubTasks: finalPlan.subTasks.length,
          completedSubTasks: completedCount,
          failedSubTasks: failedCount
        }
      };
    } catch (error: unknown) {
      this.runningTasks.delete(task.id);

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
   * 动态执行计划（按 Stage 动态生成子任务并执行）
   */
  private async executeDynamicPlan(
    task: Task,
    macroStages: Stage[],
    projectDir: string
  ): Promise<{ subTaskResults: SubTaskExecutionResult[]; finalPlan: ExecutionPlan }> {
    const results: SubTaskExecutionResult[] = [];
    const finalSubTasks: SubTask[] = [];
    this.completedSubTaskResults = []; // 重置

    for (const stage of macroStages) {
      if (this.isTaskAborted(task.id)) {
        log.warn(`[Orchestrator] Task ${task.id} aborted before stage ${stage.id}`);
        break;
      }

      this.emit({ type: 'stage:start', data: { stageId: stage.id, stageName: stage.name } });
      log.info(`[Orchestrator] Executing stage: ${stage.name}`);

      // 1. 针对当前 Stage 进行微观规划（获取当前代码库上下文）
      const currentContext = await this.getProjectContext(projectDir);
      const microPlan = await this.planner.planMicroTasks(task, stage, currentContext);

      stage.tasks = microPlan.tasks;
      stage.parallel = microPlan.parallel;
      finalSubTasks.push(...microPlan.tasks);

      log.info(`[Orchestrator] Micro plan created for stage ${stage.name}: ${stage.tasks.length} tasks`);

      // 2. 执行该阶段的子任务
      if (this.resolvedConfig.allowParallel && stage.parallel) {
        const hasCrossDependency = this.checkCrossDependency(stage.tasks);
        if (hasCrossDependency) {
          log.warn(`[Orchestrator] Stage ${stage.name} has cross-dependencies, forcing sequential execution`);
          await this.executeTasksSequentially(stage.tasks, task, results);
        } else {
          await this.executeTasksInParallel(stage.tasks, task, results);
        }
      } else {
        await this.executeTasksSequentially(stage.tasks, task, results);
      }

      this.emit({ type: 'stage:done', data: { stageId: stage.id, stageName: stage.name } });
    }

    const finalPlan: ExecutionPlan = {
      taskId: task.id,
      subTasks: finalSubTasks,
      stages: macroStages,
      createdAt: Date.now()
    };

    return { subTaskResults: results, finalPlan };
  }

  /**
   * 获取项目当前上下文（用于微观规划）
   */
  private async getProjectContext(projectDir: string): Promise<string> {
    try {
      const fs = await import('node:fs/promises');

      // 简单地读取目录结构，未来可以扩展为读取关键文件或 package.json
      const files = await fs.readdir(projectDir);
      if (files.length === 0) return '项目目录为空。';

      return `项目根目录包含以下文件/文件夹：\n${files.join('\n')}`;
    } catch (_err) {
      return '无法读取项目目录状态。';
    }
  }

  /**
   * 🆕 检查子任务之间是否有相互依赖
   */
  private checkCrossDependency(tasks: SubTask[]): boolean {
    const taskIds = new Set(tasks.map((t) => t.id));
    for (const task of tasks) {
      if (task.dependencies) {
        for (const depId of task.dependencies) {
          if (taskIds.has(depId)) {
            return true; // 发现同 Stage 内的依赖
          }
        }
      }
    }
    return false;
  }

  /**
   * 🆕 并行执行子任务
   */
  private async executeTasksInParallel(tasks: SubTask[], task: Task, results: SubTaskExecutionResult[]): Promise<void> {
    const stageResults = await Promise.allSettled(tasks.map((subTask) => this.executeSubTaskWithRetry(subTask, task)));

    // 🆕 改为 for 循环以支持异步生命周期更新
    for (let index = 0; index < stageResults.length; index++) {
      const result = stageResults[index];
      const subTask = tasks[index];

      const subTaskResult: SubTaskExecutionResult = {
        subTaskId: subTask.id,
        status: result.status === 'fulfilled' ? 'completed' : 'failed',
        result: result.status === 'fulfilled' ? result.value.output : undefined,
        error: result.status === 'rejected' ? result.reason?.message || 'Unknown error' : undefined,
        duration: result.status === 'fulfilled' ? result.value.duration : undefined,
        timestamp: Date.now()
      };

      results.push(subTaskResult);
      this.completedSubTaskResults.push(subTaskResult);
    }
  }

  /**
   * 🆕 顺序执行子任务（支持关键任务检查）
   */
  private async executeTasksSequentially(
    tasks: SubTask[],
    task: Task,
    results: SubTaskExecutionResult[]
  ): Promise<void> {
    for (const subTask of tasks) {
      if (this.isTaskAborted(task.id)) break;

      try {
        const workerResult = await this.executeSubTaskWithRetry(subTask, task);
        const subTaskResult: SubTaskExecutionResult = {
          subTaskId: subTask.id,
          status: 'completed',
          result: workerResult.output,
          duration: workerResult.duration,
          timestamp: Date.now()
        };
        results.push(subTaskResult);
        this.completedSubTaskResults.push(subTaskResult);
      } catch (error: unknown) {
        const subTaskResult: SubTaskExecutionResult = {
          subTaskId: subTask.id,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now()
        };
        results.push(subTaskResult);
        this.completedSubTaskResults.push(subTaskResult);

        // 🆕 记录失败到智库
        await this.recordFailureToBrain(subTask, error, task);

        // 🆕 检查是否为关键任务
        if (subTask.critical) {
          log.error(`[Orchestrator] Critical subtask ${subTask.id} failed, aborting execution`);
          throw new Error(
            `Critical subtask "${subTask.name}" failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        log.warn(`[Orchestrator] SubTask ${subTask.id} failed, continuing...`);
      }
    }
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
   *
   * 🆕 增加依赖校验：检查依赖是否成功完成
   */
  private injectDependencyResults(subTask: SubTask): void {
    if (!subTask.dependencies?.length) return;

    const depResults: Record<string, string> = {};
    const missingDeps: string[] = [];
    const failedDeps: string[] = [];

    for (const depId of subTask.dependencies) {
      const depResult = this.subTaskResults.get(depId);

      if (!depResult) {
        missingDeps.push(depId);
        continue;
      }

      // 🆕 检查依赖是否成功（从 subTaskResults 查找状态）
      const depResultEntry = this.getSubTaskResultStatus(depId);
      if (depResultEntry?.status === 'failed') {
        failedDeps.push(depId);
        continue;
      }

      depResults[depId] = depResult.output;
    }

    // 🆕 如果有依赖缺失或失败，抛出错误
    if (missingDeps.length > 0) {
      throw new Error(`SubTask ${subTask.id} has missing dependencies: ${missingDeps.join(', ')}`);
    }
    if (failedDeps.length > 0) {
      throw new Error(`SubTask ${subTask.id} cannot execute because dependencies failed: ${failedDeps.join(', ')}`);
    }

    if (Object.keys(depResults).length > 0) {
      subTask.context = {
        ...(subTask.context || {}),
        dependencyResults: depResults
      };
    }
  }

  /**
   * 🆕 获取子任务结果的状态（从已收集的 results 中查找）
   */
  private getSubTaskResultStatus(subTaskId: string): SubTaskExecutionResult | undefined {
    return this.completedSubTaskResults.find((r) => r.subTaskId === subTaskId);
  }

  /**
   * 尝试重新规划
   */
  private async tryReplan(task: Task, failedSubTaskId: string, reason: string): Promise<WorkerExecutionResult | null> {
    // 🆕 检查重新规划次数限制
    const maxReplanAttempts = this.resolvedConfig.maxReplanAttempts ?? 3;
    const currentCount = this.replanCounts.get(task.id) || 0;
    if (currentCount >= maxReplanAttempts) {
      log.warn(`[Orchestrator] Max replan attempts (${maxReplanAttempts}) reached for task ${task.id}, giving up`);
      return null;
    }

    try {
      this.emit({ type: 'replan:start', data: { failedSubTaskId, reason } });
      log.info(
        `[Orchestrator] Attempting replan (${currentCount + 1}/${maxReplanAttempts}) due to failure of ${failedSubTaskId}`
      );

      // 🆕 增加重新规划计数
      this.replanCounts.set(task.id, currentCount + 1);

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

  // ========== 已移除 aggregateResults 方法 ==========
  // 原先直接拼接子任务输出的方法已被 Aggregator Agent 替代
  // Aggregator Agent 使用工具读取文件，生成简洁的汇总

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

  /**
   * 🆕 保存需求分析结果到 01-需求分析.md
   */
  /**
   * 生成需求分析文档（调用 requirement-analyst Agent 生成详细文档）
   */
  private async generateRequirementAnalysis(
    taskDirPath: string,
    task: Task,
    analysisResult: import('./RequirementAnalyzer').RequirementAnalysisResult
  ): Promise<string> {
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      const analysisFile = path.join(taskDirPath, 'REQUIREMENTS.md');

      // 🆕 如果是复杂任务，调用 requirement-analyst Agent 生成详细文档
      if (analysisResult.needsOrchestration && analysisResult.analysis) {
        log.info('[Orchestrator] Generating detailed requirement analysis document...');

        const prompt = this.buildRequirementAnalysisPrompt(task, analysisResult);
        const detailedAnalysis = await this.callRequirementAnalystAgent(prompt);

        if (detailedAnalysis) {
          await fs.writeFile(analysisFile, detailedAnalysis, 'utf-8');
          log.info(`[Orchestrator] Detailed requirement analysis saved to: ${analysisFile}`);
          return detailedAnalysis;
        }

        log.warn('[Orchestrator] Failed to generate detailed analysis, using simple template');
      }

      // 降级：简单模板（用于简单任务或 Agent 调用失败）
      let content = `# ${task.objective} - 需求分析\n\n`;
      content += `> 创建时间：${new Date().toLocaleDateString('zh-CN')}\n`;
      content += `> 任务 ID：${task.id}\n`;
      content += `> 执行模式：编排模式\n\n`;
      content += `---\n\n`;

      content += `## 任务目标\n\n`;
      content += `${task.objective}\n\n`;

      if (task.description) {
        content += `## 任务描述\n\n`;
        content += `${task.description}\n\n`;
      }

      content += `## 任务分类\n\n`;
      content += `- **类型**: ${analysisResult.taskType}\n`;
      content += `- **需要编排**: ${analysisResult.needsOrchestration ? '是' : '否'}\n`;
      content += `- **判断依据**: ${analysisResult.reason}\n\n`;

      if (analysisResult.analysis) {
        const analysis = analysisResult.analysis;

        content += `## 核心目标\n\n`;
        content += `${analysis.coreObjective}\n\n`;

        content += `## 关键需求\n\n`;
        analysis.keyRequirements.forEach((req, idx) => {
          content += `${idx + 1}. ${req}\n`;
        });
        content += `\n`;

        if (analysis.technicalChallenges.length > 0) {
          content += `## 技术挑战\n\n`;
          analysis.technicalChallenges.forEach((challenge, idx) => {
            content += `${idx + 1}. ${challenge}\n`;
          });
          content += `\n`;
        }

        if (analysis.expectedDeliverables.length > 0) {
          content += `## 预期交付物\n\n`;
          analysis.expectedDeliverables.forEach((deliverable, idx) => {
            content += `${idx + 1}. ${deliverable}\n`;
          });
          content += `\n`;
        }

        content += `## 复杂度评估\n\n`;
        const complexityMap = { low: '低', medium: '中', high: '高' };
        content += `**${complexityMap[analysis.estimatedComplexity]}**\n\n`;
      }

      content += `---\n\n`;
      content += `*此文档由需求分析器自动生成于 ${new Date().toLocaleString('zh-CN')}*\n`;

      await fs.writeFile(analysisFile, content, 'utf-8');
      log.info(`[Orchestrator] Requirement analysis saved to: ${analysisFile}`);
      return content;
    } catch (error) {
      log.error('[Orchestrator] Failed to save requirement analysis:', error);
      return '';
    }
  }

  /**
   * 🆕 保存任务定义和计划到文件
   */
  private async saveTaskDefinitionAndPlan(task: Task, plan: ExecutionPlan): Promise<void> {
    if (!this.resolvedConfig.parentSessionId) return;

    const fs = await import('fs-extra');
    const path = await import('node:path');
    const { Env } = await import('@main/common/env');

    const mainWorkspace = await Env.getAgentWorkspaceDir(this.resolvedConfig.parentSessionId);
    const tasksDir = path.join(mainWorkspace, 'tasks', task.id);
    await fs.ensureDir(tasksDir);

    // 保存任务定义
    const definitionContent = [
      '# 任务定义',
      '',
      `**任务 ID**: ${task.id}`,
      `**目标**: ${task.objective}`,
      `**创建时间**: ${new Date().toISOString()}`,
      '',
      '## 任务描述',
      task.description || '（无）',
      '',
      '## 需求清单',
      ...(task.requirements || []).map((r) => `- ${r}`),
      '',
      '## 约束条件',
      ...(task.constraints || []).map((c) => `- ${c}`)
    ].join('\n');
    await fs.writeFile(path.join(tasksDir, 'definition.md'), definitionContent, 'utf-8');

    // 保存执行计划
    const planContent = [
      '# 执行计划',
      '',
      `**生成时间**: ${new Date(plan.createdAt).toISOString()}`,
      `**子任务数量**: ${plan.subTasks.length}`,
      `**执行阶段**: ${plan.stages.length}`,
      '',
      '## 子任务列表',
      '',
      ...plan.subTasks.map(
        (st) =>
          `### ${st.id}: ${st.name}\n` +
          `- **描述**: ${st.description}\n` +
          `- **分配给**: ${st.assignedWorker}\n` +
          `- **依赖**: ${st.dependencies?.length ? st.dependencies.join(', ') : '无'}\n`
      ),
      '',
      '## 执行阶段',
      '',
      ...plan.stages.map(
        (stage) =>
          `### ${stage.name} (${stage.id})\n` +
          `- **顺序**: ${stage.order}\n` +
          `- **并行**: ${stage.parallel ? '是' : '否'}\n` +
          `- **子任务**: ${stage.tasks.map((t) => t.id).join(', ')}\n`
      )
    ].join('\n');
    await fs.writeFile(path.join(tasksDir, 'plan.md'), planContent, 'utf-8');

    log.info(`[Orchestrator] Saved task definition and plan to ${tasksDir}`);
  }

  /**
   * 🆕 保存子任务执行结果到 tasks/{taskId}/results/
   */
  private async saveSubTaskResults(taskId: string, results: SubTaskExecutionResult[]): Promise<void> {
    if (!this.resolvedConfig.parentSessionId) return;

    const fs = await import('fs-extra');
    const path = await import('node:path');
    const { Env } = await import('@main/common/env');

    const mainWorkspace = await Env.getAgentWorkspaceDir(this.resolvedConfig.parentSessionId);
    const resultsDir = path.join(mainWorkspace, 'tasks', taskId, 'results');
    await fs.ensureDir(resultsDir);

    for (const result of results) {
      const resultContent = [
        `# ${result.subTaskId} 执行结果`,
        '',
        `**状态**: ${result.status}`,
        `**执行时长**: ${result.duration || 0}ms`,
        `**时间戳**: ${new Date(result.timestamp || Date.now()).toISOString()}`,
        '',
        '## 输出',
        '',
        typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2),
        '',
        result.error ? `## 错误\n\n${result.error}` : ''
      ].join('\n');

      await fs.writeFile(path.join(resultsDir, `${result.subTaskId}.md`), resultContent, 'utf-8');
    }

    log.info(`[Orchestrator] Saved ${results.length} subtask results to ${resultsDir}`);
  }

  /**
   * 🆕 保存最终汇总结果到主会话
   *
   * 🔄 修改：保存 Aggregator Agent 的简洁汇总到 aggregation.md
   */
  private async saveFinalSummary(
    taskId: string,
    finalOutput: { summary: string; results: unknown[] },
    subTaskResults: SubTaskExecutionResult[]
  ): Promise<void> {
    if (!this.resolvedConfig.parentSessionId) return;

    const fs = await import('fs-extra');
    const path = await import('node:path');
    const { Env } = await import('@main/common/env');

    const mainWorkspace = await Env.getAgentWorkspaceDir(this.resolvedConfig.parentSessionId);
    const tasksDir = path.join(mainWorkspace, 'tasks', taskId);
    await fs.ensureDir(tasksDir);

    // 🆕 保存简洁的汇总到 aggregation.md（来自 Aggregator Agent）
    const aggregationContent = [
      '# 任务执行汇总',
      '',
      `**任务 ID**: ${taskId}`,
      `**完成时间**: ${new Date().toISOString()}`,
      '',
      finalOutput.summary
    ].join('\n');

    await fs.writeFile(path.join(tasksDir, 'aggregation.md'), aggregationContent, 'utf-8');

    // 保留详细的 summary.md（包含所有子任务完整输出）
    const detailedSummary = [
      '# 任务执行详细记录',
      '',
      `**任务 ID**: ${taskId}`,
      `**完成时间**: ${new Date().toISOString()}`,
      '',
      '## 子任务结果',
      '',
      ...subTaskResults.map(
        (r) =>
          `### ${r.subTaskId}` +
          `\n- **状态**: ${r.status === 'completed' ? '✅ 完成' : '❌ 失败'}` +
          `\n- **耗时**: ${r.duration || 0}ms` +
          (r.error ? `\n- **错误**: ${r.error}` : '') +
          '\n'
      ),
      '',
      '## 完整输出',
      '',
      ...subTaskResults
        .filter((r) => r.status === 'completed' && r.result)
        .map(
          (r) =>
            `### ${r.subTaskId}\n\n${typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2)}\n`
        )
    ].join('\n');

    await fs.writeFile(path.join(tasksDir, 'summary.md'), detailedSummary, 'utf-8');

    // 保存状态 JSON
    const statusData = {
      taskId,
      status: subTaskResults.every((r) => r.status === 'completed')
        ? 'success'
        : subTaskResults.some((r) => r.status === 'completed')
          ? 'partial'
          : 'failed',
      completedAt: new Date().toISOString(),
      subTaskCount: subTaskResults.length,
      completedCount: subTaskResults.filter((r) => r.status === 'completed').length,
      failedCount: subTaskResults.filter((r) => r.status === 'failed').length
    };
    await fs.writeFile(path.join(tasksDir, 'status.json'), JSON.stringify(statusData, null, 2), 'utf-8');

    log.info(`[Orchestrator] Saved final summary to ${tasksDir}`);
  }

  /**
   * 导出所有 Worker 产出的文件到主 workspace 的 output/
   */
  private async exportWorkerArtifacts(
    subTasks: SubTask[]
  ): Promise<Array<{ name: string; path: string; workerId: string }>> {
    if (!this.resolvedConfig.parentSessionId) return [];

    const fs = await import('fs-extra');
    const path = await import('node:path');
    const { Env } = await import('@main/common/env');

    const mainWorkspace = await Env.getAgentWorkspaceDir(this.resolvedConfig.parentSessionId);
    const mainOutputDir = path.join(mainWorkspace, 'output');
    await fs.ensureDir(mainOutputDir);

    const artifacts: Array<{ name: string; path: string; workerId: string }> = [];

    // 遍历所有 Worker 的 output 目录
    for (const subTask of subTasks) {
      const workerWorkspace = path.join(mainWorkspace, 'agents', `worker-${subTask.id}`);
      const workerOutputDir = path.join(workerWorkspace, 'output');

      if (await fs.pathExists(workerOutputDir)) {
        const files = await fs.readdir(workerOutputDir);
        for (const file of files) {
          const sourcePath = path.join(workerOutputDir, file);
          const destPath = path.join(mainOutputDir, `${subTask.id}-${file}`);

          // 复制文件到主 workspace
          await fs.copy(sourcePath, destPath, { overwrite: true });
          log.info(`[Orchestrator] Exported artifact: ${subTask.id}-${file}`);

          artifacts.push({
            name: `${subTask.id}-${file}`,
            path: destPath,
            workerId: `worker-${subTask.id}`
          });
        }
      }
    }

    return artifacts;
  }

  /**
   * 🆕 确保项目空间存在
   *
   * 编排模式下，所有 Worker 应该在同一个项目空间中协作开发代码，
   * 而不是各自创建独立的项目副本。
   *
   * 策略：
   * 1. 如果 Thread 已指定 projectDir，使用它
   * 2. 否则，在 {threadWorkspace}/project/ 创建统一项目空间
   * 3. 更新 Thread 的 projectDir 记录
   */
  private async ensureProjectDir(): Promise<string> {
    if (!this.resolvedConfig.parentSessionId) {
      throw new Error('parentSessionId is required');
    }

    const fs = await import('fs-extra');
    const path = await import('node:path');
    const { Env } = await import('@main/common/env');
    const { ThreadStore } = await import('../threads/ThreadStore');

    // 1. 检查 Thread 是否已有 projectDir
    try {
      const threadStore = await ThreadStore.getInstance();
      const thread = await threadStore.get(this.resolvedConfig.parentSessionId);

      if (thread?.projectDir) {
        log.info(`[Orchestrator] Using existing project directory: ${thread.projectDir}`);
        this._projectDir = thread.projectDir;
        return thread.projectDir;
      }
    } catch (error) {
      log.warn('[Orchestrator] Failed to read thread projectDir:', error);
    }

    // 2. 创建默认项目空间：{threadWorkspace}/project/
    const threadWorkspace = await Env.getAgentWorkspaceDir(this.resolvedConfig.parentSessionId);
    const defaultProjectDir = path.join(threadWorkspace, 'project');

    await fs.ensureDir(defaultProjectDir);
    log.info(`[Orchestrator] Created default project directory: ${defaultProjectDir}`);

    // 3. 更新 Thread 记录
    try {
      const threadStore = await ThreadStore.getInstance();
      await threadStore.update(this.resolvedConfig.parentSessionId, {
        projectDir: defaultProjectDir
      });
      log.info(`[Orchestrator] Updated thread projectDir: ${defaultProjectDir}`);
    } catch (error) {
      log.warn('[Orchestrator] Failed to update thread projectDir:', error);
    }

    this._projectDir = defaultProjectDir;
    return defaultProjectDir;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 🆕 记录失败到智库
   */
  private async recordFailureToBrain(subTask: SubTask, error: unknown, parentTask: Task): Promise<void> {
    try {
      const fs = await import('fs-extra');
      const path = await import('node:path');
      const { Env } = await import('@main/common/env');

      const brainDir = path.join(Env.paths.userHome, 'brain', 'patterns');
      await fs.ensureDir(brainDir);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const patternId = `orchestrator-failure-${subTask.id}-${timestamp}`;
      const patternPath = path.join(brainDir, `${patternId}.json`);

      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      const failurePattern = {
        id: patternId,
        name: `编排模式子任务失败: ${subTask.name}`,
        signal: `orchestrator failure: ${subTask.name}`,
        context: {
          problem: `执行子任务 "${subTask.name}" 失败`,
          constraints: [
            `父任务：${parentTask.objective}`,
            `子任务ID：${subTask.id}`,
            `Worker类型：${subTask.assignedWorker}`,
            `依赖项：${subTask.dependencies?.join(', ') || '无'}`,
            `关键任务：${subTask.critical ? '是' : '否'}`
          ],
          expected_outcome: subTask.description
        },
        practice: {
          approach: '编排模式子任务执行',
          steps: ['分配 Worker', '注入依赖结果', '执行子任务', '收集结果'],
          actual_result: `失败: ${errorMessage}`,
          confidence: 0.0,
          success_streak: 0,
          outcome: {
            status: 'failure',
            score: 0.0,
            details: errorMessage,
            error_stack: errorStack
          }
        },
        evolution: {
          attempts: [
            {
              approach: '尝试通过编排模式执行子任务',
              result: 'failure',
              reason: errorMessage,
              error_message: errorStack || errorMessage,
              time_wasted: `${subTask.estimatedDuration || 'unknown'}ms`
            }
          ],
          outcome: {
            status: 'failure',
            lessons_learned: '编排模式子任务执行失败，需要检查 Worker 配置、依赖完整性、任务复杂度等因素'
          }
        },
        metadata: {
          created_at: new Date().toISOString(),
          last_used: new Date().toISOString(),
          tags: ['orchestrator', 'subtask-failure', 'worker-execution'],
          priority: subTask.critical ? 'high' : 'medium',
          source: 'orchestrator-auto-record'
        }
      };

      await fs.writeJson(patternPath, failurePattern, { spaces: 2 });
      log.info(`[Orchestrator] Failure recorded to brain: ${patternPath}`);
    } catch (brainError) {
      log.error('[Orchestrator] Failed to record failure to brain:', brainError);
    }
  }

  /**
   * 构建需求分析 Prompt
   */
  private buildRequirementAnalysisPrompt(
    task: Task,
    analysisResult: import('./RequirementAnalyzer').RequirementAnalysisResult
  ): string {
    let prompt = `请为以下编排任务生成详细的需求分析文档：\n\n`;

    prompt += `**任务信息**：\n`;
    prompt += `- 任务目标：${task.objective}\n`;
    if (task.description) {
      prompt += `- 任务描述：${task.description}\n`;
    }
    if (task.requirements?.length) {
      prompt += `- 具体要求：\n${task.requirements.map((r) => `  - ${r}`).join('\n')}\n`;
    }
    if (task.constraints?.length) {
      prompt += `- 约束条件：\n${task.constraints.map((c) => `  - ${c}`).join('\n')}\n`;
    }
    if (task.context) {
      prompt += `- 上下文信息：${JSON.stringify(task.context)}\n`;
    }

    prompt += `\n**需求分析初步判断**：\n`;
    prompt += `- 任务类型：${analysisResult.taskType}\n`;
    prompt += `- 复杂度：${analysisResult.analysis?.estimatedComplexity || 'medium'}\n`;
    if (analysisResult.analysis) {
      prompt += `- 核心目标：${analysisResult.analysis.coreObjective}\n`;
      prompt += `- 关键需求：${analysisResult.analysis.keyRequirements.join(', ')}\n`;
    }

    prompt += `\n请按照你的指令中的结构，生成完整的需求分析文档（Markdown格式）。\n`;
    prompt += `要求：\n`;
    prompt += `1. 每个章节都要充实，避免空洞的占位符\n`;
    prompt += `2. 使用具体数据和案例，不要泛泛而谈\n`;
    prompt += `3. 风险评估要诚实面对，不要回避问题\n`;
    prompt += `4. 验收标准要可量化、可验证\n`;
    prompt += `5. 文档长度应在 500-1000 行\n`;
    prompt += `6. 直接输出 Markdown，不要用代码块包裹\n`;

    return prompt;
  }

  /**
   * 调用 requirement-analyst Agent 生成详细需求分析
   */
  private async callRequirementAnalystAgent(prompt: string): Promise<string | null> {
    try {
      const { agentExecutor } = await import('../AgentExecutor');
      const { generateSnowflakeId } = await import('@main/utils/SnowflakeIdGenerator');

      const sessionId = generateSnowflakeId();

      const builder = agentExecutor
        .piMono()
        .agentId('requirement-analyst') // 使用专门的 requirement-analyst Agent
        .mode('chat')
        .sessionMode('memory')
        .lightweight(true)
        .sessionId(sessionId);

      const runtime = await builder.build();

      try {
        log.info('[Orchestrator] Calling requirement-analyst Agent...');
        const result = await runtime.run(prompt);
        log.info(`[Orchestrator] Requirement analyst generated ${result.output.length} chars`);
        return result.output;
      } finally {
        await runtime.destroy?.();
      }
    } catch (error) {
      log.error('[Orchestrator] Requirement analyst failed:', error);
      return null;
    }
  }
}

/**
 * 创建 Orchestrator 实例
 *
 * 工厂函数，自动创建 Planner、WorkerCoordinator 和 AggregatorAgent。
 */
export function createOrchestrator(config?: OrchestratorConfig): Orchestrator {
  const planner = new Planner({
    parentSessionId: config?.parentSessionId,
    model: config?.model,
    signal: config?.signal
  });

  const workerCoordinator = new WorkerCoordinator({
    parentSessionId: config?.parentSessionId,
    model: config?.model,
    workspaceRoot: config?.workspaceRoot,
    executionTimeout: config?.subTaskTimeout,
    maxWorkersPerType: config?.maxWorkersPerType,
    maxTotalWorkers: config?.maxTotalWorkers,
    signal: config?.signal
  });

  const aggregator = new AggregatorAgent({
    parentSessionId: config?.parentSessionId,
    model: config?.model,
    signal: config?.signal
  });

  return new Orchestrator(planner, workerCoordinator, aggregator, config);
}
