import { describe, expect, it, beforeEach } from 'vitest'

import { CostTracker } from '../CostTracker'
import type { ModelCostConfig, ModelRef } from '../types'

describe('CostTracker', () => {
  let tracker: CostTracker

  const gpt4oRef: ModelRef = { provider: 'openai', model: 'gpt-4o' }
  const qwen3Ref: ModelRef = { provider: 'aliyun', model: 'qwen3-max' }

  const gpt4oCost: ModelCostConfig = { input: 2.5, output: 10 }
  const qwen3Cost: ModelCostConfig = { input: 2, output: 8, cacheRead: 0.2 }

  beforeEach(() => {
    tracker = new CostTracker()
  })

  it('should start with no records', () => {
    expect(tracker.getRecords()).toEqual([])
    expect(tracker.getTotalCost()).toBe(0)
  })

  it('should record usage and calculate cost', () => {
    const record = tracker.record(gpt4oRef, { inputTokens: 1000, outputTokens: 500 }, gpt4oCost)

    // 1000/1M * 2.5 + 500/1M * 10 = 0.0025 + 0.005 = 0.0075
    expect(record.cost).toBeCloseTo(0.0075, 6)
    expect(record.inputTokens).toBe(1000)
    expect(record.outputTokens).toBe(500)
  })

  it('should include cache tokens in cost', () => {
    const record = tracker.record(
      qwen3Ref,
      { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000 },
      qwen3Cost
    )

    // 1000/1M * 2 + 500/1M * 8 + 2000/1M * 0.2 = 0.002 + 0.004 + 0.0004 = 0.0064
    expect(record.cost).toBeCloseTo(0.0064, 6)
  })

  it('should record zero cost when no cost config', () => {
    const record = tracker.record(gpt4oRef, { inputTokens: 1000, outputTokens: 500 })
    expect(record.cost).toBe(0)
  })

  it('should accumulate total cost', () => {
    tracker.record(gpt4oRef, { inputTokens: 1_000_000, outputTokens: 500_000 }, gpt4oCost)
    tracker.record(qwen3Ref, { inputTokens: 1_000_000, outputTokens: 500_000 }, qwen3Cost)

    // gpt4o: 1M/1M*2.5 + 0.5M/1M*10 = 2.5 + 5 = 7.5
    // qwen3: 1M/1M*2 + 0.5M/1M*8 = 2 + 4 = 6
    expect(tracker.getTotalCost()).toBeCloseTo(13.5, 4)
  })

  it('should calculate total tokens', () => {
    tracker.record(gpt4oRef, { inputTokens: 100, outputTokens: 50 })
    tracker.record(qwen3Ref, { inputTokens: 200, outputTokens: 80 })

    const totals = tracker.getTotalTokens()
    expect(totals.input).toBe(300)
    expect(totals.output).toBe(130)
  })

  it('should summarize by model', () => {
    tracker.record(gpt4oRef, { inputTokens: 100, outputTokens: 50 }, gpt4oCost)
    tracker.record(gpt4oRef, { inputTokens: 200, outputTokens: 80 }, gpt4oCost)
    tracker.record(qwen3Ref, { inputTokens: 300, outputTokens: 100 }, qwen3Cost)

    const summaries = tracker.getSummaryByModel()
    expect(summaries).toHaveLength(2)

    const gpt4oSummary = summaries.find((s) => s.modelRef === 'openai/gpt-4o')
    expect(gpt4oSummary?.totalCalls).toBe(2)
    expect(gpt4oSummary?.totalInputTokens).toBe(300)
    expect(gpt4oSummary?.totalOutputTokens).toBe(130)

    const qwenSummary = summaries.find((s) => s.modelRef === 'aliyun/qwen3-max')
    expect(qwenSummary?.totalCalls).toBe(1)
  })

  it('should filter records by time', () => {
    const now = Date.now()
    tracker.record(gpt4oRef, { inputTokens: 100, outputTokens: 50 })

    const recent = tracker.getRecordsSince(now - 1000)
    expect(recent).toHaveLength(1)

    const future = tracker.getRecordsSince(now + 60_000)
    expect(future).toHaveLength(0)
  })

  it('should clear all records', () => {
    tracker.record(gpt4oRef, { inputTokens: 100, outputTokens: 50 })
    tracker.record(qwen3Ref, { inputTokens: 200, outputTokens: 80 })
    tracker.clear()

    expect(tracker.getRecords()).toEqual([])
    expect(tracker.getTotalCost()).toBe(0)
  })
})
