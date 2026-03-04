/**
 * WorkerManager 端口安全与并发启动测试
 *
 * 测试覆盖：
 * 1. waitForPortAvailable — 端口空闲时立即返回
 * 2. waitForPortAvailable — 端口占用时轮询等待
 * 3. waitForPortAvailable — 超时抛出错误
 * 4. start() 并发锁 — 同一 Worker 并发 start 复用 Promise
 * 5. start() 状态守卫 — initializing 状态阻止重复启动
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp'
  }
}));

vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }))
}));

vi.mock('@main/common/env', () => {
  const tmpDir = path.join(os.tmpdir(), `worker-port-test-${Date.now()}`);
  return {
    Env: {
      paths: {
        workersDir: path.join(tmpDir, 'workers'),
        modelsDir: '/tmp/models',
        userHome: '/tmp/user',
        userData: '/tmp/data'
      },
      main: {
        serverHost: '127.0.0.1'
      },
      isWindows: false,
      getPlatformRuntimeDir: () => '/tmp/runtime'
    }
  };
});

describe('WorkerManager 端口安全', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let manager: any;
  let WorkerManagerClass: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import('../WorkerManager');
    WorkerManagerClass = module.WorkerManager;
    WorkerManagerClass.instance = null;
    manager = WorkerManagerClass.getInstance();
  });

  afterEach(() => {
    WorkerManagerClass.instance = null;
  });

  describe('waitForPortAvailable', () => {
    it('端口空闲时立即返回', async () => {
      await expect(manager.waitForPortAvailable(0, 5000)).resolves.toBeUndefined();
    });

    it('端口被占用时等待释放', async () => {
      const server = net.createServer();
      const port = await new Promise<number>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          resolve((addr as net.AddressInfo).port);
        });
      });

      setTimeout(() => server.close(), 500);

      const start = Date.now();
      await manager.waitForPortAvailable(port, 5000);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(400);
      expect(elapsed).toBeLessThan(3000);
    });

    it('超时时抛出错误', async () => {
      const server = net.createServer();
      const port = await new Promise<number>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          resolve((addr as net.AddressInfo).port);
        });
      });

      try {
        await expect(manager.waitForPortAvailable(port, 1000)).rejects.toThrow('未释放');
      } finally {
        server.close();
      }
    });
  });

  describe('start() 并发锁', () => {
    it('同一 Worker 并发 start 复用 Promise', async () => {
      const config = {
        name: 'test-lock',
        label: 'Test Lock',
        entry: 'server.py',
        port: 19999,
        type: 'python' as const
      };
      manager.register(config);

      let startCallCount = 0;
      const original = manager._doStart.bind(manager);
      manager._doStart = vi.fn(async (name: string) => {
        startCallCount++;
        await new Promise((r) => setTimeout(r, 200));
        return original(name).catch(() => {});
      });

      const p1 = manager.start('test-lock');
      const p2 = manager.start('test-lock');

      await Promise.allSettled([p1, p2]);

      expect(startCallCount).toBe(1);
    });
  });

  describe('start() 状态守卫', () => {
    it('initializing 状态阻止重复启动', async () => {
      const config = {
        name: 'test-guard',
        label: 'Test Guard',
        entry: 'server.py',
        port: 19998,
        type: 'python' as const
      };
      manager.register(config);

      const workers = manager.workers;
      const worker = workers.get('test-guard');
      if (worker) {
        worker.status = 'initializing';
      }

      manager.startingLocks.clear();

      await manager.start('test-guard');

      expect(worker?.status).toBe('initializing');
    });
  });
});
