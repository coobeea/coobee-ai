/**
 * BeforeQuitProcessHook 单元测试
 *
 * 验证后台进程清理 Hook 的元数据、执行逻辑和容错性。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LifecyclePhase } from '@main/common/types';
import { BeforeQuitProcessHook } from '../BeforeQuitProcessHook';
import { log } from '@main/common/logger';

// Mock logger（BeforeQuitProcessHook 顶层直接导入 logger）
vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

// Mock ProcessRegistry（BeforeQuitProcessHook 使用 await import 延迟导入，路径相对于 lifecycle/）
const mockCleanup = vi.fn();
const mockRunningCount = vi.fn().mockReturnValue(0);

vi.mock('../../ai/process/ProcessRegistry', () => ({
  ProcessRegistry: {
    getInstance: () => ({
      cleanup: mockCleanup,
      get runningCount() {
        return mockRunningCount();
      }
    })
  }
}));

describe('BeforeQuitProcessHook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunningCount.mockReturnValue(0);
  });

  // ---- 1. Hook 元数据 ----

  it('name 是 "before-quit-process-cleanup"', () => {
    expect(BeforeQuitProcessHook.name).toBe('before-quit-process-cleanup');
  });

  it('phase 是 LifecyclePhase.BEFORE_QUIT', () => {
    expect(BeforeQuitProcessHook.phase).toBe(LifecyclePhase.BEFORE_QUIT);
  });

  it('priority 是 50', () => {
    expect(BeforeQuitProcessHook.priority).toBe(50);
  });

  it('critical 是 false', () => {
    expect(BeforeQuitProcessHook.critical).toBe(false);
  });

  // ---- 2. execute 调用 ProcessRegistry.cleanup() ----

  it('execute 调用 ProcessRegistry.cleanup()', async () => {
    await BeforeQuitProcessHook.execute({
      phase: LifecyclePhase.BEFORE_QUIT,
      manager: {}
    });

    expect(mockCleanup).toHaveBeenCalledTimes(1);
  });

  // ---- 3. 有运行中进程时记录日志 ----

  it('有运行中进程时记录日志', async () => {
    mockRunningCount.mockReturnValue(3);

    await BeforeQuitProcessHook.execute({
      phase: LifecyclePhase.BEFORE_QUIT,
      manager: {}
    });

    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('3'));
    expect(log.info).toHaveBeenCalledWith(expect.stringMatching(/正在清理.*3.*运行中的后台进程/));
  });

  // ---- 4. 无运行中进程时正常完成 ----

  it('无运行中进程时正常完成', async () => {
    mockRunningCount.mockReturnValue(0);

    await expect(
      BeforeQuitProcessHook.execute({
        phase: LifecyclePhase.BEFORE_QUIT,
        manager: {}
      })
    ).resolves.toBeUndefined();

    expect(mockCleanup).toHaveBeenCalledTimes(1);
  });

  // ---- 5. cleanup 抛错时能捕获并记录日志 ----

  it('cleanup 抛错时能捕获并记录日志', async () => {
    const cleanupError = new Error('cleanup failed');
    mockCleanup.mockImplementation(() => {
      throw cleanupError;
    });

    await expect(
      BeforeQuitProcessHook.execute({
        phase: LifecyclePhase.BEFORE_QUIT,
        manager: {}
      })
    ).resolves.toBeUndefined();

    expect(log.error).toHaveBeenCalledWith('[BeforeQuitProcessHook] 后台进程清理失败:', cleanupError);
  });

  // ---- 6. ProcessRegistry 导入失败时能捕获 ----

  it('ProcessRegistry 导入失败时能捕获', async () => {
    vi.resetModules();
    vi.doMock('../../ai/process/ProcessRegistry', () => {
      throw new Error('ProcessRegistry import failed');
    });

    const { BeforeQuitProcessHook: Hook } = await import('../BeforeQuitProcessHook');

    await expect(
      Hook.execute({
        phase: LifecyclePhase.BEFORE_QUIT,
        manager: {}
      })
    ).resolves.toBeUndefined();

    expect(log.error).toHaveBeenCalledWith('[BeforeQuitProcessHook] 后台进程清理失败:', expect.any(Error));
  });
});
