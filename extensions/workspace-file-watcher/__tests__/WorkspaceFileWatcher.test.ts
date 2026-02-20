/**
 * WorkspaceFileWatcher 单元测试
 *
 * 使用真实的 chokidar + 临时目录测试文件监控功能
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}));

vi.mock('../../../src/main/common/logger', () => ({
  createLogger: () => mockLog
}));

const mockEventBus = vi.hoisted(() => ({
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn()
}));

vi.mock('../../../src/main/common/eventbus', () => ({
  eventBus: mockEventBus
}));

// Mock Env with real temp dir
let mockWorkspacesDir: string;

vi.mock('../../../src/main/common/env', async () => {
  return {
    Env: {
      paths: {
        get workspacesDir() {
          return mockWorkspacesDir;
        }
      }
    }
  };
});

import { WorkspaceFileWatcher } from '../WorkspaceFileWatcher';
import { StreamEventType } from '../../../src/main/ai/streaming/types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('WorkspaceFileWatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    WorkspaceFileWatcher.resetInstance();

    // Create temporary workspaces directory
    mockWorkspacesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coobee-watcher-test-'));
  });

  afterEach(() => {
    WorkspaceFileWatcher.resetInstance();

    // Cleanup temp dir
    if (mockWorkspacesDir && fs.existsSync(mockWorkspacesDir)) {
      fs.rmSync(mockWorkspacesDir, { recursive: true, force: true });
    }
  });

  // ========== 生命周期 ==========

  describe('start / stop', () => {
    it('start 注册 EventBus 监听器', () => {
      const watcher = WorkspaceFileWatcher.getInstance();
      watcher.start();

      expect(mockEventBus.on).toHaveBeenCalledWith(StreamEventType.MESSAGE, expect.any(Function));
      expect(mockEventBus.on).toHaveBeenCalledWith(StreamEventType.END, expect.any(Function));
      expect(mockEventBus.on).toHaveBeenCalledWith(StreamEventType.ERROR, expect.any(Function));
    });

    it('stop 移除监听器并清理所有监控', () => {
      const watcher = WorkspaceFileWatcher.getInstance();
      watcher.start();
      watcher.stop();

      expect(mockEventBus.off).toHaveBeenCalledWith(StreamEventType.MESSAGE, expect.any(Function));
      expect(mockEventBus.off).toHaveBeenCalledWith(StreamEventType.END, expect.any(Function));
      expect(mockEventBus.off).toHaveBeenCalledWith(StreamEventType.ERROR, expect.any(Function));
    });
  });

  // ========== stream:message 事件处理 ==========

  describe('handleStreamMessage', () => {
    it('首次 stream:message 启动监控', async () => {
      const watcher = WorkspaceFileWatcher.getInstance();
      watcher.start();

      // Create thread workspace directory
      const threadDir = path.join(mockWorkspacesDir, 'thread-1');
      fs.mkdirSync(threadDir, { recursive: true });

      const handler = mockEventBus.on.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE)?.[1];
      expect(handler).toBeDefined();

      await handler({ sessionId: 'thread-1', type: StreamEventType.MESSAGE, timestamp: Date.now() });

      // Wait for chokidar to initialize
      await sleep(200);

      expect(watcher.isWatching('thread-1')).toBe(true);
    });

    it('跳过子 Agent sessionId（含 ":"）', async () => {
      const watcher = WorkspaceFileWatcher.getInstance();
      watcher.start();

      const handler = mockEventBus.on.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE)?.[1];

      await handler({ sessionId: 'parent:child', type: StreamEventType.MESSAGE, timestamp: Date.now() });
      await sleep(100);

      expect(watcher.isWatching('parent:child')).toBe(false);
    });
  });

  // ========== stream:end/error 事件处理 ==========

  describe('handleStreamEnd / handleStreamError', () => {
    it('stream:end 停止监控', async () => {
      const watcher = WorkspaceFileWatcher.getInstance();
      watcher.start();

      const threadDir = path.join(mockWorkspacesDir, 'thread-1');
      fs.mkdirSync(threadDir, { recursive: true });

      const messageHandler = mockEventBus.on.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE)?.[1];
      const endHandler = mockEventBus.on.mock.calls.find((call) => call[0] === StreamEventType.END)?.[1];

      // 启动监控
      await messageHandler({ sessionId: 'thread-1', type: StreamEventType.MESSAGE, timestamp: Date.now() });
      await sleep(200);
      expect(watcher.isWatching('thread-1')).toBe(true);

      // 任务完成
      endHandler({ sessionId: 'thread-1', type: StreamEventType.END, timestamp: Date.now() });
      await sleep(100);

      expect(watcher.isWatching('thread-1')).toBe(false);
    });

    it('stream:error 停止监控', async () => {
      const watcher = WorkspaceFileWatcher.getInstance();
      watcher.start();

      const threadDir = path.join(mockWorkspacesDir, 'thread-1');
      fs.mkdirSync(threadDir, { recursive: true });

      const messageHandler = mockEventBus.on.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE)?.[1];
      const errorHandler = mockEventBus.on.mock.calls.find((call) => call[0] === StreamEventType.ERROR)?.[1];

      // 启动监控
      await messageHandler({ sessionId: 'thread-1', type: StreamEventType.MESSAGE, timestamp: Date.now() });
      await sleep(200);
      expect(watcher.isWatching('thread-1')).toBe(true);

      // 任务出错
      errorHandler({ sessionId: 'thread-1', type: StreamEventType.ERROR, timestamp: Date.now() });
      await sleep(100);

      expect(watcher.isWatching('thread-1')).toBe(false);
    });
  });

  // ========== 文件变化处理 ==========

  describe('file change events', () => {
    it('文件变化 → 去抖 300ms → 批量推送', async () => {
      const watcher = WorkspaceFileWatcher.getInstance({ debounceMs: 300 });
      watcher.start();

      const threadDir = path.join(mockWorkspacesDir, 'thread-1');
      fs.mkdirSync(threadDir, { recursive: true });

      const handler = mockEventBus.on.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE)?.[1];

      // 启动监控
      await handler({ sessionId: 'thread-1', type: StreamEventType.MESSAGE, timestamp: Date.now() });
      await sleep(200);

      // 创建文件（触发变化）
      fs.writeFileSync(path.join(threadDir, 'test.txt'), 'hello');
      fs.writeFileSync(path.join(threadDir, 'another.md'), 'world');

      // 等待 chokidar awaitWriteFinish (200ms) + 去抖 (300ms) + buffer
      await sleep(800);

      // 验证推送
      expect(mockEventBus.emit).toHaveBeenCalledWith('workspace:file-changed', {
        threadId: 'thread-1',
        files: expect.arrayContaining(['test.txt', 'another.md']),
        timestamp: expect.any(Number)
      });
    });
  });

  // ========== 多任务隔离 ==========

  describe('multi-task isolation', () => {
    it('多个任务独立监控，互不干扰', async () => {
      const watcher = WorkspaceFileWatcher.getInstance();
      watcher.start();

      const thread1Dir = path.join(mockWorkspacesDir, 'thread-1');
      const thread2Dir = path.join(mockWorkspacesDir, 'thread-2');
      fs.mkdirSync(thread1Dir, { recursive: true });
      fs.mkdirSync(thread2Dir, { recursive: true });

      const handler = mockEventBus.on.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE)?.[1];

      // 启动两个任务的监控
      await handler({ sessionId: 'thread-1', type: StreamEventType.MESSAGE, timestamp: Date.now() });
      await handler({ sessionId: 'thread-2', type: StreamEventType.MESSAGE, timestamp: Date.now() });
      await sleep(200);

      expect(watcher.isWatching('thread-1')).toBe(true);
      expect(watcher.isWatching('thread-2')).toBe(true);
      expect(watcher.activeWatcherCount).toBe(2);

      // 停止 thread-1
      const endHandler = mockEventBus.on.mock.calls.find((call) => call[0] === StreamEventType.END)?.[1];
      endHandler({ sessionId: 'thread-1', type: StreamEventType.END, timestamp: Date.now() });
      await sleep(100);

      expect(watcher.isWatching('thread-1')).toBe(false);
      expect(watcher.isWatching('thread-2')).toBe(true);
      expect(watcher.activeWatcherCount).toBe(1);
    });
  });

  // ========== stopAll ==========

  describe('stopAll', () => {
    it('stopAll 清理所有监控', async () => {
      const watcher = WorkspaceFileWatcher.getInstance();
      watcher.start();

      const thread1Dir = path.join(mockWorkspacesDir, 'thread-1');
      const thread2Dir = path.join(mockWorkspacesDir, 'thread-2');
      fs.mkdirSync(thread1Dir, { recursive: true });
      fs.mkdirSync(thread2Dir, { recursive: true });

      const handler = mockEventBus.on.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE)?.[1];

      // 启动多个监控
      await handler({ sessionId: 'thread-1', type: StreamEventType.MESSAGE, timestamp: Date.now() });
      await handler({ sessionId: 'thread-2', type: StreamEventType.MESSAGE, timestamp: Date.now() });
      await sleep(200);

      expect(watcher.activeWatcherCount).toBe(2);

      watcher.stopAll();

      expect(watcher.activeWatcherCount).toBe(0);
    });
  });
});
