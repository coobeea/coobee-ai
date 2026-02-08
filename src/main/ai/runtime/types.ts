/**
 * 统一运行时接口
 * 为 Agent 和 Team 提供一致的对外接口
 */

/**
 * 执行配置
 */
export interface ExecutionConfig {
  /** 是否启用流式输出 */
  streaming?: boolean
  /** 最大 token 数 */
  maxTokens?: number
  /** 温度参数 */
  temperature?: number
  /** 其他配置 */
  [key: string]: unknown
}

/**
 * 执行结果
 */
export interface ExecutionResult {
  /** 最终输出 */
  output: string
  /** 使用的工具调用记录 */
  toolCalls?: Array<{
    toolName: string
    arguments: Record<string, unknown>
    result: unknown
  }>
  /** 使用的技能记录 */
  skillsUsed?: string[]
  /** 消耗的 token 数 */
  tokensUsed?: number
  /** 执行耗时（ms） */
  duration?: number
  /** 其他元数据 */
  metadata?: Record<string, unknown>
}

/**
 * 流式输出块
 */
export interface StreamChunk {
  /** 类型 */
  type: 'text' | 'tool_call' | 'skill_call' | 'done' | 'error'
  /** 内容 */
  content: string
  /** 额外数据 */
  data?: unknown
}

/**
 * 会话信息
 */
export interface SessionInfo {
  /** 会话 ID */
  sessionId: string
  /** 创建时间 */
  createdAt: number
  /** 最后更新时间 */
  updatedAt: number
  /** 消息数量 */
  messageCount: number
  /** 其他元数据 */
  metadata?: Record<string, unknown>
}

/**
 * 记忆摘要
 */
export interface MemorySummary {
  /** 短期记忆条目数 */
  shortTermCount: number
  /** 长期记忆条目数 */
  longTermCount?: number
  /** 最近的关键信息 */
  recentKeyPoints?: string[]
}

/**
 * 工具信息
 */
export interface ToolInfo {
  /** 工具名称 */
  name: string
  /** 工具描述 */
  description: string
  /** 是否可用 */
  enabled: boolean
}

/**
 * 技能信息
 */
export interface SkillInfo {
  /** 技能 ID */
  id: string
  /** 技能名称 */
  name: string
  /** 技能描述 */
  description: string
  /** 是否激活 */
  active: boolean
}

/**
 * 统一执行接口
 *
 * Agent 和 Team 都实现这个接口，对外提供一致的能力：
 * - 执行（同步/流式）
 * - 会话管理
 * - 记忆管理
 * - 工具管理
 * - 技能管理
 */
export interface IExecutable {
  /**
   * 执行类型
   */
  readonly type: 'agent' | 'team'

  /**
   * 执行 ID（Agent ID 或 Team ID）
   */
  readonly id: string

  /**
   * 名称
   */
  readonly name: string

  // ========== 执行方法 ==========

  /**
   * 同步执行（等待完整结果）
   * @param input 用户输入
   * @param config 执行配置
   */
  run(input: string, config?: ExecutionConfig): Promise<ExecutionResult>

  /**
   * 流式执行（实时返回结果块）
   * @param input 用户输入
   * @param config 执行配置
   * @param onChunk 流式块回调
   */
  runStream(
    input: string,
    config: ExecutionConfig,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult>

  // ========== 会话管理 ==========

  /**
   * 获取会话信息
   */
  getSession(): Promise<SessionInfo>

  /**
   * 清除会话历史
   */
  clearSession(): Promise<void>

  // ========== 记忆管理 ==========

  /**
   * 获取记忆摘要
   */
  getMemory(): Promise<MemorySummary>

  /**
   * 保存记忆
   */
  saveMemory(): Promise<void>

  /**
   * 清除记忆
   */
  clearMemory(): Promise<void>

  // ========== 工具管理 ==========

  /**
   * 获取可用工具列表
   */
  getTools(): ToolInfo[]

  /**
   * 启用/禁用工具
   * @param toolName 工具名称
   * @param enabled 是否启用
   */
  setToolEnabled(toolName: string, enabled: boolean): void

  // ========== 技能管理 ==========

  /**
   * 获取技能列表
   */
  getSkills(): SkillInfo[]

  /**
   * 激活/停用技能
   * @param skillId 技能 ID
   * @param active 是否激活
   */
  setSkillActive(skillId: string, active: boolean): void

  // ========== 生命周期 ==========

  /**
   * 初始化
   */
  initialize(): Promise<void>

  /**
   * 销毁
   */
  destroy(): Promise<void>
}

/**
 * 执行上下文
 * 用于在执行过程中传递状态
 */
export interface ExecutionContext {
  /** 会话 ID */
  sessionId: string
  /** 用户输入 */
  userInput: string
  /** 执行配置 */
  config: ExecutionConfig
  /** 历史消息 */
  history?: Array<{ role: string; content: string }>
  /** 激活的技能 */
  activeSkills?: string[]
  /** 可用的工具 */
  availableTools?: string[]
  /** 其他上下文信息 */
  metadata?: Record<string, unknown>
}
