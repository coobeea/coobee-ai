/**
 * Agent 运行时
 * 为单个 Agent 提供统一的 IExecutable 接口实现
 *
 * SDK 合规改进：
 * - 使用 run() 的 stream: true 选项获取 StreamedRunResult
 * - 监听 SDK RunStreamEvent 事件，映射到自定义 StreamMessage
 * - 使用 maxTurns 防止无限工具调用循环
 * - 使用 previousResponseId 支持多轮对话延续
 */

import { run } from '@openai/agents'
import type { Agent, StreamedRunResult } from '@openai/agents'
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

/** 默认最大执行轮次（防止无限工具调用循环） */
const DEFAULT_MAX_TURNS = 25

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
  /** 上一次响应 ID（用于多轮对话延续） */
  private previousResponseId?: string

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
    this.agent = await agentFactory.createAgent({
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

  /**
   * 同步执行 Agent
   *
   * SDK 改进：
   * - 传入 maxTurns 防止无限循环
   * - 使用 previousResponseId 支持多轮对话延续
   */
  async run(input: string, config?: ExecutionConfig): Promise<ExecutionResult> {
    const startTime = Date.now()

    console.log(`[AgentRuntime] Running agent: ${this.name}`)
    console.log(`[AgentRuntime] Input: ${input}`)

    try {
      // 执行 Agent（带 maxTurns 循环保护和对话延续）
      const result = await run(this.agent, input, {
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
   * SDK 改进：
   * - 使用 run() 的 stream: true 获取 StreamedRunResult
   * - 监听 SDK 原生流事件（RunStreamEvent），实时映射到自定义 StreamMessage
   * - 获得更精细的事件粒度（text delta、tool_call delta、thinking 等）
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

      // 2. 使用 SDK 原生流式 API
      const streamRunResult = await run(this.agent, input, {
        stream: true,
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
