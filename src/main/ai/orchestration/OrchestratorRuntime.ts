/**
 * OrchestratorRuntime — 统筹者模式的 AgentRuntime 实现
 *
 * 将 Orchestrator（程序化多 Agent 编排引擎）包装为统一的 AgentRuntime 接口，
 * 使得统筹者模式可以像单 Agent 一样被 AgentExecutor 调度，
 * 流式事件正确推送到前端。
 *
 * 流式事件映射：
 *   OrchestratorEvent → StreamChunk
 *   ─────────────────────────────────
 *   plan:start        → delegate:start（规划阶段）
 *   plan:done         → delegate:done
 *   stage:start       → turn:start
 *   stage:done        → turn:done
 *   subtask:start     → tool:start（子任务执行）
 *   subtask:done      → tool:done
 *   subtask:failed    → run:error（子任务失败）
 *   aggregate:done    → text:done（最终结果）
 */

import { createLogger } from '@main/common/logger';
import { AbstractAgentRuntime, generateRuntimeId } from '../runtime/AbstractAgentRuntime';
import type { AgentRuntimeOptions, ExecutionConfig, ExecutionResult, StreamChunk, SessionInfo } from '../runtime/types';
import { Orchestrator, createOrchestrator, type OrchestratorConfig, type OrchestratorEvent } from './Orchestrator';
import type { Task, TaskExecutionResult } from './types';

const log = createLogger('orchestration:runtime');

/**
 * OrchestratorRuntime 配置
 */
export interface OrchestratorRuntimeOptions {
  /** 名称 */
  name?: string;
  /** Orchestrator 配置 */
  orchestratorConfig?: OrchestratorConfig;
  /** 会话 ID */
  sessionId?: string;
}

/**
 * OrchestratorRuntime — AgentRuntime 接口实现
 */
export class OrchestratorRuntime extends AbstractAgentRuntime {
  readonly type = 'orchestrator' as const;
  readonly id: string;
  readonly supportsHITL = false;

  private _name: string;
  private _options: AgentRuntimeOptions;
  private _interrupted = false;
  private orchestrator: Orchestrator | null = null;
  private sessionId: string;
  private createdAt: number;
  private _orchestratorConfig: OrchestratorConfig;

  constructor(options?: OrchestratorRuntimeOptions) {
    super();
    this.id = generateRuntimeId('orchestrator');
    this._name = options?.name || 'Orchestrator';
    this.sessionId = options?.sessionId || `orch-${Date.now()}`;
    this.createdAt = Date.now();
    this._orchestratorConfig = options?.orchestratorConfig || {};

    this._options = {
      name: this._name,
      instructions: 'Orchestrator Runtime — programmatic multi-agent coordination'
    };
  }

  get name(): string {
    return this._name;
  }

  get options(): AgentRuntimeOptions {
    return this._options;
  }

  get interrupted(): boolean {
    return this._interrupted;
  }

  // ========== 生命周期 ==========

  async initialize(): Promise<void> {
    log.info(`[OrchestratorRuntime] Initialized: ${this._name} (id=${this.id})`);
  }

  async destroy(): Promise<void> {
    if (this.orchestrator) {
      await this.orchestrator.cleanup();
      this.orchestrator = null;
    }
    log.info(`[OrchestratorRuntime] Destroyed: ${this._name}`);
  }

  // ========== 核心执行 ==========

  /**
   * 流式执行
   *
   * 将用户输入作为 Task.objective，交给 Orchestrator 执行。
   * Orchestrator 的 onEvent 回调被映射为 StreamChunk yield 出去。
   */
  protected async *doStream(
    input: string,
    _config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const startTime = Date.now();

    // 事件队列：Orchestrator 的回调是同步的，通过队列转为 async yield
    const eventQueue: StreamChunk[] = [];
    let resolveWaiting: (() => void) | null = null;

    const pushChunk = (chunk: StreamChunk): void => {
      eventQueue.push(chunk);
      if (resolveWaiting) {
        resolveWaiting();
        resolveWaiting = null;
      }
    };

    // 创建 Orchestrator（每次执行创建新实例）
    this.orchestrator = createOrchestrator({
      ...this._orchestratorConfig,
      onEvent: (event) => {
        const chunks = this.mapEventToChunks(event);
        for (const chunk of chunks) {
          pushChunk(chunk);
        }
      }
    });

    // 构建 Task
    const task: Task = {
      id: `task-${Date.now()}`,
      objective: input,
      context: {}
    };

    // 发出 run:start
    yield { type: 'run:start', content: '' };

    // 异步执行 Orchestrator 任务
    // 使用 wrapper 来捕获结果，同时让中间事件通过 eventQueue 流出
    let taskDone = false;
    let taskError: Error | null = null;
    let taskResult: TaskExecutionResult | null = null;

    const taskPromise = this.orchestrator.executeTask(task).then(
      (result) => {
        taskResult = result;
        taskDone = true;

        // 推送最终结果
        const resultOutput =
          typeof result.finalOutput === 'string'
            ? result.finalOutput
            : result.finalOutput
              ? JSON.stringify(result.finalOutput, null, 2)
              : result.subTaskResults
                  .filter((r) => r.status === 'completed' && r.result)
                  .map((r) => String(r.result))
                  .join('\n\n');

        pushChunk({ type: 'text:start', content: '' });
        pushChunk({
          type: 'text:delta',
          content: resultOutput,
          data: { delta: resultOutput }
        });
        pushChunk({
          type: 'text:done',
          content: resultOutput,
          data: { text: resultOutput }
        });
        pushChunk({ type: 'run:done', content: '' });
      },
      (error: unknown) => {
        taskDone = true;
        taskError = error instanceof Error ? error : new Error(String(error));
        pushChunk({
          type: 'run:error',
          content: taskError.message,
          data: { message: taskError.message }
        });
      }
    );

    // 消费事件队列（中间事件 + 最终结果事件）
    while (!taskDone || eventQueue.length > 0) {
      if (eventQueue.length > 0) {
        const chunk = eventQueue.shift()!;
        yield chunk;
      } else if (!taskDone) {
        await new Promise<void>((resolve) => {
          resolveWaiting = resolve;
          setTimeout(resolve, 100);
        });
      }
    }

    // 确保 promise 已 settled
    await taskPromise;

    const duration = Date.now() - startTime;

    // 构建 ExecutionResult
    const finalOutput = taskResult
      ? typeof (taskResult as TaskExecutionResult).finalOutput === 'string'
        ? String((taskResult as TaskExecutionResult).finalOutput)
        : JSON.stringify((taskResult as TaskExecutionResult).finalOutput || '', null, 2)
      : '';

    return {
      output: finalOutput,
      duration,
      metadata: {
        orchestratorId: this.id,
        taskId: task.id,
        status: (taskResult as TaskExecutionResult | null)?.status || 'failed',
        stats: (taskResult as TaskExecutionResult | null)?.stats
      }
    };
  }

  // ========== 会话管理 ==========

  async getSession(): Promise<SessionInfo> {
    return {
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      messageCount: 0,
      metadata: {
        orchestratorId: this.id,
        name: this._name
      }
    };
  }

  async clearSession(): Promise<void> {
    log.info(`[OrchestratorRuntime] Clearing session: ${this.sessionId}`);
  }

  // ========== 事件映射 ==========

  /**
   * 将 OrchestratorEvent 映射为 StreamChunk
   */
  private mapEventToChunks(event: OrchestratorEvent): StreamChunk[] {
    const data = event.data || {};

    switch (event.type) {
      case 'plan:start':
        return [
          {
            type: 'delegate:start',
            content: `Planning: ${data.objective || 'task decomposition'}`,
            data: { fromAgent: this._name, toAgent: 'Planner' }
          }
        ];

      case 'plan:done':
        return [
          {
            type: 'delegate:done',
            content: `Plan ready: ${data.subTaskCount} subtasks, ${data.stageCount} stages`,
            data: { fromAgent: 'Planner', toAgent: this._name }
          }
        ];

      case 'stage:start':
        return [
          {
            type: 'turn:start',
            content: '',
            data: { turnIndex: 1 }
          }
        ];

      case 'stage:done':
        return [
          {
            type: 'turn:done',
            content: '',
            data: { turnIndex: 1 }
          }
        ];

      case 'subtask:start':
        return [
          {
            type: 'tool:start',
            content: (data.subTaskName as string) || 'subtask',
            data: { toolName: `subtask:${data.subTaskId}`, callId: data.subTaskId as string }
          }
        ];

      case 'subtask:done':
        return [
          {
            type: 'tool:done',
            content: '',
            data: {
              toolName: `subtask:${data.subTaskId}`,
              callId: data.subTaskId as string,
              output: `Completed in ${data.duration}ms`
            }
          }
        ];

      case 'subtask:failed':
        return [
          {
            type: 'tool:done',
            content: '',
            data: {
              toolName: `subtask:${data.subTaskId}`,
              callId: data.subTaskId as string,
              output: `Failed: ${data.error}`
            }
          }
        ];

      case 'subtask:retry':
        return [
          {
            type: 'tool:delta',
            content: `Retry ${data.attempt}/${data.maxRetries}`,
            data: {
              delta: `Retrying in ${data.backoffTime}ms`,
              callId: data.subTaskId as string
            }
          }
        ];

      case 'replan:start':
        return [
          {
            type: 'delegate:start',
            content: `Replanning due to: ${data.reason}`,
            data: { fromAgent: this._name, toAgent: 'Planner' }
          }
        ];

      case 'replan:done':
        return [
          {
            type: 'delegate:done',
            content: `Replan ready: ${data.newSubTaskCount} new subtasks`,
            data: { fromAgent: 'Planner', toAgent: this._name }
          }
        ];

      default:
        return [];
    }
  }
}
