/**
 * Agent 运行时
 * 为单个 Agent 提供统一的 IExecutable 接口实现
 *
 * 全能力串联：
 * - SessionFileManager + SessionMemoryStore + SessionAdapter：会话记忆持久化
 * - SkillManager：技能激活和 prompt 注入
 * - AgentFactory.getToolsByIds()：工具实例解析
 * - SDK run() 的 session 参数：自动管理对话历史
 * - maxTurns 防止无限工具调用循环
 * - previousResponseId 支持多轮对话延续
 */

import { run } from '@openai/agents'
import type { Agent, StreamedRunResult, Tool, ModelSettings, Session } from '@openai/agents'
import { agentFactory } from '../agents/AgentFactory'
import { agentConfigStore } from '../storage/AgentConfigStore'
import type { AgentConfigData } from '../storage/AgentConfigStore'
import { getSessionFileManager } from '../storage/SessionFileManager'
import type { SessionFileManager } from '../storage/SessionFileManager'
import { SessionMemoryStore, createSessionAdapter } from '../memory'
import { SkillManager, builtinSkills } from '../skills'
import type { AISkill } from '../skills'
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

/** 默认最大执行轮次（防止无限工具调用循环） */
const DEFAULT_MAX_TURNS = 25

/**
 * Agent 运行时
 *
 * 完整串联以下能力模块：
 * - 会话记忆（SessionFileManager → SessionMemoryStore → SessionAdapter → SDK Session）
 * - 技能系统（SkillManager → prompt 注入 → Agent instructions）
 * - 工具系统（AgentFactory.getToolsByIds → SDK Tool[] → Agent）
 * - 流式输出（StreamEmitter）
 */
export class AgentRuntime implements IExecutable {
  readonly type = 'agent' as const
  readonly id: string
  private _name: string

  // Agent 实例
  private agent!: Agent
  private sessionId: string
  private configId: string
  private configData!: AgentConfigData

  // 会话记忆链路
  private sessionFileManager!: SessionFileManager
  private sessionMemoryStore!: SessionMemoryStore
  private sessionAdapter!: Session

  // 技能系统
  private skillManager!: SkillManager
  private activeSkills = new Map<string, boolean>()

  // 工具系统
  private allResolvedTools = new Map<string, Tool>()
  private enabledTools = new Map<string, boolean>()

  // 流式输出
  private streamEmitter!: IStreamEmitter

  /** 上一次响应 ID（用于多轮对话延续） */
  private previousResponseId?: string

  /** 会话创建时间 */
  private createdAt: number

  constructor(agentId: string, sessionId?: string) {
    this.id = agentId
    this.configId = agentId
    this.sessionId = sessionId || `session-${Date.now()}`
    this._name = 'Agent' // 将在 initialize 时更新
    this.createdAt = Date.now()
  }

  get name(): string {
    return this._name
  }

  // ========== 生命周期 ==========

  async initialize(): Promise<void> {
    // 1. 加载配置
    const configData = await agentConfigStore.getConfig(this.configId)
    if (!configData) {
      throw new Error(`Agent config not found: ${this.configId}`)
    }
    this.configData = configData
    this._name = configData.name

    // 2. 初始化会话记忆链路：SessionFileManager → SessionMemoryStore → SessionAdapter
    this.sessionFileManager = getSessionFileManager(this.sessionId)
    await this.sessionFileManager.initialize()

    this.sessionMemoryStore = new SessionMemoryStore(this.sessionFileManager, this.sessionId)
    await this.sessionMemoryStore.initialize()

    this.sessionAdapter = createSessionAdapter(this.sessionMemoryStore, this.sessionId)

    // 3. 解析工具实例：配置中的工具 ID → AgentFactory.toolRegistry → SDK Tool[]
    if (configData.tools && configData.tools.length > 0) {
      const resolvedTools = agentFactory.getToolsByIds(configData.tools)
      for (const tool of resolvedTools) {
        this.allResolvedTools.set(tool.name, tool)
        this.enabledTools.set(tool.name, true)
      }
    }

    // 4. 激活技能：SkillManager → promptSection 注入到 Agent instructions
    this.skillManager = new SkillManager()
    this.skillManager.registerAll(builtinSkills)

    let skillsPrompt = ''
    if (configData.skills && configData.skills.length > 0) {
      const activeSkillObjects = configData.skills
        .map((id) => this.skillManager.getSkill(id))
        .filter((s): s is AISkill => s !== undefined)
      skillsPrompt = this.skillManager.generatePromptSection(activeSkillObjects)
      for (const skill of activeSkillObjects) {
        this.activeSkills.set(skill.id, true)
      }
    }

    // 5. 创建 Agent 实例（带真实工具 + 技能注入的 instructions）
    const enabledToolInstances = this.getEnabledToolInstances()
    this.agent = await agentFactory.createAgent({
      config: {
        name: configData.name,
        instructions: configData.instructions + skillsPrompt,
        model: configData.model || 'gpt-4o',
        ...(configData.modelSettings
          ? { modelSettings: configData.modelSettings as ModelSettings }
          : {})
      },
      tools: enabledToolInstances
    })

    // 6. 创建流式发射器
    this.streamEmitter = createStreamEmitter(this.sessionId, {
      type: 'agent',
      id: this.id,
      name: this.name
    })

    console.log(
      `[AgentRuntime] Initialized agent: ${this.name} ` +
        `(tools: ${this.allResolvedTools.size}, skills: ${this.activeSkills.size}, ` +
        `session: ${this.sessionId})`
    )
  }

  async destroy(): Promise<void> {
    // 清理资源
    this.enabledTools.clear()
    this.activeSkills.clear()
    this.allResolvedTools.clear()
    this.previousResponseId = undefined
    console.log(`[AgentRuntime] Destroyed agent: ${this.name}`)
  }

  // ========== 执行方法 ==========

  /**
   * 同步执行 Agent
   *
   * SDK 特性：
   * - session: SDK 自动通过 session 读写对话历史
   * - maxTurns: 防止无限工具调用循环
   * - previousResponseId: 支持多轮对话延续
   */
  async run(input: string, config?: ExecutionConfig): Promise<ExecutionResult> {
    const startTime = Date.now()

    console.log(`[AgentRuntime] Running agent: ${this.name}`)
    console.log(`[AgentRuntime] Input: ${input}`)

    try {
      // 执行 Agent（带 session、maxTurns 和对话延续）
      const result = await run(this.agent, input, {
        session: this.sessionAdapter,
        maxTurns: (config?.maxTurns as number) || DEFAULT_MAX_TURNS,
        ...(this.previousResponseId ? { previousResponseId: this.previousResponseId } : {})
      })

      // 保存 responseId 用于下轮对话延续
      if (result.lastResponseId) {
        this.previousResponseId = result.lastResponseId
      }

      const duration = Date.now() - startTime

      return {
        output: result.finalOutput || '',
        toolCalls: [], // TODO: 从 result.newItems 中提取工具调用信息
        skillsUsed: Array.from(this.activeSkills.keys()).filter((id) => this.activeSkills.get(id)),
        duration,
        metadata: {
          agentId: this.id,
          sessionId: this.sessionId,
          responseId: result.lastResponseId
        }
      }
    } catch (error: unknown) {
      console.error(`[AgentRuntime] Execution failed:`, error)
      throw error
    }
  }

  /**
   * 流式执行 Agent
   *
   * SDK 特性：
   * - stream: true → 返回 StreamedRunResult（async iterable）
   * - session: SDK 自动通过 session 读写对话历史
   * - 监听 SDK RunStreamEvent，映射到自定义 StreamMessage
   */
  async runStream(
    input: string,
    config: ExecutionConfig,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult> {
    console.log(`[AgentRuntime] Running agent in stream mode: ${this.name}`)

    const startTime = Date.now()

    try {
      // 1. 发送流开始事件
      await this.streamEmitter.emitStart()

      // 2. 使用 SDK 原生流式 API（带 session）
      const streamRunResult = await run(this.agent, input, {
        stream: true,
        session: this.sessionAdapter,
        maxTurns: (config?.maxTurns as number) || DEFAULT_MAX_TURNS,
        ...(this.previousResponseId ? { previousResponseId: this.previousResponseId } : {})
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const streamResult = streamRunResult as StreamedRunResult<unknown, any>

      // 3. 监听 SDK 流事件，映射到自定义流消息
      let fullOutput = ''
      await this.consumeStreamEvents(streamResult, onChunk, (text) => {
        fullOutput += text
      })

      // 4. 等待流完成
      await streamResult.completed

      // 5. 从 streamResult 自身读取最终结果（StreamedRunResult 继承 RunResultBase）
      if (streamResult.lastResponseId) {
        this.previousResponseId = streamResult.lastResponseId
      }

      // 使用 finalOutput（如果有的话优先使用）
      const output = (streamResult.finalOutput as string) || fullOutput

      // 6. 发送流结束事件
      await this.streamEmitter.emitDone()

      // 7. 兼容旧接口的回调
      onChunk({ type: 'done', content: '' })

      const duration = Date.now() - startTime

      return {
        output,
        toolCalls: [],
        skillsUsed: Array.from(this.activeSkills.keys()).filter((id) => this.activeSkills.get(id)),
        duration,
        metadata: {
          agentId: this.id,
          sessionId: this.sessionId,
          responseId: streamResult.lastResponseId
        }
      }
    } catch (error: unknown) {
      // 发送错误
      await this.streamEmitter.emitError(error instanceof Error ? error : new Error(String(error)))

      console.error(`[AgentRuntime] Execution failed:`, error)
      throw error
    }
  }

  /**
   * 消费 SDK 流事件，映射到自定义流消息
   *
   * 监听 StreamedRunResult 的事件流，将 SDK 原生事件
   * 转换为项目的 StreamEmitter 消息格式
   */
  private async consumeStreamEvents(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    streamResult: StreamedRunResult<unknown, any>,
    onChunk: (chunk: StreamChunk) => void,
    onTextDelta: (text: string) => void
  ): Promise<void> {
    for await (const event of streamResult) {
      switch (event.type) {
        case 'raw_model_stream_event': {
          // SDK 原始模型流事件 - 处理文本增量
          const rawEvent = event.data
          if (rawEvent?.type === 'output_text_delta') {
            const delta = (rawEvent as { delta?: string }).delta || ''
            if (delta) {
              onTextDelta(delta)
              await this.streamEmitter.emitText(delta)
              onChunk({ type: 'text', content: delta })
            }
          }
          break
        }

        case 'run_item_stream_event': {
          // SDK RunItem 事件 - 处理工具调用等
          const item = event.item
          if (item?.type === 'tool_call_item' && item.rawItem?.type === 'function_call') {
            const rawItem = item.rawItem
            let parsedArgs: Record<string, unknown> = {}
            try {
              parsedArgs = JSON.parse(rawItem.arguments || '{}') as Record<string, unknown>
            } catch {
              // 参数解析失败时使用空对象
            }
            await this.streamEmitter.emitToolCall(rawItem.name || 'unknown', parsedArgs)
            onChunk({
              type: 'tool_call',
              content: rawItem.name || 'unknown'
            })
          }
          break
        }

        case 'agent_updated_stream_event': {
          // Agent 切换事件（handoff）
          await this.streamEmitter.emitThinking(
            `Switched to agent: ${event.agent?.name || 'unknown'}`
          )
          break
        }
      }
    }
  }

  // ========== 会话管理 ==========

  async getSession(): Promise<SessionInfo> {
    const stats = await this.sessionMemoryStore.getStats()
    return {
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      updatedAt: stats.timeRange?.end || this.createdAt,
      messageCount: stats.total,
      metadata: {
        agentId: this.id,
        agentName: this.name,
        byRole: stats.byRole
      }
    }
  }

  async clearSession(): Promise<void> {
    console.log(`[AgentRuntime] Clearing session: ${this.sessionId}`)
    await this.sessionMemoryStore.clearHistory()
    this.previousResponseId = undefined
  }

  // ========== 记忆管理 ==========

  async getMemory(): Promise<MemorySummary> {
    const stats = await this.sessionMemoryStore.getStats()
    const recentMessages = await this.sessionMemoryStore.getHistory(5)
    return {
      shortTermCount: stats.total,
      longTermCount: 0, // LongTermMemory 暂未接入
      recentKeyPoints: recentMessages
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content.slice(0, 100))
    }
  }

  async saveMemory(): Promise<void> {
    // SDK Session 自动在每次 run() 后通过 session.addItems() 保存
    // 无需手动保存
    console.log(`[AgentRuntime] Memory is auto-saved by SDK Session for: ${this.sessionId}`)
  }

  async clearMemory(): Promise<void> {
    console.log(`[AgentRuntime] Clearing memory for session: ${this.sessionId}`)
    await this.sessionMemoryStore.clearHistory()
    this.previousResponseId = undefined
  }

  // ========== 工具管理 ==========

  getTools(): ToolInfo[] {
    const tools: ToolInfo[] = []

    for (const [toolName, enabled] of this.enabledTools) {
      const tool = this.allResolvedTools.get(toolName)
      tools.push({
        name: toolName,
        description: tool ? `Tool: ${toolName}` : `Tool: ${toolName} (unresolved)`,
        enabled
      })
    }

    return tools
  }

  setToolEnabled(toolName: string, enabled: boolean): void {
    this.enabledTools.set(toolName, enabled)
    console.log(`[AgentRuntime] Tool ${toolName} ${enabled ? 'enabled' : 'disabled'}`)
    // 重建 Agent 以更新工具列表
    this.rebuildAgent().catch((err) =>
      console.error('[AgentRuntime] Failed to rebuild agent after tool toggle:', err)
    )
  }

  // ========== 技能管理 ==========

  getSkills(): SkillInfo[] {
    const skills: SkillInfo[] = []

    for (const [skillId, active] of this.activeSkills) {
      const skill = this.skillManager?.getSkill(skillId)
      skills.push({
        id: skillId,
        name: skill?.name || skillId,
        description: skill?.description || `Skill: ${skillId}`,
        active
      })
    }

    return skills
  }

  setSkillActive(skillId: string, active: boolean): void {
    this.activeSkills.set(skillId, active)
    console.log(`[AgentRuntime] Skill ${skillId} ${active ? 'activated' : 'deactivated'}`)
    // 重建 Agent 以更新技能注入的 instructions
    this.rebuildAgent().catch((err) =>
      console.error('[AgentRuntime] Failed to rebuild agent after skill toggle:', err)
    )
  }

  // ========== 内部方法 ==========

  /**
   * 获取当前启用的工具实例列表
   */
  private getEnabledToolInstances(): Tool[] {
    const tools: Tool[] = []
    for (const [toolName, enabled] of this.enabledTools) {
      if (enabled) {
        const tool = this.allResolvedTools.get(toolName)
        if (tool) {
          tools.push(tool)
        }
      }
    }
    return tools
  }

  /**
   * 重建 Agent 实例
   * 当工具或技能状态变更后，需要重建 Agent 以应用新配置
   */
  private async rebuildAgent(): Promise<void> {
    if (!this.configData) return

    // 重新生成技能 prompt
    let skillsPrompt = ''
    const activeSkillIds = Array.from(this.activeSkills.entries())
      .filter(([, active]) => active)
      .map(([id]) => id)

    if (activeSkillIds.length > 0 && this.skillManager) {
      const activeSkillObjects = activeSkillIds
        .map((id) => this.skillManager.getSkill(id))
        .filter((s): s is AISkill => s !== undefined)
      skillsPrompt = this.skillManager.generatePromptSection(activeSkillObjects)
    }

    // 获取启用的工具
    const enabledToolInstances = this.getEnabledToolInstances()

    // 重建 Agent
    this.agent = await agentFactory.createAgent({
      config: {
        name: this.configData.name,
        instructions: this.configData.instructions + skillsPrompt,
        model: this.configData.model || 'gpt-4o',
        ...(this.configData.modelSettings
          ? { modelSettings: this.configData.modelSettings as ModelSettings }
          : {})
      },
      tools: enabledToolInstances
    })

    console.log(
      `[AgentRuntime] Rebuilt agent: ${this.name} ` +
        `(tools: ${enabledToolInstances.length}, skills: ${activeSkillIds.length})`
    )
  }
}
