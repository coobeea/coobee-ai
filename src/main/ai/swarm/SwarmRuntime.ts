/**
 * SwarmRuntime - 统一运行时
 *
 * 实现 IExecutable 接口，使 Swarm 与 Agent/Team 运行时对等：
 * - run(): 调用 SwarmCoordinator 完成任务
 * - runStream(): 流式输出支持
 * - 完整的生命周期管理
 * - 会话、记忆、工具、技能管理接口
 */

import { createStreamEmitter, type IStreamEmitter } from '../streaming/StreamEmitter'
import { SwarmCoordinator } from './SwarmCoordinator'
import type { SwarmSubTask } from './ConcurrencyManager'
import type { AgentRole, SwarmConfig } from './types'
import { DEFAULT_SWARM_CONFIG } from './types'
import type {
  IExecutable,
  ExecutionConfig,
  ExecutionResult,
  StreamChunk,
  SessionInfo,
  MemorySummary,
  ToolInfo,
  SkillInfo
} from '../runtime/types'

/**
 * Swarm 运行时创建选项
 */
export interface SwarmRuntimeOptions {
  /** Swarm 配置（可选，使用默认值填充） */
  config?: Partial<SwarmConfig>
  /** 自定义角色列表 */
  customRoles?: AgentRole[]
}

/**
 * Swarm 运行时
 */
export class SwarmRuntime implements IExecutable {
  readonly type = 'swarm' as const
  readonly id: string
  private _name: string

  private sessionId: string
  private coordinator: SwarmCoordinator
  private swarmConfig: SwarmConfig
  private streamEmitter!: IStreamEmitter
  private taskCounter = 0
  private createdAt = Date.now()

  constructor(swarmId: string, sessionId?: string, options?: SwarmRuntimeOptions) {
    this.id = swarmId
    this.sessionId = sessionId || `swarm-session-${Date.now()}`

    // 合并配置
    this.swarmConfig = {
      ...DEFAULT_SWARM_CONFIG,
      id: swarmId,
      name: options?.config?.name || `Swarm-${swarmId}`,
      ...options?.config
    } as SwarmConfig

    this._name = this.swarmConfig.name

    // 创建协调器
    this.coordinator = new SwarmCoordinator(this.swarmConfig)
  }

  get name(): string {
    return this._name
  }

  // ========== 生命周期 ==========

  async initialize(): Promise<void> {
    // 1. 初始化协调器（会创建 Triage Agent 和专家 Agent）
    await this.coordinator.initialize()

    // 2. 创建流式发射器
    this.streamEmitter = createStreamEmitter(this.sessionId, {
      type: 'swarm',
      id: this.id,
      name: this.name
    })

    console.log(`[SwarmRuntime] Initialized: ${this.name} (session: ${this.sessionId})`)
  }

  async destroy(): Promise<void> {
    this.coordinator.destroy()
    console.log(`[SwarmRuntime] Destroyed: ${this.name}`)
  }

  // ========== 执行方法 ==========

  async run(input: string, config?: ExecutionConfig): Promise<ExecutionResult> {
    const startTime = Date.now()
    this.taskCounter++

    const taskId = `task-${this.taskCounter}-${Date.now().toString(36)}`
    const executionMode = (config?.executionMode as string) || 'auto'

    console.log(
      `[SwarmRuntime] Running task ${taskId} (mode: ${executionMode}): ${input.substring(0, 100)}...`
    )

    try {
      const task = {
        id: taskId,
        input,
        context: config?.context as Record<string, unknown> | undefined,
        constraints: config?.constraints as string[] | undefined,
        createdAt: Date.now()
      }

      // 根据执行模式选择协调方式
      let result
      if (executionMode === 'parallel' && config?.subTasks) {
        // 显式并行模式
        result = await this.coordinator.coordinateParallel(task, config.subTasks as SwarmSubTask[])
      } else if (executionMode === 'hybrid' || executionMode === 'auto') {
        // 混合模式（自动判断是否需要并行）
        result = await this.coordinator.coordinateHybrid(task)
      } else {
        // 默认串行 handoff 模式
        result = await this.coordinator.coordinate(task)
      }

      const duration = Date.now() - startTime

      return {
        output: result.output,
        toolCalls: [],
        skillsUsed: result.rolesUsed,
        duration,
        metadata: {
          swarmId: this.id,
          sessionId: this.sessionId,
          taskId,
          executionMode,
          handoffCount: result.handoffCount,
          rolesUsed: result.rolesUsed,
          swarmState: result.state.status
        }
      }
    } catch (error: unknown) {
      console.error(`[SwarmRuntime] Task ${taskId} failed:`, error)
      throw error
    }
  }

  async runStream(
    input: string,
    config: ExecutionConfig,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult> {
    const startTime = Date.now()
    this.taskCounter++

    const taskId = `task-${this.taskCounter}-${Date.now().toString(36)}`

    console.log(`[SwarmRuntime] Running task ${taskId} in stream mode`)

    try {
      // 1. 发送流开始事件
      await this.streamEmitter.emitStart()

      // 2. 发送思考消息
      await this.streamEmitter.emitThinking(`分诊中: ${input.substring(0, 50)}...`)

      onChunk({
        type: 'text',
        content: '[Swarm] 正在分析任务需求...\n'
      })

      // 3. 执行协调
      const result = await this.coordinator.coordinate({
        id: taskId,
        input,
        context: config?.context as Record<string, unknown> | undefined,
        constraints: config?.constraints as string[] | undefined,
        createdAt: Date.now()
      })

      // 4. 发送结果
      await this.streamEmitter.emitText(result.output)

      onChunk({
        type: 'text',
        content: result.output
      })

      // 5. 发送元信息
      if (result.rolesUsed.length > 0) {
        const metaInfo = `\n\n---\n[Swarm] 使用专家: ${result.rolesUsed.join(' -> ')} | Handoff: ${result.handoffCount}次 | 耗时: ${result.duration}ms`
        onChunk({
          type: 'text',
          content: metaInfo
        })
      }

      // 6. 发送完成事件
      await this.streamEmitter.emitDone()

      onChunk({
        type: 'done',
        content: ''
      })

      const duration = Date.now() - startTime

      return {
        output: result.output,
        toolCalls: [],
        skillsUsed: result.rolesUsed,
        duration,
        metadata: {
          swarmId: this.id,
          sessionId: this.sessionId,
          taskId,
          handoffCount: result.handoffCount,
          rolesUsed: result.rolesUsed,
          swarmState: result.state.status
        }
      }
    } catch (error: unknown) {
      await this.streamEmitter.emitError(error instanceof Error ? error : new Error(String(error)))

      onChunk({
        type: 'error',
        content: error instanceof Error ? error.message : String(error)
      })

      console.error(`[SwarmRuntime] Task ${taskId} failed:`, error)
      throw error
    }
  }

  // ========== 角色管理（Swarm 特有） ==========

  /**
   * 动态注册新角色
   */
  async registerRole(role: AgentRole): Promise<void> {
    await this.coordinator.registerRole(role)
    console.log(`[SwarmRuntime] Registered new role: ${role.id}`)
  }

  /**
   * 获取可用角色列表
   */
  getAvailableRoles(): AgentRole[] {
    return this.coordinator.getAvailableRoleList()
  }

  /**
   * 获取 Swarm 执行指标
   */
  getMetrics(): ReturnType<typeof this.coordinator.monitor.getMetrics> {
    return this.coordinator.monitor.getMetrics()
  }

  /**
   * 获取 Agent 池统计
   */
  getPoolStats(): ReturnType<typeof this.coordinator.pool.getStats> {
    return this.coordinator.pool.getStats()
  }

  /**
   * 获取 Handoff 统计
   */
  getHandoffStats(): ReturnType<typeof this.coordinator.router.getStats> {
    return this.coordinator.router.getStats()
  }

  /**
   * 获取共享上下文摘要
   */
  getContextSummary(): string {
    return this.coordinator.context.toSummary()
  }

  /**
   * 获取消息总线统计
   */
  getMessageStats(): ReturnType<typeof this.coordinator.messageBus.getStats> {
    return this.coordinator.messageBus.getStats()
  }

  /**
   * 获取并发管理器状态
   */
  getConcurrencyStatus(): { running: number; atCapacity: boolean } {
    return {
      running: this.coordinator.concurrency.getRunningCount(),
      atCapacity: this.coordinator.concurrency.isAtCapacity()
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
    }
  }

  async clearSession(): Promise<void> {
    this.coordinator.reset()
    this.taskCounter = 0
    console.log(`[SwarmRuntime] Session cleared: ${this.sessionId}`)
  }

  // ========== 记忆管理 ==========

  async getMemory(): Promise<MemorySummary> {
    const contextData = this.coordinator.context.export()
    return {
      shortTermCount: Object.keys(contextData.state).length,
      longTermCount: contextData.artifacts.length,
      recentKeyPoints: this.coordinator.context.getRecentProgress(5)
    }
  }

  async saveMemory(): Promise<void> {
    // 共享上下文在执行过程中自动管理
    console.log(`[SwarmRuntime] Memory persisted for session: ${this.sessionId}`)
  }

  async clearMemory(): Promise<void> {
    this.coordinator.context.clear()
    console.log(`[SwarmRuntime] Memory cleared for session: ${this.sessionId}`)
  }

  // ========== 工具管理 ==========

  getTools(): ToolInfo[] {
    // Swarm 的工具由各专家 Agent 自行管理
    // 这里返回一个概览
    return [
      {
        name: 'swarm_handoff',
        description: '自动将任务交接给最合适的专家',
        enabled: true
      },
      {
        name: 'shared_context',
        description: '在 Agent 之间共享状态和产物',
        enabled: this.swarmConfig.enableSharedContext
      }
    ]
  }

  setToolEnabled(toolName: string, enabled: boolean): void {
    if (toolName === 'shared_context') {
      // 运行时修改配置不影响已创建的实例，仅记录日志
      console.log(`[SwarmRuntime] Shared context ${enabled ? 'enabled' : 'disabled'}`)
    }
  }

  // ========== 技能管理 ==========

  getSkills(): SkillInfo[] {
    // Swarm 的"技能"对应可用角色
    return this.coordinator.getAvailableRoleList().map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      active: true
    }))
  }

  setSkillActive(skillId: string, _active: boolean): void {
    // 在 Swarm 中，技能对应角色。
    // 动态启用/禁用角色的能力在 coordinator 的 config.availableRoles 中管理
    console.log(
      `[SwarmRuntime] Role ${skillId} activation change requested — rebuild Swarm to apply`
    )
  }
}
