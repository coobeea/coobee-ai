/**
 * 执行评估器
 *
 * 独立、通用的评估模块，适用于所有 AgentRuntime 实现。
 *
 * 三维度评估：
 *   1. 质量（40%）：输出正确性、关键词匹配、事件闭环
 *   2. 过程（30%）：处理效率、工具使用、轮次合理性
 *   3. 成本（30%）：时间消耗、Token 消耗、费用估算
 *
 * 使用方式：
 *   const evaluator = new ExecutionEvaluator(config?)
 *   const report = evaluator.evaluate(input)
 *   const formatted = ExecutionEvaluator.formatReport(report)
 */

import type { StreamChunk } from '../types'
import type {
  EvaluationInput,
  EvaluationConfig,
  EvaluationReport,
  QualityReport,
  ProcessReport,
  CostReport,
  ClosureCheck,
  PhaseDuration,
  TimedChunkInfo
} from './types'

// ========== 默认配置 ==========

const DEFAULT_CONFIG: Required<EvaluationConfig> = {
  quality: {
    checkKeywords: true,
    minOutputLength: 1
  },
  process: {
    maxReasonableTurns: 10,
    maxReasonableToolCalls: 15,
    checkIdleTurns: true
  },
  cost: {
    maxReasonableDuration: 120_000, // 2 分钟
    inputTokenPrice: 0.3 / 1000, // $/1K tokens（MiniMax M2.1）
    outputTokenPrice: 1.2 / 1000 // $/1K tokens
  }
}

// ========== 权重 ==========

const WEIGHT_QUALITY = 0.4
const WEIGHT_PROCESS = 0.3
const WEIGHT_COST = 0.3

// ========== 解析后的配置（所有字段必填） ==========

interface ResolvedConfig {
  quality: { checkKeywords: boolean; minOutputLength: number }
  process: { maxReasonableTurns: number; maxReasonableToolCalls: number; checkIdleTurns: boolean }
  cost: { maxReasonableDuration: number; inputTokenPrice: number; outputTokenPrice: number }
}

// ========== 评估器 ==========

export class ExecutionEvaluator {
  private readonly config: ResolvedConfig

  constructor(config?: EvaluationConfig) {
    // 展开合并保证所有字段有值，DEFAULT_CONFIG 提供兜底
    this.config = {
      quality: { ...DEFAULT_CONFIG.quality, ...config?.quality } as ResolvedConfig['quality'],
      process: { ...DEFAULT_CONFIG.process, ...config?.process } as ResolvedConfig['process'],
      cost: { ...DEFAULT_CONFIG.cost, ...config?.cost } as ResolvedConfig['cost']
    }
  }

  /**
   * 执行评估
   */
  evaluate(input: EvaluationInput): EvaluationReport {
    const quality = this.evaluateQuality(input)
    const process = this.evaluateProcess(input)
    const cost = this.evaluateCost(input)

    const overallScore = Math.round(
      quality.score * WEIGHT_QUALITY + process.score * WEIGHT_PROCESS + cost.score * WEIGHT_COST
    )

    const grade = this.scoreToGrade(overallScore)
    const suggestions = this.generateSuggestions(quality, process, cost, input)

    return {
      testName: input.testName,
      timestamp: new Date().toISOString(),
      overallScore,
      grade,
      quality,
      process,
      cost,
      suggestions
    }
  }

  // ========== 质量评估 ==========

  private evaluateQuality(input: EvaluationInput): QualityReport {
    const { result, chunks, expectedKeywords = [] } = input
    let score = 0

    // 1. 输出非空（30分）
    const hasOutput = !!result.output && result.output.trim().length > 0
    if (hasOutput) score += 30

    // 2. 输出长度合理（20分）
    const outputLength = result.output?.length || 0
    const minLen = this.config.quality.minOutputLength
    if (outputLength >= minLen) {
      score += Math.min(20, Math.floor((outputLength / Math.max(minLen, 10)) * 10))
    }

    // 3. 关键词匹配（30分）
    const matchedKeywords: string[] = []
    const missingKeywords: string[] = []
    if (this.config.quality.checkKeywords && expectedKeywords.length > 0) {
      const outputLower = (result.output || '').toLowerCase()
      for (const kw of expectedKeywords) {
        if (outputLower.includes(kw.toLowerCase())) {
          matchedKeywords.push(kw)
        } else {
          missingKeywords.push(kw)
        }
      }
      const matchRate = matchedKeywords.length / expectedKeywords.length
      score += Math.round(matchRate * 30)
    } else {
      // 无关键词检查，给满分
      score += 30
    }

    // 4. 事件闭环（20分）
    const closureDetails = this.checkClosures(chunks)
    const eventsClosed = closureDetails.every((c) => c.matched)
    if (eventsClosed) score += 20

    const keywordMatchRate =
      expectedKeywords.length > 0 ? matchedKeywords.length / expectedKeywords.length : 1

    return {
      score: Math.min(100, score),
      hasOutput,
      outputLength,
      keywordMatchRate,
      matchedKeywords,
      missingKeywords,
      eventsClosed,
      closureDetails
    }
  }

  // ========== 过程评估 ==========

  private evaluateProcess(input: EvaluationInput): ProcessReport {
    const { chunks, expectedTools = [] } = input
    let score = 100

    // 事件类型分布
    const eventDistribution: Record<string, number> = {}
    for (const c of chunks) {
      eventDistribution[c.type] = (eventDistribution[c.type] || 0) + 1
    }

    const turnCount = eventDistribution['turn:start'] || 0
    const toolCallCount = eventDistribution['tool:start'] || 0
    const llmCallCount = eventDistribution['llm:start'] || 0
    const reasoningCount = eventDistribution['reasoning:start'] || 0
    const compressionCount = eventDistribution['compression:start'] || 0

    // 工具使用分析
    const toolStarts = chunks.filter((c) => c.type === 'tool:start')
    const toolsUsed = [
      ...new Set(
        toolStarts.map((c) => {
          const d = c.data as { toolName?: string } | undefined
          return d?.toolName || c.content || 'unknown'
        })
      )
    ]
    const unexpectedTools =
      expectedTools.length > 0 ? toolsUsed.filter((t) => !expectedTools.includes(t)) : []
    const expectedToolsCovered =
      expectedTools.length === 0 || expectedTools.every((t) => toolsUsed.includes(t))

    // 1. 轮次合理性（-10 分/超出轮）
    if (turnCount > this.config.process.maxReasonableTurns) {
      const excess = turnCount - this.config.process.maxReasonableTurns
      score -= excess * 10
    }

    // 2. 工具调用合理性（-5 分/超出次）
    if (toolCallCount > this.config.process.maxReasonableToolCalls) {
      const excess = toolCallCount - this.config.process.maxReasonableToolCalls
      score -= excess * 5
    }

    // 3. 未预期工具使用（-10 分/个）
    if (unexpectedTools.length > 0) {
      score -= unexpectedTools.length * 10
    }

    // 4. 期望工具未覆盖（-15 分）
    if (!expectedToolsCovered) {
      score -= 15
    }

    // 5. 空闲轮检测
    let hasIdleTurns = false
    if (this.config.process.checkIdleTurns) {
      // 检查是否有轮次没有产生任何 text:delta 或 tool:start
      hasIdleTurns = this.detectIdleTurns(chunks)
      if (hasIdleTurns) score -= 10
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      totalEvents: chunks.length,
      turnCount,
      toolCallCount,
      toolsUsed,
      expectedToolsCovered,
      unexpectedTools,
      llmCallCount,
      hasIdleTurns,
      reasoningCount,
      compressionCount,
      eventDistribution
    }
  }

  // ========== 成本评估 ==========

  private evaluateCost(input: EvaluationInput): CostReport {
    const { result, chunks, timedChunks } = input
    let score = 100

    const duration = result.duration || 0

    // Token 统计（从 llm:done 事件聚合）
    const llmDones = chunks.filter((c) => c.type === 'llm:done')
    let inputTokens = 0
    let outputTokens = 0
    for (const ld of llmDones) {
      const d = ld.data as { usage?: { inputTokens?: number; outputTokens?: number } } | undefined
      if (d?.usage) {
        inputTokens += d.usage.inputTokens || 0
        outputTokens += d.usage.outputTokens || 0
      }
    }
    const totalTokens = inputTokens + outputTokens

    // 估算费用
    const estimatedCost =
      (inputTokens / 1000) * this.config.cost.inputTokenPrice +
      (outputTokens / 1000) * this.config.cost.outputTokenPrice

    // 首次输出时间
    let timeToFirstToken = 0
    let timeToFirstToolCall = 0
    if (timedChunks && timedChunks.length > 0) {
      const firstOutput = timedChunks.find(
        (tc) => tc.type === 'text:delta' || tc.type === 'reasoning:delta'
      )
      timeToFirstToken = firstOutput?.elapsed || 0

      const firstTool = timedChunks.find((tc) => tc.type === 'tool:start')
      timeToFirstToolCall = firstTool?.elapsed || 0
    }

    // 各阶段耗时
    const phaseDurations = this.calculatePhaseDurations(timedChunks || [])

    // 评分
    // 1. 耗时（-1 分/超出 5 秒）
    if (duration > this.config.cost.maxReasonableDuration) {
      const excessSeconds = (duration - this.config.cost.maxReasonableDuration) / 1000
      score -= Math.floor(excessSeconds / 5)
    }

    // 2. 首次输出时间（>10s 扣分）
    if (timeToFirstToken > 10_000) {
      score -= Math.floor((timeToFirstToken - 10_000) / 2000)
    }

    // 3. Token 使用效率（基于 input/output 比例）
    // input 远大于 output 说明上下文膨胀
    if (inputTokens > 0 && outputTokens > 0) {
      const ratio = inputTokens / outputTokens
      if (ratio > 50) score -= 10 // 输入远大于输出，上下文可能膨胀
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      duration,
      timeToFirstToken,
      timeToFirstToolCall,
      tokenUsage: { inputTokens, outputTokens, totalTokens },
      estimatedCost: Math.round(estimatedCost * 1_000_000) / 1_000_000, // 保留 6 位小数
      phaseDurations
    }
  }

  // ========== 辅助方法 ==========

  private checkClosures(chunks: StreamChunk[]): ClosureCheck[] {
    const counts: Record<string, number> = {}
    for (const c of chunks) {
      counts[c.type] = (counts[c.type] || 0) + 1
    }

    const pairs: [string, string][] = [
      ['run:start', 'run:done'],
      ['turn:start', 'turn:done'],
      ['llm:start', 'llm:done'],
      ['text:start', 'text:done'],
      ['reasoning:start', 'reasoning:done'],
      ['tool:start', 'tool:done'],
      ['compression:start', 'compression:done']
    ]

    return pairs
      .filter(([s, d]) => (counts[s] || 0) > 0 || (counts[d] || 0) > 0)
      .map(([s, d]) => ({
        startEvent: s,
        doneEvent: d,
        startCount: counts[s] || 0,
        doneCount: counts[d] || 0,
        matched: (counts[s] || 0) === (counts[d] || 0)
      }))
  }

  private detectIdleTurns(chunks: StreamChunk[]): boolean {
    let inTurn = false
    let hasContent = false

    for (const c of chunks) {
      if (c.type === 'turn:start') {
        inTurn = true
        hasContent = false
      } else if (c.type === 'turn:done') {
        if (inTurn && !hasContent) return true
        inTurn = false
      } else if (
        inTurn &&
        (c.type === 'text:delta' || c.type === 'tool:start' || c.type === 'reasoning:delta')
      ) {
        hasContent = true
      }
    }

    return false
  }

  private calculatePhaseDurations(timedChunks: TimedChunkInfo[]): PhaseDuration[] {
    const phases: PhaseDuration[] = []
    if (timedChunks.length === 0) return phases

    let currentTurnStart = 0
    let turnIdx = 0

    for (let i = 0; i < timedChunks.length; i++) {
      const tc = timedChunks[i]

      if (tc.type === 'turn:start') {
        turnIdx++
        currentTurnStart = tc.elapsed
      }
      if (tc.type === 'turn:done') {
        phases.push({
          phase: `turn-${turnIdx}`,
          startMs: currentTurnStart,
          endMs: tc.elapsed,
          durationMs: tc.elapsed - currentTurnStart
        })
      }
      if (tc.type === 'tool:start') {
        // 找到对应的 tool:done
        const toolName = (tc.data as { toolName?: string })?.toolName || tc.content || 'unknown'
        const done = timedChunks
          .slice(i + 1)
          .find(
            (t) =>
              t.type === 'tool:done' &&
              ((t.data as { toolName?: string })?.toolName || '') === toolName
          )
        if (done) {
          phases.push({
            phase: `tool-${toolName}`,
            startMs: tc.elapsed,
            endMs: done.elapsed,
            durationMs: done.elapsed - tc.elapsed
          })
        }
      }
      if (tc.type === 'reasoning:start') {
        const done = timedChunks.slice(i + 1).find((t) => t.type === 'reasoning:done')
        if (done) {
          phases.push({
            phase: `reasoning-${turnIdx}`,
            startMs: tc.elapsed,
            endMs: done.elapsed,
            durationMs: done.elapsed - tc.elapsed
          })
        }
      }
    }

    return phases
  }

  private scoreToGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= 90) return 'A'
    if (score >= 80) return 'B'
    if (score >= 70) return 'C'
    if (score >= 60) return 'D'
    return 'F'
  }

  private generateSuggestions(
    quality: QualityReport,
    process: ProcessReport,
    cost: CostReport,
    input: EvaluationInput
  ): string[] {
    const suggestions: string[] = []

    // 质量建议
    if (!quality.hasOutput) {
      suggestions.push('[质量] 输出为空，检查 LLM 调用是否正常返回')
    }
    if (quality.missingKeywords.length > 0) {
      suggestions.push(`[质量] 缺失关键词: ${quality.missingKeywords.join(', ')}`)
    }
    if (!quality.eventsClosed) {
      const broken = quality.closureDetails.filter((c) => !c.matched)
      for (const b of broken) {
        suggestions.push(
          `[质量] 事件闭环不匹配: ${b.startEvent}(${b.startCount}) / ${b.doneEvent}(${b.doneCount})`
        )
      }
    }

    // 过程建议
    if (process.turnCount > (input.expectedTools?.length || 1) + 2) {
      suggestions.push(`[过程] 轮次较多(${process.turnCount})，考虑优化指令使 LLM 减少不必要的迭代`)
    }
    if (process.hasIdleTurns) {
      suggestions.push('[过程] 存在空闲轮（无实际输出），可能是 LLM 犹豫或重复调用')
    }
    if (process.unexpectedTools.length > 0) {
      suggestions.push(
        `[过程] 使用了未预期的工具: ${process.unexpectedTools.join(', ')}，检查指令清晰度`
      )
    }
    if (!process.expectedToolsCovered && (input.expectedTools?.length || 0) > 0) {
      suggestions.push('[过程] 未使用所有预期工具，检查工具描述和指令')
    }

    // 成本建议
    if (cost.timeToFirstToken > 10_000) {
      suggestions.push(
        `[成本] 首次输出时间过长(${(cost.timeToFirstToken / 1000).toFixed(1)}s)，可能需要优化系统提示词`
      )
    }
    if (cost.tokenUsage.inputTokens > 50_000) {
      suggestions.push(`[成本] 输入 Token 过多(${cost.tokenUsage.inputTokens})，考虑启用会话压缩`)
    }
    if (cost.duration > 60_000) {
      suggestions.push(
        `[成本] 总耗时超过 60s(${(cost.duration / 1000).toFixed(1)}s)，考虑限制最大轮次`
      )
    }

    if (suggestions.length === 0) {
      suggestions.push('无明显改进点，执行表现良好')
    }

    return suggestions
  }

  // ========== 格式化输出 ==========

  /**
   * 格式化评估报告为可读文本
   */
  static formatReport(report: EvaluationReport): string {
    const sep = '═'.repeat(72)
    const sub = '─'.repeat(72)
    const lines: string[] = []

    lines.push('')
    lines.push(sep)
    lines.push(`  评估报告: ${report.testName}`)
    lines.push(`  评估时间: ${report.timestamp}`)
    lines.push(`  总体评分: ${report.overallScore}/100  评级: ${report.grade}`)
    lines.push(sep)

    // 质量
    lines.push('')
    lines.push(`  ● 质量评估 (${report.quality.score}/100, 权重 ${WEIGHT_QUALITY * 100}%)`)
    lines.push(sub)
    lines.push(`    输出非空: ${report.quality.hasOutput ? '✓' : '✗'}`)
    lines.push(`    输出长度: ${report.quality.outputLength} 字符`)
    lines.push(`    关键词匹配: ${(report.quality.keywordMatchRate * 100).toFixed(0)}%`)
    if (report.quality.matchedKeywords.length > 0) {
      lines.push(`    ✓ 匹配: ${report.quality.matchedKeywords.join(', ')}`)
    }
    if (report.quality.missingKeywords.length > 0) {
      lines.push(`    ✗ 缺失: ${report.quality.missingKeywords.join(', ')}`)
    }
    lines.push(`    事件闭环: ${report.quality.eventsClosed ? '✓ 完整' : '✗ 不完整'}`)
    for (const c of report.quality.closureDetails) {
      const mark = c.matched ? '✓' : '✗'
      lines.push(
        `      ${mark} ${c.startEvent.padEnd(20)} / ${c.doneEvent.padEnd(20)} : ${c.startCount}/${c.doneCount}`
      )
    }

    // 过程
    lines.push('')
    lines.push(`  ● 过程评估 (${report.process.score}/100, 权重 ${WEIGHT_PROCESS * 100}%)`)
    lines.push(sub)
    lines.push(`    总事件数: ${report.process.totalEvents}`)
    lines.push(`    轮次: ${report.process.turnCount}`)
    lines.push(`    LLM 调用: ${report.process.llmCallCount}`)
    lines.push(`    工具调用: ${report.process.toolCallCount}`)
    lines.push(`    使用工具: ${report.process.toolsUsed.join(', ') || '无'}`)
    lines.push(`    推理事件: ${report.process.reasoningCount}`)
    lines.push(`    压缩事件: ${report.process.compressionCount}`)
    lines.push(`    空闲轮: ${report.process.hasIdleTurns ? '✗ 是' : '✓ 无'}`)
    lines.push(`    事件分布:`)
    for (const [type, count] of Object.entries(report.process.eventDistribution).sort()) {
      lines.push(`      ${type.padEnd(22)} : ${count}`)
    }

    // 成本
    lines.push('')
    lines.push(`  ● 成本评估 (${report.cost.score}/100, 权重 ${WEIGHT_COST * 100}%)`)
    lines.push(sub)
    lines.push(`    总耗时: ${(report.cost.duration / 1000).toFixed(2)}s`)
    lines.push(
      `    首次输出: ${report.cost.timeToFirstToken > 0 ? (report.cost.timeToFirstToken / 1000).toFixed(2) + 's' : 'N/A'}`
    )
    lines.push(
      `    首次工具: ${report.cost.timeToFirstToolCall > 0 ? (report.cost.timeToFirstToolCall / 1000).toFixed(2) + 's' : 'N/A'}`
    )
    lines.push(`    Token 使用:`)
    lines.push(`      输入: ${report.cost.tokenUsage.inputTokens}`)
    lines.push(`      输出: ${report.cost.tokenUsage.outputTokens}`)
    lines.push(`      合计: ${report.cost.tokenUsage.totalTokens}`)
    lines.push(`    估算费用: $${report.cost.estimatedCost.toFixed(6)}`)
    if (report.cost.phaseDurations.length > 0) {
      lines.push(`    阶段耗时:`)
      for (const p of report.cost.phaseDurations) {
        lines.push(
          `      ${p.phase.padEnd(25)} : ${p.startMs}ms → ${p.endMs}ms (${p.durationMs}ms)`
        )
      }
    }

    // 建议
    lines.push('')
    lines.push(`  ● 改进建议`)
    lines.push(sub)
    for (const s of report.suggestions) {
      lines.push(`    ${s}`)
    }

    lines.push('')
    lines.push(sep)

    return lines.join('\n')
  }

  /**
   * 格式化多个报告的对比汇总
   */
  static formatSummary(reports: EvaluationReport[]): string {
    const sep = '═'.repeat(88)
    const lines: string[] = []

    lines.push('')
    lines.push(sep)
    lines.push('  执行评估汇总')
    lines.push(sep)
    lines.push('')

    // 表头
    const header = [
      '场景'.padEnd(30),
      '总分'.padStart(5),
      '级'.padStart(3),
      '质量'.padStart(5),
      '过程'.padStart(5),
      '成本'.padStart(5),
      '耗时'.padStart(8),
      'Token'.padStart(8),
      '费用'.padStart(10)
    ].join('  ')
    lines.push(`  ${header}`)
    lines.push(`  ${'─'.repeat(86)}`)

    for (const r of reports) {
      const row = [
        r.testName.slice(0, 30).padEnd(30),
        String(r.overallScore).padStart(5),
        r.grade.padStart(3),
        String(r.quality.score).padStart(5),
        String(r.process.score).padStart(5),
        String(r.cost.score).padStart(5),
        `${(r.cost.duration / 1000).toFixed(1)}s`.padStart(8),
        String(r.cost.tokenUsage.totalTokens).padStart(8),
        `$${r.cost.estimatedCost.toFixed(4)}`.padStart(10)
      ].join('  ')
      lines.push(`  ${row}`)
    }

    // 汇总
    if (reports.length > 0) {
      lines.push(`  ${'─'.repeat(86)}`)
      const avgScore = Math.round(reports.reduce((s, r) => s + r.overallScore, 0) / reports.length)
      const totalDuration = reports.reduce((s, r) => s + r.cost.duration, 0)
      const totalTokens = reports.reduce((s, r) => s + r.cost.tokenUsage.totalTokens, 0)
      const totalCost = reports.reduce((s, r) => s + r.cost.estimatedCost, 0)
      lines.push(
        `  ${'汇总'.padEnd(30)}  ${String(avgScore).padStart(5)}  ${''.padStart(3)}  ` +
          `${''.padStart(5)}  ${''.padStart(5)}  ${''.padStart(5)}  ` +
          `${(totalDuration / 1000).toFixed(1) + 's'}  ` +
          `${String(totalTokens).padStart(8)}  ` +
          `${'$' + totalCost.toFixed(4)}`.padStart(10)
      )
    }

    lines.push('')
    lines.push(sep)
    return lines.join('\n')
  }
}
