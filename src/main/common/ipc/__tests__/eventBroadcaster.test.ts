/**
 * IpcEventBroadcaster 清理机制测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
    error: vi.fn(),
    debug: vi.fn()
  }
}));

// Mock Electron
vi.mock('electron', () => ({
  BrowserWindow: {
    fromId: vi.fn()
  },
  WebContentsView: vi.fn(),
  webContents: {
    getAllWebContents: vi.fn().mockReturnValue([])
  }
}));

describe('IpcEventBroadcaster', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // 重置模块以清除之前的单例状态
    vi.resetModules();
  });

  it('init() 注册所有事件监听器', async () => {
    const { ipcEventBroadcaster } = await import('../eventBroadcaster');

    ipcEventBroadcaster.init();

    // 验证至少注册了多个监听器（Window + Tab + App 事件）
    expect(mockEventBus.on).toHaveBeenCalled();
    expect(mockEventBus.on.mock.calls.length).toBeGreaterThan(20);
  });

  it('destroy() 移除所有事件监听器', async () => {
    const { ipcEventBroadcaster } = await import('../eventBroadcaster');

    ipcEventBroadcaster.init();
    const registerCount = mockEventBus.on.mock.calls.length;

    // 记录所有注册的 handler
    const registeredHandlers = mockEventBus.on.mock.calls.map((call) => ({
      event: call[0],
      handler: call[1]
    }));

    vi.clearAllMocks();

    // 调用 destroy
    ipcEventBroadcaster.destroy();

    // 验证 off 被调用的次数与 on 相同
    expect(mockEventBus.off).toHaveBeenCalledTimes(registerCount);

    // 验证每个 handler 都被正确移除
    for (const { event, handler } of registeredHandlers) {
      expect(mockEventBus.off).toHaveBeenCalledWith(event, handler);
    }
  });

  it('重复 init/destroy 不累积监听器', async () => {
    const { ipcEventBroadcaster } = await import('../eventBroadcaster');

    // 第一轮
    ipcEventBroadcaster.init();
    const handlers1 = mockEventBus.on.mock.calls.map((c) => ({ event: c[0], handler: c[1] }));
    ipcEventBroadcaster.destroy();

    vi.clearAllMocks();

    // 第二轮
    ipcEventBroadcaster.init();
    const handlers2 = mockEventBus.on.mock.calls.map((c) => ({ event: c[0], handler: c[1] }));

    // 验证两次注册的 handlers 是相同的引用
    expect(handlers1.length).toBe(handlers2.length);
    for (let i = 0; i < handlers1.length; i++) {
      expect(handlers1[i].event).toBe(handlers2[i].event);
      expect(handlers1[i].handler).toBe(handlers2[i].handler);
    }
  });

  it('destroy() 后再次 init() 可以正常工作', async () => {
    const { ipcEventBroadcaster } = await import('../eventBroadcaster');

    ipcEventBroadcaster.init();
    ipcEventBroadcaster.destroy();

    vi.clearAllMocks();

    // 再次初始化
    ipcEventBroadcaster.init();

    // 验证监听器被重新注册
    expect(mockEventBus.on).toHaveBeenCalled();
  });
});
