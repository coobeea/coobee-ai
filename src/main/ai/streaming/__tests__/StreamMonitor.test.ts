/**
 * StreamMonitor 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 捕获注册的回调
const eventHandlers = new Map<string, ((...args: unknown[]) => unknown)[]>();

vi.mock('@main/common/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('@main/common/eventbus', () => ({
  eventBus: {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      if (!eventHandlers.has(event)) eventHandlers.set(event, []);
      eventHandlers.get(event)!.push(handler);
    }),
    emit: vi.fn(),
    off: vi.fn()
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
});
