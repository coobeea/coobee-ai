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
import { Aggregator } from '../quality-loop/Aggregator';
import { createLLMChat, type AgentExecutorLike } from '../quality-loop/llm-chat';

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
  /** AgentExecutor 实例（用于质量闭环 LLM 调用） */
  agentExecutor?: unknown;
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
  private _agentExecutor: unknown;

  constructor(options?: OrchestratorRuntimeOptions) {
    super();
    this.id = generateRuntimeId('orchestrator');
    this._name = options?.name || 'Orchestrator';
    this.sessionId = options?.sessionId || `orch-${Date.now()}`;
    this.createdAt = Date.now();
    this._orchestratorConfig = options?.orchestratorConfig || {};
    this._agentExecutor = options?.agentExecutor;

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

    // 🆕 保存用户消息到主会话
    await this.saveUserMessage(input);

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
    let qualityLoopOutput: string | null = null;

    const taskPromise = this.orchestrator.executeTask(task).then(
      async (result) => {
        taskResult = result;
        taskDone = true;

        // 提取初始输出
        let resultOutput =
          typeof result.finalOutput === 'string'
            ? result.finalOutput
            : result.finalOutput
              ? JSON.stringify(result.finalOutput, null, 2)
              : result.subTaskResults
                  .filter((r) => r.status === 'completed' && r.result)
                  .map((r) => String(r.result))
                  .join('\n\n');

        if (this._agentExecutor) {
          try {
            const aggregator = new Aggregator(createLLMChat(this._agentExecutor as AgentExecutorLike));

            if (result.subTaskResults.length > 1) {
              pushChunk({
                type: 'text:delta',
                content: '\n[质量闭环] 正在汇总多子任务输出...\n',
                data: { delta: '\n[质量闭环] 正在汇总多子任务输出...\n' }
              });

              const aggregationResult = await aggregator.aggregate({
                userRequest: input,
                subTaskResults: result.subTaskResults.map((subtask, idx) => ({
                  taskId: `subtask-${idx}`,
                  agentName: `agent-${idx}`,
                  output: String(subtask.result || ''),
                  status: subtask.status === 'completed' ? 'success' : 'failed',
                  error: subtask.error
                }))
              });

              resultOutput = aggregationResult.finalOutput;
              pushChunk({
                type: 'text:delta',
                content: `[质量闭环] 汇总完成 (耗时: ${aggregationResult.duration}ms)\n`,
                data: {
                  delta: `[质量闭环] 汇总完成 (耗时: ${aggregationResult.duration}ms)\n`
                }
              });
            }
          } catch (error) {
            log.error('[OrchestratorRuntime] 质量闭环失败:', error);
            pushChunk({
              type: 'text:delta',
              content: `[质量闭环] ⚠️ 质量检查失败，使用原始输出\n`,
              data: { delta: `[质量闭环] ⚠️ 质量检查失败，使用原始输出\n` }
            });
          }
        }

        qualityLoopOutput = resultOutput;
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

    // 构建 ExecutionResult — 优先使用质量闭环优化后的输出
    const result = taskResult as TaskExecutionResult | null;
    let finalOutput =
      qualityLoopOutput ??
      (result
        ? typeof result.finalOutput === 'string'
          ? String(result.finalOutput)
          : JSON.stringify(result.finalOutput || '', null, 2)
        : '');

    // 🆕 如果有产出文件，附加到输出末尾
    if (result?.artifacts && result.artifacts.length > 0) {
      const artifactsSummary = [
        '',
        '---',
        '## 📦 产出文件',
        '',
        ...result.artifacts.map((a) => `- **${a.name}** - Worker: ${a.workerId}`),
        '',
        '所有文件已保存到工作空间的 `user/output/` 目录。'
      ].join('\n');
      finalOutput += artifactsSummary;
    }

    // 🆕 保存 Assistant 响应到主会话
    await this.saveAssistantMessage(finalOutput);

    return {
      output: finalOutput,
      duration,
      metadata: {
        orchestratorId: this.id,
        taskId: task.id,
        status: result?.status || 'failed',
        stats: result?.stats,
        artifacts: result?.artifacts || []
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

  // ========== 会话持久化 ==========

  /**
   * 🆕 保存用户消息到主会话
   */
  private async saveUserMessage(content: string): Promise<void> {
    try {
      const fs = await import('fs-extra');
      const path = await import('node:path');
      const { Env } = await import('@main/common/env');

      const workspaceDir = await Env.getAgentWorkspaceDir(this.sessionId);
      const sessionsDir = path.join(workspaceDir, '.runtime', 'sessions');
      const sessionFile = path.join(sessionsDir, `${this.sessionId}.jsonl`);

      await fs.ensureDir(sessionsDir);

      const userMsg = {
        role: 'user',
        content,
        timestamp: new Date().toISOString()
      };

      await fs.appendFile(sessionFile, JSON.stringify(userMsg) + '\n', 'utf-8');
      log.debug(`[OrchestratorRuntime] Saved user message to session: ${this.sessionId}`);
    } catch (error) {
      log.error('[OrchestratorRuntime] Failed to save user message:', error);
    }
  }

  /**
   * 🆕 保存 Assistant 响应到主会话
   */
  private async saveAssistantMessage(content: string): Promise<void> {
    try {
      const fs = await import('fs-extra');
      const path = await import('node:path');
      const { Env } = await import('@main/common/env');

      const workspaceDir = await Env.getAgentWorkspaceDir(this.sessionId);
      const sessionsDir = path.join(workspaceDir, '.runtime', 'sessions');
      const sessionFile = path.join(sessionsDir, `${this.sessionId}.jsonl`);

      await fs.ensureDir(sessionsDir);

      const assistantMsg = {
        role: 'assistant',
        content,
        timestamp: new Date().toISOString()
      };

      await fs.appendFile(sessionFile, JSON.stringify(assistantMsg) + '\n', 'utf-8');
      log.debug(`[OrchestratorRuntime] Saved assistant message to session: ${this.sessionId}`);
    } catch (error) {
      log.error('[OrchestratorRuntime] Failed to save assistant message:', error);
    }
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
            content: `规划任务...`,
            data: {
              agentId: 'planner',
              agentName: 'Planner',
              task: data.objective || 'task decomposition'
            }
          }
        ];

      case 'plan:done':
        return [
          {
            type: 'delegate:done',
            content: `计划完成：${data.subTaskCount} 个子任务，${data.stageCount} 个阶段`,
            data: {
              agentId: 'planner',
              agentName: 'Planner'
            }
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
            type: 'delegate:start',
            content: `执行子任务...`,
            data: {
              agentId: `worker-${data.subTaskId}`,
              agentName: (data.subTaskName as string) || `Worker ${data.subTaskId}`,
              task: (data.subTaskName as string) || 'subtask'
            }
          }
        ];

      case 'subtask:done':
        return [
          {
            type: 'delegate:done',
            content: `子任务完成 (${data.duration}ms)`,
            data: {
              agentId: `worker-${data.subTaskId}`,
              agentName: (data.subTaskName as string) || `Worker ${data.subTaskId}`,
              duration: data.duration
            }
          }
        ];

      case 'subtask:failed':
        return [
          {
            type: 'delegate:done',
            content: `子任务失败`,
            data: {
              agentId: `worker-${data.subTaskId}`,
              agentName: (data.subTaskName as string) || `Worker ${data.subTaskId}`,
              error: data.error
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
