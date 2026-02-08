/**
 * Team 运行时
 * 为 Team 提供统一的 IExecutable 接口实现
 */

import { teamConfigStore } from '../storage/TeamConfigStore'
import { agentFactory } from '../agents/AgentFactory'
import { run, type Agent } from '@openai/agents'
import type { TeamConfig } from '../teams/types'
import type {
  IExecutable,
  ExecutionConfig,
  ExecutionResult,
  StreamChunk,
  SessionInfo,
  MemorySummary,
  ToolInfo,
  SkillInfo
} from './types'

/**
 * Team 运行时
 */
export class TeamRuntime implements IExecutable {
  readonly type = 'team' as const
  readonly id: string
  private _name: string

  private sessionId: string
  private teamConfig!: TeamConfig
  private memberRuntimes = new Map<string, Agent>() // agentId -> Agent instance

  constructor(teamId: string, sessionId?: string) {
    this.id = teamId
    this.sessionId = sessionId || `session-${Date.now()}`
    this._name = 'Team' // 将在 initialize 时更新
  }

  get name(): string {
    return this._name
  }

  // ========== 生命周期 ==========

  async initialize(): Promise<void> {
    // 1. 加载 Team 配置
    const config = await teamConfigStore.getTeam(this.id)
    if (!config) {
      throw new Error(`Team config not found: ${this.id}`)
    }

    this.teamConfig = config
    this._name = config.name

    // 2. 初始化所有成员 Agents
    for (const member of this.teamConfig.members) {
      const agent = await agentFactory.createAgent(`team-${this.id}-${member.agentId}`, {
        configId: member.agentId
      })
      this.memberRuntimes.set(member.agentId, agent)
    }

    console.log(
      `[TeamRuntime] Initialized team: ${this.name} with ${this.teamConfig.members.length} members`
    )
  }

  async destroy(): Promise<void> {
    // 清理所有成员
    this.memberRuntimes.clear()
    console.log(`[TeamRuntime] Destroyed team: ${this.name}`)
  }

  // ========== 执行方法 ==========

  async run(input: string, config?: ExecutionConfig): Promise<ExecutionResult> {
    const startTime = Date.now()

    console.log(`[TeamRuntime] Running team: ${this.name}`)
    console.log(`[TeamRuntime] Orchestration: ${this.teamConfig.orchestrationType}`)

    try {
      let output: string | { summary: string; results: unknown[] }

      // 根据协作模式执行
      switch (this.teamConfig.orchestrationType) {
        case 'sequential':
          output = await this.runSequential(input, config)
          break
        case 'parallel':
          output = await this.runParallel(input, config)
          break
        case 'planner':
          output = await this.runWithPlanner(input, config)
          break
        default:
          throw new Error(`Unknown orchestration type: ${this.teamConfig.orchestrationType}`)
      }

      const duration = Date.now() - startTime

      return {
        output: typeof output === 'string' ? output : JSON.stringify(output),
        toolCalls: [], // TODO: 聚合所有成员的工具调用
        skillsUsed: this.getAggregatedSkills(),
        duration,
        metadata: {
          teamId: this.id,
          sessionId: this.sessionId,
          orchestrationType: this.teamConfig.orchestrationType,
          memberCount: this.teamConfig.members.length
        }
      }
    } catch (error: unknown) {
      console.error(`[TeamRuntime] Execution failed:`, error)
      throw error
    }
  }

  async runStream(
    input: string,
    config: ExecutionConfig,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult> {
    console.log(`[TeamRuntime] Running team in stream mode: ${this.name}`)

    // TODO: 实现流式输出
    // 需要在协作过程中实时发送每个成员的输出

    // 暂时回退到同步执行
    const result = await this.run(input, config)

    // 发送完整结果
    onChunk({
      type: 'text',
      content: result.output
    })

    onChunk({
      type: 'done',
      content: ''
    })

    return result
  }

  // ========== 协作模式实现 ==========

  /**
   * 顺序执行（Chain）
   */
  private async runSequential(input: string, _config?: ExecutionConfig): Promise<string> {
    let currentOutput = input

    // 按优先级排序
    const sortedMembers = [...this.teamConfig.members].sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    )

    for (const member of sortedMembers) {
      console.log(`[TeamRuntime] Sequential - Running member: ${member.role}`)

      const agent = this.memberRuntimes.get(member.agentId)
      if (!agent) {
        console.warn(`[TeamRuntime] Member agent not found: ${member.agentId}`)
        continue
      }

      const result = await run(agent, currentOutput)
      currentOutput = result.finalOutput || currentOutput
    }

    return currentOutput
  }

  /**
   * 并行执行
   */
  private async runParallel(
    input: string,
    _config?: ExecutionConfig
  ): Promise<{ summary: string; results: unknown[] }> {
    console.log(`[TeamRuntime] Parallel - Running all members`)

    const results = await Promise.all(
      this.teamConfig.members.map(async (member) => {
        const agent = this.memberRuntimes.get(member.agentId)
        if (!agent) {
          return { role: member.role, output: null }
        }

        const result = await run(agent, input)
        return {
          role: member.role,
          output: result.finalOutput
        }
      })
    )

    // 聚合结果
    return {
      summary: `Completed ${results.length} parallel tasks`,
      results
    }
  }

  /**
   * 使用 Planner 执行
   */
  private async runWithPlanner(input: string, config?: ExecutionConfig): Promise<string> {
    console.log(`[TeamRuntime] Planner mode - Using Orchestrator`)

    // TODO: 集成 Orchestrator
    // 1. 使用 Planner 分解任务
    // 2. 将子任务分配给合适的成员
    // 3. 协调执行
    // 4. 聚合结果

    // 暂时回退到顺序执行
    return await this.runSequential(input, config)
  }

  // ========== 会话管理 ==========

  async getSession(): Promise<SessionInfo> {
    // TODO: 从 SessionStore 获取
    return {
      sessionId: this.sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
      metadata: {
        teamId: this.id,
        teamName: this.name,
        memberCount: this.teamConfig.members.length
      }
    }
  }

  async clearSession(): Promise<void> {
    console.log(`[TeamRuntime] Clearing session: ${this.sessionId}`)
    // TODO: 清除 SessionStore 中的数据
  }

  // ========== 记忆管理 ==========

  async getMemory(): Promise<MemorySummary> {
    // TODO: 聚合所有成员的记忆
    return {
      shortTermCount: 0,
      longTermCount: 0,
      recentKeyPoints: []
    }
  }

  async saveMemory(): Promise<void> {
    console.log(`[TeamRuntime] Saving memory for team session: ${this.sessionId}`)
    // TODO: 保存所有成员的记忆
  }

  async clearMemory(): Promise<void> {
    console.log(`[TeamRuntime] Clearing memory for team session: ${this.sessionId}`)
    // TODO: 清除所有成员的记忆
  }

  // ========== 工具管理 ==========

  getTools(): ToolInfo[] {
    // TODO: 聚合所有成员的工具
    const allTools = new Map<string, ToolInfo>()

    // 目前返回空列表，实际应该从所有成员收集
    return Array.from(allTools.values())
  }

  setToolEnabled(toolName: string, enabled: boolean): void {
    console.log(`[TeamRuntime] Setting tool ${toolName} to ${enabled} for all members`)
    // TODO: 更新所有成员的工具状态
  }

  // ========== 技能管理 ==========

  getSkills(): SkillInfo[] {
    // TODO: 聚合所有成员的技能
    const allSkills = new Map<string, SkillInfo>()

    // 目前返回空列表，实际应该从所有成员收集
    return Array.from(allSkills.values())
  }

  setSkillActive(skillId: string, active: boolean): void {
    console.log(`[TeamRuntime] Setting skill ${skillId} to ${active} for all members`)
    // TODO: 更新所有成员的技能状态
  }

  // ========== 辅助方法 ==========

  /**
   * 获取聚合的技能列表
   */
  private getAggregatedSkills(): string[] {
    // TODO: 从所有成员收集技能
    return []
  }
}
