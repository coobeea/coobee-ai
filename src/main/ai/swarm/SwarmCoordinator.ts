/**
 * SwarmCoordinator - 核心协调器
 *
 * Swarm 的大脑，负责：
 * - 管理 Triage Agent（分诊路由器）
 * - 根据任务需求动态创建专业 Agent
 * - 通过 Handoff 机制实现 Agent 间自然交接
 * - 监控执行过程和聚合最终结果
 */

import { Agent, run } from '@openai/agents'
import type { AgentRole, SwarmConfig, SwarmState, SwarmTask } from './types'
import { createInitialSwarmState } from './types'
import { AgentPool } from './AgentPool'
import { HandoffRouter } from './HandoffRouter'
import { SwarmContext } from './SwarmContext'
import { SwarmMonitor } from './SwarmMonitor'
import { MessageBus } from './MessageBus'
import { ConcurrencyManager, type SwarmSubTask } from './ConcurrencyManager'
import { createSwarmTools } from './tools'
import { RoleRegistry } from './roles'

/**
 * 协调结果
 */
export interface CoordinationResult {
  /** 最终输出 */
  output: string
  /** Swarm 状态快照 */
  state: SwarmState
  /** 使用的角色列表 */
  rolesUsed: string[]
  /** 总 Handoff 次数 */
  handoffCount: number
  /** 执行耗时（ms） */
  duration: number
}

/**
 * Triage Agent 默认指令
 */
const TRIAGE_INSTRUCTIONS = `你是一个智能任务分诊员（Triage Agent），负责分析用户的需求并将任务交接给最合适的专家。

你的职责：
1. 理解用户的需求和意图
2. 判断需要哪类专家来处理
3. 使用 handoff 工具将任务交接给合适的专家
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
- 交接前，先将任务分析结果写入共享上下文，方便专家参考`

/**
 * Swarm 核心协调器
 */
export class SwarmCoordinator {
  /** Agent 池 */
  readonly pool: AgentPool

  /** Handoff 路由器 */
  readonly router: HandoffRouter

  /** 共享上下文 */
  readonly context: SwarmContext

  /** 执行监控 */
  readonly monitor: SwarmMonitor

  /** 消息总线 */
  readonly messageBus: MessageBus

  /** 并发管理器 */
  readonly concurrency: ConcurrencyManager

  /** 角色注册表 */
  readonly roleRegistry: RoleRegistry

  /** Triage Agent 实例（带 handoff 的 Agent 泛型类型较复杂，使用宽松类型） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private triageAgent: Agent<any, any> | null = null

  /** 当前 Swarm 状态 */
  private state: SwarmState = createInitialSwarmState()

  /** 已创建的专家 Agent 映射（roleId -> Agent） */
  private specialistAgents = new Map<string, Agent>()

  constructor(private readonly config: SwarmConfig) {
    this.pool = new AgentPool(config)
    this.router = new HandoffRouter(config)
    this.context = new SwarmContext()
    this.monitor = new SwarmMonitor()
    this.messageBus = new MessageBus()
    this.concurrency = new ConcurrencyManager(config)
    this.roleRegistry = new RoleRegistry()

    this.setupMonitoringBridge()
  }

  // ========== 初始化 ==========

  /**
   * 初始化协调器
   * 创建 Triage Agent 和所有可用的专家 Agent
   */
  async initialize(): Promise<void> {
    // 启动 Agent 池
    this.pool.start()

    // 获取可用角色
    const roles = this.getAvailableRoles()

    // 为每个角色创建专家 Agent，注入通信工具
    for (const role of roles) {
      const commTools = createSwarmTools(this.context, this.messageBus, role.id)
      const allTools = [...(role.tools || []), ...commTools]

      const specialistAgent = new Agent({
        name: role.name,
        instructions: this.buildSpecialistInstructions(role),
        model: role.model || 'gpt-4o',
        tools: allTools,
        handoffDescription: role.handoffDescription
      })

      this.specialistAgents.set(role.id, specialistAgent)
    }

    // 创建 Triage Agent（带 handoff 配置 + 通信工具）
    this.triageAgent = this.buildTriageAgent(roles)

    console.log(
      `[SwarmCoordinator] Initialized with ${roles.length} roles:`,
      roles.map((r) => r.id)
    )
  }

  // ========== 核心执行 ==========

  /**
   * 协调执行任务
   * @param task Swarm 任务
   * @returns 协调结果
   */
  async coordinate(task: SwarmTask): Promise<CoordinationResult> {
    if (!this.triageAgent) {
      throw new Error('[SwarmCoordinator] Not initialized. Call initialize() first.')
    }

    const startTime = Date.now()

    // 更新状态
    this.state.status = 'triaging'
    this.state.startedAt = startTime

    // 重置路由链
    this.router.resetChain()

    // 开始监控
    this.monitor.startExecution(task.id)

    // 设置共享上下文
    this.context.set('task_id', task.id, 'system')
    this.context.set('task_input', task.input, 'system')
    if (task.context) {
      for (const [key, value] of Object.entries(task.context)) {
        this.context.set(key, value, 'system')
      }
    }
    this.context.addProgressNote('任务开始处理', 'triage')

    try {
      // 执行 Triage Agent（SDK 的 run 会自动处理 handoff 链）
      this.state.status = 'executing'

      const result = await run(this.triageAgent, task.input, { maxTurns: 25 })

      // 提取最终输出
      const output = result.finalOutput || ''

      // 更新状态
      this.state.status = 'completed'
      this.state.completedAt = Date.now()
      this.state.progress = 100

      // 获取路由统计
      const routerStats = this.router.getStats()

      // 完成监控
      this.monitor.completeExecution(true)

      this.context.addProgressNote('任务处理完成', 'system')

      const duration = Date.now() - startTime

      return {
        output,
        state: { ...this.state },
        rolesUsed: this.router.getCurrentChain(),
        handoffCount: routerStats.totalHandoffs,
        duration
      }
    } catch (error) {
      // 错误处理
      const errorMessage = error instanceof Error ? error.message : String(error)

      this.state.status = 'failed'
      this.state.error = errorMessage
      this.state.completedAt = Date.now()

      this.monitor.completeExecution(false, errorMessage)
      this.context.addProgressNote(`任务处理失败: ${errorMessage}`, 'system')

      console.error('[SwarmCoordinator] Coordination failed:', error)

      const duration = Date.now() - startTime

      return {
        output: `处理失败: ${errorMessage}`,
        state: { ...this.state },
        rolesUsed: this.router.getCurrentChain(),
        handoffCount: this.router.getStats().totalHandoffs,
        duration
      }
    }
  }

  // ========== 并行执行 ==========

  /**
   * 并行协调执行：将任务拆分为多个子任务并行处理
   *
   * 适用于可以明确拆分的复合任务，如：
   * - "同时搜索 A 和 B 的信息"
   * - "前端和后端同时开发"
   * - "代码编写 + 文档编写同时进行"
   *
   * @param task 主任务
   * @param subTasks 子任务定义列表
   * @returns 协调结果
   */
  async coordinateParallel(task: SwarmTask, subTasks: SwarmSubTask[]): Promise<CoordinationResult> {
    if (!this.triageAgent) {
      throw new Error('[SwarmCoordinator] Not initialized. Call initialize() first.')
    }

    const startTime = Date.now()

    this.state.status = 'executing'
    this.state.startedAt = startTime
    this.router.resetChain()
    this.monitor.startExecution(task.id)

    // 设置共享上下文
    this.context.set('task_id', task.id, 'system')
    this.context.set('task_input', task.input, 'system')
    this.context.set('execution_mode', 'parallel', 'system')
    this.context.addProgressNote(`并行执行开始，共 ${subTasks.length} 个子任务`, 'system')

    try {
      // 并行执行
      const parallelResult = await this.concurrency.executeParallel(subTasks, this.specialistAgents)

      // 更新状态
      this.state.status = 'completed'
      this.state.completedAt = Date.now()
      this.state.progress = 100

      this.monitor.completeExecution(true)
      this.context.addProgressNote(
        `并行执行完成: 成功 ${parallelResult.successCount}/${subTasks.length}`,
        'system'
      )

      const duration = Date.now() - startTime

      return {
        output: parallelResult.aggregatedOutput,
        state: { ...this.state },
        rolesUsed: [...new Set(parallelResult.results.map((r) => r.roleId))],
        handoffCount: 0,
        duration
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.state.status = 'failed'
      this.state.error = errorMessage
      this.state.completedAt = Date.now()

      this.monitor.completeExecution(false, errorMessage)
      this.context.addProgressNote(`并行执行失败: ${errorMessage}`, 'system')

      const duration = Date.now() - startTime

      return {
        output: `并行执行失败: ${errorMessage}`,
        state: { ...this.state },
        rolesUsed: [],
        handoffCount: 0,
        duration
      }
    }
  }

  /**
   * 混合协调执行：先由 Triage 分析，然后将可并行的部分并行执行
   *
   * 结合 handoff（串行分诊）和 parallel（并行执行）两种模式。
   * Triage Agent 分析任务后决定：
   * - 简单任务 → 直接 handoff 给单个专家
   * - 复合任务 → 拆分子任务后并行执行
   *
   * @param task 主任务
   * @returns 协调结果
   */
  async coordinateHybrid(task: SwarmTask): Promise<CoordinationResult> {
    // 第一步：使用 Triage 分析是否需要并行
    // 目前使用简单的 Triage → 如果任务中有明确的并行关键词则走并行路径
    // 未来可以让 Triage Agent 自行决定

    const needsParallel = this.detectParallelIntent(task.input)

    if (needsParallel) {
      // 让 Triage Agent 分解任务
      const subTasks = await this.decomposeTask(task)
      if (subTasks.length > 1) {
        return this.coordinateParallel(task, subTasks)
      }
    }

    // 默认走串行 handoff 路径
    return this.coordinate(task)
  }

  /**
   * 检测输入是否暗示需要并行处理
   */
  private detectParallelIntent(input: string): boolean {
    const parallelKeywords = [
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
    ]
    const lowerInput = input.toLowerCase()
    return parallelKeywords.some((kw) => lowerInput.includes(kw))
  }

  /**
   * 将任务分解为子任务（通过 Triage Agent）
   */
  private async decomposeTask(task: SwarmTask): Promise<SwarmSubTask[]> {
    if (!this.triageAgent) {
      return []
    }

    try {
      const decomposerAgent = new Agent({
        name: 'TaskDecomposer',
        instructions: `你是一个任务分解专家。分析用户需求，将其拆分为可以并行执行的子任务。

返回 JSON 数组格式：
[
  { "id": "subtask-1", "input": "子任务描述", "roleId": "角色ID", "dependencies": [] },
  { "id": "subtask-2", "input": "子任务描述", "roleId": "角色ID", "dependencies": ["subtask-1"] }
]

可用角色: ${this.getAvailableRoles()
          .map((r) => `${r.id}(${r.name})`)
          .join(', ')}

规则：
- 独立的子任务不需要 dependencies
- 有前后依赖的子任务需要在 dependencies 中指定
- roleId 必须是可用角色中的一个`,
        model: this.config.triageModel || 'gpt-4o'
      })

      const result = await run(decomposerAgent, task.input, { maxTurns: 10 })
      const output = result.finalOutput || ''

      // 尝试解析 JSON
      const jsonMatch = output.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>
        return parsed.map((item) => ({
          id: String(item.id || `subtask-${Date.now()}`),
          input: String(item.input || ''),
          roleId: String(item.roleId || 'coder'),
          dependencies: Array.isArray(item.dependencies)
            ? (item.dependencies as string[])
            : undefined,
          priority: typeof item.priority === 'number' ? item.priority : undefined
        }))
      }
    } catch (error) {
      console.warn('[SwarmCoordinator] Task decomposition failed:', error)
    }

    return []
  }

  // ========== Triage Agent 构建 ==========

  /**
   * 构建 Triage Agent
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildTriageAgent(roles: AgentRole[]): Agent<any, any> {
    // 构建角色描述（帮助 Triage 做出正确判断）
    const rolesDescription = roles
      .map((r) => `- **${r.name}** (${r.id}): ${r.description}`)
      .join('\n')

    // 合并指令
    const instructions = `${TRIAGE_INSTRUCTIONS}

## 可用专家

${rolesDescription}

${this.config.triageInstructions || ''}`

    // 构建 handoff 配置
    const handoffs = this.router.buildTriageHandoffs(
      this.specialistAgents,
      new Map(roles.map((r) => [r.id, r]))
    )

    // Triage Agent 的通信工具（可读取共享上下文和消息）
    const triageCommTools = createSwarmTools(this.context, this.messageBus, 'triage')

    // 创建 Triage Agent
    const triageAgent = Agent.create({
      name: 'SwarmTriage',
      instructions,
      model: this.config.triageModel || 'gpt-4o',
      tools: triageCommTools,
      handoffs
    })

    return triageAgent
  }

  /**
   * 构建专家 Agent 的指令（追加共享上下文说明）
   */
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
- **send_message**: 向其他专家发送消息（请求帮助、通知进度等）
- **get_messages**: 查看收到的消息
- **report_progress**: 上报当前进度

### 工作流程
1. 开始工作前，先用 read_shared_context 查看共享上下文和 get_messages 查看消息
2. 工作过程中，用 report_progress 上报进度
3. 产出中间结果时，用 add_artifact 或 write_shared_context 存储
4. 需要其他专家协助时，用 send_message 沟通或使用 handoff 工具交接
5. 最终结果直接给出`
  }

  // ========== 角色管理 ==========

  /**
   * 获取当前可用的角色列表
   */
  private getAvailableRoles(): AgentRole[] {
    if (this.config.availableRoles && this.config.availableRoles.length > 0) {
      return this.roleRegistry.getRoles(this.config.availableRoles)
    }
    return this.roleRegistry.getAllRoles()
  }

  /**
   * 动态注册新角色
   * 如果 Swarm 已初始化，会重新构建 Triage Agent 的 handoff 配置
   */
  async registerRole(role: AgentRole): Promise<void> {
    this.roleRegistry.register(role)

    // 如果已初始化，重新构建专家 Agent 和 Triage
    if (this.triageAgent) {
      const commTools = createSwarmTools(this.context, this.messageBus, role.id)
      const allTools = [...(role.tools || []), ...commTools]

      const specialistAgent = new Agent({
        name: role.name,
        instructions: this.buildSpecialistInstructions(role),
        model: role.model || 'gpt-4o',
        tools: allTools,
        handoffDescription: role.handoffDescription
      })

      this.specialistAgents.set(role.id, specialistAgent)

      // 重建 Triage Agent
      const roles = this.getAvailableRoles()
      this.triageAgent = this.buildTriageAgent(roles)

      console.log(`[SwarmCoordinator] Dynamically registered role: ${role.id}`)
    }
  }

  // ========== 状态查询 ==========

  /**
   * 获取当前 Swarm 状态
   */
  getState(): SwarmState {
    // 更新活跃 Agent 列表
    this.state.activeAgents = []

    for (const [roleId] of this.specialistAgents) {
      const agents = this.pool.getAgentsByRole(roleId)
      for (const entry of agents) {
        this.state.activeAgents.push({
          poolId: entry.poolId,
          roleId: entry.role.id,
          status: entry.status
        })
      }
    }

    this.state.handoffHistory = this.router.getHistory()
    this.state.currentHandoffDepth = this.router.getCurrentDepth()

    return { ...this.state }
  }

  /**
   * 获取可用角色列表
   */
  getAvailableRoleList(): AgentRole[] {
    return this.getAvailableRoles()
  }

  // ========== 监控桥接 ==========

  /**
   * 设置 Monitor 与其他组件的桥接
   */
  private setupMonitoringBridge(): void {
    // Agent 池事件 → Monitor
    this.pool.addEventListener((event) => {
      if (event.type === 'agent_created') {
        this.monitor.recordPoolEvent('created', event.roleId)
      } else if (event.type === 'agent_retired') {
        this.monitor.recordPoolEvent('retired', event.roleId)
      }
    })

    // Handoff 回调 → Monitor
    this.router.setOnHandoff((fromRoleId, toRoleId) => {
      const depth = this.router.getCurrentDepth()
      this.monitor.recordHandoff(fromRoleId, toRoleId, depth)

      // 循环检测
      this.monitor.detectLoop(this.router.getCurrentChain(), toRoleId)

      // 深度限制检测
      this.monitor.detectDepthLimit(depth, this.config.maxHandoffDepth)
    })
  }

  // ========== 生命周期 ==========

  /**
   * 重置协调器状态（用于新任务）
   */
  reset(): void {
    this.state = createInitialSwarmState()
    this.router.resetChain()
    this.context.clear()
  }

  /**
   * 销毁协调器，释放所有资源
   */
  destroy(): void {
    this.pool.stop()
    this.router.destroy()
    this.context.destroy()
    this.monitor.destroy()
    this.messageBus.destroy()
    this.concurrency.destroy()

    this.specialistAgents.clear()
    this.triageAgent = null
    this.state = createInitialSwarmState()

    console.log('[SwarmCoordinator] Destroyed')
  }
}
