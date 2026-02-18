/**
 * HandoffRouter 单元测试
 *
 * SDK 无关 — HandoffRouter 现在是纯路由逻辑，不构建 SDK handoff 对象
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { HandoffRouter } from '../HandoffRouter';
import type { SwarmConfig } from '../types';

const mockConfig: SwarmConfig = {
  id: 'swarm-test',
  name: 'Test Swarm',
  maxConcurrentAgents: 5,
  agentIdleTimeout: 60000,
  maxHandoffDepth: 3,
  enableSharedContext: true,
  enableMonitoring: true
};

describe('HandoffRouter', () => {
  let router: HandoffRouter;

  beforeEach(() => {
    router = new HandoffRouter(mockConfig);
    vi.clearAllMocks();
  });

  describe('recordHandoff', () => {
    it('记录事件', () => {
      const record = router.recordHandoff('a', 'b');
      expect(record.fromRoleId).toBe('a');
      expect(record.toRoleId).toBe('b');
      expect(record.depth).toBe(1);
    });

    it('递增深度', () => {
      router.recordHandoff('a', 'b');
      const second = router.recordHandoff('b', 'c');
      expect(second.depth).toBe(2);
    });

    it('触发回调', () => {
      const cb = vi.fn();
      router.setOnHandoff(cb);
      router.recordHandoff('a', 'b', { x: 1 });
      expect(cb).toHaveBeenCalledWith('a', 'b', { x: 1 });
    });
  });

  describe('wouldCauseLoop', () => {
    it('检测循环', () => {
      router.recordHandoff('a', 'b');
      router.recordHandoff('b', 'c');
      expect(router.wouldCauseLoop('b')).toBe(true);
    });

    it('无循环', () => {
      router.recordHandoff('a', 'b');
      expect(router.wouldCauseLoop('c')).toBe(false);
    });

    it('resetChain 重置', () => {
      router.recordHandoff('a', 'b');
      router.resetChain();
      expect(router.wouldCauseLoop('b')).toBe(false);
    });
  });

  describe('isMaxDepthReached', () => {
    it('达到最大深度', () => {
      router.recordHandoff('a', 'b');
      router.recordHandoff('b', 'c');
      router.recordHandoff('c', 'd');
      expect(router.isMaxDepthReached()).toBe(true);
    });

    it('未达到最大深度', () => {
      router.recordHandoff('a', 'b');
      expect(router.isMaxDepthReached()).toBe(false);
    });
  });

  describe('历史查询', () => {
    it('getHistoryByRole from', () => {
      router.recordHandoff('a', 'b');
      router.recordHandoff('a', 'c');
      expect(router.getHistoryByRole('a', 'from')).toHaveLength(2);
    });

    it('getHistoryByRole to', () => {
      router.recordHandoff('a', 'b');
      router.recordHandoff('c', 'b');
      expect(router.getHistoryByRole('b', 'to')).toHaveLength(2);
    });

    it('getCurrentChain', () => {
      router.recordHandoff('a', 'b');
      router.recordHandoff('b', 'c');
      expect(router.getCurrentChain()).toEqual(['b', 'c']);
    });

    it('getStats', () => {
      router.recordHandoff('a', 'b');
      router.recordHandoff('b', 'c');
      const stats = router.getStats();
      expect(stats.totalHandoffs).toBe(2);
      expect(stats.currentDepth).toBe(2);
      expect(stats.maxDepth).toBe(2);
      expect(stats.roleTransitions['a -> b']).toBe(1);
    });
  });

  describe('清理', () => {
    it('clearHistory', () => {
      router.recordHandoff('a', 'b');
      router.clearHistory();
      expect(router.getHistory()).toHaveLength(0);
      expect(router.getCurrentDepth()).toBe(0);
    });

    it('destroy', () => {
      router.recordHandoff('a', 'b');
      router.destroy();
      expect(router.getHistory()).toHaveLength(0);
    });
  });
});
