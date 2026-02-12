/**
 * HitlApprovalManager 单元测试
 *
 * 测试 Promise 等待模式的核心逻辑：
 * - waitForDecisions / submitDecision 基本流程
 * - 多工具审批（全部完成后才 resolve）
 * - 超时处理
 * - 幂等（重复 submit 同一 index）
 * - 边界情况（无效 index、无 pending）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HitlApprovalManager } from '../HitlApprovalManager'

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

      // 逐个提交
      expect(manager.submitDecision('session-1', 0, 'approve-once')).toBe(true)
      expect(manager.submitDecision('session-1', 1, 'approve-always')).toBe(true)

      // 还没全部完成，hasPending 应为 true
      expect(manager.hasPending('session-1')).toBe(true)

      // 提交最后一个
      expect(manager.submitDecision('session-1', 2, 'reject')).toBe(true)

      const result = await promise
      expect(result).toEqual(['approve-once', 'approve-always', 'reject'])
      expect(manager.hasPending('session-1')).toBe(false)
    })
  })

  // ========== 超时处理 ==========

  describe('超时处理', () => {
    it('超时后 resolve(null)', async () => {
      const promise = manager.waitForDecisions('session-1', 2, 1000)

      // 只提交了一个，没有全部完成
      manager.submitDecision('session-1', 0, 'approve-once')

      // 推进时间到超时
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

      // 推进时间超过超时，不应有副作用
      vi.advanceTimersByTime(6000)
    })
  })

  // ========== 幂等 ==========

  describe('幂等', () => {
    it('重复提交同一 index 不重复计数', async () => {
      const promise = manager.waitForDecisions('session-1', 2)

      // 重复提交 index 0
      manager.submitDecision('session-1', 0, 'approve-once')
      manager.submitDecision('session-1', 0, 'approve-always')

      // 还没全部完成
      expect(manager.hasPending('session-1')).toBe(true)

      // 提交 index 1
      manager.submitDecision('session-1', 1, 'reject')

      const result = await promise
      // index 0 被覆盖为 approve-always
      expect(result).toEqual(['approve-always', 'reject'])
    })
  })

  // ========== 边界情况 ==========

  describe('边界情况', () => {
    it('无 pending 时 submitDecision 返回 false', () => {
      expect(manager.submitDecision('no-session', 0, 'reject')).toBe(false)
    })

    it('无效 index 返回 false', async () => {
      manager.waitForDecisions('session-1', 2)

      expect(manager.submitDecision('session-1', -1, 'reject')).toBe(false)
      expect(manager.submitDecision('session-1', 5, 'reject')).toBe(false)
    })

    it('hasPending 正确反映状态', () => {
      expect(manager.hasPending('session-1')).toBe(false)

      manager.waitForDecisions('session-1', 1)
      expect(manager.hasPending('session-1')).toBe(true)

      manager.submitDecision('session-1', 0, 'approve-once')
      expect(manager.hasPending('session-1')).toBe(false)
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

    it('cleanupAll 清理所有 pending', async () => {
      const p1 = manager.waitForDecisions('session-1', 1)
      const p2 = manager.waitForDecisions('session-2', 1)

      manager.cleanupAll()

      expect(await p1).toBeNull()
      expect(await p2).toBeNull()
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
  })
})
