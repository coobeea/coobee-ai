/**
 * StreamMonitor 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 使用 vi.hoisted 确保 mock 函数在 vi.mock 之前定义
const { mockOn, mockOff, eventHandlers } = vi.hoisted(() => {
  const eventHandlers = new Map<string, ((...args: unknown[]) => unknown)[]>();

  const mockOn = vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
    if (!eventHandlers.has(event)) eventHandlers.set(event, []);
    eventHandlers.get(event)!.push(handler);
  });

  const mockOff = vi.fn();

  return { mockOn, mockOff, eventHandlers };
});

vi.mock('@main/common/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('@main/common/eventbus', () => ({
  eventBus: {
    on: mockOn,
    emit: vi.fn(),
    off: mockOff
  }
}));

import { StreamMonitor } from '../consumers/StreamMonitor';
import { StreamEventType } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function triggerEvent(eventType: string, data: any): void {
  const handlers = eventHandlers.get(eventType) || [];
  handlers.forEach((h) => h(data));
}

describe('StreamMonitor', () => {
  let monitor: StreamMonitor;

  beforeEach(() => {
    eventHandlers.clear();
    monitor = new StreamMonitor();
    monitor.initialize();
  });

  it('初始化后注册事件监听', () => {
    // START, MESSAGE, END, ERROR = 4 个事件
    expect(eventHandlers.size).toBeGreaterThanOrEqual(4);
  });

  it('START 事件创建统计', () => {
    triggerEvent(StreamEventType.START, {
      sessionId: 'session-1',
      type: StreamEventType.START
    });

    const stats = monitor.getStats('session-1');
    expect(stats).toBeDefined();
    expect(stats!.messageCount).toBe(0);
    expect(stats!.startTime).toBeDefined();
  });

  it('MESSAGE 事件更新统计', () => {
    triggerEvent(StreamEventType.START, { sessionId: 's1', type: StreamEventType.START });

    triggerEvent(StreamEventType.MESSAGE, {
      sessionId: 's1',
      message: { type: 'text:delta', sequence: 1 }
    });

    triggerEvent(StreamEventType.MESSAGE, {
      sessionId: 's1',
      message: { type: 'tool:start', sequence: 2 }
    });

    const stats = monitor.getStats('s1');
    expect(stats!.messageCount).toBe(2);
    expect(stats!.textCount).toBe(1);
    expect(stats!.toolCallCount).toBe(1);
    expect(stats!.lastSequence).toBe(2);
  });

  it('END 事件记录结束时间', () => {
    triggerEvent(StreamEventType.START, { sessionId: 's2', type: StreamEventType.START });
    triggerEvent(StreamEventType.END, { sessionId: 's2', type: StreamEventType.END });

    const stats = monitor.getStats('s2');
    expect(stats!.endTime).toBeDefined();
    expect(stats!.duration).toBeGreaterThanOrEqual(0);
  });

  it('ERROR 事件增加错误计数', () => {
    triggerEvent(StreamEventType.START, { sessionId: 's3', type: StreamEventType.START });
    triggerEvent(StreamEventType.ERROR, { sessionId: 's3', error: 'fail' });

    const stats = monitor.getStats('s3');
    expect(stats!.errorCount).toBe(1);
  });

  it('getAllStats 返回全部统计', () => {
    triggerEvent(StreamEventType.START, { sessionId: 'a', type: StreamEventType.START });
    triggerEvent(StreamEventType.START, { sessionId: 'b', type: StreamEventType.START });

    expect(monitor.getAllStats()).toHaveLength(2);
  });

  it('clearStats 清除指定会话', () => {
    triggerEvent(StreamEventType.START, { sessionId: 'c', type: StreamEventType.START });
    monitor.clearStats('c');
    expect(monitor.getStats('c')).toBeNull();
  });

  it('clearAllStats 清除全部', () => {
    triggerEvent(StreamEventType.START, { sessionId: 'x', type: StreamEventType.START });
    monitor.clearAllStats();
    expect(monitor.getAllStats()).toHaveLength(0);
  });

  describe('destroy', () => {
    it('移除所有 EventBus 监听器（验证 off 被调用 4 次）', () => {
      vi.clearAllMocks();

      // destroy() 应该移除所有 4 个监听器
      monitor.destroy();

      // 验证 off 被调用了 4 次（对应 START, MESSAGE, END, ERROR）
      expect(mockOff).toHaveBeenCalledTimes(4);

      // 验证每个事件类型的 off 都被调用
      const offCalls = mockOff.mock.calls.map((c) => c[0]);
      expect(offCalls).toContain(StreamEventType.START);
      expect(offCalls).toContain(StreamEventType.MESSAGE);
      expect(offCalls).toContain(StreamEventType.END);
      expect(offCalls).toContain(StreamEventType.ERROR);
    });

    it('清空统计数据', () => {
      triggerEvent(StreamEventType.START, { sessionId: 'test', type: StreamEventType.START });
      expect(monitor.getAllStats()).toHaveLength(1);

      monitor.destroy();
      expect(monitor.getAllStats()).toHaveLength(0);
    });

    it('重复 initialize/destroy 不会累积监听器', () => {
      // 第一轮
      monitor.destroy();
      vi.clearAllMocks();

      // 第二轮
      monitor.initialize();
      const registerCount = mockOn.mock.calls.length;

      monitor.destroy();

      // 验证 off 调用次数等于 on 调用次数
      expect(mockOff).toHaveBeenCalledTimes(registerCount);
    });
  });
});
