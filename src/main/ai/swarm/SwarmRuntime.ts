/**
 * SwarmRuntime - 统一运行时
 *
 * 实现 IExecutable 接口，使 Swarm 与 Agent/Team 运行时对等：
 * - run(): 调用 SwarmCoordinator 完成任务
 * - runStream(): 流式输出支持
 * - 完整的生命周期管理
 * - HITL 接口（预留）
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

  // HITL（Swarm 暂不支持）
  private _interrupted = false

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

  get interrupted(): boolean {
    return this._interrupted
  }

  // ========== 生命周期 ==========

  async initialize(): Promise<void> {
    await this.coordinator.initialize()

    this.streamEmitter = createStreamEmitter(this.sessionId, {
      type: 'swarm',
      id: this.id,
      name: this.name
    })

    console.log(`[SwarmRuntime] Initialized: ${this.name} (session: ${this.sessionId})`)
  }

  async destroy(): Promise<void> {
    this.coordinator.destroy()
    this._interrupted = false
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
      // run:start
      await this.streamEmitter.emitStart()
      await this.streamEmitter.emitThinking(`分诊中: ${input.substring(0, 50)}...`)

      // turn:start → llm:start → text:start
      onChunk({ type: 'turn:start', content: '', data: { turnIndex: 1 } })
      onChunk({ type: 'llm:start', content: '' })
      onChunk({ type: 'text:start', content: '' })

      onChunk({
        type: 'text:delta',
        content: '[Swarm] 正在分析任务需求...\n',
        data: { delta: '[Swarm] 正在分析任务需求...\n' }
      })

      const result = await this.coordinator.coordinate({
        id: taskId,
        input,
        context: config?.context as Record<string, unknown> | undefined,
        constraints: config?.constraints as string[] | undefined,
        createdAt: Date.now()
      })

      await this.streamEmitter.emitText(result.output)

      onChunk({
        type: 'text:delta',
        content: result.output,
        data: { delta: result.output }
      })

      if (result.rolesUsed.length > 0) {
        const metaInfo = `\n\n---\n[Swarm] 使用专家: ${result.rolesUsed.join(' -> ')} | Handoff: ${result.handoffCount}次 | 耗时: ${result.duration}ms`
        onChunk({
          type: 'text:delta',
          content: metaInfo,
          data: { delta: metaInfo }
        })
      }

      // text:done → llm:done → turn:done
      const fullOutput = result.output
      onChunk({ type: 'text:done', content: fullOutput, data: { text: fullOutput } })
      onChunk({ type: 'llm:done', content: '' })
      onChunk({ type: 'turn:done', content: '', data: { turnIndex: 1 } })

      // run:done
      await this.streamEmitter.emitDone()

      onChunk({
        type: 'run:done',
        content: ''
      })

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
      await this.streamEmitter.emitError(error instanceof Error ? error : new Error(String(error)))

      onChunk({
        type: 'run:error',
        content: error instanceof Error ? error.message : String(error),
        data: { message: error instanceof Error ? error.message : String(error) }
      })

      console.error(`[SwarmRuntime] Task ${taskId} failed:`, error)
      throw error
    }
  }

  // ========== HITL（Swarm 暂不支持） ==========

  approveToolCall(_index: number, _options?: { alwaysApprove?: boolean }): void {
    throw new Error('SwarmRuntime does not yet support HITL tool approval')
  }

  rejectToolCall(_index: number, _options?: { alwaysReject?: boolean }): void {
    throw new Error('SwarmRuntime does not yet support HITL tool approval')
  }

  async resume(): Promise<ExecutionResult> {
    throw new Error('SwarmRuntime does not yet support HITL resume')
  }

  async resumeStream(
    _config: ExecutionConfig,
    _onChunk: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult> {
    throw new Error('SwarmRuntime does not yet support HITL resume')
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

  // ========== 角色管理（Swarm 特有） ==========

  async registerRole(role: AgentRole): Promise<void> {
    await this.coordinator.registerRole(role)
    console.log(`[SwarmRuntime] Registered new role: ${role.id}`)
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
