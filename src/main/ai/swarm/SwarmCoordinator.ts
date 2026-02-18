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
import type { AgentRole, SwarmConfig, SwarmState, SwarmTask } from './types';
import { createInitialSwarmState, extractHandoffTarget } from './types';
import { AgentPool } from './AgentPool';
import { HandoffRouter } from './HandoffRouter';
import { SwarmContext } from './SwarmContext';
import { SwarmMonitor } from './SwarmMonitor';
import { MessageBus } from './MessageBus';
import { ConcurrencyManager, type SwarmSubTask } from './ConcurrencyManager';
import { createSwarmTools } from './tools';
import { RoleRegistry } from './roles';

const log = createLogger('swarm:coordinator');

// ========== 事件系统 ==========

export type SwarmEvent =
  | { type: 'triage:start'; data: { taskId: string; input: string } }
  | { type: 'triage:done'; data: { targetRole?: string } }
  | { type: 'handoff'; data: { from: string; to: string; depth: number; reason?: string } }
  | { type: 'agent:start'; data: { roleId: string; input: string } }
  | { type: 'agent:done'; data: { roleId: string; output: string } }
  | { type: 'complete'; data: { output: string; handoffCount: number; rolesUsed: string[] } }
  | { type: 'error'; data: { message: string } };

export type SwarmEventCallback = (event: SwarmEvent) => void;

// ========== 协调结果 ==========

export interface CoordinationResult {
  output: string;
  state: SwarmState;
  rolesUsed: string[];
  handoffCount: number;
  duration: number;
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

/**
 * Swarm 核心协调器
 */
export class SwarmCoordinator {
  readonly pool: AgentPool;
  readonly router: HandoffRouter;
  readonly context: SwarmContext;
  readonly monitor: SwarmMonitor;
  readonly messageBus: MessageBus;
  readonly concurrency: ConcurrencyManager;
  readonly roleRegistry: RoleRegistry;

  private state: SwarmState = createInitialSwarmState();
  private onEvent: SwarmEventCallback | null = null;

  constructor(private readonly config: SwarmConfig) {
    this.pool = new AgentPool(config);
    this.router = new HandoffRouter(config);
    this.context = new SwarmContext();
    this.monitor = new SwarmMonitor();
    this.messageBus = new MessageBus();
    this.concurrency = new ConcurrencyManager(config);
    this.roleRegistry = new RoleRegistry();

    this.setupMonitoringBridge();
  }

  // ========== 事件 ==========

  setOnEvent(callback: SwarmEventCallback): void {
    this.onEvent = callback;
  }

  private emit(event: SwarmEvent): void {
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
    this.state.status = 'triaging';
    this.state.startedAt = startTime;
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

      this.state.status = 'executing';
      let finalOutput = '';

      for (let depth = 0; depth <= this.config.maxHandoffDepth; depth++) {
        this.emit({
          type: 'agent:start',
          data: { roleId: currentRoleId, input: currentInput.substring(0, 200) }
        });

        const result = await currentRuntime.run(currentInput);
        const output = result.output || '';

        this.emit({ type: 'agent:done', data: { roleId: currentRoleId, output: output.substring(0, 200) } });

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

        await currentRuntime.destroy();

        const contextSummary = this.context.toSummary();
        const enrichedInput = contextSummary
          ? `${task.input}\n\n---\n## 来自之前分析的共享上下文\n${contextSummary}`
          : task.input;

        const { runtime: nextRuntime } = await this.pool.acquireAgent(
          targetRole,
          this.buildRoleTools(targetRole.id, roles)
        );

        currentRuntime = nextRuntime;
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

      this.emit({
        type: 'complete',
        data: { output: finalOutput, handoffCount: routerStats.totalHandoffs, rolesUsed }
      });

      return {
        output: finalOutput,
        state: { ...this.state },
        rolesUsed,
        handoffCount: routerStats.totalHandoffs,
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
      const roleIds = [...new Set(subTasks.map((t) => t.roleId))];

      for (const roleId of roleIds) {
        const role = this.roleRegistry.getRole(roleId);
        if (!role) continue;
        const { runtime } = await this.pool.acquireAgent(role);
        runtimes.set(roleId, runtime);
      }

      const parallelResult = await this.concurrency.executeParallel(subTasks, runtimes);

      this.state.status = 'completed';
      this.state.completedAt = Date.now();
      this.state.progress = 100;
      this.monitor.completeExecution(true);

      return {
        output: parallelResult.aggregatedOutput,
        state: { ...this.state },
        rolesUsed: [...new Set(parallelResult.results.map((r) => r.roleId))],
        handoffCount: 0,
        duration: Date.now() - startTime
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.state.status = 'failed';
      this.state.error = errorMessage;
      this.state.completedAt = Date.now();
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
    const needsParallel = this.detectParallelIntent(task.input);

    if (needsParallel) {
      const subTasks = await this.decomposeTask(task);
      if (subTasks.length > 1) {
        return this.coordinateParallel(task, subTasks);
      }
    }

    return this.coordinate(task);
  }

  // ========== 内部方法 ==========

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
    const sessionId = `triage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const rolesDescription = roles.map((r) => `- **${r.name}** (${r.id}): ${r.description}`).join('\n');

    const instructions = `${TRIAGE_INSTRUCTIONS}\n\n## 可用专家\n\n${rolesDescription}\n\n${this.config.triageInstructions || ''}`;

    const allTools: ToolDefinition[] = [...createSwarmTools(this.context, this.messageBus, 'triage', roles)];

    const builder = agentExecutor
      .piMono()
      .name('SwarmTriage')
      .mode('chat')
      .sessionMode('memory')
      .instructions(instructions)
      .sessionId(sessionId);

    if (this.config.triageModel) {
      builder.model(this.config.triageModel);
    }

    builder.tools(allTools);

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
      .mode('chat')
      .sessionMode('memory')
      .instructions(specialistInstructions)
      .sessionId(sessionId);

    if (role.model) {
      builder.model(role.model);
    }

    const allTools = [...(role.tools || []), ...(extraTools || [])];
    if (allTools.length > 0) {
      builder.tools(allTools);
    }

    return await builder.build();
  }

  private buildRoleTools(roleId: string, allRoles: AgentRole[]): ToolDefinition[] {
    return createSwarmTools(this.context, this.messageBus, roleId, allRoles);
  }

  private buildSpecialistInstructions(role: AgentRole): string {
    return `${role.instructions}

## 协作说明

你是 Swarm 协作系统中的专家成员（角色: ${role.id}）。

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
      const sessionId = `decompose-${Date.now()}`;
      const roles = this.getAvailableRoles();

      const builder = agentExecutor
        .piMono()
        .name('TaskDecomposer')
        .mode('chat')
        .sessionMode('memory')
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
