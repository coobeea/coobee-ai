/**
 * ConcurrencyManager - 并发管理器
 *
 * SDK 无关 — 使用 AgentRuntime.run() 替代 SDK 的 run()。
 *
 * 管理 Swarm 中 Agent 的并行执行：
 * - 依赖分析：拓扑排序构建执行阶段
 * - 并行执行：同一阶段内的任务并发运行
 * - 同步屏障：等待所有并行任务完成
 * - 结果聚合：合并多个 Agent 的输出
 * - 并发控制：信号量机制限制同时运行数
 */

import { createLogger } from '@main/common/logger';
import type { AgentRuntime } from '../runtime/AgentRuntime';
import type { SwarmConfig } from './types';

const log = createLogger('swarm:concurrency');

// ========== 类型定义 ==========

export interface SwarmSubTask {
  id: string;
  input: string;
  roleId: string;
  dependencies?: string[];
  priority?: number;
}

export interface SubTaskResult {
  taskId: string;
  roleId: string;
  output: string;
  success: boolean;
  error?: string;
  duration: number;
  startedAt: number;
  completedAt: number;
}

export interface ParallelExecutionResult {
  results: SubTaskResult[];
  aggregatedOutput: string;
  successCount: number;
  failCount: number;
  totalDuration: number;
}

export interface ConcurrencyEvent {
  type: 'task_started' | 'task_completed' | 'task_failed' | 'phase_started' | 'phase_completed' | 'all_completed';
  taskId?: string;
  roleId?: string;
  phase?: number;
  message: string;
  timestamp: number;
}

export type ConcurrencyEventListener = (event: ConcurrencyEvent) => void;

/**
 * 并发管理器
 */
export class ConcurrencyManager {
  private runningCount = 0;
  private eventListeners: ConcurrencyEventListener[] = [];

  constructor(private readonly config: SwarmConfig) {}

  // ========== 并行执行 ==========

  /**
   * 并行执行多个子任务
   * @param subTasks 子任务列表
   * @param runtimes 可用 AgentRuntime 映射（roleId -> AgentRuntime）
   */
  async executeParallel(
    subTasks: SwarmSubTask[],
    runtimes: Map<string, AgentRuntime>
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();
    const allResults: SubTaskResult[] = [];
    const completedTaskIds = new Set<string>();

    const phases = this.buildExecutionPhases(subTasks);

    for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex++) {
      const phase = phases[phaseIndex];

      this.emitEvent({
        type: 'phase_started',
        phase: phaseIndex,
        message: `阶段 ${phaseIndex + 1}/${phases.length} 开始，包含 ${phase.length} 个任务`,
        timestamp: Date.now()
      });

      const phaseResults = await this.executePhase(phase, runtimes);
      allResults.push(...phaseResults);

      for (const result of phaseResults) {
        if (result.success) completedTaskIds.add(result.taskId);
      }

      this.emitEvent({
        type: 'phase_completed',
        phase: phaseIndex,
        message: `阶段 ${phaseIndex + 1} 完成，成功 ${phaseResults.filter((r) => r.success).length}/${phaseResults.length}`,
        timestamp: Date.now()
      });
    }

    const aggregatedOutput = this.aggregateResults(allResults);
    const totalDuration = Date.now() - startTime;

    this.emitEvent({
      type: 'all_completed',
      message: `全部完成，共 ${allResults.length} 个任务，耗时 ${totalDuration}ms`,
      timestamp: Date.now()
    });

    return {
      results: allResults,
      aggregatedOutput,
      successCount: allResults.filter((r) => r.success).length,
      failCount: allResults.filter((r) => !r.success).length,
      totalDuration
    };
  }

  // ========== 执行阶段 ==========

  private async executePhase(tasks: SwarmSubTask[], runtimes: Map<string, AgentRuntime>): Promise<SubTaskResult[]> {
    const limit = this.config.maxConcurrentAgents;
    const results: SubTaskResult[] = [];
    const executing: Promise<void>[] = [];

    const sorted = [...tasks].sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const task of sorted) {
      const runtime = runtimes.get(task.roleId);
      if (!runtime) {
        results.push({
          taskId: task.id,
          roleId: task.roleId,
          output: '',
          success: false,
          error: `AgentRuntime not found for role: ${task.roleId}`,
          duration: 0,
          startedAt: Date.now(),
          completedAt: Date.now()
        });
        continue;
      }

      if (executing.length >= limit) {
        await Promise.race(executing);
      }

      const promise = this.executeSingleTask(task.id, task.input, runtime, task.roleId)
        .then((result) => results.push(result))
        .then(() => {
          const idx = executing.indexOf(promise);
          if (idx !== -1) executing.splice(idx, 1);
        });

      executing.push(promise);
    }

    await Promise.all(executing);
    return results;
  }

  private async executeSingleTask(
    taskId: string,
    input: string,
    runtime: AgentRuntime,
    roleId: string
  ): Promise<SubTaskResult> {
    const startedAt = Date.now();
    this.runningCount++;

    this.emitEvent({
      type: 'task_started',
      taskId,
      roleId,
      message: `任务 ${taskId} 开始执行 (${roleId})`,
      timestamp: startedAt
    });

    try {
      const result = await runtime.run(input);
      const completedAt = Date.now();

      this.emitEvent({
        type: 'task_completed',
        taskId,
        roleId,
        message: `任务 ${taskId} 执行完成 (${completedAt - startedAt}ms)`,
        timestamp: completedAt
      });

      return {
        taskId,
        roleId,
        output: result.output || '',
        success: true,
        duration: completedAt - startedAt,
        startedAt,
        completedAt
      };
    } catch (error) {
      const completedAt = Date.now();
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.emitEvent({
        type: 'task_failed',
        taskId,
        roleId,
        message: `任务 ${taskId} 执行失败: ${errorMessage}`,
        timestamp: completedAt
      });

      return {
        taskId,
        roleId,
        output: '',
        success: false,
        error: errorMessage,
        duration: completedAt - startedAt,
        startedAt,
        completedAt
      };
    } finally {
      this.runningCount--;
    }
  }

  // ========== 依赖分析 ==========

  buildExecutionPhases(subTasks: SwarmSubTask[]): SwarmSubTask[][] {
    const phases: SwarmSubTask[][] = [];
    const resolved = new Set<string>();
    let remaining = [...subTasks];

    while (remaining.length > 0) {
      const currentPhase: SwarmSubTask[] = [];
      const nextRemaining: SwarmSubTask[] = [];

      for (const task of remaining) {
        const deps = task.dependencies || [];
        if (deps.every((dep) => resolved.has(dep))) {
          currentPhase.push(task);
        } else {
          nextRemaining.push(task);
        }
      }

      if (currentPhase.length === 0 && nextRemaining.length > 0) {
        log.warn('Circular dependency detected, forcing execution of remaining tasks');
        currentPhase.push(...nextRemaining);
        nextRemaining.length = 0;
      }

      for (const task of currentPhase) {
        resolved.add(task.id);
      }

      phases.push(currentPhase);
      remaining = nextRemaining;
    }

    return phases;
  }

  // ========== 结果聚合 ==========

  private aggregateResults(results: SubTaskResult[]): string {
    const successResults = results.filter((r) => r.success);
    const failedResults = results.filter((r) => !r.success);
    const parts: string[] = [];

    for (const result of successResults) {
      parts.push(`### ${result.roleId} (${result.taskId})\n\n${result.output}`);
    }

    if (failedResults.length > 0) {
      parts.push('\n---\n### 执行失败的任务\n');
      for (const result of failedResults) {
        parts.push(`- **${result.taskId}** (${result.roleId}): ${result.error}`);
      }
    }

    return parts.join('\n\n');
  }

  // ========== 状态查询 ==========

  getRunningCount(): number {
    return this.runningCount;
  }

  isAtCapacity(): boolean {
    return this.runningCount >= this.config.maxConcurrentAgents;
  }

  // ========== 事件系统 ==========

  addEventListener(listener: ConcurrencyEventListener): void {
    this.eventListeners.push(listener);
  }

  removeEventListener(listener: ConcurrencyEventListener): void {
    const index = this.eventListeners.indexOf(listener);
    if (index !== -1) this.eventListeners.splice(index, 1);
  }

  private emitEvent(event: ConcurrencyEvent): void {
    log.debug(event.message);
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        log.error('Event listener error', error);
      }
    }
  }

  // ========== 清理 ==========

  destroy(): void {
    this.eventListeners = [];
    this.runningCount = 0;
  }
}
