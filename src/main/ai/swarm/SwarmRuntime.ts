/**
 * SwarmRuntime - 统一运行时
 *
 * 实现 AgentRuntime 接口，使 Swarm 与 Agent/Team 运行时对等：
 * - stream(): AsyncGenerator 流式输出（主方法）
 * - run(): 便捷方法
 * - 完整的生命周期管理
 * - HITL 接口（预留）
 */

import { log } from '@main/common/logger'
import { AbstractAgentRuntime, generateRuntimeId } from '../runtime/AbstractAgentRuntime'
import { SwarmCoordinator } from './SwarmCoordinator'
import type { SwarmSubTask } from './ConcurrencyManager'
import type { AgentRole, SwarmConfig } from './types'
import { DEFAULT_SWARM_CONFIG } from './types'
import type {
  AgentRuntimeOptions,
  ExecutionConfig,
  ExecutionResult,
  StreamChunk,
  SessionInfo
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
export class SwarmRuntime extends AbstractAgentRuntime {
  readonly type = 'swarm' as const
  readonly id: string
  private _name: string

  private sessionId: string
  private coordinator: SwarmCoordinator
  private swarmConfig: SwarmConfig
  private taskCounter = 0
  private createdAt = Date.now()

  // HITL（Swarm 暂不支持）
  private _interrupted = false

  constructor(swarmId: string, sessionId?: string, options?: SwarmRuntimeOptions) {
    super()
    this.id = swarmId || generateRuntimeId('swarm')
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

  get options(): AgentRuntimeOptions {
    return {
      name: this._name,
      instructions: `Swarm: ${this.swarmConfig.name}`
    }
  }

  get interrupted(): boolean {
    return this._interrupted
  }

  get supportsHITL(): boolean {
    return false
  }

  // ========== 生命周期 ==========

  async initialize(): Promise<void> {
    await this.coordinator.initialize()
    log.info(`[SwarmRuntime] Initialized: ${this.name} (session: ${this.sessionId})`)
  }

  async destroy(): Promise<void> {
    this.coordinator.destroy()
    this._interrupted = false
    log.info(`[SwarmRuntime] Destroyed: ${this.name}`)
  }

  // ========== 执行方法 ==========

  async run(input: string, config?: ExecutionConfig): Promise<ExecutionResult> {
    const startTime = Date.now()
    this.taskCounter++

    const taskId = `task-${this.taskCounter}-${Date.now().toString(36)}`
    const executionMode = (config?.executionMode as string) || 'auto'

    log.info(
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

      let result
      if (executionMode === 'parallel' && config?.subTasks) {
        result = await this.coordinator.coordinateParallel(task, config.subTasks as SwarmSubTask[])
      } else if (executionMode === 'hybrid' || executionMode === 'auto') {
        result = await this.coordinator.coordinateHybrid(task)
      } else {
        result = await this.coordinator.coordinate(task)
      }

      const duration = Date.now() - startTime

      return {
        output: result.output,
        toolCalls: [],
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
      log.error(`[SwarmRuntime] Task ${taskId} failed:`, error)
      throw error
    }
  }

  /**
   * 流式执行
   *
   * 注意：Swarm 的 stream() 目前**不是真正的增量流式**。
   * 内部调用 coordinator.coordinate() 阻塞等待完成后，再一次性输出结果。
   * 这是因为 Swarm 协调器的 handoff 和多角色调度机制尚不支持增量透传。
   *
   * 未来计划：让各角色 Agent 的执行输出通过 generator 实时透传。
   */
  async *stream(
    input: string,
    config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const startTime = Date.now()
    this.taskCounter++

    const taskId = `task-${this.taskCounter}-${Date.now().toString(36)}`

    log.info(`[SwarmRuntime] Running task ${taskId} in stream mode`)

    try {
      // run:start
      yield { type: 'run:start', content: '' }

      // turn:start → llm:start → text:start
      yield { type: 'turn:start', content: '', data: { turnIndex: 1 } }
      yield { type: 'llm:start', content: '' }
      yield { type: 'text:start', content: '' }

      yield {
        type: 'text:delta',
        content: '[Swarm] 正在分析任务需求...\n',
        data: { delta: '[Swarm] 正在分析任务需求...\n' }
      }

      const result = await this.coordinator.coordinate({
        id: taskId,
        input,
        context: config?.context as Record<string, unknown> | undefined,
        constraints: config?.constraints as string[] | undefined,
        createdAt: Date.now()
      })

      yield {
        type: 'text:delta',
        content: result.output,
        data: { delta: result.output }
      }

      if (result.rolesUsed.length > 0) {
        const metaInfo = `\n\n---\n[Swarm] 使用专家: ${result.rolesUsed.join(' -> ')} | Handoff: ${result.handoffCount}次 | 耗时: ${result.duration}ms`
        yield {
          type: 'text:delta',
          content: metaInfo,
          data: { delta: metaInfo }
        }
      }

      // text:done → llm:done → turn:done
      const fullOutput = result.output
      yield { type: 'text:done', content: fullOutput, data: { text: fullOutput } }
      yield { type: 'llm:done', content: '' }
      yield { type: 'turn:done', content: '', data: { turnIndex: 1 } }

      // run:done
      yield { type: 'run:done', content: '' }

      const duration = Date.now() - startTime

      return {
        output: result.output,
        toolCalls: [],
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
      yield {
        type: 'run:error',
        content: error instanceof Error ? error.message : String(error),
        data: { message: error instanceof Error ? error.message : String(error) }
      }

      log.error(`[SwarmRuntime] Task ${taskId} failed:`, error)
      throw error
    }
  }

  // runStream() and HITL methods inherited from AbstractAgentRuntime

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
    log.info(`[SwarmRuntime] Session cleared: ${this.sessionId}`)
  }

  // ========== 角色管理（Swarm 特有） ==========

  async registerRole(role: AgentRole): Promise<void> {
    await this.coordinator.registerRole(role)
    log.info(`[SwarmRuntime] Registered new role: ${role.id}`)
  }

  getAvailableRoles(): AgentRole[] {
    return this.coordinator.getAvailableRoleList()
  }

  getMetrics(): ReturnType<typeof this.coordinator.monitor.getMetrics> {
    return this.coordinator.monitor.getMetrics()
  }

  getPoolStats(): ReturnType<typeof this.coordinator.pool.getStats> {
    return this.coordinator.pool.getStats()
  }

  getHandoffStats(): ReturnType<typeof this.coordinator.router.getStats> {
    return this.coordinator.router.getStats()
  }

  getContextSummary(): string {
    return this.coordinator.context.toSummary()
  }

  getMessageStats(): ReturnType<typeof this.coordinator.messageBus.getStats> {
    return this.coordinator.messageBus.getStats()
  }

  getConcurrencyStatus(): { running: number; atCapacity: boolean } {
    return {
      running: this.coordinator.concurrency.getRunningCount(),
      atCapacity: this.coordinator.concurrency.isAtCapacity()
    }
  }
}
