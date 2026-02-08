/**
 * Agent 运行时
 * 为单个 Agent 提供统一的 IExecutable 接口实现
 */

import { run } from '@openai/agents'
import type { Agent } from '@openai/agents'
import { agentFactory } from '../agents/AgentFactory'
import { agentConfigStore } from '../storage/AgentConfigStore'
import { createStreamEmitter, type IStreamEmitter } from '../streaming/StreamEmitter'
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
 * Agent 运行时
 */
export class AgentRuntime implements IExecutable {
  readonly type = 'agent' as const
  readonly id: string
  private _name: string

  private agent!: Agent
  private sessionId: string
  private configId: string
  private config!: { name: string; tools?: string[]; skills?: string[] }
  private enabledTools = new Map<string, boolean>()
  private activeSkills = new Map<string, boolean>()
  private streamEmitter!: IStreamEmitter

  constructor(agentId: string, sessionId?: string) {
    this.id = agentId
    this.configId = agentId
    this.sessionId = sessionId || `session-${Date.now()}`
    this._name = 'Agent' // 将在 initialize 时更新
  }

  get name(): string {
    return this._name
  }

  // ========== 生命周期 ==========

  async initialize(): Promise<void> {
    // 1. 加载配置
    const loadedConfig = await agentConfigStore.getConfig(this.configId)
    if (!loadedConfig) {
      throw new Error(`Agent config not found: ${this.configId}`)
    }

    this.config = loadedConfig

    // 更新名称
    this._name = this.config.name

    // 2. 创建 Agent 实例
    this.agent = await agentFactory.createAgent(this.sessionId, {
      configId: this.configId
    })

    // 3. 初始化工具状态
    if (this.config.tools) {
      this.config.tools.forEach((toolName: string) => {
        this.enabledTools.set(toolName, true)
      })
    }

    // 4. 初始化技能状态
    if (this.config.skills) {
      this.config.skills.forEach((skillId: string) => {
        this.activeSkills.set(skillId, true)
      })
    }

    // 5. 创建流式发射器
    this.streamEmitter = createStreamEmitter(this.sessionId, {
      type: 'agent',
      id: this.id,
      name: this.name
    })

    console.log(`[AgentRuntime] Initialized agent: ${this.name}`)
  }

  async destroy(): Promise<void> {
    // 清理资源
    this.enabledTools.clear()
    this.activeSkills.clear()
    console.log(`[AgentRuntime] Destroyed agent: ${this.name}`)
  }

  // ========== 执行方法 ==========

  async run(input: string, _config?: ExecutionConfig): Promise<ExecutionResult> {
    const startTime = Date.now()

    console.log(`[AgentRuntime] Running agent: ${this.name}`)
    console.log(`[AgentRuntime] Input: ${input}`)

    try {
      // 执行 Agent
      const result = await run(this.agent, input)

      const duration = Date.now() - startTime

      return {
        output: result.finalOutput || '',
        toolCalls: [], // TODO: 从 result 中提取工具调用信息
        skillsUsed: Array.from(this.activeSkills.keys()).filter((id) => this.activeSkills.get(id)),
        duration,
        metadata: {
          agentId: this.id,
          sessionId: this.sessionId
        }
      }
    } catch (error: unknown) {
      console.error(`[AgentRuntime] Execution failed:`, error)
      throw error
    }
  }

  async runStream(
    input: string,
    _config: ExecutionConfig,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult> {
    console.log(`[AgentRuntime] Running agent in stream mode: ${this.name}`)

    const startTime = Date.now()

    try {
      // 1. 发送流开始事件
      await this.streamEmitter.emitStart()

      // 2. 发送思考消息
      await this.streamEmitter.emitThinking(`Processing: ${input.substring(0, 50)}...`)

      // 3. 执行 Agent
      const result = await run(this.agent, input)

      // 4. 发送文本结果
      await this.streamEmitter.emitText(result.finalOutput || '')

      // 5. 发送流结束事件
      await this.streamEmitter.emitDone()

      // 6. 同时调用回调（兼容旧接口）
      onChunk({
        type: 'text',
        content: result.finalOutput || ''
      })

      onChunk({
        type: 'done',
        content: ''
      })

      const duration = Date.now() - startTime

      return {
        output: result.finalOutput || '',
        toolCalls: [],
        skillsUsed: Array.from(this.activeSkills.keys()).filter((id) => this.activeSkills.get(id)),
        duration,
        metadata: {
          agentId: this.id,
          sessionId: this.sessionId
        }
      }
    } catch (error: unknown) {
      // 发送错误
      await this.streamEmitter.emitError(error instanceof Error ? error : new Error(String(error)))

      console.error(`[AgentRuntime] Execution failed:`, error)
      throw error
    }
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
        agentId: this.id,
        agentName: this.name
      }
    }
  }

  async clearSession(): Promise<void> {
    console.log(`[AgentRuntime] Clearing session: ${this.sessionId}`)
    // TODO: 清除 SessionStore 中的数据
  }

  // ========== 记忆管理 ==========

  async getMemory(): Promise<MemorySummary> {
    // TODO: 从 SessionMemory 获取
    return {
      shortTermCount: 0,
      longTermCount: 0,
      recentKeyPoints: []
    }
  }

  async saveMemory(): Promise<void> {
    console.log(`[AgentRuntime] Saving memory for session: ${this.sessionId}`)
    // TODO: 保存到 SessionMemory
  }

  async clearMemory(): Promise<void> {
    console.log(`[AgentRuntime] Clearing memory for session: ${this.sessionId}`)
    // TODO: 清除 SessionMemory
  }

  // ========== 工具管理 ==========

  getTools(): ToolInfo[] {
    const tools: ToolInfo[] = []

    for (const [toolName, enabled] of this.enabledTools) {
      tools.push({
        name: toolName,
        description: `Tool: ${toolName}`, // TODO: 从工具注册表获取真实描述
        enabled
      })
    }

    return tools
  }

  setToolEnabled(toolName: string, enabled: boolean): void {
    this.enabledTools.set(toolName, enabled)
    console.log(`[AgentRuntime] Tool ${toolName} ${enabled ? 'enabled' : 'disabled'}`)
    // TODO: 动态更新 Agent 的工具配置
  }

  // ========== 技能管理 ==========

  getSkills(): SkillInfo[] {
    const skills: SkillInfo[] = []

    for (const [skillId, active] of this.activeSkills) {
      skills.push({
        id: skillId,
        name: skillId, // TODO: 从技能注册表获取真实名称
        description: `Skill: ${skillId}`,
        active
      })
    }

    return skills
  }

  setSkillActive(skillId: string, active: boolean): void {
    this.activeSkills.set(skillId, active)
    console.log(`[AgentRuntime] Skill ${skillId} ${active ? 'activated' : 'deactivated'}`)
    // TODO: 动态更新技能状态
  }
}
