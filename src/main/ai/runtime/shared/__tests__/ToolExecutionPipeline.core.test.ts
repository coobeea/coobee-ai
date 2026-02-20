import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeToolPipeline, createFallbackToolContext } from '../ToolExecutionPipeline';
import type { ToolDefinition } from '../../../tools/types';
import { ToolCategory } from '../../../tools/types';
import { z } from 'zod';

// Mock logger
vi.mock('@main/common/logger', () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { log, createLogger: vi.fn(() => log) };
});

const mockRunModifyingHook = vi.fn();
const mockRunVoidHook = vi.fn();

// Mock ExtensionManager
vi.mock('../../../../common/extension', () => ({
  ExtensionManager: {
    getHookRunner: vi.fn(() => ({
      runModifyingHook: mockRunModifyingHook,
      runVoidHook: mockRunVoidHook
    }))
  }
}));

// Mock Sandbox
const mockIsToolAllowed = vi.fn();
const mockFormatToolBlockedMessage = vi.fn();
vi.mock('../../sandbox', () => ({
  isToolAllowed: mockIsToolAllowed,
  formatToolBlockedMessage: mockFormatToolBlockedMessage
}));

describe('ToolExecutionPipeline Core', () => {
  let mockTool: ToolDefinition;
  let context: ReturnType<typeof createFallbackToolContext>;

  beforeEach(() => {
    vi.clearAllMocks();

    context = createFallbackToolContext({ workspaceRoot: '/mock/workspace', sessionId: 'test-session' });
    context.toolPolicy = { allow: [], deny: [], confirm: [] };

    mockIsToolAllowed.mockReturnValue(true);

    mockTool = {
      name: 'test_tool',
      description: 'Test tool',
      category: ToolCategory.Extension,
      parameters: z.object({ arg: z.string() }),
      async *execute(params) {
        yield { type: 'progress', content: 'working' };
        yield { type: 'progress', content: 'still working' };
        return { success: true, llmContent: `result: ${params.arg}` };
      }
    };
  });

  it('should execute tool successfully and yield updates', async () => {
    const onUpdate = vi.fn();

    const result = await executeToolPipeline(mockTool, { arg: 'test_arg' }, { sandboxContext: context, onUpdate });

    expect(result.blocked).toBe(false);
    expect(result.suspended).toBe(false);
    expect(result.resultText).toBe('result: test_arg');
    expect(result.rawResult).toEqual({ success: true, llmContent: 'result: test_arg' });

    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenNthCalledWith(1, { type: 'progress', content: 'working' });
    expect(onUpdate).toHaveBeenNthCalledWith(2, { type: 'progress', content: 'still working' });
  });

  it('should block execution if before_tool_call hook returns block', async () => {
    mockRunModifyingHook.mockResolvedValueOnce({ block: true, blockReason: 'custom reason' });

    const result = await executeToolPipeline(mockTool, { arg: 'test_arg' }, { sandboxContext: context });

    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe('custom reason');
    expect(result.resultText).toContain('custom reason');
  });

  it('should modify params if before_tool_call hook returns params', async () => {
    mockRunModifyingHook.mockResolvedValueOnce({ params: { arg: 'modified_arg' } });

    const result = await executeToolPipeline(mockTool, { arg: 'test_arg' }, { sandboxContext: context });

    expect(result.blocked).toBe(false);
    expect(result.resultText).toBe('result: modified_arg');
  });

  it('should block execution if sandbox policy denies tool', async () => {
    mockIsToolAllowed.mockReturnValue(false);
    mockFormatToolBlockedMessage.mockReturnValue('Sandbox denied');

    // ensure context toolPolicy is set so it checks
    context.toolPolicy = { deny: ['test_tool'], allow: [], confirm: [] };

    const result = await executeToolPipeline(mockTool, { arg: 'test_arg' }, { sandboxContext: context });

    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain('denied');
    expect(result.resultText).toContain('denied');
  });

  it('should call after_tool_call and tool_result_persist hooks', async () => {
    mockRunModifyingHook.mockResolvedValueOnce(undefined); // before_tool_call
    mockRunModifyingHook.mockResolvedValueOnce({ result: 'persisted_result' }); // tool_result_persist

    const result = await executeToolPipeline(mockTool, { arg: 'test_arg' }, { sandboxContext: context });

    expect(mockRunVoidHook).toHaveBeenCalledWith(
      'after_tool_call',
      expect.objectContaining({
        toolName: 'test_tool',
        result: 'result: test_arg'
      })
    );

    expect(mockRunModifyingHook).toHaveBeenCalledWith(
      'tool_result_persist',
      expect.objectContaining({
        toolName: 'test_tool',
        result: 'result: test_arg'
      })
    );

    expect(result.resultText).toBe('persisted_result');
  });

  it('should handle invalid tool result gracefully', async () => {
    const invalidTool: ToolDefinition = {
      ...mockTool,
      async *execute() {
        yield { type: 'progress', content: 'generating error' };
        return 'invalid string result' as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      }
    };

    const result = await executeToolPipeline(invalidTool, { arg: 'test_arg' }, { sandboxContext: context });

    expect(result.blocked).toBe(true);
    expect(result.resultText).toContain('invalid result structure');
  });
});
