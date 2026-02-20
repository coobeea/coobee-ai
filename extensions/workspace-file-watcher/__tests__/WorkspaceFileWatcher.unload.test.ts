/**
 * WorkspaceFileWatcher 卸载与资源清理测试
 *
 * 验证：
 *   1. stop() 正确移除 EventBus 监听器
 *   2. stop() 关闭所有 FSWatcher 实例
 *   3. stop() 清理所有 Timer（keepalive + debounce）
 *   4. 热重载场景下资源不泄漏
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
};

const mockEventBus = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn()
};

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

describe('WorkspaceFileWatcher - 卸载与资源清理', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    WorkspaceFileWatcher.resetInstance();
    mockWorkspacesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coobee-watcher-unload-test-'));
  });

  afterEach(() => {
    WorkspaceFileWatcher.resetInstance();
    if (mockWorkspacesDir && fs.existsSync(mockWorkspacesDir)) {
      fs.rmSync(mockWorkspacesDir, { recursive: true, force: true });
    }
  });

  it('stop() 移除所有 EventBus 监听器', async () => {
    const watcher = WorkspaceFileWatcher.getInstance();
    await watcher.start(mockLogger, mockEventBus);

    expect(mockEventBus.on).toHaveBeenCalledTimes(3);

    watcher.stop();

    // 验证 off 被调用 3 次（对应 3 个 on）
    expect(mockEventBus.off).toHaveBeenCalledTimes(3);
    expect(mockEventBus.off).toHaveBeenCalledWith(StreamEventType.MESSAGE, expect.any(Function));
    expect(mockEventBus.off).toHaveBeenCalledWith(StreamEventType.END, expect.any(Function));
    expect(mockEventBus.off).toHaveBeenCalledWith(StreamEventType.ERROR, expect.any(Function));

    // 验证传递给 off 的函数引用与 on 时相同
    const onCallMessage = mockEventBus.on.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE);
    const offCallMessage = mockEventBus.off.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE);
    expect(onCallMessage?.[1]).toBe(offCallMessage?.[1]); // ← 函数引用必须相同
  });

  it('stop() 关闭所有 FSWatcher 实例', async () => {
    const watcher = WorkspaceFileWatcher.getInstance();
    await watcher.start(mockLogger, mockEventBus);

    // 启动 2 个任务的监控
    const threadDir1 = path.join(mockWorkspacesDir, 't1');
    const threadDir2 = path.join(mockWorkspacesDir, 't2');
    fs.mkdirSync(threadDir1, { recursive: true });
    fs.mkdirSync(threadDir2, { recursive: true });

    const handler = mockEventBus.on.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE)?.[1];
    await handler?.({ sessionId: 't1', type: StreamEventType.MESSAGE });
    await handler?.({ sessionId: 't2', type: StreamEventType.MESSAGE });

    await sleep(100);

    // 调用 stop
    watcher.stop();

    // 验证所有 watcher 都被关闭（内部 Map 应为空）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((watcher as any).watchers.size).toBe(0);
  });

  it('stop() 清理所有 Timer（keepalive + debounce）', async () => {
    vi.useFakeTimers();

    const watcher = WorkspaceFileWatcher.getInstance({ keepaliveTimeout: 1000 });
    await watcher.start(mockLogger, mockEventBus);

    const threadDir = path.join(mockWorkspacesDir, 't1');
    fs.mkdirSync(threadDir, { recursive: true });

    const handler = mockEventBus.on.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE)?.[1];
    await handler?.({ sessionId: 't1', type: StreamEventType.MESSAGE });

    // 触发文件变化（创建 debounce timer）
    fs.writeFileSync(path.join(threadDir, 'test.txt'), 'content');
    await vi.advanceTimersByTimeAsync(100);

    // 调用 stop（应清理所有 timer）
    watcher.stop();

    // 快进时间，验证 timer 不会触发
    const emitCallsBefore = mockEventBus.emit.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    const emitCallsAfter = mockEventBus.emit.mock.calls.length;

    expect(emitCallsAfter).toBe(emitCallsBefore); // 无新的 emit（timer 已清理）

    vi.useRealTimers();
  });

  it('热重载场景：重复 start/stop 不泄漏', async () => {
    const watcher = WorkspaceFileWatcher.getInstance();

    // 第 1 次加载
    await watcher.start(mockLogger, mockEventBus);
    expect(mockEventBus.on).toHaveBeenCalledTimes(3);

    watcher.stop();
    expect(mockEventBus.off).toHaveBeenCalledTimes(3);

    vi.clearAllMocks();

    // 第 2 次加载（热重载）
    await watcher.start(mockLogger, mockEventBus);
    expect(mockEventBus.on).toHaveBeenCalledTimes(3);

    watcher.stop();
    expect(mockEventBus.off).toHaveBeenCalledTimes(3);

    // 验证函数引用仍然一致
    const onCallMessage2 = mockEventBus.on.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE);
    const offCallMessage2 = mockEventBus.off.mock.calls.find((call) => call[0] === StreamEventType.MESSAGE);
    expect(onCallMessage2?.[1]).toBe(offCallMessage2?.[1]);
  });
});
