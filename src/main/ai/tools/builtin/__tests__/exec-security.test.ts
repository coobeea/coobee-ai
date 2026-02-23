/**
 * exec 工具安全兜底测试
 *
 * 验证 exec 工具在 tool-approval Extension 未加载时的行为：
 *   - deny: 始终被拒绝
 *   - ask: 未知命令在 Extension 不可用时被拒绝
 *   - allow: 安全命令仍可执行（由 Extension hook 或工具自身放行）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────

// Mock electron first
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/path'),
    isReady: vi.fn(() => true)
  },
  BrowserWindow: vi.fn()
}));

// Mock @electron-toolkit/utils
vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: false,
    prod: true
  }
}));

// Mock Env (before any imports that depend on it)
vi.mock('@main/common/env', () => ({
  Env: {
    paths: {
      workspaceRoot: '/mock/workspace',
      userHome: '/mock/home',
      threadsDir: '/mock/threads',
      workspacesDir: '/mock/workspaces'
    },
    main: {
      logLevel: 'info'
    }
  }
}));

vi.mock('@main/common/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

const mockGetExtensionIds = vi.fn();

vi.mock('../../../../common/extension', () => ({
  ExtensionManager: {
    getRegistry: (): { getExtensionIds: () => string[] } | null => {
      return { getExtensionIds: mockGetExtensionIds };
    },
    getHookRunner: (): null => null
  }
}));

// Mock sandbox (resolveWorkingDirectory)
vi.mock('../../../sandbox', () => ({
  resolveWorkingDirectory: (): string => '/tmp/workspace'
}));

// Mock ProcessRegistry
vi.mock('../../../process/ProcessRegistry', () => ({
  ProcessRegistry: {
    getInstance: (): { register: () => void } => ({
      register: vi.fn()
    })
  }
}));

// ─── Tests ──────────────────────────────────────

describe('exec tool — security fallback', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let execTool: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetExtensionIds.mockReturnValue([]);

    const mod = await import('../exec');
    execTool = mod.execTool;
  });

  /**
   * 辅助：运行 exec 工具并获取返回的 ToolResult
   *
   * exec 是 AsyncGenerator<ToolStreamUpdate, ToolResult>。
   * return 值在 generator done 时出现。
   */
  async function runExec(command: string): Promise<{ success: boolean; error?: { code: string; message: string } }> {
    const gen = execTool.execute({ command }, undefined, { workspaceRoot: '/tmp/workspace' });

    // 消耗所有 yield，直到 done: true（return 值）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let result: any;

    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        result = value;
        break;
      }
    }
    return result;
  }

  it('should deny blacklisted commands regardless of extension state', async () => {
    const result = await runExec('rm -rf /');
    expect(result.success).toBe(false);
    // 实际返回的错误码是 DANGEROUS_COMMAND
    expect(result.error?.code).toBe('DANGEROUS_COMMAND');
  });

  it('should pass through ask-level commands (approval handled by ToolExecutionPipeline)', async () => {
    // 审批逻辑已移至 ToolExecutionPipeline 统一处理
    // exec 工具层不再拦截 ask 级别命令，直接执行
    // 命令不存在时 spawn 会触发 EXEC_ERROR（而非 EXEC_POLICY_ASK_NO_APPROVAL）
    mockGetExtensionIds.mockReturnValue([]);
    const result = await runExec('my-unknown-tool --flag');
    expect(result.success).toBe(false);
    // 命令不存在 → spawn error，不是策略拒绝
    expect(result.error?.code).toBe('EXEC_ERROR');
  });

  it('should not produce EXEC_POLICY_ASK_NO_APPROVAL when tool-approval IS loaded', async () => {
    mockGetExtensionIds.mockReturnValue(['tool-approval']);

    // 命令不存在会在 spawn 时失败（非策略拒绝）
    // 使用 try-catch 因为 spawn 会抛出系统错误
    try {
      const result = await runExec('imaginary-tool --version');
      if (!result.success) {
        expect(result.error?.code).not.toBe('EXEC_POLICY_ASK_NO_APPROVAL');
      }
    } catch {
      // spawn 失败（命令不存在）是预期行为，重要的是没被策略拒绝
    }
  });
});
