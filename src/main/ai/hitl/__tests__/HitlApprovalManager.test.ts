/**
 * HitlApprovalManager 单元测试
 *
 * 覆盖 per-call 单工具审批模式：
 *   - waitForSingleDecision / submitSingleDecision 基本流程
 *   - 超时处理
 *   - 边界情况（无 pending、超时后 submit）
 *   - hasSinglePending 状态查询
 *   - cleanupSession / cleanupAll 清理
 *   - 多 session 隔离
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HitlApprovalManager, DEFAULT_HITL_TIMEOUT_MS } from '../HitlApprovalManager';

vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('HitlApprovalManager', () => {
  let manager: HitlApprovalManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new HitlApprovalManager();
  });

  afterEach(() => {
    manager.cleanupAll();
    vi.useRealTimers();
  });

  describe('基本流程', () => {
    it('waitForSingleDecision + submitSingleDecision 基本流程', async () => {
      const promise = manager.waitForSingleDecision('session-1:0');
      manager.submitSingleDecision('session-1:0', 'approve-once');
      const result = await promise;
      expect(result).toBe('approve-once');
    });

    it('多个独立审批互不干扰', async () => {
      const p1 = manager.waitForSingleDecision('session-1:0');
      const p2 = manager.waitForSingleDecision('session-1:1');
      const p3 = manager.waitForSingleDecision('session-2:0');

      manager.submitSingleDecision('session-1:1', 'reject');
      manager.submitSingleDecision('session-2:0', 'approve-always');
      manager.submitSingleDecision('session-1:0', 'approve-once');

      expect(await p1).toBe('approve-once');
      expect(await p2).toBe('reject');
      expect(await p3).toBe('approve-always');
    });

    it('默认超时为 120 秒', () => {
      expect(DEFAULT_HITL_TIMEOUT_MS).toBe(120_000);
    });
  });

  describe('超时处理', () => {
    it('超时返回 null', async () => {
      const promise = manager.waitForSingleDecision('session-1:0', 500);
      vi.advanceTimersByTime(501);
      expect(await promise).toBeNull();
    });

    it('超时后 submit 返回 false', async () => {
      const promise = manager.waitForSingleDecision('session-1:0', 100);
      vi.advanceTimersByTime(101);
      await promise;
      expect(manager.submitSingleDecision('session-1:0', 'approve-once')).toBe(false);
    });
  });

  describe('边界情况', () => {
    it('无 pending 时 submit 返回 false', () => {
      expect(manager.submitSingleDecision('no-such:0', 'reject')).toBe(false);
    });

    it('hasSinglePending 正确反映状态', () => {
      expect(manager.hasSinglePending('session-1:0')).toBe(false);
      manager.waitForSingleDecision('session-1:0');
      expect(manager.hasSinglePending('session-1:0')).toBe(true);
      manager.submitSingleDecision('session-1:0', 'approve-once');
      expect(manager.hasSinglePending('session-1:0')).toBe(false);
    });

    it('重复 waitForSingleDecision 同一 approvalId 会清理旧的', async () => {
      const p1 = manager.waitForSingleDecision('session-1:0');
      const p2 = manager.waitForSingleDecision('session-1:0');

      expect(await p1).toBeNull(); // 旧的被清理
      manager.submitSingleDecision('session-1:0', 'reject');
      expect(await p2).toBe('reject');
    });
  });

  describe('cleanup', () => {
    it('cleanupSession 清理指定 session 的所有 single pending', async () => {
      const p1 = manager.waitForSingleDecision('session-1:0');
      const p2 = manager.waitForSingleDecision('session-1:1');
      const p3 = manager.waitForSingleDecision('session-2:0');

      manager.cleanupSession('session-1');

      expect(await p1).toBeNull();
      expect(await p2).toBeNull();
      // session-2 不受影响
      expect(manager.hasSinglePending('session-2:0')).toBe(true);
      manager.submitSingleDecision('session-2:0', 'approve-once');
      expect(await p3).toBe('approve-once');
    });

    it('cleanupSession 批量清理不会遍历时变异 Map（大量 pending）', async () => {
      const promises: Promise<string | null>[] = [];
      for (let i = 0; i < 50; i++) {
        promises.push(manager.waitForSingleDecision(`session-test:${i}`));
      }
      promises.push(manager.waitForSingleDecision('session-other:0'));

      manager.cleanupSession('session-test');

      const results = await Promise.all(promises.slice(0, 50));
      expect(results.every((r) => r === null)).toBe(true);

      expect(manager.hasSinglePending('session-other:0')).toBe(true);
    });

    it('cleanupAll 清理所有 single pending', async () => {
      const p1 = manager.waitForSingleDecision('session-1:0');
      const p2 = manager.waitForSingleDecision('session-2:0');

      manager.cleanupAll();

      expect(await p1).toBeNull();
      expect(await p2).toBeNull();
    });
  });
});
