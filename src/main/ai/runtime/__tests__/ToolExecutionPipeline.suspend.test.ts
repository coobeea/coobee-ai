/**
 * ToolExecutionPipeline — suspend 信号测试
 *
 * 验证 before_tool_call hook 返回 { suspend: true } 时的行为：
 *   - 不执行工具
 *   - 返回 suspended: true 的 PipelineResult
 *   - resultText 包含 [SUSPENDED] 标记
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@main/common/logger', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
  return {
    log: mockLogger,
    createLogger: () => mockLogger
  };
});

// Mock ExtensionManager
const mockRunModifyingHook = vi.fn();
const mockRunVoidHook = vi.fn();

vi.mock('../../../common/extension', () => ({
  ExtensionManager: {
    getHookRunner: () => ({
      runModifyingHook: mockRunModifyingHook,
      runVoidHook: mockRunVoidHook
    })
  }
}));

// Mock sandbox
vi.mock('../../sandbox', () => ({
  isToolAllowed: () => true,
  formatToolBlockedMessage: () => 'blocked'
}));

describe('ToolExecutionPipeline — suspend', () => {
  let executeToolPipeline: typeof import('../shared/ToolExecutionPipeline').executeToolPipeline;

  const mockToolExecute = vi.fn();

  const mockToolDef = {
    name: 'test-tool',
    description: 'Test tool',
    execute: mockToolExecute
  };

  const defaultOpts = {
    sandboxContext: {
      workspaceRoot: '/tmp/test',
      sessionId: 'thread-123'
    }
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('../shared/ToolExecutionPipeline');
    executeToolPipeline = mod.executeToolPipeline;
  });

  it('before_tool_call 返回 suspend → 不执行工具, 返回 suspended PipelineResult', async () => {
    mockRunModifyingHook.mockResolvedValue({
      suspend: true,
      suspendReason: 'approval-pending:thread-123:0:test-tool',
      resultText: '[SUSPENDED] Tool test-tool suspended by extension'
    });

    const result = await executeToolPipeline(mockToolDef as never, { command: 'test' }, defaultOpts as never);

    expect(result.suspended).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.resultText).toContain('[SUSPENDED]');
    expect(result.resultText).toContain('test-tool');
    expect(mockToolExecute).not.toHaveBeenCalled();
  });

  it('before_tool_call 返回 block → 返回 blocked PipelineResult', async () => {
    mockRunModifyingHook.mockResolvedValue({
      block: true,
      blockReason: 'User rejected'
    });

    const result = await executeToolPipeline(mockToolDef as never, { command: 'test' }, defaultOpts as never);

    expect(result.blocked).toBe(true);
    expect(result.suspended).toBe(false);
    expect(result.resultText).toContain('User rejected');
    expect(mockToolExecute).not.toHaveBeenCalled();
  });

  it('before_tool_call 返回 null（放行）→ 正常执行工具', async () => {
    mockRunModifyingHook.mockResolvedValue(null);
    mockRunVoidHook.mockResolvedValue(undefined);

    // 模拟工具 AsyncGenerator
    const gen = (async function* () {
      yield { type: 'progress', data: '' };
      return { success: true, llmContent: 'Command executed' };
    })();
    mockToolExecute.mockReturnValue(gen);

    const result = await executeToolPipeline(mockToolDef as never, { command: 'echo hello' }, defaultOpts as never);

    expect(result.blocked).toBe(false);
    expect(result.suspended).toBe(false);
    expect(result.resultText).toBe('Command executed');
  });

  it('suspend 的 resultText 包含暂停标记', async () => {
    mockRunModifyingHook.mockResolvedValue({
      suspend: true,
      suspendReason: 'approval-pending',
      resultText: '[SUSPENDED] Please wait. Do NOT retry — the system will resume automatically.'
    });

    const result = await executeToolPipeline(mockToolDef as never, {}, defaultOpts as never);

    expect(result.resultText).toContain('[SUSPENDED]');
    expect(result.resultText).toContain('Do NOT retry');
    expect(result.resultText).toContain('automatically');
  });
});
