/**
 * 执行评估类型定义
 *
 * 三维度评估体系：
 *   1. 质量（Quality）：输出正确性、完整性
 *   2. 过程（Process）：处理步骤效率、工具使用合理性
 *   3. 成本（Cost）：时间消耗、Token 消耗
 *
 * 设计原则：
 *   - SDK 无关：仅依赖 StreamChunk + ExecutionResult
 *   - 可序列化：所有类型可直接 JSON.stringify
 *   - 可扩展：评估规则通过 EvaluationConfig 注入
 */

import type { StreamChunk, ExecutionResult } from '../types'

// ========== 评估输入 ==========

/**
 * 评估输入（从测试执行中收集）
 */
export interface EvaluationInput {
  /** 测试场景名称 */
  testName: string
  /** 用户输入 */
  input: string
  /** 执行结果 */
  result: ExecutionResult
  /** 流式事件列表 */
  chunks: StreamChunk[]
  /** 带时间戳的事件（可选） */
  timedChunks?: TimedChunkInfo[]
  /** 期望输出关键词（用于质量评估） */
  expectedKeywords?: string[]
  /** 期望工具调用（用于过程评估） */
  expectedTools?: string[]
  /** Session 上下文快照（可选，用于上下文可观测） */
  sessionContext?: unknown
  /** Session 文件路径（可选） */
  sessionFilePath?: string
}

/**
 * 带时间信息的事件
 */
export interface TimedChunkInfo {
  type: string
  content: string
  data?: unknown
  /** 从执行开始到此事件的毫秒数 */
  elapsed: number
  /** 事件序号（从 1 开始） */
  seq: number
}

// ========== 评估配置 ==========

/**
 * 评估配置
 */
export interface EvaluationConfig {
  /** 质量评估配置 */
  quality?: {
    /** 是否检查关键词匹配 */
    checkKeywords?: boolean
    /** 输出最小长度 */
    minOutputLength?: number
  }
  /** 过程评估配置 */
  process?: {
    /** 最大合理轮次 */
    maxReasonableTurns?: number
    /** 最大合理工具调用次数 */
    maxReasonableToolCalls?: number
    /** 是否检查空闲轮（无实际输出的轮次） */
    checkIdleTurns?: boolean
  }
  /** 成本评估配置 */
  cost?: {
    /** 最大合理耗时（ms） */
    maxReasonableDuration?: number
    /** 每 1K input token 的费用（美元） */
    inputTokenPrice?: number
    /** 每 1K output token 的费用（美元） */
    outputTokenPrice?: number
  }
}

// ========== 评估结果 ==========

/**
 * 总体评估报告
 */
export interface EvaluationReport {
  /** 测试场景名称 */
  testName: string
  /** 评估时间 */
  timestamp: string
  /** 总体评分（0-100） */
  overallScore: number
  /** 总体评级 */
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  /** 质量评估 */
  quality: QualityReport
  /** 过程评估 */
  process: ProcessReport
  /** 成本评估 */
  cost: CostReport
  /** 改进建议 */
  suggestions: string[]
}

/**
 * 质量评估报告
 */
export interface QualityReport {
  /** 评分（0-100） */
  score: number
  /** 输出是否非空 */
  hasOutput: boolean
  /** 输出长度 */
  outputLength: number
  /** 关键词匹配率 */
  keywordMatchRate: number
  /** 匹配的关键词 */
  matchedKeywords: string[]
  /** 未匹配的关键词 */
  missingKeywords: string[]
  /** 事件闭环是否完整 */
  eventsClosed: boolean
  /** 闭环检查详情 */
  closureDetails: ClosureCheck[]
}

/**
 * 闭环检查
 */
export interface ClosureCheck {
  startEvent: string
  doneEvent: string
  startCount: number
  doneCount: number
  matched: boolean
}

/**
 * 过程评估报告
 */
export interface ProcessReport {
  /** 评分（0-100） */
  score: number
  /** 总事件数 */
  totalEvents: number
  /** 轮次数 */
  turnCount: number
  /** 工具调用次数 */
  toolCallCount: number
  /** 工具列表 */
  toolsUsed: string[]
  /** 期望工具是否全部使用 */
  expectedToolsCovered: boolean
  /** 未预期的工具使用 */
  unexpectedTools: string[]
  /** LLM 调用次数 */
  llmCallCount: number
  /** 是否有空闲轮（无实际输出的轮次） */
  hasIdleTurns: boolean
  /** 推理事件数 */
  reasoningCount: number
  /** 压缩事件数 */
  compressionCount: number
  /** 事件类型分布 */
  eventDistribution: Record<string, number>
}

/**
 * 成本评估报告
 */
export interface CostReport {
  /** 评分（0-100） */
  score: number
  /** 总耗时（ms） */
  duration: number
  /** 首次输出时间（ms，text:delta 或 reasoning:delta） */
  timeToFirstToken: number
  /** 首次工具调用时间（ms） */
  timeToFirstToolCall: number
  /** Token 使用情况 */
  tokenUsage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  /** 估算费用（美元） */
  estimatedCost: number
  /** 各阶段耗时 */
  phaseDurations: PhaseDuration[]
}

/**
 * 阶段耗时
 */
export interface PhaseDuration {
  /** 阶段名（如 "turn-1", "tool-add_numbers", "reasoning"） */
  phase: string
  /** 开始时间（ms，相对于执行开始） */
  startMs: number
  /** 结束时间（ms） */
  endMs: number
  /** 耗时（ms） */
  durationMs: number
}
