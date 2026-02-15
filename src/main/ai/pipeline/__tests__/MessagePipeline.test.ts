import { describe, expect, it, beforeEach, vi } from 'vitest'

import { MessagePipeline } from '../MessagePipeline'

describe('MessagePipeline', () => {
  let pipeline: MessagePipeline
  let executionLog: string[]
  let executor: (sessionId: string, message: string, signal?: AbortSignal) => Promise<void>

  beforeEach(() => {
    executionLog = []
    executor = vi.fn(async (_sid: string, msg: string) => {
      executionLog.push(msg)
      // 模拟执行时间
      await sleep(50)
    })
    pipeline = new MessagePipeline(executor)
  })

  // ─── 基础执行 ──────────────────────────────────

  it('should execute immediately when session is idle', () => {
    const result = pipeline.submit('s1', 'hello')
    expect(result.status).toBe('executing')
    expect(result.sessionId).toBe('s1')
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it('should queue when session is busy (collect mode)', async () => {
    pipeline.submit('s1', 'first')
    const result = pipeline.submit('s1', 'second')

    expect(result.status).toBe('queued')
    expect(result.queuePosition).toBe(1)
  })

  // ─── Interrupt 模式 ────────────────────────────

  it('should interrupt and execute new message', async () => {
    pipeline.setQueueMode('s1', 'interrupt')
    pipeline.submit('s1', 'first')
    const result = pipeline.submit('s1', 'interrupt-msg')

    expect(result.status).toBe('interrupted')
  })

  // ─── Queue Status ──────────────────────────────

  it('should report queue status', () => {
    const status = pipeline.getQueueStatus('s1')
    expect(status.isRunning).toBe(false)
    expect(status.queueLength).toBe(0)
  })

  it('should report busy status after submit', () => {
    pipeline.submit('s1', 'hello')
    const status = pipeline.getQueueStatus('s1')
    expect(status.isRunning).toBe(true)
  })

  // ─── Abort ─────────────────────────────────────

  it('should abort session', () => {
    pipeline.submit('s1', 'hello')
    const aborted = pipeline.abort('s1')
    expect(aborted).toBe(true)
  })

  it('should return false when aborting non-running session', () => {
    expect(pipeline.abort('non-existent')).toBe(false)
  })

  // ─── Clear Queue ───────────────────────────────

  it('should clear queue', () => {
    pipeline.submit('s1', 'first')
    pipeline.submit('s1', 'second')
    pipeline.submit('s1', 'third')

    const cleared = pipeline.clearQueue('s1')
    expect(cleared).toBe(2) // two queued (first is executing)
  })

  // ─── Drain: followup ──────────────────────────

  it('should drain queued messages after run completes (followup)', async () => {
    const followupLog: string[] = []
    const followupExecutor = vi.fn(async (_sid: string, msg: string) => {
      followupLog.push(msg)
      await sleep(50)
    })
    const followupPipeline = new MessagePipeline(followupExecutor)
    followupPipeline.setQueueMode('s1', 'followup')

    followupPipeline.submit('s1', 'first')
    followupPipeline.submit('s1', 'second')
    followupPipeline.submit('s1', 'third')

    // 等待所有 drain 完成 (3 * 50ms + buffer)
    await sleep(500)

    expect(followupLog).toContain('first')
    expect(followupLog).toContain('second')
    expect(followupLog).toContain('third')
    expect(followupLog.filter((m) => m === 'first')).toHaveLength(1)
    expect(followupExecutor).toHaveBeenCalledTimes(3)
  })

  // ─── Drain: collect ───────────────────────────

  it('should drain queued messages as merged (collect)', async () => {
    const collectLog: string[] = []
    const collectExecutor = vi.fn(async (_sid: string, msg: string) => {
      collectLog.push(msg)
      await sleep(50)
    })
    const collectPipeline = new MessagePipeline(collectExecutor)
    collectPipeline.setQueueMode('s1', 'collect')

    collectPipeline.submit('s1', 'first')
    collectPipeline.submit('s1', 'second')
    collectPipeline.submit('s1', 'third')

    await sleep(300)

    expect(collectLog).toHaveLength(2) // first + merged(second+third)
    expect(collectLog[0]).toBe('first')
    expect(collectLog[1]).toContain('second')
    expect(collectLog[1]).toContain('third')
  })

  // ─── Settings ──────────────────────────────────

  it('should update global settings', () => {
    pipeline.updateGlobalSettings({ mode: 'interrupt', cap: 5 })
    // 新 session 应该使用更新后的设置
    const status = pipeline.getQueueStatus('new-session')
    expect(status.mode).toBe('interrupt')
  })

  // ─── Steer 模式 ───────────────────────────────

  it('should handle steer mode', () => {
    pipeline.setQueueMode('s1', 'steer')
    pipeline.submit('s1', 'first')
    const result = pipeline.submit('s1', 'steer-msg')

    expect(result.status).toBe('merged')
  })
})

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
