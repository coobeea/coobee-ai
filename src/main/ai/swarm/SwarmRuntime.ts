/**
 * SwarmRuntime - 统一运行时
 *
 * 实现 AgentRuntime 接口，使 Swarm 与 Agent/Orchestrator 运行时对等。
 * 将 SwarmCoordinator 的事件映射为标准 StreamChunk 流。
 */

import { createLogger } from '@main/common/logger';
import { AbstractAgentRuntime, generateRuntimeId } from '../runtime/AbstractAgentRuntime';
import { SwarmCoordinator, type SwarmEvent } from './SwarmCoordinator';
import type { SwarmSubTask } from './ConcurrencyManager';
import type { AgentRole, SwarmConfig } from './types';
import { DEFAULT_SWARM_CONFIG } from './types';
import { FileSwarmContext } from './FileSwarmContext';
import { FileMessageBus } from './FileMessageBus';
import { KnowledgeBase } from './KnowledgeBase';
import env from '@main/common/env';
import { join } from 'path';
import type { AgentRuntimeOptions, ExecutionConfig, ExecutionResult, StreamChunk, SessionInfo } from '../runtime/types';
import { Aggregator } from '../quality-loop/Aggregator';
import { Validator } from '../quality-loop/Validator';
import { Repairer } from '../quality-loop/Repairer';
import { LLMService } from '../provider/LLMService';

const log = createLogger('swarm:runtime');

export interface SwarmRuntimeOptions {
  config?: Partial<SwarmConfig>;
  customRoles?: AgentRole[];
  /** Workspace 目录（用于持久化） */
  workspaceDir?: string;
  /** 是否启用持久化（默认 true） */
  enablePersistence?: boolean;
  /** AgentExecutor 实例（用于质量闭环 LLM 调用） */
  agentExecutor?: unknown;
}

export class SwarmRuntime extends AbstractAgentRuntime {
  readonly type = 'swarm' as const;
  readonly id: string;
  private _name: string;

  private sessionId: string;
  private coordinator: SwarmCoordinator;
  private swarmConfig: SwarmConfig;
  private taskCounter = 0;
  private createdAt = Date.now();

  private _interrupted = false;

  constructor(swarmId: string, sessionId?: string, options?: SwarmRuntimeOptions) {
    super();
    this.id = swarmId || generateRuntimeId('swarm');
    this.sessionId = sessionId || `swarm-session-${Date.now()}`;

    // 🆕 构建持久化配置
    const enablePersistence = options?.enablePersistence !== false; // 默认启用
    const workspaceDir = options?.workspaceDir || this.getDefaultWorkspaceDir(this.sessionId);

    // 🆕 创建持久化实例
    const context = enablePersistence ? new FileSwarmContext(workspaceDir) : undefined;
    const messageBus = enablePersistence ? new FileMessageBus(workspaceDir) : undefined;
    const knowledgeBase = enablePersistence ? new KnowledgeBase(workspaceDir) : undefined;

    this.swarmConfig = {
      ...DEFAULT_SWARM_CONFIG,
      id: swarmId,
      name: options?.config?.name || `Swarm-${swarmId}`,
      parentSessionId: this.sessionId,
      ...options?.config,
      context,
      messageBus,
      knowledgeBase,
      agentExecutor: options?.agentExecutor
    } as SwarmConfig;

    this._name = this.swarmConfig.name;
    this.coordinator = new SwarmCoordinator(this.swarmConfig);
  }

  /**
   * 获取默认 workspace 目录
   */
  private getDefaultWorkspaceDir(sessionId: string): string {
    const homeDir = env.paths.userHome;
    return join(homeDir, 'workspaces', sessionId);
  }

  get name(): string {
    return this._name;
  }

  get options(): AgentRuntimeOptions {
    return {
      name: this._name,
      instructions: `Swarm: ${this.swarmConfig.name}`
    };
  }

  get interrupted(): boolean {
    return this._interrupted;
  }

  get supportsHITL(): boolean {
    return false;
  }

  // ========== 生命周期 ==========

  async initialize(): Promise<void> {
    await this.coordinator.initialize();
    log.info(`SwarmRuntime initialized: ${this.name} (session: ${this.sessionId})`);
  }

  async destroy(): Promise<void> {
    await this.coordinator.destroy();
    this._interrupted = false;
    log.info(`SwarmRuntime destroyed: ${this.name}`);
  }

  // ========== 执行方法 ==========

  async run(input: string, config?: ExecutionConfig): Promise<ExecutionResult> {
    const startTime = Date.now();
    this.taskCounter++;

    const taskId = `task-${this.taskCounter}-${Date.now().toString(36)}`;
    const executionMode = (config?.executionMode as string) || 'auto';

    log.info(`Running task ${taskId} (mode: ${executionMode}): ${input.substring(0, 100)}...`);

    try {
      const task = {
        id: taskId,
        input,
        context: config?.context as Record<string, unknown> | undefined,
        constraints: config?.constraints as string[] | undefined,
        createdAt: Date.now()
      };

      let result;
      if (executionMode === 'discussion') {
        const discussionConfig = config?.discussionConfig as
          | Partial<import('./DiscussionCoordinator').DiscussionConfig>
          | undefined;
        result = await this.coordinator.coordinateDiscussion(task, discussionConfig);
      } else if (executionMode === 'parallel' && config?.subTasks) {
        result = await this.coordinator.coordinateParallel(task, config.subTasks as SwarmSubTask[]);
      } else if (executionMode === 'hybrid' || executionMode === 'auto') {
        result = await this.coordinator.coordinateHybrid(task);
      } else {
        result = await this.coordinator.coordinate(task);
      }

      return {
        output: result.output,
        toolCalls: [],
        duration: Date.now() - startTime,
        metadata: {
          swarmId: this.id,
          sessionId: this.sessionId,
          taskId,
          executionMode,
          handoffCount: result.handoffCount,
          rolesUsed: result.rolesUsed,
          swarmState: result.state.status
        }
      };
    } catch (error: unknown) {
      log.error(`Task ${taskId} failed`, error);
      throw error;
    }
  }

  /**
   * 流式执行
   *
   * 通过 SwarmCoordinator 的事件系统将 Handoff 链路实时输出为 StreamChunk。
   */
  protected async *doStream(
    input: string,
    config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const startTime = Date.now();
    this.taskCounter++;
    const taskId = `task-${this.taskCounter}-${Date.now().toString(36)}`;

    log.info(`Running task ${taskId} in stream mode`);

    try {
      yield { type: 'run:start', content: '' };
      yield { type: 'turn:start', content: '', data: { turnIndex: 1 } };
      yield { type: 'llm:start', content: '' };
      yield { type: 'text:start', content: '' };

      const eventQueue: SwarmEvent[] = [];
      let resolveWait: (() => void) | null = null;

      this.coordinator.setOnEvent((event) => {
        eventQueue.push(event);
        resolveWait?.();
      });

      const task = {
        id: taskId,
        input,
        context: config?.context as Record<string, unknown> | undefined,
        constraints: config?.constraints as string[] | undefined,
        createdAt: Date.now()
      };

      const outcome: {
        result: import('./SwarmCoordinator').CoordinationResult | null;
        error: Error | null;
      } = { result: null, error: null };

      const executionMode = (config?.executionMode as string) || 'auto';
      const coordinatePromise =
        executionMode === 'discussion'
          ? this.coordinator.coordinateDiscussion(
              task,
              config?.discussionConfig as Partial<import('./DiscussionCoordinator').DiscussionConfig> | undefined
            )
          : executionMode === 'parallel' && config?.subTasks
            ? this.coordinator.coordinateParallel(task, config.subTasks as SwarmSubTask[])
            : executionMode === 'hybrid' || executionMode === 'auto'
              ? this.coordinator.coordinateHybrid(task)
              : this.coordinator.coordinate(task);

      const taskPromise = coordinatePromise
        .then((r) => {
          outcome.result = r;
          log.info(`[SwarmRuntime] Coordination completed: status=${r.state.status}, output length=${r.output.length}`);
        })
        .catch((e) => {
          outcome.error = e instanceof Error ? e : new Error(String(e));
          log.error(`[SwarmRuntime] Coordination failed:`, e);
        })
        .finally(() => {
          resolveWait?.();
        });

      while (!outcome.result && !outcome.error) {
        if (eventQueue.length === 0) {
          await Promise.race([
            taskPromise,
            new Promise<void>((resolve) => {
              resolveWait = resolve;
            })
          ]);
        }

        while (eventQueue.length > 0) {
          const event = eventQueue.shift()!;
          log.info(`[SwarmRuntime] Processing event from queue: ${event.type}`);
          const chunks = this.mapEventToChunks(event);
          for (const chunk of chunks) {
            yield chunk;
          }
        }
      }

      await taskPromise;

      if (outcome.error) {
        log.error(`[SwarmRuntime] Task failed with error:`, outcome.error);
        yield {
          type: 'run:error',
          content: outcome.error.message,
          data: { message: outcome.error.message }
        };
        throw outcome.error;
      }

      const result = outcome.result!;
      log.info(
        `[SwarmRuntime] Task result: status=${result.state.status}, output="${result.output.substring(0, 100)}..."`
      );

      // 如果 SwarmCoordinator 返回 failed 状态，也应该抛出错误
      if (result.state.status === 'failed') {
        const errorMsg = result.state.error || result.output || 'Unknown error';
        log.error(`[SwarmRuntime] Swarm execution failed: ${errorMsg}`);
        yield {
          type: 'run:error',
          content: errorMsg,
          data: { message: errorMsg }
        };
        throw new Error(errorMsg);
      }

      let finalOutput = result.output;
      let qualityScore = 100;
      let repairRounds = 0;
      const maxRepairRounds = 3;

      const agentExec = this.swarmConfig.agentExecutor;
      const llmService = agentExec ? new LLMService(agentExec) : null;
      const aggregator = llmService ? new Aggregator(llmService) : null;
      const validator = llmService ? new Validator(llmService) : null;
      const repairer = llmService ? new Repairer(llmService) : null;

      if (aggregator && validator && repairer && llmService) {
        // Step 1: 汇总多个 Agent 输出（如果有多个角色参与）
        if (result.rolesUsed.length > 1) {
          yield {
            type: 'text:delta',
            content: '\n\n[质量闭环] 正在汇总多 Agent 输出...\n',
            data: { delta: '\n\n[质量闭环] 正在汇总多 Agent 输出...\n' }
          };

          const aggregationResult = await aggregator.aggregate({
            userRequest: input,
            subTaskResults: result.rolesUsed.map((role, idx) => ({
              taskId: `${taskId}-${idx}`,
              agentName: role,
              output: idx === result.rolesUsed.length - 1 ? result.output : '...',
              status: 'success'
            })),
            collaborationContext: `Handoff 链路: ${result.rolesUsed.join(' → ')}`
          });

          finalOutput = aggregationResult.finalOutput;
          yield {
            type: 'text:delta',
            content: `[质量闭环] 汇总完成 (耗时: ${aggregationResult.duration}ms)\n`,
            data: { delta: `[质量闭环] 汇总完成 (耗时: ${aggregationResult.duration}ms)\n` }
          };
        }

        // Step 2: 验证输出质量
        while (repairRounds < maxRepairRounds) {
          yield {
            type: 'text:delta',
            content: `[质量闭环] 正在验证输出质量 (第 ${repairRounds + 1} 轮)...\n`,
            data: {
              delta: `[质量闭环] 正在验证输出质量 (第 ${repairRounds + 1} 轮)...\n`
            }
          };

          const validationResult = await validator.validate({
            userRequest: input,
            output: finalOutput
          });

          qualityScore = validationResult.overallScore;

          yield {
            type: 'text:delta',
            content: `[质量闭环] 验证完成，得分: ${qualityScore}/100 (${validationResult.passed ? '✅ 通过' : '❌ 未通过'})\n`,
            data: {
              delta: `[质量闭环] 验证完成，得分: ${qualityScore}/100 (${validationResult.passed ? '✅ 通过' : '❌ 未通过'})\n`
            }
          };

          if (validationResult.passed) {
            break;
          }

          repairRounds++;

          if (repairRounds >= maxRepairRounds) {
            yield {
              type: 'text:delta',
              content: `[质量闭环] ⚠️ 已达最大修复次数 (${maxRepairRounds})，使用当前输出\n`,
              data: {
                delta: `[质量闭环] ⚠️ 已达最大修复次数 (${maxRepairRounds})，使用当前输出\n`
              }
            };
            break;
          }

          yield {
            type: 'text:delta',
            content: `[质量闭环] 正在生成修复计划...\n`,
            data: { delta: `[质量闭环] 正在生成修复计划...\n` }
          };

          const repairPlan = await repairer.generateRepairPlan({
            userRequest: input,
            currentOutput: finalOutput,
            validationResult,
            repairRound: repairRounds
          });

          if (!repairPlan.shouldRepair || repairPlan.strategy === 'abort') {
            yield {
              type: 'text:delta',
              content: `[质量闭环] 修复建议: ${repairPlan.strategy}，停止修复\n`,
              data: {
                delta: `[质量闭环] 修复建议: ${repairPlan.strategy}，停止修复\n`
              }
            };
            break;
          }

          yield {
            type: 'text:delta',
            content: `[质量闭环] 正在修复输出 (策略: ${repairPlan.strategy})...\n`,
            data: {
              delta: `[质量闭环] 正在修复输出 (策略: ${repairPlan.strategy})...\n`
            }
          };

          const repairResponse = await llmService.chat({
            messages: [
              {
                role: 'user',
                content: `原始请求: ${input}\n\n当前输出:\n${finalOutput}\n\n修复指令:\n${repairPlan.repairInstructions}\n\n请根据修复指令优化输出。`
              }
            ],
            temperature: 0.5,
            maxTokens: 4000
          });

          finalOutput = repairResponse.content.trim();
        }
      }

      if (result.rolesUsed.length > 0) {
        const metaInfo = `\n\n---\n[Swarm] 使用专家: ${result.rolesUsed.join(' → ')} | Handoff: ${result.handoffCount}次 | 质量分数: ${qualityScore}/100 | 耗时: ${result.duration}ms`;
        yield { type: 'text:delta', content: metaInfo, data: { delta: metaInfo } };
      }

      yield { type: 'text:done', content: finalOutput, data: { text: finalOutput } };
      yield { type: 'llm:done', content: '' };
      yield { type: 'turn:done', content: '', data: { turnIndex: 1 } };
      yield { type: 'run:done', content: '' };

      return {
        output: finalOutput,
        toolCalls: [],
        duration: Date.now() - startTime,
        metadata: {
          swarmId: this.id,
          sessionId: this.sessionId,
          taskId,
          handoffCount: result.handoffCount,
          rolesUsed: result.rolesUsed,
          swarmState: result.state.status,
          qualityScore,
          repairRounds
        }
      };
    } catch (error: unknown) {
      yield {
        type: 'run:error',
        content: error instanceof Error ? error.message : String(error),
        data: { message: error instanceof Error ? error.message : String(error) }
      };
      log.error(`Task ${taskId} stream failed`, error);
      throw error;
    }
  }

  private mapEventToChunks(event: SwarmEvent): StreamChunk[] {
    switch (event.type) {
      case 'triage:start':
        return [
          {
            type: 'text:delta',
            content: '[Swarm] 正在分析任务需求...\n',
            data: { delta: '[Swarm] 正在分析任务需求...\n' }
          }
        ];
      case 'triage:done':
        return event.data.targetRole
          ? [
              {
                type: 'text:delta',
                content: `[Swarm] 分诊完成，交接给: ${event.data.targetRole}\n`,
                data: { delta: `[Swarm] 分诊完成，交接给: ${event.data.targetRole}\n` }
              }
            ]
          : [];
      case 'handoff':
        return [
          {
            type: 'handoff:start',
            content: '',
            data: { fromAgent: event.data.from, toAgent: event.data.to }
          },
          {
            type: 'text:delta',
            content: `[Handoff] ${event.data.from} → ${event.data.to} (深度: ${event.data.depth})\n`,
            data: {
              delta: `[Handoff] ${event.data.from} → ${event.data.to} (深度: ${event.data.depth})\n`
            }
          },
          {
            type: 'handoff:done',
            content: '',
            data: { fromAgent: event.data.from, toAgent: event.data.to }
          }
        ];
      case 'agent:start':
        return [
          {
            type: 'text:delta',
            content: `[${event.data.roleId}] 开始处理...\n`,
            data: { delta: `[${event.data.roleId}] 开始处理...\n` }
          }
        ];
      case 'agent:done':
        return [
          {
            type: 'text:delta',
            content: event.data.output + '\n',
            data: { delta: event.data.output + '\n' }
          }
        ];
      case 'discussion:turn':
        return [
          {
            type: 'text:delta',
            content: `\n**[${event.data.roleName}]** (第${event.data.round}轮):\n${event.data.content}\n`,
            data: {
              delta: `\n**[${event.data.roleName}]** (第${event.data.round}轮):\n${event.data.content}\n`
            }
          }
        ];
      case 'discussion:consensus':
        return [
          {
            type: 'text:delta',
            content: event.data.reached
              ? `\n---\n**[主持人]** 第${event.data.round}轮共识评估: ✅ 达成共识 (${event.data.score}分)\n`
              : `\n---\n**[主持人]** 第${event.data.round}轮共识评估: ⏳ 继续讨论 (${event.data.score}分)\n`,
            data: {
              delta: event.data.reached
                ? `[主持人] 达成共识 (${event.data.score}分)\n`
                : `[主持人] 继续讨论 (${event.data.score}分)\n`
            }
          }
        ];
      case 'error':
        return [
          {
            type: 'run:error',
            content: event.data.message,
            data: { message: event.data.message }
          }
        ];
      default:
        return [];
    }
  }

  // ========== 会话管理 ==========

  async getSession(): Promise<SessionInfo> {
    return {
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      messageCount: this.taskCounter,
      metadata: {
        swarmId: this.id,
        swarmName: this.name,
        status: this.coordinator.getState().status
      }
    };
  }

  async clearSession(): Promise<void> {
    this.coordinator.reset();
    this.taskCounter = 0;
    log.info(`Session cleared: ${this.sessionId}`);
  }

  // ========== Swarm 特有方法 ==========

  async registerRole(role: AgentRole): Promise<void> {
    await this.coordinator.registerRole(role);
  }

  getAvailableRoles(): AgentRole[] {
    return this.coordinator.getAvailableRoleList();
  }

  getMetrics(): ReturnType<typeof this.coordinator.monitor.getMetrics> {
    return this.coordinator.monitor.getMetrics();
  }

  getPoolStats(): ReturnType<typeof this.coordinator.pool.getStats> {
    return this.coordinator.pool.getStats();
  }

  getHandoffStats(): ReturnType<typeof this.coordinator.router.getStats> {
    return this.coordinator.router.getStats();
  }

  getContextSummary(): string {
    return this.coordinator.context.toSummary();
  }

  getMessageStats(): ReturnType<typeof this.coordinator.messageBus.getStats> {
    return this.coordinator.messageBus.getStats();
  }

  getConcurrencyStatus(): { running: number; atCapacity: boolean } {
    return {
      running: this.coordinator.concurrency.getRunningCount(),
      atCapacity: this.coordinator.concurrency.isAtCapacity()
    };
  }
}
