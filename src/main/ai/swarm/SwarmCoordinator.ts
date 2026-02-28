/**
 * SwarmCoordinator - 核心协调器
 *
 * SDK 无关 — 通过 AgentRuntime 抽象运行 Agent，
 * 通过工具调用 + 协调器循环实现 Handoff 机制。
 *
 * 核心流程：
 * 1. 创建 Triage Agent（AgentRuntime）并注入 transfer_to_XXX 工具
 * 2. 运行 Triage Agent 处理用户输入
 * 3. 如果 Agent 调用了 transfer_to_XXX 工具 → 截获 Handoff 信号
 * 4. 创建目标角色的 Agent → 运行 → 继续检测 Handoff
 * 5. 循环直到无更多 Handoff 或达到深度限制
 */

import { createLogger } from '@main/common/logger';
import type { AgentRuntime } from '../runtime/AgentRuntime';
import type { ToolDefinition } from '../tools/types';
import type { AgentRole, ISwarmContext, SwarmConfig, SwarmState, SwarmTask } from './types';
import { createInitialSwarmState, extractHandoffTarget } from './types';
import { AgentPool } from './AgentPool';
import { HandoffRouter } from './HandoffRouter';
import { SwarmContext } from './SwarmContext';
import { SwarmMonitor } from './SwarmMonitor';
import { MessageBus } from './MessageBus';
import { KnowledgeBase } from './KnowledgeBase';
import { ConcurrencyManager, type SwarmSubTask } from './ConcurrencyManager';
import { createSwarmTools } from './tools';
import { RoleRegistry } from './roles';
import { Aggregator } from '../quality-loop/Aggregator';
import { Validator, type ValidationInput } from '../quality-loop/Validator';
import { Repairer, type RepairInput } from '../quality-loop/Repairer';
import type { LLMService } from '../provider/LLMService';
import { getLLMService } from '../provider/LLMService';
import { injectEnv } from '../AgentEnvInjector';

const log = createLogger('swarm:coordinator');

// ========== 事件系统 ==========

export type SwarmEvent =
  | { type: 'triage:start'; data: { taskId: string; input: string } }
  | { type: 'triage:done'; data: { targetRole?: string } }
  | { type: 'handoff'; data: { from: string; to: string; depth: number; reason?: string } }
  | { type: 'agent:start'; data: { roleId: string; input: string } }
  | { type: 'agent:done'; data: { roleId: string; output: string } }
  | { type: 'discussion:turn'; data: { round: number; roleId: string; roleName: string; content: string } }
  | {
      type: 'discussion:consensus';
      data: { round: number; reached: boolean; score: number; conclusion?: string };
    }
  | { type: 'complete'; data: { output: string; handoffCount: number; rolesUsed: string[] } }
  | { type: 'error'; data: { message: string } };

export type SwarmEventCallback = (event: SwarmEvent) => void;

// ========== 协调结果 ==========

export interface RoleOutput {
  roleId: string;
  output: string;
}

export interface CoordinationResult {
  output: string;
  state: SwarmState;
  rolesUsed: string[];
  handoffCount: number;
  duration: number;
  /** 每个角色的独立输出（用于 Aggregator 汇总） */
  roleOutputs?: RoleOutput[];
}

// ========== Triage 指令 ==========

const TRIAGE_INSTRUCTIONS = `你是一个智能任务分诊员（Triage Agent），负责分析用户的需求并将任务交接给最合适的专家。

你的职责：
1. 理解用户的需求和意图
2. 判断需要哪类专家来处理
3. 使用 transfer_to_xxx 工具将任务交接给合适的专家
4. 如果任务很简单，你可以直接回答

交接规则：
- 代码相关（编写、调试、重构）→ 交接给代码专家
- 信息搜索和调研 → 交接给研究专家
- 代码审查和质量检查 → 交接给审查专家
- 文档编写和说明 → 交接给写作专家
- 数据分析和统计 → 交接给分析专家

通信能力：
- 你可以使用 write_shared_context 工具在共享上下文中留下任务分析结果
- 你可以使用 send_message 工具给专家发送补充说明
- 你可以使用 report_progress 工具记录分诊过程

注意事项：
- 仔细分析用户需求，不要误判
- 如果不确定，可以先简要回复并说明你的判断
- 对于综合性任务，选择最核心的专家先交接
- 交接前，先将任务分析结果写入共享上下文，方便专家参考`;

import { AsyncLock } from '../utils/AsyncLock';

/**
 * Swarm 核心协调器
 */
export class SwarmCoordinator {
  readonly pool: AgentPool;
  readonly router: HandoffRouter;
  readonly context: ISwarmContext;
  readonly monitor: SwarmMonitor;
  readonly messageBus: MessageBus;
  readonly concurrency: ConcurrencyManager;
  readonly roleRegistry: RoleRegistry;
  readonly knowledgeBase?: KnowledgeBase; // 🆕 共享知识库
  private aggregator?: Aggregator;
  private validator?: Validator;
  private repairer?: Repairer;
  private llmService?: LLMService;

  private state: SwarmState = createInitialSwarmState();
  private onEvent: SwarmEventCallback | null = null;
  private stateLock = new AsyncLock();

  constructor(private readonly config: SwarmConfig) {
    this.pool = new AgentPool(config);
    this.router = new HandoffRouter(config);
    this.context = config.context || new SwarmContext(); // 🆕 支持注入
    this.monitor = new SwarmMonitor();
    this.messageBus = config.messageBus || new MessageBus(); // 🆕 支持注入
    this.knowledgeBase = config.knowledgeBase; // 🆕 可选的知识库
    this.concurrency = new ConcurrencyManager(config);
    this.roleRegistry = new RoleRegistry();

    if (config.qualityLoop?.enabled && config.agentExecutor) {
      this.llmService = getLLMService();
      this.aggregator = new Aggregator(this.llmService);
      this.validator = new Validator(this.llmService);
      this.repairer = new Repairer(this.llmService);
      log.info('[SwarmCoordinator] 质量闭环已启用');
    } else if (config.qualityLoop?.enabled) {
      log.warn('[SwarmCoordinator] 质量闭环已启用但缺少 agentExecutor，跳过初始化');
    }

    this.setupMonitoringBridge();
    this.setupKnowledgeBaseRecording(); // 🆕 设置知识库自动记录
  }

  // ========== 事件 ==========

  setOnEvent(callback: SwarmEventCallback): void {
    this.onEvent = callback;
  }

  private emit(event: SwarmEvent): void {
    log.info(
      `[SwarmCoordinator] Emitting event: ${event.type}`,
      event.data ? `data keys: ${Object.keys(event.data).join(', ')}` : '(no data)'
    );
    this.onEvent?.(event);
  }

  // ========== 初始化 ==========

  async initialize(): Promise<void> {
    this.pool.start();

    this.pool.setRuntimeFactory(async (role, sessionId, extraTools) => {
      return this.createRoleRuntime(role, sessionId, extraTools);
    });

    const roles = this.getAvailableRoles();
    log.info(`Swarm initialized with ${roles.length} roles: ${roles.map((r) => r.id).join(', ')}`);
  }

  // ========== 核心执行 ==========

  /**
   * 协调执行：Triage → Handoff 循环
   */
  async coordinate(task: SwarmTask): Promise<CoordinationResult> {
    const startTime = Date.now();
    await this.updateState({
      status: 'triaging',
      startedAt: startTime
    });
    this.router.resetChain();
    this.monitor.startExecution(task.id);

    this.setupContext(task);
    this.emit({ type: 'triage:start', data: { taskId: task.id, input: task.input } });

    try {
      const roles = this.getAvailableRoles();
      let currentRoleId = 'triage';
      let currentInput = task.input;

      const triageRuntime = await this.createTriageRuntime(roles);
      let currentRuntime: AgentRuntime = triageRuntime;
      let currentPoolId: string | undefined = undefined;
      let isCurrentFromPool = false;

      await this.updateState({ status: 'executing' });
      let finalOutput = '';
      const roleOutputs: RoleOutput[] = [];

      for (let depth = 0; depth <= this.config.maxHandoffDepth; depth++) {
        log.info(`[SwarmCoordinator] Loop depth=${depth}, roleId=${currentRoleId}, inputLength=${currentInput.length}`);

        this.emit({
          type: 'agent:start',
          data: { roleId: currentRoleId, input: currentInput.substring(0, 200) }
        });
        log.info(`[SwarmCoordinator] Emitted agent:start for ${currentRoleId}`);

        log.info(`[SwarmCoordinator] Calling runtime.run() for ${currentRoleId}...`);
        const runStartTime = Date.now();
        const result = await currentRuntime.run(currentInput);
        const runDuration = Date.now() - runStartTime;
        const output = result.output || '';

        log.info(
          `[SwarmCoordinator] Runtime.run() completed for ${currentRoleId}: outputLength=${output.length}, duration=${runDuration}ms, hasToolCalls=${result.toolCalls?.length || 0}`
        );
        if (output.length === 0) {
          log.warn(
            `[SwarmCoordinator] ⚠️  ${currentRoleId} returned EMPTY output! Result:`,
            JSON.stringify(result).substring(0, 500)
          );
        }

        this.emit({ type: 'agent:done', data: { roleId: currentRoleId, output: output.substring(0, 200) } });
        log.info(`[SwarmCoordinator] Emitted agent:done for ${currentRoleId}`);

        roleOutputs.push({ roleId: currentRoleId, output });

        const handoffTarget = this.detectHandoff(result);

        if (!handoffTarget) {
          finalOutput = output;
          break;
        }

        if (this.router.wouldCauseLoop(handoffTarget)) {
          log.warn(`Loop detected: ${this.router.getCurrentChain().join(' -> ')} -> ${handoffTarget}`);
          finalOutput = output;
          break;
        }

        this.router.recordHandoff(currentRoleId, handoffTarget);
        this.emit({
          type: 'handoff',
          data: { from: currentRoleId, to: handoffTarget, depth: depth + 1 }
        });
        this.context.addProgressNote(`Handoff: ${currentRoleId} → ${handoffTarget}`, 'system');

        const targetRole = this.roleRegistry.getRole(handoffTarget);
        if (!targetRole) {
          log.warn(`Target role not found: ${handoffTarget}, stopping handoff chain`);
          finalOutput = output;
          break;
        }

        if (isCurrentFromPool && currentPoolId) {
          this.pool.releaseAgent(currentPoolId, true);
        } else {
          await currentRuntime.destroy();
        }

        const contextSummary = this.context.toSummary();
        const enrichedInput = contextSummary
          ? `${task.input}\n\n---\n## 来自之前分析的共享上下文\n${contextSummary}`
          : task.input;

        const { runtime: nextRuntime, poolId: nextPoolId } = await this.pool.acquireAgent(
          targetRole,
          this.buildRoleTools(targetRole.id, roles)
        );

        currentRuntime = nextRuntime;
        currentPoolId = nextPoolId;
        isCurrentFromPool = true;
        currentRoleId = handoffTarget;
        currentInput = enrichedInput;
      }

      this.state.status = 'completed';
      this.state.completedAt = Date.now();
      this.state.progress = 100;
      this.monitor.completeExecution(true);
      this.context.addProgressNote('任务处理完成', 'system');

      const routerStats = this.router.getStats();
      const rolesUsed = this.router.getCurrentChain();

      // 🆕 质量闭环
      let improvedOutput = finalOutput;
      if (this.config.qualityLoop?.enabled && this.aggregator && this.validator && this.repairer) {
        improvedOutput = await this.runQualityLoop(task, finalOutput, rolesUsed);
      }

      this.emit({
        type: 'complete',
        data: { output: improvedOutput, handoffCount: routerStats.totalHandoffs, rolesUsed }
      });

      return {
        output: improvedOutput,
        state: { ...this.state },
        rolesUsed,
        handoffCount: routerStats.totalHandoffs,
        roleOutputs,
        duration: Date.now() - startTime
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.state.status = 'failed';
      this.state.error = errorMessage;
      this.state.completedAt = Date.now();
      this.monitor.completeExecution(false, errorMessage);
      this.context.addProgressNote(`任务处理失败: ${errorMessage}`, 'system');
      this.emit({ type: 'error', data: { message: errorMessage } });
      log.error('Coordination failed', error);

      return {
        output: `处理失败: ${errorMessage}`,
        state: { ...this.state },
        rolesUsed: this.router.getCurrentChain(),
        handoffCount: this.router.getStats().totalHandoffs,
        duration: Date.now() - startTime
      };
    }
  }

  // ========== 并行执行 ==========

  async coordinateParallel(task: SwarmTask, subTasks: SwarmSubTask[]): Promise<CoordinationResult> {
    const startTime = Date.now();
    this.state.status = 'executing';
    this.state.startedAt = startTime;
    this.router.resetChain();
    this.monitor.startExecution(task.id);

    this.setupContext(task);
    this.context.set('execution_mode', 'parallel', 'system');

    try {
      const runtimes = new Map<string, AgentRuntime>();
      const acquiredPoolIds: string[] = [];
      const roleIds = [...new Set(subTasks.map((t) => t.roleId))];

      for (const roleId of roleIds) {
        const role = this.roleRegistry.getRole(roleId);
        if (!role) continue;
        const { runtime, poolId } = await this.pool.acquireAgent(role);
        runtimes.set(roleId, runtime);
        acquiredPoolIds.push(poolId);
      }

      try {
        const parallelResult = await this.concurrency.executeParallel(subTasks, runtimes);

        // 释放所有已获取的 Agent
        for (const poolId of acquiredPoolIds) {
          this.pool.releaseAgent(poolId, true);
        }

        this.updateState({
          status: 'completed',
          completedAt: Date.now(),
          progress: 100
        });
        this.monitor.completeExecution(true);

        return {
          output: parallelResult.aggregatedOutput,
          state: { ...this.state },
          rolesUsed: [...new Set(parallelResult.results.map((r) => r.roleId))],
          handoffCount: 0,
          duration: Date.now() - startTime
        };
      } catch (error) {
        // 执行阶段失败，释放资源
        for (const poolId of acquiredPoolIds) {
          this.pool.releaseAgent(poolId, false);
        }
        throw error;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateState({
        status: 'failed',
        error: errorMessage,
        completedAt: Date.now()
      });
      this.monitor.completeExecution(false, errorMessage);

      return {
        output: `并行执行失败: ${errorMessage}`,
        state: { ...this.state },
        rolesUsed: [],
        handoffCount: 0,
        duration: Date.now() - startTime
      };
    }
  }

  // ========== 混合执行 ==========

  async coordinateHybrid(task: SwarmTask): Promise<CoordinationResult> {
    if (this.detectDiscussionIntent(task.input)) {
      return this.coordinateDiscussion(task);
    }

    const needsParallel = this.detectParallelIntent(task.input);

    if (needsParallel) {
      const subTasks = await this.decomposeTask(task);
      if (subTasks.length > 1) {
        return this.coordinateParallel(task, subTasks);
      }
    }

    return this.coordinate(task);
  }

  // ========== 讨论模式 ==========

  /**
   * 发起多智能体讨论
   *
   * 让多个 Agent 围绕一个话题轮流发言，通过主持人评估共识，最终生成结论。
   */
  async coordinateDiscussion(
    task: SwarmTask,
    discussionConfig?: Partial<import('./DiscussionCoordinator').DiscussionConfig>
  ): Promise<CoordinationResult> {
    const startTime = Date.now();
    this.state.status = 'executing';
    this.state.startedAt = startTime;

    this.setupContext(task);
    this.context.set('execution_mode', 'discussion', 'system');

    try {
      const { DiscussionCoordinator } = await import('./DiscussionCoordinator');

      const participantRoleIds = discussionConfig?.participantRoleIds?.length
        ? discussionConfig.participantRoleIds
        : this.getAvailableRoles().map((r) => r.id);

      const coordinator = new DiscussionCoordinator(this.config, {
        ...discussionConfig,
        participantRoleIds
      });

      for (const role of this.getAvailableRoles()) {
        coordinator.registerRole(role);
      }

      coordinator.setOnEvent((event: import('./DiscussionCoordinator').DiscussionEvent) => {
        switch (event.type) {
          case 'discussion:start':
            this.emit({
              type: 'agent:start',
              data: { roleId: 'moderator', input: `讨论: ${event.data.topic}` }
            });
            break;
          case 'discussion:turn':
            this.emit({
              type: 'discussion:turn',
              data: event.data
            });
            break;
          case 'discussion:consensus_check':
            this.emit({
              type: 'discussion:consensus',
              data: {
                round: event.data.round,
                reached: event.data.reached,
                score: event.data.score,
                conclusion: event.data.reached ? undefined : undefined
              }
            });
            break;
          case 'discussion:done':
            this.emit({
              type: 'complete',
              data: {
                output: `讨论完成 (${event.data.totalRounds} 轮)`,
                handoffCount: 0,
                rolesUsed: participantRoleIds
              }
            });
            break;
        }
      });

      const result = await coordinator.discuss(task);

      await this.updateState({
        status: 'completed',
        completedAt: Date.now(),
        progress: 100
      });
      this.monitor.completeExecution(true);

      await coordinator.destroy();

      return {
        output: result.conclusion,
        state: { ...this.state },
        rolesUsed: result.participantRoles,
        handoffCount: 0,
        duration: Date.now() - startTime
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.updateState({
        status: 'failed',
        error: errorMessage,
        completedAt: Date.now()
      });
      this.monitor.completeExecution(false, errorMessage);

      return {
        output: `讨论失败: ${errorMessage}`,
        state: { ...this.state },
        rolesUsed: [],
        handoffCount: 0,
        duration: Date.now() - startTime
      };
    }
  }

  // ========== 内部方法 ==========

  /** 线程安全地更新内部状态 */
  private async updateState(updates: Partial<SwarmState>): Promise<void> {
    await this.stateLock.run(async () => {
      Object.assign(this.state, updates);
    });
  }

  /**
   * 从执行结果中检测 Handoff 信号
   *
   * Agent 调用 transfer_to_XXX 工具后，工具返回 HANDOFF_SIGNAL_PREFIX + roleId，
   * 这个信号会出现在 result.output 或 toolCalls 的结果中。
   */
  private detectHandoff(result: import('../runtime/types').ExecutionResult): string | null {
    if (result.toolCalls) {
      for (const tc of result.toolCalls) {
        if (tc.toolName.startsWith('transfer_to_')) {
          const roleId = tc.toolName.replace('transfer_to_', '');
          return roleId;
        }
        if (typeof tc.result === 'string') {
          const target = extractHandoffTarget(tc.result);
          if (target) return target;
        }
        if (tc.result && typeof tc.result === 'object') {
          const r = tc.result as Record<string, unknown>;
          if (typeof r.llmContent === 'string') {
            const target = extractHandoffTarget(r.llmContent);
            if (target) return target;
          }
        }
      }
    }

    if (result.output) {
      const target = extractHandoffTarget(result.output);
      if (target) return target;
    }

    return null;
  }

  /**
   * 创建 Triage Agent 运行时
   */
  private async createTriageRuntime(roles: AgentRole[]): Promise<AgentRuntime> {
    const { agentExecutor } = await import('../AgentExecutor');
    const sessionId = this.config.parentSessionId
      ? `${this.config.parentSessionId}:triage`
      : `triage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const rolesDescription = roles.map((r) => `- **${r.name}** (${r.id}): ${r.description}`).join('\n');

    const instructions = `${TRIAGE_INSTRUCTIONS}\n\n## 可用专家\n\n${rolesDescription}\n\n${this.config.triageInstructions || ''}`;

    const allTools: ToolDefinition[] = [...createSwarmTools(this.context, this.messageBus, 'triage', roles)];

    const builder = agentExecutor
      .piMono()
      .name('SwarmTriage')
      .mode('agent')
      .sessionMode('file')
      .instructions(instructions)
      .sessionId(sessionId);

    if (this.config.triageModel) {
      builder.model(this.config.triageModel);
    }

    builder.tools(allTools);

    // 注入执行协议、Skill 发现提示、运行时路径
    await injectEnv(sessionId, builder);

    return await builder.build();
  }

  /**
   * 创建角色 Agent 运行时
   */
  private async createRoleRuntime(
    role: AgentRole,
    sessionId: string,
    extraTools?: ToolDefinition[]
  ): Promise<AgentRuntime> {
    const { agentExecutor } = await import('../AgentExecutor');

    const specialistInstructions = this.buildSpecialistInstructions(role);

    const builder = agentExecutor
      .piMono()
      .name(`${role.name} (Swarm)`)
      .mode('agent')
      .sessionMode('file')
      .instructions(specialistInstructions)
      .sessionId(sessionId);

    if (role.model) {
      builder.model(role.model);
    }

    const allTools = [...(role.tools || []), ...(extraTools || [])];
    if (allTools.length > 0) {
      builder.tools(allTools);
    }

    // 注入执行协议、Skill 发现提示、运行时路径
    await injectEnv(sessionId, builder);

    return await builder.build();
  }

  private buildRoleTools(roleId: string, allRoles: AgentRole[]): ToolDefinition[] {
    return createSwarmTools(this.context, this.messageBus, roleId, allRoles);
  }

  private buildSpecialistInstructions(role: AgentRole): string {
    // 🆕 构建共享上下文摘要（如果有知识库）
    const contextSection = this.knowledgeBase
      ? `\n## Swarm 协作上下文\n\n以下是其他 Agent 的最近活动和决策：\n\n${this.knowledgeBase.buildSummary(10)}\n\n请基于以上信息工作。如有疑问，可以使用通信工具查询详细信息。\n`
      : '';

    return `${role.instructions}

## 协作说明

你是 Swarm 协作系统中的专家成员（角色: ${role.id}）。
${contextSection}
### 通信工具
你拥有以下通信工具来与其他专家协作：
- **read_shared_context**: 读取共享上下文中其他专家留下的信息
- **write_shared_context**: 将你的分析结果、中间状态写入共享上下文
- **add_artifact**: 添加你产出的中间产物（代码、文档等）
- **get_artifact**: 获取其他专家产出的产物
- **send_message**: 向其他专家发送消息
- **get_messages**: 查看收到的消息
- **report_progress**: 上报当前进度

### Handoff（交接）
如果你的任务超出自身能力范围，可以使用 transfer_to_xxx 工具将任务交接给其他专家。

### 工作流程
1. 开始工作前，先用 read_shared_context 查看共享上下文
2. 工作过程中，用 report_progress 上报进度
3. 产出中间结果时，用 add_artifact 或 write_shared_context 存储
4. 需要其他专家协助时，使用 transfer_to_xxx 工具交接
5. 最终结果直接给出`;
  }

  private setupContext(task: SwarmTask): void {
    this.context.set('task_id', task.id, 'system');
    this.context.set('task_input', task.input, 'system');
    if (task.context) {
      for (const [key, value] of Object.entries(task.context)) {
        this.context.set(key, value, 'system');
      }
    }
    this.context.addProgressNote('任务开始处理', 'triage');
  }

  private detectDiscussionIntent(input: string): boolean {
    const keywords = [
      '讨论',
      '辩论',
      '商议',
      '探讨',
      '各方意见',
      '多方讨论',
      '集思广益',
      '头脑风暴',
      '圆桌',
      'discuss',
      'debate',
      'brainstorm',
      'deliberate',
      'round-table'
    ];
    const lower = input.toLowerCase();
    return keywords.some((kw) => lower.includes(kw));
  }

  private detectParallelIntent(input: string): boolean {
    const keywords = [
      '同时',
      '并行',
      '一起',
      '分别',
      '各自',
      'simultaneously',
      'parallel',
      'concurrently',
      'at the same time',
      '多个',
      '多方面'
    ];
    const lower = input.toLowerCase();
    return keywords.some((kw) => lower.includes(kw));
  }

  private async decomposeTask(task: SwarmTask): Promise<SwarmSubTask[]> {
    try {
      const { agentExecutor } = await import('../AgentExecutor');
      const sessionId = this.config.parentSessionId
        ? `${this.config.parentSessionId}:decompose`
        : `decompose-${Date.now()}`;
      const roles = this.getAvailableRoles();

      const builder = agentExecutor
        .piMono()
        .name('TaskDecomposer')
        .mode('chat')
        .sessionMode('file')
        .instructions(
          `你是一个任务分解专家。分析用户需求，将其拆分为可以并行执行的子任务。

返回 JSON 数组格式：
[
  { "id": "subtask-1", "input": "子任务描述", "roleId": "角色ID", "dependencies": [] },
  { "id": "subtask-2", "input": "子任务描述", "roleId": "角色ID", "dependencies": ["subtask-1"] }
]

可用角色: ${roles.map((r) => `${r.id}(${r.name})`).join(', ')}

规则：
- 独立的子任务不需要 dependencies
- 有前后依赖的子任务需要在 dependencies 中指定
- roleId 必须是可用角色中的一个`
        )
        .sessionId(sessionId);

      if (this.config.triageModel) {
        builder.model(this.config.triageModel);
      }

      const runtime = await builder.build();
      try {
        const result = await runtime.run(task.input);
        const output = result.output || '';
        const jsonMatch = output.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>;
          return parsed.map((item) => ({
            id: String(item.id || `subtask-${Date.now()}`),
            input: String(item.input || ''),
            roleId: String(item.roleId || 'coder'),
            dependencies: Array.isArray(item.dependencies) ? (item.dependencies as string[]) : undefined,
            priority: typeof item.priority === 'number' ? item.priority : undefined
          }));
        }
      } finally {
        await runtime.destroy();
      }
    } catch (error) {
      log.warn('Task decomposition failed', error);
    }
    return [];
  }

  // ========== 角色管理 ==========

  private getAvailableRoles(): AgentRole[] {
    if (this.config.availableRoles?.length) {
      return this.roleRegistry.getRoles(this.config.availableRoles);
    }
    return this.roleRegistry.getAllRoles();
  }

  async registerRole(role: AgentRole): Promise<void> {
    this.roleRegistry.register(role);
    log.info(`Dynamically registered role: ${role.id}`);
  }

  // ========== 状态查询 ==========

  getState(): SwarmState {
    this.state.handoffHistory = this.router.getHistory();
    this.state.currentHandoffDepth = this.router.getCurrentDepth();
    return { ...this.state };
  }

  getAvailableRoleList(): AgentRole[] {
    return this.getAvailableRoles();
  }

  // ========== 监控桥接 ==========

  private setupMonitoringBridge(): void {
    this.pool.addEventListener((event) => {
      if (event.type === 'agent_created') {
        this.monitor.recordPoolEvent('created', event.roleId);
      } else if (event.type === 'agent_retired') {
        this.monitor.recordPoolEvent('retired', event.roleId);
      }
    });

    this.router.setOnHandoff((fromRoleId, toRoleId) => {
      const depth = this.router.getCurrentDepth();
      this.monitor.recordHandoff(fromRoleId, toRoleId, depth);
      this.monitor.detectLoop(this.router.getCurrentChain(), toRoleId);
      this.monitor.detectDepthLimit(depth, this.config.maxHandoffDepth);
    });
  }

  /**
   * 🆕 设置知识库自动记录
   *
   * 监听 SwarmContext 的变更事件，自动记录重要信息到 KnowledgeBase
   */
  private setupKnowledgeBaseRecording(): void {
    if (!this.knowledgeBase) return;

    this.context.addChangeListener((event) => {
      try {
        // 产物创建 → 记录到知识库
        if (event.type === 'artifact_added') {
          const artifact = this.context.getArtifact(event.key);
          this.knowledgeBase!.append({
            type: 'artifact_created',
            name: event.key,
            createdBy: event.roleId,
            artifactType: artifact?.type,
            description: `产物大小: ${artifact?.content?.length || 0} 字符`,
            ts: event.timestamp
          });
        }

        // 重要状态变更 → 记录到知识库
        // 识别关键词：decision, result, conclusion, final
        if (event.type === 'state_set' && this.isImportantState(event.key)) {
          this.knowledgeBase!.append({
            type: 'decision',
            decision: `${event.key} 已设置`,
            madeBy: event.roleId,
            reason: '通过 write_shared_context 设置',
            ts: event.timestamp
          });
        }
      } catch (error) {
        log.error('Failed to record to knowledge base:', error);
      }
    });
  }

  /**
   * 判断是否为重要状态（应该记录到知识库）
   */
  private isImportantState(key: string): boolean {
    const importantKeywords = ['decision', 'result', 'conclusion', 'final', 'status', 'outcome'];
    const lowerKey = key.toLowerCase();
    return importantKeywords.some((keyword) => lowerKey.includes(keyword));
  }

  // ========== 质量闭环 ==========

  /**
   * 运行质量闭环：汇总 → 验证 → 修复（迭代）
   */
  private async runQualityLoop(task: SwarmTask, output: string, _rolesUsed: string[]): Promise<string> {
    if (!this.aggregator || !this.validator || !this.repairer) {
      return output;
    }

    const maxIterations = this.config.qualityLoop?.maxIterations || 3;
    const passThreshold = this.config.qualityLoop?.passThreshold || 70;

    log.info('[SwarmCoordinator] 启动质量闭环，最大迭代次数:', maxIterations);

    let currentOutput = output;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;
      log.info(`[SwarmCoordinator] 质量闭环 - 迭代 ${iteration}/${maxIterations}`);

      // Step 1: 验证
      const validationInput: ValidationInput = {
        userRequest: task.input,
        output: currentOutput,
        acceptanceCriteria: this.config.qualityLoop?.acceptanceCriteria
      };

      const validationResult = await this.validator.validate(validationInput);
      log.info(
        `[SwarmCoordinator] 验证完成: 得分 ${validationResult.overallScore}/100, 通过: ${validationResult.passed}`
      );

      // Step 2: 检查是否通过
      if (validationResult.overallScore >= passThreshold) {
        log.info('[SwarmCoordinator] 输出质量达标，质量闭环结束');
        return currentOutput;
      }

      // Step 3: 生成修复计划
      const repairInput: RepairInput = {
        userRequest: task.input,
        currentOutput,
        validationResult,
        repairRound: iteration
      };

      const repairPlan = await this.repairer.generateRepairPlan(repairInput);
      log.info(`[SwarmCoordinator] 修复策略: ${repairPlan.strategy}, 建议修复: ${repairPlan.shouldRepair}`);

      // Step 4: 根据策略执行修复
      if (!repairPlan.shouldRepair || repairPlan.strategy === 'abort') {
        log.warn('[SwarmCoordinator] 质量闭环中止，返回当前输出');
        return currentOutput;
      }

      if (repairPlan.strategy === 'replan') {
        log.warn('[SwarmCoordinator] 建议重新规划任务，但当前不支持，返回原输出');
        return currentOutput;
      }

      // Step 5: 执行修复（重新生成或修补）
      try {
        currentOutput = await this.applyRepair(currentOutput, repairPlan.repairInstructions, task);
        log.info('[SwarmCoordinator] 修复完成，进入下一轮验证');
      } catch (error) {
        log.error('[SwarmCoordinator] 修复失败:', error);
        return currentOutput;
      }
    }

    log.warn('[SwarmCoordinator] 达到最大迭代次数，返回当前输出');
    return currentOutput;
  }

  /**
   * 应用修复（调用 LLM 优化输出）
   */
  private async applyRepair(currentOutput: string, repairInstructions: string, task: SwarmTask): Promise<string> {
    if (!this.llmService) {
      throw new Error('LLMService not initialized — agentExecutor missing from config');
    }

    const prompt = `你是一个输出优化专家。请根据修复指令改进以下输出。

## 用户原始请求

${task.input}

## 当前输出

${currentOutput}

## 修复指令

${repairInstructions}

## 你的任务

请改进输出，使其符合修复指令的要求。直接输出改进后的内容，不要添加额外说明。`;

    const response = await this.llmService.chat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      maxTokens: 4000
    });

    return response.content.trim();
  }

  // ========== 生命周期 ==========

  reset(): void {
    this.state = createInitialSwarmState();
    this.router.resetChain();
    this.context.clear();
  }

  async destroy(): Promise<void> {
    await this.pool.stop();
    this.router.destroy();
    this.context.destroy();
    this.monitor.destroy();
    this.messageBus.destroy();
    this.concurrency.destroy();
    this.state = createInitialSwarmState();
    log.info('SwarmCoordinator destroyed');
  }
}
