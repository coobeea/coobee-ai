/**
 * OpenAI Agents SDK 特有类型定义
 *
 * 这些类型仅在 OpenAI 实现中使用，不暴露给外层接口。
 * 包括：Session 存储格式、压缩配置、上下文快照等。
 */

import type {
  Agent,
  AgentInputItem,
  Handoff,
  Tool,
  ModelSettings,
  RunToolApprovalItem
} from '@openai/agents'
import type { AgentRuntimeOptions } from '../types'

// ========== OpenAI Agent 运行时选项 ==========

/**
 * OpenAI AgentRuntime 创建选项
 *
 * 扩展通用 AgentRuntimeOptions，添加 OpenAI SDK 特有配置。
 */
export interface OpenAIAgentRuntimeOptions extends AgentRuntimeOptions {
  /** 模型参数（温度、top_p 等） */
  modelSettings?: ModelSettings
  /** SDK 原生 Tool 实例列表（高级用法，优先于 tools） */
  sdkTools?: Tool[]
  /** SDK Handoff 配置（Agent 或 Handoff 实例） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handoffs?: (Agent<any, any> | Handoff<any, any>)[]
  /** Session 压缩配置 */
  compression?: SessionCompressionOptions
}

// ========== HITL 审批（OpenAI 特有） ==========

/**
 * OpenAI SDK 的 HITL 审批项引用
 *
 * 对应通用 HitlRequiredData 中的 approvalItem 字段。
 */
export type OpenAIApprovalItem = RunToolApprovalItem

// ========== Session 存储格式 ==========

/**
 * Session 存储项
 *
 * 每行 JSONL 的实际存储格式，包含序号、类型和元数据。
 * SDK 接口（getItems/addItems）对此透明，仅看到 AgentInputItem[]。
 *
 * 类型说明：
 *   - message: 普通消息（SDK AgentInputItem 的包装）
 *   - summary: 压缩总结（包含被压缩消息的元数据）
 */
export interface SessionItem {
  /** 自增序号（1-based） */
  seq: number
  /** 项目类型 */
  type: 'message' | 'summary'
  /** SDK 原始 AgentInputItem 数据 */
  item: AgentInputItem
  /** 总结元数据（仅 type=summary 时有值） */
  meta?: SummaryMeta
  /** 时间戳（毫秒） */
  ts: number
}

/**
 * 总结元数据
 *
 * 附加在 type=summary 的 SessionItem 上，记录压缩的详细信息。
 * 用于前端展示、审计追踪和智能上下文构建。
 */
export interface SummaryMeta {
  /** 总结文本（LLM 生成的结构化总结） */
  summaryText: string
  /** 被压缩的消息序号列表 */
  summarizedSeqs: number[]
  /** 最后一个被压缩的消息序号（用于 getItems 过滤） */
  endSeq: number
  /** 压缩前的 token 数 */
  originalTokens: number
  /** 总结的 token 数 */
  summaryTokens: number
  /** 压缩比（summaryTokens / originalTokens） */
  compressionRatio: number
  /** 压缩耗时（ms） */
  duration: number
}

// ========== Session 压缩 ==========

/**
 * Session 压缩配置
 *
 * 参考 Joythink-AI SessionSummaryMiddleware 的分段压缩策略：
 *   - 检测 token 用量是否超过上下文窗口阈值
 *   - 将历史消息分为"待总结部分"和"保留部分"
 *   - 调用 LLM 生成结构化总结，追加总结到 Session 文件
 *   - getItems() 智能路由：返回 [总结上下文 + 后续消息]
 */
export interface SessionCompressionOptions {
  /** 是否启用压缩（默认 false） */
  enabled?: boolean
  /** 上下文窗口大小（token 数，默认 128000） */
  contextWindowSize?: number
  /** 触发压缩的阈值比例（默认 0.7，即达到上下文窗口的 70% 时触发） */
  thresholdRatio?: number
  /** 保留最近消息的比例（默认 0.3，即保留最近 30% 的消息不压缩） */
  keepRatio?: number
  /** 触发压缩的最小消息数（默认 10，低于此数不压缩） */
  minMessageCount?: number
  /** 用于生成总结的模型（不传则使用 Agent 自身的模型） */
  summaryModel?: string
  /** 是否调试模式 */
  debug?: boolean
}

/**
 * 压缩结果信息
 */
export interface CompressionResult {
  /** 是否执行了压缩 */
  compressed: boolean
  /** 压缩前的未压缩消息数 */
  originalCount?: number
  /** 被总结的消息数 */
  summarizedCount?: number
  /** 保留的消息数 */
  keptCount?: number
  /** 被压缩的消息序号列表 */
  summarizedSeqs?: number[]
  /** 最后一个被压缩的序号 */
  endSeq?: number
  /** 压缩前的估算 token 数 */
  originalTokens?: number
  /** 总结的 token 数 */
  summaryTokens?: number
  /** 压缩比 */
  compressionRatio?: number
  /** 压缩耗时（ms） */
  duration?: number
}

// ========== 上下文监控 ==========

/**
 * 上下文快照（调试/监控用）
 *
 * 提供 Session 当前状态的全景视图：
 *   - contextItems：getItems() 返回的 LLM 上下文
 *   - allSessionItems：完整的 SessionItem 存储记录
 *   - lastSummary：最后一个 summary 的元数据
 *   - stats：统计数据
 */
export interface ContextSnapshot {
  /** getItems() 返回的 LLM 上下文（下次 run 时发送给模型的内容） */
  contextItems: AgentInputItem[]
  /** 完整的 SessionItem 存储记录（含 summary） */
  allSessionItems: SessionItem[]
  /** 最后一个 summary 的元数据（null = 尚未压缩） */
  lastSummary: SummaryMeta | null
  /** 统计信息 */
  stats: {
    /** getItems() 返回的上下文消息数 */
    contextItemCount: number
    /** 文件中的总 SessionItem 数 */
    totalSessionItems: number
    /** 其中 type=message 的数量 */
    messageCount: number
    /** 其中 type=summary 的数量 */
    summaryCount: number
  }
}
