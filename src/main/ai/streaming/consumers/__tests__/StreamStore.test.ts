/**
 * StreamStore 测试
 *
 * 测试流式消息存储（消费者）的核心功能：
 * - 初始化（创建 Schema、注册事件、启动定时刷新）
 * - 消息入队和批量刷新
 * - 消息检索（按序号范围）
 * - 获取最新序号
 * - 清理旧消息 / 清理会话
 * - 队列统计
 * - 销毁（刷新剩余消息、停止定时器）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ===== Hoisted mocks =====
const { mockOn, mockOff, mockExecute, mockQuery, mockQueryOne, mockTransaction } = vi.hoisted(() => {
  const mockTransaction = vi.fn().mockImplementation(async (fn: () => Promise<void>) => {
    await fn();
  });
  return {
    mockOn: vi.fn(),
    mockOff: vi.fn(),
    mockExecute: vi.fn().mockResolvedValue(0),
    mockQuery: vi.fn().mockResolvedValue([]),
    mockQueryOne: vi.fn().mockResolvedValue(null),
    mockTransaction
  };
});

// ===== Mock logger (避免 env → electron 依赖) =====
vi.mock('@main/common/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

// ===== Mock eventBus =====
vi.mock('@main/common/eventbus', () => ({
  eventBus: {
    on: mockOn,
    off: mockOff,
    emit: vi.fn()
  }
}));

// ===== Mock SQLiteService =====
vi.mock('@main/common/database', () => ({
  SQLiteService: {
    getInstance: vi.fn(() => ({
      execute: mockExecute,
      query: mockQuery,
      queryOne: mockQueryOne,
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

function createMockMessage(seq: number, sessionId = 'session-1'): StreamMessage {
  return {
    id: `msg-${seq}`,
    sessionId,
    sequence: seq,
    type: 'text',
    content: `Message ${seq}`,
    timestamp: Date.now(),
    source: { type: 'agent', id: 'agent-1', name: 'TestAgent' }
  };
}

describe('StreamStore', () => {
  let store: StreamStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    store = new StreamStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===== 初始化 =====

  describe('initialize', () => {
    it('创建 Schema 并注册事件监听', async () => {
      await store.initialize();

      // Schema 创建（readFile 失败后走 inline）
      expect(mockExecute).toHaveBeenCalled();

      // 事件监听注册
      expect(mockOn).toHaveBeenCalledWith(StreamEventType.MESSAGE, expect.any(Function));
    });

    it('重复初始化不产生副作用', async () => {
      await store.initialize();
      const callCount = mockExecute.mock.calls.length;

      await store.initialize();
      expect(mockExecute.mock.calls.length).toBe(callCount);
    });
  });

  // ===== 消息入队和批量刷新 =====

  describe('消息入队与刷新', () => {
    it('通过事件监听入队消息', async () => {
      await store.initialize();

      const messageHandler = mockOn.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE)?.[1];

      expect(messageHandler).toBeDefined();

      const msg = createMockMessage(1);
      messageHandler({ message: msg });

      const stats = store.getQueueStats();
      expect(stats.queueSize).toBe(1);
    });

    it('定时刷新队列', async () => {
      await store.initialize();

      const messageHandler = mockOn.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE)?.[1];

      messageHandler({ message: createMockMessage(1) });
      messageHandler({ message: createMockMessage(2) });

      expect(store.getQueueStats().queueSize).toBe(2);

      await vi.advanceTimersByTimeAsync(1000);

      expect(store.getQueueStats().queueSize).toBe(0);
      expect(mockTransaction).toHaveBeenCalled();
    });
  });

  // ===== 消息检索 =====

  describe('getMessages', () => {
    it('按序号范围检索消息', async () => {
      await store.initialize();
      mockQuery.mockResolvedValueOnce([
        {
          id: 'msg-1',
          session_id: 's1',
          sequence: 1,
          type: 'text',
          content: 'hello',
          data: null,
          timestamp: 1000,
          source_type: 'agent',
          source_id: 'a1',
          source_name: 'Agent'
        }
      ]);

      const messages = await store.getMessages('s1', 1, 10);

      expect(messages).toHaveLength(1);
      expect(messages[0].sessionId).toBe('s1');
      expect(messages[0].sequence).toBe(1);
      expect(messages[0].source.type).toBe('agent');
    });

    it('使用默认参数', async () => {
      await store.initialize();
      mockQuery.mockResolvedValueOnce([]);

      await store.getMessages('s1');

      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['s1', 1, 100]);
    });
  });

  // ===== 最新序号 =====

  describe('getLatestSequence', () => {
    it('返回最新序号', async () => {
      await store.initialize();
      mockQueryOne.mockResolvedValueOnce({ max_seq: 42 });

      const seq = await store.getLatestSequence('s1');

      expect(seq).toBe(42);
    });

    it('无消息时返回 0', async () => {
      await store.initialize();
      mockQueryOne.mockResolvedValueOnce({ max_seq: null });

      const seq = await store.getLatestSequence('s1');

      expect(seq).toBe(0);
    });
  });

  // ===== 清理 =====

  describe('cleanOldMessages', () => {
    it('清理旧消息', async () => {
      await store.initialize();
      await store.cleanOldMessages('s1', 500);

      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM stream_messages'), [
        's1',
        500,
        's1'
      ]);
    });
  });

  describe('clearSession', () => {
    it('清理会话所有消息', async () => {
      await store.initialize();
      await store.clearSession('s1');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM stream_messages WHERE session_id = ?'),
        ['s1']
      );
    });
  });

  // ===== 队列统计 =====

  describe('getQueueStats', () => {
    it('返回队列统计', () => {
      const stats = store.getQueueStats();

      expect(stats.queueSize).toBe(0);
      expect(stats.maxBatchSize).toBe(100);
      expect(stats.flushInterval).toBe(1000);
    });
  });

  // ===== 销毁 =====

  describe('destroy', () => {
    it('停止定时器并刷新剩余消息', async () => {
      await store.initialize();

      const messageHandler = mockOn.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE)?.[1];
      messageHandler({ message: createMockMessage(1) });

      await store.destroy();

      expect(store.getQueueStats().queueSize).toBe(0);
    });

    it('移除 EventBus 监听器（验证 bound handler）', async () => {
      await store.initialize();

      // 记录 initialize() 时注册的 handler
      expect(mockOn).toHaveBeenCalledWith(StreamEventType.MESSAGE, expect.any(Function));
      const registeredHandler = mockOn.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE)?.[1];

      // 清空 mock 调用记录
      vi.clearAllMocks();

      // destroy() 应该使用相同的 handler 引用调用 off
      await store.destroy();
      expect(mockOff).toHaveBeenCalledWith(StreamEventType.MESSAGE, registeredHandler);
    });

    it('重复 initialize/destroy 不累积监听器', async () => {
      // 第一轮
      await store.initialize();
      const handler1 = mockOn.mock.calls.find((c) => c[0] === StreamEventType.MESSAGE)?.[1];
      await store.destroy();

      vi.clearAllMocks();

      // 第二轮
      await store.initialize();
      const handler2 = mockOn.mock.calls.find((c) => c[0] === StreamEventType.MESSAGE)?.[1];
      await store.destroy();

      // 验证两次注册的 handler 是同一个引用
      expect(handler1).toBe(handler2);
    });
  });
});
