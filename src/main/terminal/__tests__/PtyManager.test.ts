/**
 * PtyManager 单元测试
 *
 * 测试 PTY 终端的创建、IO、调整大小、销毁和生命周期管理。
 * node-pty 被 mock 以避免在 CI 环境中需要原生模块。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function createMockPty() {
  return {
    pid: 12345,
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn()
  };
}

let latestMockPty = createMockPty();

const mockSpawn = vi.fn(() => {
  latestMockPty = createMockPty();
  return latestMockPty;
});

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

import { getPtyManager, PtyManager, _setPtyModule } from '../PtyManager';

describe('PtyManager', () => {
  let manager: PtyManager;

  beforeEach(() => {
    vi.clearAllMocks();
    _setPtyModule({ spawn: mockSpawn });
    manager = new PtyManager();
  });

  afterEach(() => {
    manager.cleanup();
  });

  describe('create', () => {
    it('should create a terminal with default options', () => {
      const info = manager.create();

      expect(info).toMatchObject({
        id: expect.stringMatching(/^term-\d+$/),
        pid: 12345,
        cols: 80,
        rows: 24
      });
      expect(info.createdAt).toBeGreaterThan(0);
      expect(latestMockPty.onData).toHaveBeenCalled();
      expect(latestMockPty.onExit).toHaveBeenCalled();
    });

    it('should create a terminal with custom options', () => {
      const info = manager.create({
        cwd: '/tmp/test',
        cols: 120,
        rows: 40,
        shell: '/bin/bash'
      });

      expect(info.cols).toBe(120);
      expect(info.rows).toBe(40);
      expect(info.shell).toBe('/bin/bash');
      expect(info.cwd).toBe('/tmp/test');
    });

    it('should limit maximum terminals', () => {
      for (let i = 0; i < 10; i++) {
        manager.create();
      }

      expect(() => manager.create()).toThrow('Terminal limit reached');
    });
  });

  describe('write', () => {
    it('should write data to terminal', () => {
      const info = manager.create();
      const pty = latestMockPty;
      const ok = manager.write(info.id, 'echo hello\n');

      expect(ok).toBe(true);
      expect(pty.write).toHaveBeenCalledWith('echo hello\n');
    });

    it('should return false for non-existent terminal', () => {
      expect(manager.write('non-existent', 'data')).toBe(false);
    });
  });

  describe('resize', () => {
    it('should resize terminal', () => {
      const info = manager.create();
      const pty = latestMockPty;
      const ok = manager.resize(info.id, 200, 50);

      expect(ok).toBe(true);
      expect(pty.resize).toHaveBeenCalledWith(200, 50);

      const updated = manager.get(info.id);
      expect(updated?.cols).toBe(200);
      expect(updated?.rows).toBe(50);
    });

    it('should return false for non-existent terminal', () => {
      expect(manager.resize('non-existent', 80, 24)).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should destroy terminal', () => {
      const info = manager.create();
      const pty = latestMockPty;
      const ok = manager.destroy(info.id);

      expect(ok).toBe(true);
      expect(pty.kill).toHaveBeenCalled();
      expect(manager.get(info.id)).toBeUndefined();
    });

    it('should return false for non-existent terminal', () => {
      expect(manager.destroy('non-existent')).toBe(false);
    });
  });

  describe('list', () => {
    it('should list all terminals', () => {
      manager.create();
      manager.create();

      const list = manager.list();
      expect(list).toHaveLength(2);
    });
  });

  describe('events', () => {
    it('should emit terminal:output when pty produces data', () => {
      const outputHandler = vi.fn();
      manager.on('terminal:output', outputHandler);

      const info = manager.create();
      const pty = latestMockPty;

      const dataCallback = pty.onData.mock.calls[0][0];
      dataCallback('hello world');

      expect(outputHandler).toHaveBeenCalledWith({
        terminalId: info.id,
        data: 'hello world'
      });
    });

    it('should emit terminal:exit when pty exits', () => {
      const exitHandler = vi.fn();
      manager.on('terminal:exit', exitHandler);

      const info = manager.create();
      const pty = latestMockPty;

      const exitCallback = pty.onExit.mock.calls[0][0];
      exitCallback({ exitCode: 0, signal: undefined });

      expect(exitHandler).toHaveBeenCalledWith({
        terminalId: info.id,
        exitCode: 0,
        signal: undefined
      });

      expect(manager.get(info.id)).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('should destroy all terminals', () => {
      const ptys: ReturnType<typeof createMockPty>[] = [];
      manager.create();
      ptys.push(latestMockPty);
      manager.create();
      ptys.push(latestMockPty);
      manager.create();
      ptys.push(latestMockPty);

      expect(manager.list()).toHaveLength(3);

      manager.cleanup();

      expect(manager.list()).toHaveLength(0);
      for (const pty of ptys) {
        expect(pty.kill).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const a = getPtyManager();
      const b = getPtyManager();
      expect(a).toBe(b);
    });
  });
});
