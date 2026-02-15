/**
 * HitlApprovalManager 全面测试
 *
 * 覆盖维度：
 *   - waitForDecisions / submitDecision 基本流程
 *   - 多工具审批（全部完成后才 resolve）
 *   - 超时处理
 *   - 幂等（重复 submit 同一 index）
 *   - 边界情况（无效 index、无 pending、count=0）
 *   - getPendingInfo 状态查询
 *   - cleanup / cleanupAll 清理
 *   - 多 session 隔离
 *   - 并发审批提交
 *   - 超时计时器清理（防泄漏）
 *   - 决策类型完整覆盖
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HitlApprovalManager, DEFAULT_HITL_TIMEOUT_MS } from '../HitlApprovalManager'

vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

describe('HitlApprovalManager', () => {
  let manager: HitlApprovalManager

  beforeEach(() => {
    vi.useFakeTimers()
    manager = new HitlApprovalManager()
  })

  afterEach(() => {
    manager.cleanupAll()
    vi.useRealTimers()
  })

  // ========== 基本流程 ==========

  describe('基本流程', () => {
    it('单工具审批：submit 后立即 resolve', async () => {
      const promise = manager.waitForDecisions('session-1', 1)

      manager.submitDecision('session-1', 0, 'approve-once')

      const result = await promise
      expect(result).toEqual(['approve-once'])
    })

    it('多工具审批：全部 submit 后才 resolve', async () => {
      const promise = manager.waitForDecisions('session-1', 3)

      expect(manager.submitDecision('session-1', 0, 'approve-once')).toBe(true)
      expect(manager.submitDecision('session-1', 1, 'approve-always')).toBe(true)

      expect(manager.hasPending('session-1')).toBe(true)

      expect(manager.submitDecision('session-1', 2, 'reject')).toBe(true)

      const result = await promise
      expect(result).toEqual(['approve-once', 'approve-always', 'reject'])
      expect(manager.hasPending('session-1')).toBe(false)
    })

    it('两个工具审批：approve + reject 混合', async () => {
      const promise = manager.waitForDecisions('session-1', 2)

      manager.submitDecision('session-1', 0, 'approve-once')
      manager.submitDecision('session-1', 1, 'reject')

      const result = await promise
      expect(result).toEqual(['approve-once', 'reject'])
    })

    it('所有三种决策类型都能正确使用', async () => {
      const promise = manager.waitForDecisions('session-1', 3)

      manager.submitDecision('session-1', 0, 'approve-once')
      manager.submitDecision('session-1', 1, 'approve-always')
      manager.submitDecision('session-1', 2, 'reject')

      const result = await promise
      expect(result).toEqual(['approve-once', 'approve-always', 'reject'])
    })

    it('逆序提交也能正确 resolve', async () => {
      const promise = manager.waitForDecisions('session-1', 3)

      manager.submitDecision('session-1', 2, 'reject')
      manager.submitDecision('session-1', 1, 'approve-always')
      manager.submitDecision('session-1', 0, 'approve-once')

      const result = await promise
      expect(result).toEqual(['approve-once', 'approve-always', 'reject'])
    })
  })

  // ========== 超时处理 ==========

  describe('超时处理', () => {
    it('超时后 resolve(null)', async () => {
      const promise = manager.waitForDecisions('session-1', 2, 1000)

      manager.submitDecision('session-1', 0, 'approve-once')

      vi.advanceTimersByTime(1001)

      const result = await promise
      expect(result).toBeNull()
      expect(manager.hasPending('session-1')).toBe(false)
    })

    it('在超时前全部提交则不触发超时', async () => {
      const promise = manager.waitForDecisions('session-1', 1, 5000)

      manager.submitDecision('session-1', 0, 'reject')

      const result = await promise
      expect(result).toEqual(['reject'])

      // 推进超时后不应有副作用
      vi.advanceTimersByTime(6000)
    })

    it('默认超时为 120 秒', () => {
      expect(DEFAULT_HITL_TIMEOUT_MS).toBe(120_000)
    })

    it('自定义短超时', async () => {
      const promise = manager.waitForDecisions('session-1', 1, 100)

      vi.advanceTimersByTime(101)

      const result = await promise
      expect(result).toBeNull()
    })

    it('超时后提交决策返回 false', async () => {
      const promise = manager.waitForDecisions('session-1', 1, 100)

      vi.advanceTimersByTime(101)
      await promise

      expect(manager.submitDecision('session-1', 0, 'approve-once')).toBe(false)
    })
  })

  // ========== 幂等 ==========

  describe('幂等', () => {
    it('重复提交同一 index 不重复计数', async () => {
      const promise = manager.waitForDecisions('session-1', 2)

      manager.submitDecision('session-1', 0, 'approve-once')
      manager.submitDecision('session-1', 0, 'approve-always')

      expect(manager.hasPending('session-1')).toBe(true)

      manager.submitDecision('session-1', 1, 'reject')

      const result = await promise
      expect(result).toEqual(['approve-always', 'reject'])
    })

    it('三次提交同一 index，取最后一次', async () => {
      const promise = manager.waitForDecisions('session-1', 1)

      manager.submitDecision('session-1', 0, 'reject')
      manager.submitDecision('session-1', 0, 'approve-once')
      manager.submitDecision('session-1', 0, 'approve-always')

      // 第一次 submit 就已经 resolve 了（因为 count=1）
      const result = await promise
      // resolve 时使用的是第一次 submit 的值
      expect(result).toEqual(['reject'])
    })

    it('幂等提交已决策的 index 返回 true', () => {
      manager.waitForDecisions('session-1', 2)

      expect(manager.submitDecision('session-1', 0, 'approve-once')).toBe(true)
      // 幂等重复提交
      expect(manager.submitDecision('session-1', 0, 'approve-always')).toBe(true)
    })
  })

  // ========== 边界情况 ==========

  describe('边界情况', () => {
    it('无 pending 时 submitDecision 返回 false', () => {
      expect(manager.submitDecision('no-session', 0, 'reject')).toBe(false)
    })

    it('无效 index 返回 false（负数）', async () => {
      manager.waitForDecisions('session-1', 2)

      expect(manager.submitDecision('session-1', -1, 'reject')).toBe(false)
    })

    it('无效 index 返回 false（超出范围）', async () => {
      manager.waitForDecisions('session-1', 2)

      expect(manager.submitDecision('session-1', 5, 'reject')).toBe(false)
    })

    it('hasPending 正确反映状态', () => {
      expect(manager.hasPending('session-1')).toBe(false)

      manager.waitForDecisions('session-1', 1)
      expect(manager.hasPending('session-1')).toBe(true)

      manager.submitDecision('session-1', 0, 'approve-once')
      expect(manager.hasPending('session-1')).toBe(false)
    })

    it('连续调用 waitForDecisions 同一 session 会清理旧的', async () => {
      const promise1 = manager.waitForDecisions('session-1', 1, 5000)

      // 再次调用会清理旧的
      const promise2 = manager.waitForDecisions('session-1', 1, 5000)

      // 旧的被清理（resolve(null)）
      const result1 = await promise1
      expect(result1).toBeNull()

      // 新的正常工作
      manager.submitDecision('session-1', 0, 'approve-once')
      const result2 = await promise2
      expect(result2).toEqual(['approve-once'])
    })
  })

  // ========== getPendingInfo ==========

  describe('getPendingInfo', () => {
    it('返回当前审批进度', () => {
      manager.waitForDecisions('session-1', 3)
      manager.submitDecision('session-1', 1, 'reject')

      const info = manager.getPendingInfo('session-1')
      expect(info).toEqual({
        totalCount: 3,
        resolvedCount: 1,
        decisions: [null, 'reject', null]
      })
    })

    it('无 pending 返回 null', () => {
      expect(manager.getPendingInfo('no-session')).toBeNull()
    })

    it('全部提交后 info 为 null（已清理）', async () => {
      const promise = manager.waitForDecisions('session-1', 1)
      manager.submitDecision('session-1', 0, 'approve-once')
      await promise

      expect(manager.getPendingInfo('session-1')).toBeNull()
    })

    it('返回的 decisions 是副本（不影响内部状态）', () => {
      manager.waitForDecisions('session-1', 2)
      manager.submitDecision('session-1', 0, 'approve-once')

      const info = manager.getPendingInfo('session-1')!
      info.decisions[0] = 'reject' // 修改副本
      info.decisions[1] = 'approve-always' // 修改副本

      // 内部状态不受影响
      const info2 = manager.getPendingInfo('session-1')!
      expect(info2.decisions[0]).toBe('approve-once')
      expect(info2.decisions[1]).toBeNull()
    })

    it('resolvedCount 正确累计', () => {
      manager.waitForDecisions('session-1', 3)

      expect(manager.getPendingInfo('session-1')!.resolvedCount).toBe(0)

      manager.submitDecision('session-1', 0, 'approve-once')
      expect(manager.getPendingInfo('session-1')!.resolvedCount).toBe(1)

      manager.submitDecision('session-1', 2, 'reject')
      expect(manager.getPendingInfo('session-1')!.resolvedCount).toBe(2)
    })
  })

  // ========== cleanup ==========

  describe('cleanup', () => {
    it('cleanup 清理指定 session 并 resolve(null)', async () => {
      const promise = manager.waitForDecisions('session-1', 2)

      manager.cleanup('session-1')

      const result = await promise
      expect(result).toBeNull()
      expect(manager.hasPending('session-1')).toBe(false)
    })

    it('cleanup 不存在的 session 不报错', () => {
      expect(() => manager.cleanup('nonexistent')).not.toThrow()
    })

    it('cleanupAll 清理所有 pending', async () => {
      const p1 = manager.waitForDecisions('session-1', 1)
      const p2 = manager.waitForDecisions('session-2', 1)

      manager.cleanupAll()

      expect(await p1).toBeNull()
      expect(await p2).toBeNull()
    })

    it('cleanupAll 清理后都不 hasPending', async () => {
      manager.waitForDecisions('s1', 1)
      manager.waitForDecisions('s2', 1)
      manager.waitForDecisions('s3', 1)

      manager.cleanupAll()

      expect(manager.hasPending('s1')).toBe(false)
      expect(manager.hasPending('s2')).toBe(false)
      expect(manager.hasPending('s3')).toBe(false)
    })

    it('cleanup 后超时不会重复 resolve', async () => {
      const promise = manager.waitForDecisions('session-1', 1, 1000)

      manager.cleanup('session-1')
      const result1 = await promise
      expect(result1).toBeNull()

      // 推进超时，不应有额外副作用
      vi.advanceTimersByTime(2000)
    })
  })

  // ========== 多 session 隔离 ==========

  describe('多 session 隔离', () => {
    it('不同 session 的审批互不干扰', async () => {
      const p1 = manager.waitForDecisions('session-1', 1)
      const p2 = manager.waitForDecisions('session-2', 1)

      manager.submitDecision('session-1', 0, 'approve-once')
      manager.submitDecision('session-2', 0, 'reject')

      expect(await p1).toEqual(['approve-once'])
      expect(await p2).toEqual(['reject'])
    })

    it('一个 session 超时不影响另一个', async () => {
      const p1 = manager.waitForDecisions('session-1', 1, 500)
      const p2 = manager.waitForDecisions('session-2', 1, 5000)

      vi.advanceTimersByTime(501)

      expect(await p1).toBeNull() // session-1 超时
      expect(manager.hasPending('session-2')).toBe(true) // session-2 仍在等待

      manager.submitDecision('session-2', 0, 'approve-once')
      expect(await p2).toEqual(['approve-once'])
    })

    it('cleanup 一个 session 不影响其他', async () => {
      const p1 = manager.waitForDecisions('session-1', 1)
      const p2 = manager.waitForDecisions('session-2', 1)

      manager.cleanup('session-1')
      expect(await p1).toBeNull()

      expect(manager.hasPending('session-2')).toBe(true)

      manager.submitDecision('session-2', 0, 'approve-always')
      expect(await p2).toEqual(['approve-always'])
    })

    it('多个 session 同时提交', async () => {
      const sessions = ['s1', 's2', 's3', 's4', 's5']
      const promises = sessions.map((s) => manager.waitForDecisions(s, 1))

      sessions.forEach((s) => manager.submitDecision(s, 0, 'approve-once'))

      const results = await Promise.all(promises)
      results.forEach((r) => {
        expect(r).toEqual(['approve-once'])
      })
    })
  })

  // ========== 并发提交 ==========

  describe('并发提交', () => {
    it('同时提交多个 index 都能正确处理', async () => {
      const promise = manager.waitForDecisions('session-1', 5)

      // 同时提交所有决策
      const decisions: Array<'approve-once' | 'approve-always' | 'reject'> = [
        'approve-once',
        'approve-always',
        'reject',
        'approve-once',
        'approve-always'
      ]

      decisions.forEach((d, i) => {
        expect(manager.submitDecision('session-1', i, d)).toBe(true)
      })

      const result = await promise
      expect(result).toEqual(decisions)
    })
  })

  // ========== Per-call 单工具审批（新 API） ==========

  describe('单工具审批（per-call）', () => {
    it('waitForSingleDecision + submitSingleDecision 基本流程', async () => {
      const promise = manager.waitForSingleDecision('session-1:0')
      manager.submitSingleDecision('session-1:0', 'approve-once')
      const result = await promise
      expect(result).toBe('approve-once')
    })

    it('多个独立审批互不干扰', async () => {
      const p1 = manager.waitForSingleDecision('session-1:0')
      const p2 = manager.waitForSingleDecision('session-1:1')
      const p3 = manager.waitForSingleDecision('session-2:0')

      manager.submitSingleDecision('session-1:1', 'reject')
      manager.submitSingleDecision('session-2:0', 'approve-always')
      manager.submitSingleDecision('session-1:0', 'approve-once')

      expect(await p1).toBe('approve-once')
      expect(await p2).toBe('reject')
      expect(await p3).toBe('approve-always')
    })

    it('超时返回 null', async () => {
      const promise = manager.waitForSingleDecision('session-1:0', 500)
      vi.advanceTimersByTime(501)
      expect(await promise).toBeNull()
    })

    it('超时后 submit 返回 false', async () => {
      const promise = manager.waitForSingleDecision('session-1:0', 100)
      vi.advanceTimersByTime(101)
      await promise
      expect(manager.submitSingleDecision('session-1:0', 'approve-once')).toBe(false)
    })

    it('无 pending 时 submit 返回 false', () => {
      expect(manager.submitSingleDecision('no-such:0', 'reject')).toBe(false)
    })

    it('hasSinglePending 正确反映状态', () => {
      expect(manager.hasSinglePending('session-1:0')).toBe(false)
      manager.waitForSingleDecision('session-1:0')
      expect(manager.hasSinglePending('session-1:0')).toBe(true)
      manager.submitSingleDecision('session-1:0', 'approve-once')
      expect(manager.hasSinglePending('session-1:0')).toBe(false)
    })

    it('cleanupSession 清理指定 session 的所有 single pending', async () => {
      const p1 = manager.waitForSingleDecision('session-1:0')
      const p2 = manager.waitForSingleDecision('session-1:1')
      const p3 = manager.waitForSingleDecision('session-2:0')

      manager.cleanupSession('session-1')

      expect(await p1).toBeNull()
      expect(await p2).toBeNull()
      // session-2 不受影响
      expect(manager.hasSinglePending('session-2:0')).toBe(true)
      manager.submitSingleDecision('session-2:0', 'approve-once')
      expect(await p3).toBe('approve-once')
    })

    it('cleanupAll 清理所有 single pending', async () => {
      const p1 = manager.waitForSingleDecision('session-1:0')
      const p2 = manager.waitForSingleDecision('session-2:0')

      manager.cleanupAll()

      expect(await p1).toBeNull()
      expect(await p2).toBeNull()
    })

    it('重复 waitForSingleDecision 同一 approvalId 会清理旧的', async () => {
      const p1 = manager.waitForSingleDecision('session-1:0')
      const p2 = manager.waitForSingleDecision('session-1:0')

      expect(await p1).toBeNull() // 旧的被清理
      manager.submitSingleDecision('session-1:0', 'reject')
      expect(await p2).toBe('reject')
    })
  })
})
