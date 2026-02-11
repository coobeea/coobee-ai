/**
 * 统一运行时类型定义
 *
 * 设计原则：
 *   1. SDK 无关：不依赖任何特定 SDK（@openai/agents、pi-coding-agent 等）
 *   2. 接口优先：定义通用的 AgentRuntime / IExecutable 接口
 *   3. 各 SDK 实现在子目录（openai/、pi/）中定义特有类型
 */

// ========== 统一工具定义 ==========

/**
 * 统一工具定义（SDK 无关）
 *
 * 在 Runtime 层提供跨 SDK 的工具定义格式：
 *   - parameters 使用 JSON Schema（TypeBox 输出即 JSON Schema，Zod 可转换）
 *   - execute 返回纯 string，各 SDK 适配层自行包装为原生返回值
 *
 * 各 Runtime 内部通过 convertTools() 将 ToolDefinition 转为 SDK 原生格式。
 * 高级用户仍可使用 SDK 特有的工具入口（如 OpenAI 的 Tool[]、PiMono 的 customTools）。
 */
export interface ToolDefinition {
  /** 工具名称（唯一标识） */
  name: string
  /** 工具描述（LLM 用于决策是否调用） */
  description: string
  /** 参数 JSON Schema（TypeBox / Zod-to-JSON-Schema 输出） */
  parameters: Record<string, unknown>
  /** 执行函数（返回纯文本结果） */
  execute: (params: Record<string, unknown>) => Promise<string>
}

// ========== 统一技能定义 ==========

/**
 * 统一技能定义（SDK 无关）
 *
 * 技能是注入到系统提示词中的领域知识/指令片段。
 * 各 Runtime 根据自身 SDK 机制将技能内容注入 LLM 上下文：
 *   - OpenAI：格式化后拼接到 Agent.instructions
 *   - PiMono：通过 resourceLoader.getSkills() 返回，由 SDK 内部组装
 */
export interface SkillDefinition {
  /** 技能名称（唯一标识） */
  name: string
  /** 技能描述（用于提示词中的标注） */
  description: string
  /** 技能内容（通常是 markdown 格式的指令/知识） */
  content: string
}

// ========== Agent 运行时通用选项 ==========

/**
 * AgentRuntime 基础选项（SDK 无关）
 *
 * 各 SDK 实现可扩展此接口添加 SDK 特有配置。
 * 例如：OpenAI 实现添加 tools、handoffs、modelSettings 等。
 */
export interface AgentRuntimeOptions {
  /** Agent 名称 */
  name: string
  /** Agent 基础系统指令 */
  instructions: string
  /**
   * 追加指令片段
   *
   * 在基础 instructions 之后追加的额外指令。
   * 适合动态注入上下文信息（如当前项目结构、用户偏好等）。
   */
  appendInstructions?: string[]
  /**
   * 技能列表
   *
   * 注入到系统提示词中的领域知识。
   * 各 Runtime 自动格式化并整合到最终 LLM 上下文中。
   */
  skills?: SkillDefinition[]
  /** 模型名称 */
  model?: string
  /** 会话 ID（不传则自动生成） */
  sessionId?: string
  /** 最大执行轮次，防止无限工具调用循环（默认 25） */
  maxTurns?: number
  /**
   * 统一工具列表（SDK 无关）
   *
   * 使用 ToolDefinition 格式定义工具，Runtime 内部自动转换为 SDK 原生格式。
   * 与 SDK 特有工具（如 OpenAI 的 Tool[]）共存，SDK 特有工具优先。
   */
  tools?: ToolDefinition[]
  /** SDK 特有配置（各实现自定义） */
  [key: string]: unknown
}

// ========== 系统提示词构建 ==========

/**
 * 格式化技能列表为提示词文本
 *
 * 使用 XML 结构化格式，便于 LLM 解析：
 *   <skills>
 *     <skill name="xxx">
 *       <description>...</description>
 *       <content>...</content>
 *     </skill>
 *   </skills>
 */
export function formatSkills(skills: SkillDefinition[]): string {
  if (!skills.length) return ''
  const items = skills
    .map(
      (s) =>
        `<skill name="${s.name}">\n<description>${s.description}</description>\n<content>\n${s.content}\n</content>\n</skill>`
    )
    .join('\n')
  return `<skills>\n${items}\n</skills>`
}

/**
 * 构建最终系统提示词
 *
 * 组装顺序：instructions → skills → appendInstructions
 * 供不支持独立 skill 注入的 Runtime（如 OpenAI）使用。
 * PiMono 通过 resourceLoader 各方法分别返回，由 SDK 内部组装。
 */
export function buildInstructions(
  instructions: string,
  skills?: SkillDefinition[],
  appendInstructions?: string[]
): string {
  const parts: string[] = [instructions]

  if (skills?.length) {
    parts.push(formatSkills(skills))
  }

  if (appendInstructions?.length) {
    parts.push(appendInstructions.join('\n\n'))
  }

  return parts.join('\n\n')
}

// ========== 执行配置和结果 ==========

/**
 * 执行配置（运行时覆盖项）
 */
export interface ExecutionConfig {
  /** 是否启用流式输出 */
  streaming?: boolean
  /** 覆盖最大轮次 */
  maxTurns?: number
  /** 其他配置 */
  [key: string]: unknown
}

/**
 * 工具审批信息（前端可读格式）
 */
export interface ToolApprovalInfo {
  /** 审批项索引 */
  index: number
  /** 工具名称 */
  toolName: string
  /** 工具参数（JSON 字符串） */
  arguments: string
}

/**
 * 执行结果
 */
export interface ExecutionResult {
  /** 最终输出文本 */
  output: string
  /** 是否被中断（HITL 工具审批） */
  interrupted?: boolean
  /** 待审批的工具调用列表（仅 interrupted=true 时有值） */
  interruptions?: ToolApprovalInfo[]
  /** 使用的工具调用记录 */
  toolCalls?: Array<{
    toolName: string
    arguments: Record<string, unknown>
    result?: unknown
  }>
  /** 执行耗时（ms） */
  duration?: number
  /** 元数据 */
  metadata?: Record<string, unknown>
}

// ========== 流式事件 ==========

/**
 * 流式输出块
 *
 * 所有流式事件的统一载体。前端通过 `type` 的前缀过滤感兴趣的层级。
 */
export interface StreamChunk {
  /** 事件类型（prefix:event 格式） */
  type: StreamChunkType
  /** 主要内容（文本增量、工具名、错误信息等） */
  content: string
  /** 额外数据（类型随 type 变化） */
  data?: StreamChunkData
  /** 发出此事件的 Agent 名称（多 Agent 场景有值） */
  agentName?: string
}

/**
 * 流式事件类型
 *
 * 设计原则：
 *   1. 每层用统一前缀（prefix:event），层级关系清晰
 *   2. 每个实体形成闭环（start → delta → done）
 *   3. 消费者不感知底层 SDK
 *
 * 嵌套关系：
 *   run ⊃ turn ⊃ llm ⊃ { text, reasoning, tool }
 *                                       ↓
 *                                     hitl
 *            ↗ handoff ↘
 *      (Agent A)    (Agent B)
 *
 * 闭环时序示意：
 *
 *   ┌─ run:start ──────────────────────────────────────────────────── run:done ─┐
 *   │  ┌─ turn:start ──────────────────────────────────── turn:done ─┐         │
 *   │  │  ┌─ llm:start ──────────────────────── llm:done ─┐         │         │
 *   │  │  │  reasoning:start → :delta × N → :done         │         │         │
 *   │  │  │  text:start → :delta × N → :done              │         │         │
 *   │  │  │  tool:start → :delta × N → :pending           │         │         │
 *   │  │  └────────────────────────────────────────────────┘         │         │
 *   │  │  tool:done { result }                                       │         │
 *   │  └─────────────────────────────────────────────────────────────┘         │
 *   │  ┌─ turn:start (下一轮) ─── ... ─── turn:done ─┐                        │
 *   │  └──────────────────────────────────────────────┘                        │
 *   └──────────────────────────────────────────────────────────────────────────┘
 */
export type StreamChunkType =
  // ① run: 执行生命周期（最外层）
  | 'run:start' // 整个执行开始
  | 'run:done' // 整个执行完成
  | 'run:error' // 执行错误
  | 'run:interrupted' // 被 HITL 中断
  | 'run:resumed' // 恢复执行
  // ② turn: 对话轮次（一轮 = 一次 LLM 调用 + 可能的工具执行）
  | 'turn:start' // 轮次开始
  | 'turn:done' // 轮次完成
  // ③ llm: 模型 API 调用
  | 'llm:start' // 模型调用开始
  | 'llm:done' // 模型调用完成
  // ④ text: 文本输出
  | 'text:start' // 文本开始
  | 'text:delta' // 文本增量
  | 'text:done' // 文本完成
  // ⑤ reasoning: 推理/思维链
  | 'reasoning:start' // 推理开始
  | 'reasoning:delta' // 推理增量
  | 'reasoning:done' // 推理完成
  // ⑥ tool: 工具调用
  | 'tool:start' // 工具调用开始
  | 'tool:delta' // 参数增量 / 执行进度
  | 'tool:pending' // 参数完成，等待执行
  | 'tool:done' // 执行完成
  // ⑦ hitl: 人工审批
  | 'hitl:required' // 需要审批
  | 'hitl:approved' // 已批准
  | 'hitl:rejected' // 已拒绝
  // ⑧ handoff: Agent 切换
  | 'handoff:start' // 请求切换
  | 'handoff:done' // 切换完成
  // ⑨ compression: Session 压缩
  | 'compression:start' // 压缩开始
  | 'compression:done' // 压缩完成（含统计信息）

/**
 * StreamChunk 额外数据（联合类型，根据 StreamChunkType 变化）
 */
export type StreamChunkData =
  | RunErrorData
  | TurnData
  | LlmDoneData
  | TextDeltaData
  | TextDoneData
  | ReasoningDoneData
  | ToolStartData
  | ToolDeltaData
  | ToolPendingData
  | ToolDoneData
  | HitlRequiredData
  | HandoffData
  | CompressionStartData
  | CompressionDoneData
  | Record<string, unknown>

// ---- ① run: ----

/** run:error 数据 */
export interface RunErrorData {
  /** 错误消息 */
  message: string
  /** 错误码 */
  code?: string
}

// ---- ② turn: ----

/** turn:start / turn:done 数据 */
export interface TurnData {
  /** 轮次索引（从 1 开始） */
  turnIndex: number
}

// ---- ③ llm: ----

/** llm:done 数据（含 token 用量） */
export interface LlmDoneData {
  /** 响应 ID */
  responseId?: string
  /** Token 用量 */
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
}

// ---- ④ text: ----

/** text:delta 数据 */
export interface TextDeltaData {
  /** 增量文本片段 */
  delta: string
}

/** text:done 数据 */
export interface TextDoneData {
  /** 完整文本 */
  text: string
}

// ---- ⑤ reasoning: ----

/** reasoning:done 数据 */
export interface ReasoningDoneData {
  /** 推理摘要（用户可见） */
  summary?: string
  /** 原始推理文本（可能不返回） */
  rawContent?: string
}

// ---- ⑥ tool: ----

/** tool:start 数据 */
export interface ToolStartData {
  /** 工具名称 */
  toolName: string
  /** 调用 ID */
  callId?: string
}

/** tool:delta 数据 */
export interface ToolDeltaData {
  /** 参数 JSON 片段 / 执行进度 */
  delta: string
  /** 调用 ID */
  callId?: string
}

/** tool:pending 数据（参数完成） */
export interface ToolPendingData {
  /** 工具名称 */
  toolName?: string
  /** 调用 ID */
  callId?: string
  /** 完整参数 JSON 字符串 */
  arguments: string
}

/** tool:done 数据（执行结果） */
export interface ToolDoneData {
  /** 工具名称 */
  toolName: string
  /** 调用 ID */
  callId?: string
  /** 输出内容 */
  output: unknown
}

// ---- ⑦ hitl: ----

/** hitl:required 数据 */
export interface HitlRequiredData {
  /** 审批项索引 */
  index: number
  /** 工具名称 */
  toolName: string
  /** 工具参数（JSON 字符串） */
  arguments?: string
  /** SDK 原始审批项引用（用于 approve/reject，由具体实现定义类型） */
  approvalItem: unknown
}

// ---- ⑧ handoff: ----

/** handoff:start / handoff:done 数据 */
export interface HandoffData {
  /** 来源 Agent 名称 */
  fromAgent?: string
  /** 目标 Agent 名称 */
  toAgent: string
}

// ---- ⑨ compression: ----

/** compression:start 数据 */
export interface CompressionStartData {
  /** 触发原因 */
  reason: string
  /** 当前 token 数 */
  totalTokens: number
  /** 阈值 */
  threshold: number
}

/** compression:done 数据 */
export interface CompressionDoneData {
  /** 被压缩的消息序号列表 */
  summarizedSeqs: number[]
  /** 最后一个被压缩的序号 */
  endSeq: number
  /** 压缩前的 token 数 */
  originalTokens: number
  /** 总结的 token 数 */
  summaryTokens: number
  /** 压缩比 */
  compressionRatio: number
  /** 压缩耗时（ms） */
  duration: number
}

// ========== 会话信息 ==========

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
  /** 元数据 */
  metadata?: Record<string, unknown>
}

// ========== 统一执行接口 ==========

/**
 * 统一执行接口
 *
 * Agent、Team、Swarm 都实现此接口，对外提供一致的能力：
 * - 执行（同步/流式）
 * - HITL 工具审批（暂停/恢复）
 * - 会话管理
 */
export interface IExecutable {
  /** 执行类型 */
  readonly type: 'agent' | 'team' | 'swarm'
  /** 执行 ID */
  readonly id: string
  /** 名称 */
  readonly name: string
  /** 是否处于中断状态（HITL 工具审批等待中） */
  readonly interrupted: boolean

  // ========== 生命周期 ==========

  /** 初始化 */
  initialize(): Promise<void>
  /** 销毁 */
  destroy(): Promise<void>

  // ========== 执行方法 ==========

  /**
   * 同步执行（等待完整结果）
   * @param input 用户输入
   * @param config 执行配置
   */
  run(input: string, config?: ExecutionConfig): Promise<ExecutionResult>

  /**
   * 流式执行（实时返回事件块）
   * @param input 用户输入
   * @param config 执行配置
   * @param onChunk 流式事件回调
   */
  runStream(
    input: string,
    config: ExecutionConfig,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult>

  // ========== HITL 工具审批 ==========

  /**
   * 批准工具调用
   * @param index 审批项索引
   * @param options 选项（如 alwaysApprove）
   */
  approveToolCall(index: number, options?: { alwaysApprove?: boolean }): void

  /**
   * 拒绝工具调用
   * @param index 审批项索引
   * @param options 选项（如 alwaysReject）
   */
  rejectToolCall(index: number, options?: { alwaysReject?: boolean }): void

  /**
   * 恢复被中断的执行
   * 在 approve/reject 工具调用后调用此方法继续执行
   */
  resume(): Promise<ExecutionResult>

  /**
   * 恢复被中断的流式执行
   */
  resumeStream(
    config: ExecutionConfig,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult>

  // ========== 会话管理 ==========

  /** 获取会话信息 */
  getSession(): Promise<SessionInfo>
  /** 清除会话历史 */
  clearSession(): Promise<void>
}
