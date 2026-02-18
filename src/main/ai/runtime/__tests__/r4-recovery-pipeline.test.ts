/**
 * R4 改进测试 — S-2 ErrorRecovery runtime 注入 + M-4 ToolExecutionPipeline
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('@main/common/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }))
}));

import { AbstractAgentRuntime, generateRuntimeId } from '../AbstractAgentRuntime';
import type { AgentRuntimeOptions, ExecutionConfig, ExecutionResult, StreamChunk, SessionInfo } from '../types';
import { ToolCategory } from '../../tools/types';

// ==================== S-2: ErrorRecovery runtime injection ====================

describe('S-2: ErrorRecoveryChain runtime injection', () => {
  /**
   * 带 compressor 的 Mock Runtime
   */
  class MockRuntimeWithCompressor extends AbstractAgentRuntime {
    readonly type = 'agent' as const;
    readonly id = generateRuntimeId('test');
    readonly name = 'TestAgent';
    readonly options: AgentRuntimeOptions & { thinkingLevel?: string } = {
      name: 'TestAgent',
      instructions: 'test',
      thinkingLevel: 'high'
    };
    readonly interrupted = false;
    readonly supportsHITL = false;

    /** 模拟的 sessionCompressor */
    sessionCompressor = {
      compressed: false,
      compress: vi.fn(async () => {
        this.sessionCompressor.compressed = true;
      })
    };

    private failOnce: boolean;
    private errorMsg: string;

    constructor(opts?: { failOnce?: boolean; errorMsg?: string }) {
      super();
      this.failOnce = opts?.failOnce ?? false;
      this.errorMsg = opts?.errorMsg ?? 'context_length_exceeded';
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    async initialize(): Promise<void> {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    async destroy(): Promise<void> {}

    protected async *doStream(
      _input: string,
      _config?: ExecutionConfig
    ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
      if (this.failOnce) {
        this.failOnce = false;
        throw new Error(this.errorMsg);
      }
      yield { type: 'text:delta', content: 'ok' };
      return { output: 'done' };
    }

    async getSession(): Promise<SessionInfo> {
      return { sessionId: 'test', createdAt: 0, updatedAt: 0, messageCount: 0 };
    }
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    async clearSession(): Promise<void> {}
  }

  it('buildRecoveryRuntime 返回包含 compressor 的对象', () => {
    const rt = new MockRuntimeWithCompressor();
    // @ts-expect-error -- access protected method for test
    const runtimeRef = rt.buildRecoveryRuntime();
    expect(runtimeRef).toBeDefined();
    expect(runtimeRef!.compressor).toBeDefined();
    expect(runtimeRef!.thinkingLevel).toBe('high');
    expect(runtimeRef!.setThinkingLevel).toBeInstanceOf(Function);
  });

  it('buildRecoveryRuntime.setThinkingLevel 修改 options', () => {
    const rt = new MockRuntimeWithCompressor();
    // @ts-expect-error -- access protected method for test
    const runtimeRef = rt.buildRecoveryRuntime();
    runtimeRef!.setThinkingLevel!('low');
    expect(rt.options.thinkingLevel).toBe('low');
  });

  it('context_length_exceeded 时触发 compress 并重试', async () => {
    const rt = new MockRuntimeWithCompressor({ failOnce: true });
    const chunks: StreamChunk[] = [];

    const gen = rt.stream('test input');
    let r = await gen.next();
    while (!r.done) {
      chunks.push(r.value);
      r = await gen.next();
    }

    // compressor.compress 被调用
    expect(rt.sessionCompressor.compress).toHaveBeenCalledTimes(1);
    expect(rt.sessionCompressor.compressed).toBe(true);

    // 重试后正常返回
    expect(r.value.output).toBe('done');

    // 有 recovery 事件
    const recoveryChunk = chunks.find((c) => c.type === 'run:error');
    expect(recoveryChunk).toBeDefined();
    expect(recoveryChunk!.content).toContain('compressed');
  });

  it('无 compressor 的 runtime 不崩溃', () => {
    class NoCompressorRuntime extends AbstractAgentRuntime {
      readonly type = 'agent' as const;
      readonly id = 'no-comp';
      readonly name = 'NoComp';
      readonly options: AgentRuntimeOptions = { name: 'NoComp', instructions: 'x' };
      readonly interrupted = false;
      readonly supportsHITL = false;

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      async initialize(): Promise<void> {}
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      async destroy(): Promise<void> {}
      // eslint-disable-next-line require-yield
      protected async *doStream(): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
        return { output: 'ok' };
      }
      async getSession(): Promise<SessionInfo> {
        return { sessionId: 'nc', createdAt: 0, updatedAt: 0, messageCount: 0 };
      }
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      async clearSession(): Promise<void> {}
    }

    const rt = new NoCompressorRuntime();
    // @ts-expect-error -- access protected method for test
    const runtimeRef = rt.buildRecoveryRuntime();
    expect(runtimeRef!.compressor).toBeUndefined();
  });

  it('认证错误不重试', async () => {
    const rt = new MockRuntimeWithCompressor({
      failOnce: true,
      errorMsg: 'unauthorized: invalid_api_key'
    });

    const gen = rt.stream('test');
    try {
      let r = await gen.next();
      while (!r.done) {
        r = await gen.next();
      }
      // 不应该走到这里
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toContain('unauthorized');
    }

    // compressor 不应该被调用
    expect(rt.sessionCompressor.compress).not.toHaveBeenCalled();
  });
});

// ==================== M-4: ToolExecutionPipeline ====================

describe('M-4: ToolExecutionPipeline', () => {
  // Mock ExtensionManager（无 runner，模拟 Extension 未加载的场景）
  vi.mock('../../../common/extension', () => ({
    ExtensionManager: {
      getHookRunner: () => null
    }
  }));

  // Mock sandbox
  vi.mock('../../sandbox', () => ({
    isToolAllowed: (_name: string, _policy: unknown) => true,
    formatToolBlockedMessage: (name: string) => `Tool ${name} is blocked`
  }));

  // 延迟导入（在 mock 之后）
  let executeToolPipeline: typeof import('../shared/ToolExecutionPipeline').executeToolPipeline;

  beforeEach(async () => {
    const mod = await import('../shared/ToolExecutionPipeline');
    executeToolPipeline = mod.executeToolPipeline;
  });

  it('正常执行工具并返回结果', async () => {
    const mockTool = {
      name: 'test_tool',
      description: 'Test',
      category: ToolCategory.FileSystem,
      needUserConfirm: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: {} as any,
      execute: async function* (): AsyncGenerator<
        { type: 'progress'; content: string },
        { success: boolean; llmContent: string }
      > {
        yield { type: 'progress' as const, content: 'working...' };
        return { success: true, llmContent: 'Test result' };
      }
    };

    const updates: string[] = [];
    const result = await executeToolPipeline(
      mockTool,
      {},
      {
        sandboxContext: {
          mode: 'path-only',
          workspaceRoot: '/tmp/test',
          sessionId: 's1',
          toolPolicy: { allow: [], deny: [] }
        },
        onUpdate: (u) => updates.push(u.content)
      }
    );

    expect(result.blocked).toBe(false);
    expect(result.resultText).toBe('Test result');
    expect(updates).toContain('working...');
  });

  it('工具执行失败返回错误文本', async () => {
    const failTool = {
      name: 'fail_tool',
      description: 'Fails',
      category: ToolCategory.FileSystem,
      needUserConfirm: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: {} as any,
      // eslint-disable-next-line require-yield
      execute: async function* (): AsyncGenerator<
        never,
        { success: boolean; error: { code: string; message: string } }
      > {
        return {
          success: false,
          error: { code: 'FAILED', message: 'Something went wrong' }
        };
      }
    };

    const result = await executeToolPipeline(
      failTool,
      {},
      {
        sandboxContext: { mode: 'path-only', workspaceRoot: '/tmp/test', toolPolicy: { allow: [], deny: [] } }
      }
    );

    expect(result.blocked).toBe(false);
    expect(result.resultText).toContain('Error: Something went wrong');
  });

  it('Extension 未加载时工具仍然正常执行', async () => {
    const simpleTool = {
      name: 'simple',
      description: 'Simple',
      category: ToolCategory.FileSystem,
      needUserConfirm: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: {} as any,
      // eslint-disable-next-line require-yield
      execute: async function* (): AsyncGenerator<never, { success: boolean; llmContent: string }> {
        return { success: true, llmContent: 'ok' };
      }
    };

    const result = await executeToolPipeline(
      simpleTool,
      {},
      {
        sandboxContext: { mode: 'path-only', workspaceRoot: '/tmp/test', toolPolicy: { allow: [], deny: [] } }
      }
    );

    expect(result.blocked).toBe(false);
    expect(result.resultText).toBe('ok');
  });
});
