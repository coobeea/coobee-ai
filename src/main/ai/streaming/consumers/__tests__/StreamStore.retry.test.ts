/**
 * StreamStore 重试上限测试
 *
 * 测试 P3 改进：
 * - 批量写入失败时重新入队
 * - 达到 maxFlushRetries 上限后丢弃消息
 * - 成功后重置计数器
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ===== Hoisted mocks =====
const { mockOn, mockExecute, mockTransaction } = vi.hoisted(() => {
  const mockTransaction = vi.fn();
  return {
    mockOn: vi.fn(),
    mockExecute: vi.fn().mockResolvedValue(0),
    mockTransaction
  };
});

// ===== Mock eventBus =====
vi.mock('@main/common/eventbus', () => ({
  eventBus: {
    on: mockOn,
    off: vi.fn(),
    emit: vi.fn()
  }
}));

// ===== Mock logger =====
vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

// ===== Mock SQLiteService =====
vi.mock('@main/common/database', () => ({
  SQLiteService: {
    getInstance: vi.fn(() => ({
      execute: mockExecute,
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn().mockResolvedValue(null),
      transaction: mockTransaction
    }))
  }
}));

// ===== Mock fs =====
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('file not found'))
}));

import { StreamStore } from '../StreamStore';
import { StreamEventType } from '../../types';
import type { StreamMessage } from '../../types';

function createMockMessage(seq: number): StreamMessage {
  return {
    id: `msg-${seq}`,
    sessionId: 'session-1',
    sequence: seq,
    type: 'text',
    content: `Message ${seq}`,
    timestamp: Date.now(),
    source: { type: 'agent', id: 'agent-1', name: 'TestAgent' }
  };
}

describe('StreamStore 重试上限', () => {
  let store: StreamStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    store = new StreamStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('写入失败后重新入队（低于上限）', async () => {
    // 第一次 transaction 失败
    mockTransaction.mockRejectedValueOnce(new Error('DB write failed'));
    // 第二次 transaction 成功
    mockTransaction.mockImplementationOnce(async (fn: () => Promise<void>) => {
      await fn();
    });

    await store.initialize();

    // 获取事件处理函数
    const messageHandler = mockOn.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE)?.[1];

    // 入队一条消息
    messageHandler({ message: createMockMessage(1) });
    expect(store.getQueueStats().queueSize).toBe(1);

    // 第一次刷新失败 → 消息应该重新入队
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getQueueStats().queueSize).toBe(1); // 仍在队列中

    // 第二次刷新成功
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getQueueStats().queueSize).toBe(0); // 队列清空
  });

  it('达到最大重试次数后丢弃消息', async () => {
    // 所有 transaction 都失败
    mockTransaction.mockRejectedValue(new Error('DB permanently broken'));

    await store.initialize();

    const messageHandler = mockOn.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE)?.[1];

    // 入队一条消息
    messageHandler({ message: createMockMessage(1) });

    // 连续失败 5 次（maxFlushRetries = 5）
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }

    // 达到上限后消息被丢弃
    expect(store.getQueueStats().queueSize).toBe(0);
  });
});
