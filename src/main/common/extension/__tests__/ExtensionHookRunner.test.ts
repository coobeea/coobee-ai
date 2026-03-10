import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExtensionRegistry } from '../ExtensionRegistry';
import { ExtensionHookRunner } from '../ExtensionHookRunner';

describe('ExtensionHookRunner', () => {
  let registry: ExtensionRegistry;
  let runner: ExtensionHookRunner;

  beforeEach(() => {
    registry = new ExtensionRegistry();
    runner = new ExtensionHookRunner(registry);
  });

  // ---- void hook ----

  it('void hook 并行执行 — 多个 handler 都被调用', async () => {
    const calls: string[] = [];
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'session_start',
      handler: async () => {
        calls.push('a');
      },
      priority: 0
    });
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'session_start',
      handler: async () => {
        calls.push('b');
      },
      priority: 0
    });

    await runner.runVoidHook('session_start', { sessionId: 's1' });
    expect(calls).toContain('a');
    expect(calls).toContain('b');
  });

  it('void hook 错误隔离 — 一个抛错，其他正常', async () => {
    const calls: string[] = [];
    registry.registerHook({
      extensionId: 'ext-bad',
      hookName: 'agent_end',
      handler: async () => {
        throw new Error('boom');
      },
      priority: 10
    });
    registry.registerHook({
      extensionId: 'ext-good',
      hookName: 'agent_end',
      handler: async () => {
        calls.push('good');
      },
      priority: 0
    });

    // 不应抛错
    await runner.runVoidHook('agent_end', {
      sessionId: 's1',
      agentId: 'test-agent',
      success: true,
      output: '',
      durationMs: 100
    });
    expect(calls).toContain('good');
  });

  it('void hook 空列表 — 无注册时正常返回', async () => {
    await expect(runner.runVoidHook('session_end', { sessionId: 's1' })).resolves.toBeUndefined();
  });

  // ---- modifying hook ----

  it('modifying hook 顺序执行 — 高优先级先', async () => {
    const order: string[] = [];
    registry.registerHook({
      extensionId: 'ext-low',
      hookName: 'before_agent_start',
      handler: async () => {
        order.push('low');
        return { prependContext: 'low' };
      },
      priority: 10
    });
    registry.registerHook({
      extensionId: 'ext-high',
      hookName: 'before_agent_start',
      handler: async () => {
        order.push('high');
        return { prependContext: 'high' };
      },
      priority: 50
    });

    await runner.runModifyingHook('before_agent_start', {
      sessionId: 's1',
      prompt: 'hello'
    });
    expect(order).toEqual(['high', 'low']);
  });

  it('modifying hook 合并 — prependContext 多个拼接', async () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'before_agent_start',
      handler: async () => ({ prependContext: 'ctx-A' }),
      priority: 50
    });
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'before_agent_start',
      handler: async () => ({ prependContext: 'ctx-B' }),
      priority: 10
    });

    const result = await runner.runModifyingHook('before_agent_start', {
      sessionId: 's1',
      prompt: 'hello'
    });
    expect(result).toBeDefined();
    expect(result!.prependContext).toBe('ctx-A\nctx-B');
  });

  it('modifying hook 合并 — block 任一为 true', async () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'before_tool_call',
      handler: async () => ({ block: false }),
      priority: 50
    });
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'before_tool_call',
      handler: async () => ({ block: true, blockReason: 'forbidden' }),
      priority: 10
    });

    const result = await runner.runModifyingHook('before_tool_call', {
      sessionId: 's1',
      toolName: 'exec',
      params: {}
    });
    expect(result).toBeDefined();
    expect(result!.block).toBe(true);
    expect(result!.blockReason).toBe('forbidden');
  });

  it('modifying hook 合并 — params 浅合并', async () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'before_tool_call',
      handler: async () => ({ params: { a: 1 } }),
      priority: 50
    });
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'before_tool_call',
      handler: async () => ({ params: { b: 2 } }),
      priority: 10
    });

    const result = await runner.runModifyingHook('before_tool_call', {
      sessionId: 's1',
      toolName: 'read',
      params: {}
    });
    expect(result!.params).toEqual({ a: 1, b: 2 });
  });

  it('modifying hook 合并 — replaceSystemPrompt 后覆盖前', async () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'before_agent_start',
      handler: async () => ({ replaceSystemPrompt: 'first' }),
      priority: 50
    });
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'before_agent_start',
      handler: async () => ({ replaceSystemPrompt: 'second' }),
      priority: 10
    });

    const result = await runner.runModifyingHook('before_agent_start', {
      sessionId: 's1',
      prompt: 'hello'
    });
    expect(result!.replaceSystemPrompt).toBe('second');
  });

  it('modifying hook 合并 — result 后覆盖前', async () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'tool_result_persist',
      handler: async () => ({ result: 'first-result' }),
      priority: 50
    });
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'tool_result_persist',
      handler: async () => ({ result: 'second-result' }),
      priority: 10
    });

    const result = await runner.runModifyingHook('tool_result_persist', {
      sessionId: 's1',
      toolName: 'read',
      result: 'original'
    });
    expect(result!.result).toBe('second-result');
  });

  it('modifying hook 错误跳过 — handler 失败跳过继续', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    registry.registerHook({
      extensionId: 'ext-bad',
      hookName: 'before_agent_start',
      handler: async () => {
        throw new Error('crash');
      },
      priority: 50
    });
    registry.registerHook({
      extensionId: 'ext-good',
      hookName: 'before_agent_start',
      handler: async () => ({ prependContext: 'survived' }),
      priority: 10
    });

    const result = await runner.runModifyingHook('before_agent_start', {
      sessionId: 's1',
      prompt: 'hello'
    });
    expect(result).toBeDefined();
    expect(result!.prependContext).toBe('survived');

    consoleSpy.mockRestore();
  });

  it('modifying hook 空列表 — 返回 undefined', async () => {
    const result = await runner.runModifyingHook('before_agent_start', {
      sessionId: 's1',
      prompt: 'hello'
    });
    expect(result).toBeUndefined();
  });

  it('modifying hook 全返回 void — 返回 undefined', async () => {
    registry.registerHook<'before_agent_start'>({
      extensionId: 'ext-a',
      hookName: 'before_agent_start',
      handler: async () => {},
      priority: 0
    });

    const result = await runner.runModifyingHook('before_agent_start', {
      sessionId: 's1',
      prompt: 'hello'
    });
    expect(result).toBeUndefined();
  });

  // ---- 补充维度 ----

  // run() 自动模式判断
  it('run() — void hook 自动判断并执行', async () => {
    const calls: string[] = [];
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'session_start',
      handler: async () => {
        calls.push('ran');
      },
      priority: 0
    });

    const result = await runner.run('session_start', { sessionId: 's1' });
    expect(result).toBeUndefined();
    expect(calls).toEqual(['ran']);
  });

  it('run() — modifying hook 自动判断并返回结果', async () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'before_agent_start',
      handler: async () => ({ prependContext: 'injected' }),
      priority: 0
    });

    const result = await runner.run('before_agent_start', {
      sessionId: 's1',
      prompt: 'hello'
    });
    expect(result).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).prependContext).toBe('injected');
  });

  it('run() — void hook 错误隔离（与 runVoidHook 一致）', async () => {
    const calls: string[] = [];
    registry.registerHook({
      extensionId: 'ext-bad',
      hookName: 'session_end',
      handler: async () => {
        throw new Error('fail');
      },
      priority: 10
    });
    registry.registerHook({
      extensionId: 'ext-ok',
      hookName: 'session_end',
      handler: async () => {
        calls.push('ok');
      },
      priority: 0
    });

    await expect(runner.run('session_end', { sessionId: 's1' })).resolves.toBeUndefined();
    expect(calls).toContain('ok');
  });

  // prependContext 边界
  it('prependContext 只有第一个有值 — 保留第一个', async () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'before_agent_start',
      handler: async () => ({ prependContext: 'only-a' }),
      priority: 50
    });
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'before_agent_start',
      handler: async () => ({}),
      priority: 10
    });

    const result = await runner.runModifyingHook('before_agent_start', {
      sessionId: 's1',
      prompt: 'hello'
    });
    expect(result!.prependContext).toBe('only-a');
  });

  it('prependContext 只有第二个有值 — 保留第二个', async () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'before_agent_start',
      handler: async () => ({}),
      priority: 50
    });
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'before_agent_start',
      handler: async () => ({ prependContext: 'only-b' }),
      priority: 10
    });

    const result = await runner.runModifyingHook('before_agent_start', {
      sessionId: 's1',
      prompt: 'hello'
    });
    expect(result!.prependContext).toBe('only-b');
  });

  // block 边界
  it('block 双 false — 保持 false', async () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'before_tool_call',
      handler: async () => ({ block: false }),
      priority: 50
    });
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'before_tool_call',
      handler: async () => ({ block: false }),
      priority: 10
    });

    const result = await runner.runModifyingHook('before_tool_call', {
      sessionId: 's1',
      toolName: 'exec',
      params: {}
    });
    expect(result!.block).toBe(false);
  });

  it('blockReason — 前有后无，保留前者', async () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'before_tool_call',
      handler: async () => ({ block: true, blockReason: 'first-reason' }),
      priority: 50
    });
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'before_tool_call',
      handler: async () => ({ block: false }),
      priority: 10
    });

    const result = await runner.runModifyingHook('before_tool_call', {
      sessionId: 's1',
      toolName: 'exec',
      params: {}
    });
    expect(result!.block).toBe(true);
    expect(result!.blockReason).toBe('first-reason');
  });

  // params 同 key 覆盖
  it('params 同 key — 后者覆盖前者', async () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'before_tool_call',
      handler: async () => ({ params: { key: 'old', a: 1 } }),
      priority: 50
    });
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'before_tool_call',
      handler: async () => ({ params: { key: 'new', b: 2 } }),
      priority: 10
    });

    const result = await runner.runModifyingHook('before_tool_call', {
      sessionId: 's1',
      toolName: 'read',
      params: {}
    });
    expect(result!.params).toEqual({ key: 'new', a: 1, b: 2 });
  });

  // tool_result_persist 前有后无 — 保留前者
  it('tool_result_persist — 后者 result 为 undefined 时保留前者', async () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'tool_result_persist',
      handler: async () => ({ result: 'kept' }),
      priority: 50
    });
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'tool_result_persist',
      handler: async () => ({}),
      priority: 10
    });

    const result = await runner.runModifyingHook('tool_result_persist', {
      sessionId: 's1',
      toolName: 'read',
      result: 'original'
    });
    expect(result!.result).toBe('kept');
  });

  // 三个 handler 链式合并
  it('三个 handler 链式合并 — 逐步累积', async () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'before_agent_start',
      handler: async () => ({ prependContext: 'A' }),
      priority: 90
    });
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'before_agent_start',
      handler: async () => ({ prependContext: 'B', replaceSystemPrompt: 'sp-B' }),
      priority: 50
    });
    registry.registerHook({
      extensionId: 'ext-c',
      hookName: 'before_agent_start',
      handler: async () => ({ prependContext: 'C' }),
      priority: 10
    });

    const result = await runner.runModifyingHook('before_agent_start', {
      sessionId: 's1',
      prompt: 'hello'
    });
    expect(result!.prependContext).toBe('A\nB\nC');
    expect(result!.replaceSystemPrompt).toBe('sp-B');
  });

  // void hook 获取正确 event 参数
  it('void hook — handler 收到正确的 event 参数', async () => {
    let received: unknown;
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'message_received',
      handler: async (event) => {
        received = event;
      },
      priority: 0
    });

    await runner.runVoidHook('message_received', {
      sessionId: 'test-session',
      message: 'hello world'
    });

    expect(received).toEqual({ sessionId: 'test-session', message: 'hello world' });
  });

  // modifying hook 获取正确 event 参数
  it('modifying hook — handler 收到正确的 event 参数', async () => {
    let received: unknown;
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'before_tool_call',
      handler: async (event) => {
        received = event;
        return {};
      },
      priority: 0
    });

    await runner.runModifyingHook('before_tool_call', {
      sessionId: 'sess-1',
      toolName: 'exec',
      params: { command: 'ls' }
    });

    expect(received).toEqual({
      sessionId: 'sess-1',
      toolName: 'exec',
      params: { command: 'ls' }
    });
  });

  // ---- Phase 1: before_compaction 合并 ----

  it('before_compaction 合并 — skipDefault 任一为 true', async () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'before_compaction',
      handler: async () => ({ skipDefault: false }),
      priority: 50
    });
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'before_compaction',
      handler: async () => ({ skipDefault: true, customSummary: 'my summary' }),
      priority: 10
    });

    const result = await runner.runModifyingHook('before_compaction', {
      sessionId: 's1',
      messageCount: 10,
      totalTokens: 50000,
      threshold: 40000
    });
    expect(result!.skipDefault).toBe(true);
    expect(result!.customSummary).toBe('my summary');
  });

  it('before_compaction 合并 — customSummary 后覆盖前', async () => {
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'before_compaction',
      handler: async () => ({ customSummary: 'first' }),
      priority: 50
    });
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'before_compaction',
      handler: async () => ({ customSummary: 'second' }),
      priority: 10
    });

    const result = await runner.runModifyingHook('before_compaction', {
      sessionId: 's1',
      messageCount: 5,
      totalTokens: 30000,
      threshold: 25000
    });
    expect(result!.customSummary).toBe('second');
  });

  it('turn_start / turn_end / after_compaction — void hook 正常执行', async () => {
    const calls: string[] = [];
    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'turn_start',
      handler: async () => {
        calls.push('turn_start');
      },
      priority: 0
    });
    registry.registerHook({
      extensionId: 'ext-b',
      hookName: 'turn_end',
      handler: async () => {
        calls.push('turn_end');
      },
      priority: 0
    });
    registry.registerHook({
      extensionId: 'ext-c',
      hookName: 'after_compaction',
      handler: async () => {
        calls.push('after_compaction');
      },
      priority: 0
    });

    await runner.runVoidHook('turn_start', { sessionId: 's1', turnIndex: 1 });
    await runner.runVoidHook('turn_end', {
      sessionId: 's1',
      turnIndex: 1,
      durationMs: 500,
      toolCallCount: 2
    });
    await runner.runVoidHook('after_compaction', {
      sessionId: 's1',
      originalTokens: 50000,
      compressedTokens: 15000,
      compressionRatio: 0.3,
      duration: 200
    });

    expect(calls).toEqual(['turn_start', 'turn_end', 'after_compaction']);
  });

  // 中间 handler 抛错但前后 handler 结果正常合并
  it('三个 handler 中间抛错 — 前后结果正常合并', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    registry.registerHook({
      extensionId: 'ext-a',
      hookName: 'before_agent_start',
      handler: async () => ({ prependContext: 'A' }),
      priority: 90
    });
    registry.registerHook({
      extensionId: 'ext-bad',
      hookName: 'before_agent_start',
      handler: async () => {
        throw new Error('middle crash');
      },
      priority: 50
    });
    registry.registerHook({
      extensionId: 'ext-c',
      hookName: 'before_agent_start',
      handler: async () => ({ prependContext: 'C' }),
      priority: 10
    });

    const result = await runner.runModifyingHook('before_agent_start', {
      sessionId: 's1',
      prompt: 'hello'
    });
    expect(result!.prependContext).toBe('A\nC');

    consoleSpy.mockRestore();
  });
});
