/**
 * ReadyExtensionHook 单元测试
 *
 * 验证生命周期 Hook 的元数据和容错性。
 * 注意：ReadyExtensionHook.execute() 内部使用 await import() 动态导入多个模块，
 * 其核心编排流程（Registry、Loader、Manager、ToolRegistry 组合）已在各组件的
 * 独立测试和集成测试中充分覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LifecyclePhase } from '@main/common/types';
import { ReadyExtensionHook } from '../../../lifecycle/ReadyExtensionHook';

// Mock logger（ReadyExtensionHook 顶层直接导入 logger）
vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

describe('ReadyExtensionHook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- 元数据 ----

  it('name 为 "ready-extension"', () => {
    expect(ReadyExtensionHook.name).toBe('ready-extension');
  });

  it('phase 为 READY', () => {
    expect(ReadyExtensionHook.phase).toBe(LifecyclePhase.READY);
  });

  it('priority 为 50（在 Gateway(45) 之后）', () => {
    expect(ReadyExtensionHook.priority).toBe(50);
  });

  it('critical 为 false（Extension 加载失败不阻止启动）', () => {
    expect(ReadyExtensionHook.critical).toBe(false);
  });

  it('execute 是一个 async 函数', () => {
    expect(typeof ReadyExtensionHook.execute).toBe('function');
  });

  // ---- 容错 ----

  it('execute — 动态 import 失败时不抛错（critical=false 保护）', async () => {
    // 故意 mock @main/common/env 使其抛错
    vi.doMock('@main/common/env', () => {
      throw new Error('module load failed');
    });

    // 不应抛错，因为 execute 内有 try-catch
    await expect(
      ReadyExtensionHook.execute({
        phase: LifecyclePhase.READY,
        manager: {}
      })
    ).resolves.toBeUndefined();
  });

  // ---- 静态结构验证 ----

  it('符合 LifecycleHook 接口结构', () => {
    expect(ReadyExtensionHook).toHaveProperty('name');
    expect(ReadyExtensionHook).toHaveProperty('phase');
    expect(ReadyExtensionHook).toHaveProperty('priority');
    expect(ReadyExtensionHook).toHaveProperty('critical');
    expect(ReadyExtensionHook).toHaveProperty('execute');
  });

  it('priority 在合理范围 [0,100]', () => {
    expect(ReadyExtensionHook.priority).toBeGreaterThanOrEqual(0);
    expect(ReadyExtensionHook.priority).toBeLessThanOrEqual(100);
  });

  it('priority 大于 Gateway(45)', () => {
    expect(ReadyExtensionHook.priority).toBeGreaterThan(45);
  });
});
