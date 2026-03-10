/**
 * ProcessRegistry 测试
 *
 * 验证：
 * - 进程注册与列表
 * - 事件发射 (process:output, process:exit)
 * - 输出缓冲区管理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ProcessRegistry } from '../ProcessRegistry';

vi.mock('@main/common/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

function createMockChild(): {
  child: import('node:child_process').ChildProcess;
  emitStdout: (data: string) => void;
  emitStderr: (data: string) => void;
  emitClose: (code: number | null, signal: string | null) => void;
  emitError: (err: Error) => void;
} {
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  const childEmitter = new EventEmitter();

  const child = {
    pid: 12345,
    stdout: stdoutEmitter,
    stderr: stderrEmitter,
    stdin: { write: vi.fn() },
    kill: vi.fn(() => true),
    on: childEmitter.on.bind(childEmitter),
    removeListener: childEmitter.removeListener.bind(childEmitter)
  } as unknown as import('node:child_process').ChildProcess;

  return {
    child,
    emitStdout: (data: string) => stdoutEmitter.emit('data', Buffer.from(data)),
    emitStderr: (data: string) => stderrEmitter.emit('data', Buffer.from(data)),
    emitClose: (code, signal) => childEmitter.emit('close', code, signal),
    emitError: (err) => childEmitter.emit('error', err)
  };
}

describe('ProcessRegistry', () => {
  let registry: ProcessRegistry;

  beforeEach(() => {
    ProcessRegistry.resetInstance();
    registry = ProcessRegistry.getInstance();
  });

  afterEach(() => {
    ProcessRegistry.resetInstance();
  });

  it('should register a process and list it', () => {
    const { child } = createMockChild();
    const processId = registry.register('echo hello', '/tmp', child);

    expect(processId).toMatch(/^proc-/);
    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0].command).toBe('echo hello');
    expect(list[0].status).toBe('running');
  });

  it('should emit process:output on stdout', () => {
    const handler = vi.fn();
    registry.on('process:output', handler);

    const { child, emitStdout } = createMockChild();
    const processId = registry.register('echo hello', '/tmp', child);

    emitStdout('hello world\n');

    expect(handler).toHaveBeenCalledWith({
      processId,
      text: 'hello world\n'
    });
  });

  it('should emit process:output on stderr', () => {
    const handler = vi.fn();
    registry.on('process:output', handler);

    const { child, emitStderr } = createMockChild();
    const processId = registry.register('bad-command', '/tmp', child);

    emitStderr('error: not found\n');

    expect(handler).toHaveBeenCalledWith({
      processId,
      text: 'error: not found\n'
    });
  });

  it('should emit process:exit on close', () => {
    const handler = vi.fn();
    registry.on('process:exit', handler);

    const { child, emitClose } = createMockChild();
    const processId = registry.register('sleep 1', '/tmp', child);

    emitClose(0, null);

    expect(handler).toHaveBeenCalledWith({
      processId,
      status: 'exited',
      exitCode: 0
    });
  });

  it('should emit process:exit with killed status on signal', () => {
    const handler = vi.fn();
    registry.on('process:exit', handler);

    const { child, emitClose } = createMockChild();
    const processId = registry.register('sleep 100', '/tmp', child);

    emitClose(null, 'SIGTERM');

    expect(handler).toHaveBeenCalledWith({
      processId,
      status: 'killed',
      exitCode: null
    });
  });

  it('should buffer output and read it back', () => {
    const { child, emitStdout } = createMockChild();
    const processId = registry.register('log-cmd', '/tmp', child);

    emitStdout('line1\nline2\n');
    emitStdout('line3\n');

    const output = registry.readOutput(processId);
    expect(output).toContain('line1');
    expect(output).toContain('line2');
    expect(output).toContain('line3');
  });

  it('should store threadId when provided', () => {
    const { child } = createMockChild();
    const processId = registry.register('echo ok', '/tmp', child, 'thread-123');

    const proc = registry.get(processId);
    expect(proc?.threadId).toBe('thread-123');
  });

  it('listByThread returns only processes matching threadId', () => {
    const { child: c1 } = createMockChild();
    const { child: c2 } = createMockChild();
    const { child: c3 } = createMockChild();

    registry.register('cmd-a', '/tmp', c1, 'thread-A');
    registry.register('cmd-b', '/tmp', c2, 'thread-B');
    registry.register('cmd-c', '/tmp', c3, 'thread-A');

    const listA = registry.listByThread('thread-A');
    expect(listA).toHaveLength(2);
    expect(listA.map((p) => p.command)).toEqual(['cmd-a', 'cmd-c']);

    const listB = registry.listByThread('thread-B');
    expect(listB).toHaveLength(1);
    expect(listB[0].command).toBe('cmd-b');
  });

  it('cleanupByThread kills and removes matching processes', () => {
    const killFn1 = vi.fn();
    const killFn2 = vi.fn();

    const { child: c1 } = createMockChild();
    c1.kill = killFn1;
    const { child: c2 } = createMockChild();
    c2.kill = killFn2;

    registry.register('long-a', '/tmp', c1, 'thread-X');
    registry.register('long-b', '/tmp', c2, 'thread-Y');

    const cleaned = registry.cleanupByThread('thread-X');
    expect(cleaned).toBe(1);
    expect(killFn1).toHaveBeenCalledWith('SIGTERM');
    expect(killFn2).not.toHaveBeenCalled();
    expect(registry.listByThread('thread-X')).toHaveLength(0);
    expect(registry.listByThread('thread-Y')).toHaveLength(1);
  });
});
