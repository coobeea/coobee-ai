/**
 * EventBridge 清理机制测试
 * 验证 StreamBridge、ThreadBridge 返回的清理函数能正确移除 EventBus 监听器
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GatewayApi } from '../../protocol/types';

// 使用 vi.hoisted 确保 mock 在模块加载前初始化
const { mockEventBus } = vi.hoisted(() => {
  const mockEventBus = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn()
  };
  return { mockEventBus };
});

vi.mock('@main/common/eventbus', () => ({
  eventBus: mockEventBus
}));

vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('EventBridge 清理机制', () => {
  let mockGateway: GatewayApi;

  beforeEach(() => {
    vi.clearAllMocks();

    // 创建 mock Gateway
    mockGateway = {
      broadcastEvent: vi.fn(),
      broadcastEventIf: vi.fn(),
      sendEvent: vi.fn(),
      clientCount: 0
    } as unknown as GatewayApi;
  });

  describe('StreamBridge', () => {
    it('初始化时注册 4 个监听器', async () => {
      const { initStreamBridge } = await import('../StreamBridge');
      const { StreamEventType } = await import('@main/ai/streaming/types');

      initStreamBridge(mockGateway);

      expect(mockEventBus.on).toHaveBeenCalledTimes(4);
      expect(mockEventBus.on).toHaveBeenCalledWith(StreamEventType.MESSAGE, expect.any(Function));
      expect(mockEventBus.on).toHaveBeenCalledWith(StreamEventType.START, expect.any(Function));
      expect(mockEventBus.on).toHaveBeenCalledWith(StreamEventType.END, expect.any(Function));
      expect(mockEventBus.on).toHaveBeenCalledWith(StreamEventType.ERROR, expect.any(Function));
    });

    it('返回清理函数，调用后移除所有监听器', async () => {
      const { initStreamBridge } = await import('../StreamBridge');
      const { StreamEventType } = await import('@main/ai/streaming/types');

      const cleanup = initStreamBridge(mockGateway);
      expect(cleanup).toBeTypeOf('function');

      // 记录注册的 handlers
      const handlers = {
        message: mockEventBus.on.mock.calls.find((c) => c[0] === StreamEventType.MESSAGE)?.[1],
        start: mockEventBus.on.mock.calls.find((c) => c[0] === StreamEventType.START)?.[1],
        end: mockEventBus.on.mock.calls.find((c) => c[0] === StreamEventType.END)?.[1],
        error: mockEventBus.on.mock.calls.find((c) => c[0] === StreamEventType.ERROR)?.[1]
      };

      vi.clearAllMocks();

      // 调用清理函数
      cleanup!();

      // 验证使用相同的 handler 引用调用 off
      expect(mockEventBus.off).toHaveBeenCalledTimes(4);
      expect(mockEventBus.off).toHaveBeenCalledWith(StreamEventType.MESSAGE, handlers.message);
      expect(mockEventBus.off).toHaveBeenCalledWith(StreamEventType.START, handlers.start);
      expect(mockEventBus.off).toHaveBeenCalledWith(StreamEventType.END, handlers.end);
      expect(mockEventBus.off).toHaveBeenCalledWith(StreamEventType.ERROR, handlers.error);
    });
  });

  describe('ThreadBridge', () => {
    it('初始化时注册 4 个监听器', async () => {
      const { initThreadBridge } = await import('../ThreadBridge');
      const { ThreadEventType } = await import('@main/ai/threads/ThreadStore');

      initThreadBridge(mockGateway);

      expect(mockEventBus.on).toHaveBeenCalledTimes(4);
      expect(mockEventBus.on).toHaveBeenCalledWith(ThreadEventType.CREATED, expect.any(Function));
      expect(mockEventBus.on).toHaveBeenCalledWith(ThreadEventType.UPDATED, expect.any(Function));
      expect(mockEventBus.on).toHaveBeenCalledWith(ThreadEventType.DELETED, expect.any(Function));
      expect(mockEventBus.on).toHaveBeenCalledWith(ThreadEventType.STATUS, expect.any(Function));
    });

    it('返回清理函数，调用后移除所有监听器', async () => {
      const { initThreadBridge } = await import('../ThreadBridge');
      const { ThreadEventType } = await import('@main/ai/threads/ThreadStore');

      const cleanup = initThreadBridge(mockGateway);
      expect(cleanup).toBeTypeOf('function');

      // 记录注册的 handlers
      const handlers = {
        created: mockEventBus.on.mock.calls.find((c) => c[0] === ThreadEventType.CREATED)?.[1],
        updated: mockEventBus.on.mock.calls.find((c) => c[0] === ThreadEventType.UPDATED)?.[1],
        deleted: mockEventBus.on.mock.calls.find((c) => c[0] === ThreadEventType.DELETED)?.[1],
        status: mockEventBus.on.mock.calls.find((c) => c[0] === ThreadEventType.STATUS)?.[1]
      };

      vi.clearAllMocks();

      // 调用清理函数
      cleanup!();

      // 验证使用相同的 handler 引用调用 off
      expect(mockEventBus.off).toHaveBeenCalledTimes(4);
      expect(mockEventBus.off).toHaveBeenCalledWith(ThreadEventType.CREATED, handlers.created);
      expect(mockEventBus.off).toHaveBeenCalledWith(ThreadEventType.UPDATED, handlers.updated);
      expect(mockEventBus.off).toHaveBeenCalledWith(ThreadEventType.DELETED, handlers.deleted);
      expect(mockEventBus.off).toHaveBeenCalledWith(ThreadEventType.STATUS, handlers.status);
    });
  });

  describe('EventBridge 集成', () => {
    it('多个 EventBridge 的清理函数互不干扰', async () => {
      const { initStreamBridge } = await import('../StreamBridge');
      const { initThreadBridge } = await import('../ThreadBridge');

      const cleanup1 = initStreamBridge(mockGateway);
      const cleanup2 = initThreadBridge(mockGateway);

      // 验证总共注册了 8 个监听器（4 + 4）
      expect(mockEventBus.on).toHaveBeenCalledTimes(8);

      vi.clearAllMocks();

      // 调用第一个清理函数
      cleanup1!();
      expect(mockEventBus.off).toHaveBeenCalledTimes(4);

      vi.clearAllMocks();

      // 调用第二个清理函数
      cleanup2!();
      expect(mockEventBus.off).toHaveBeenCalledTimes(4);
    });
  });
});
