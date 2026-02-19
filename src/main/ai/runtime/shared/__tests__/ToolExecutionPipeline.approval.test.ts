/**
 * ToolExecutionPipeline 审批流程测试
 *
 * 测试 Phase 1 审批判断逻辑和后台任务执行流程：
 *   - ExecPolicy 检查（deny/allow/ask）
 *   - needUserConfirm 检查
 *   - 返回 suspended
 *   - 后台任务执行 executeToolCore
 *   - 发送 thread:wake 事件
 *
 * 使用真实的 ToolExecutionPipeline 和 HitlApprovalManager，最小化 mock。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmpWorkspace: string;

// Mock logger
vi.mock('@main/common/logger', () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { log, createLogger: vi.fn(() => log) };
});

// Mock env
vi.mock('@main/common/env', () => ({
  Env: {
    isDev: true,
    paths: {
      userHome: () => tmpWorkspace,
      temp: os.tmpdir(),
      workspacesDir: tmpWorkspace
    }
  }
}));

// 导入被测模块
import { executeToolPipeline, resetApprovalCounter, createFallbackToolContext } from '../ToolExecutionPipeline';
import type { ToolDefinition } from '../../../tools/types';
import { ToolCategory } from '../../../tools/types';
import { hitlApprovalManager } from '../../../hitl/HitlApprovalManager';
import { AgentEventWriter } from '../../../AgentEventWriter';
import { z } from 'zod';

describe('ToolExecutionPipeline 审批流程', () => {
  let sessionId: string;
  let eventWriter: AgentEventWriter;

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-approval-'));
    sessionId = `test-${Date.now()}`;
    resetApprovalCounter(sessionId);

    // 创建 events 目录
    fs.mkdirSync(path.join(tmpWorkspace, 'events'), { recursive: true });

    // 创建并注册 EventWriter
    eventWriter = new AgentEventWriter(tmpWorkspace);
    eventWriter.register(sessionId);
  });

  afterEach(() => {
    eventWriter.unregister(sessionId);
    hitlApprovalManager.cleanupAll();
    if (tmpWorkspace && fs.existsSync(tmpWorkspace)) {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    }
  });

  // ==========================================
  // 测试 0: 验证 ExecPolicy 基本功能
  // ==========================================

  it('验证 ExecPolicy 函数可用', async () => {
    const { checkExecPolicy } = await import('../../../sandbox/exec-policy');

    const curlPolicy = checkExecPolicy('curl https://example.com');
    console.log('[Test] curl policy:', curlPolicy);
    expect(curlPolicy.action).toBe('ask'); // curl 不在白名单，应该 ask

    const lsPolicy = checkExecPolicy('ls');
    console.log('[Test] ls policy:', lsPolicy);
    expect(lsPolicy.action).toBe('allow'); // ls 在白名单

    const rmPolicy = checkExecPolicy('rm -rf /');
    console.log('[Test] rm policy:', rmPolicy);
    expect(rmPolicy.action).toBe('deny'); // rm -rf 是危险命令
  });

  // ==========================================
  // 测试 1: ExecPolicy ask → 触发审批
  // ==========================================

  it('exec 工具（需审批命令）→ 返回 suspended', async () => {
    const command = 'curl https://example.com';
    let toolExecuted = false;

    const execTool: ToolDefinition = {
      name: 'exec',
      description: 'Execute command',
      category: ToolCategory.Execute,
      parameters: z.object({ command: z.string() }),
      async *execute() {
        toolExecuted = true;
        yield { type: 'progress', content: '' };
        return { success: true, llmContent: 'executed' };
      }
    };

    const context = createFallbackToolContext({ workspaceRoot: tmpWorkspace, sessionId });
    const result = await executeToolPipeline(execTool, { command }, { sandboxContext: context });

    // 验证返回 suspended
    expect(result.suspended).toBe(true);
    expect(result.suspendReason).toContain('approval-pending');
    expect(result.resultText).toContain('requires user approval');

    // 验证工具尚未执行
    expect(toolExecuted).toBe(false);

    // 等待后台任务启动（fire-and-forget 是异步的）
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 验证 HitlApprovalManager 中有 pending（后台任务已注册）
    expect(hitlApprovalManager.hasSinglePending(`${sessionId}:0`)).toBe(true);
  });

  // ==========================================
  // 测试 2: 用户批准 → 后台任务执行工具
  // ==========================================

  it('用户批准 → 后台任务执行工具 → 发送 thread:wake', async () => {
    const command = 'sleep 0.1'; // sleep 不在白名单，会触发审批
    let toolExecutionCount = 0;

    const execTool: ToolDefinition = {
      name: 'exec',
      description: 'Execute command',
      category: ToolCategory.Execute,
      parameters: z.object({ command: z.string() }),
      async *execute(params) {
        toolExecutionCount++;
        yield { type: 'progress', content: '' };
        return { success: true, llmContent: `Executed: ${params.command}` };
      }
    };

    // 监听 thread:wake 事件
    const { eventBus } = await import('../../../../common/eventbus');
    let wakeReceived = false;
    let wakeResult: string | undefined;

    const handler = (event: { threadId: string; reason: string; toolResult?: string; toolName?: string }): void => {
      if (event.threadId === sessionId && event.reason === 'tool-done') {
        wakeReceived = true;
        wakeResult = event.toolResult;
      }
    };
    eventBus.on('thread:wake', handler);

    try {
      const context = createFallbackToolContext({ workspaceRoot: tmpWorkspace, sessionId });

      // 执行 Pipeline（触发审批）
      const result = await executeToolPipeline(execTool, { command }, { sandboxContext: context });
      expect(result.suspended).toBe(true);

      // 等待后台任务启动
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 批准执行
      const submitted = hitlApprovalManager.submitSingleDecision(`${sessionId}:0`, 'approve-once');
      expect(submitted).toBe(true);

      // 等待后台任务完成
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 验证工具已执行
      expect(toolExecutionCount).toBe(1);

      // 验证 wake 事件已发送
      expect(wakeReceived).toBe(true);
      expect(wakeResult).toContain('Executed: sleep 0.1');
    } finally {
      eventBus.off('thread:wake', handler);
    }
  }, 5_000);

  // ==========================================
  // 测试 3: 用户拒绝 → 发送拒绝消息
  // ==========================================

  it('用户拒绝 → 发送拒绝消息的 thread:wake', async () => {
    const command = 'dangerous-command';
    let toolExecuted = false;

    const execTool: ToolDefinition = {
      name: 'exec',
      description: 'Execute command',
      category: ToolCategory.Execute,
      parameters: z.object({ command: z.string() }),
      async *execute() {
        toolExecuted = true;
        yield { type: 'progress', content: '' };
        return { success: true, llmContent: 'Should not execute' };
      }
    };

    const { eventBus } = await import('../../../../common/eventbus');
    let wakeReceived = false;
    let rejectMessage: string | undefined;

    const handler = (event: { threadId: string; reason: string; toolResult?: string }): void => {
      if (event.threadId === sessionId) {
        wakeReceived = true;
        rejectMessage = event.toolResult;
      }
    };
    eventBus.on('thread:wake', handler);

    try {
      const context = createFallbackToolContext({ workspaceRoot: tmpWorkspace, sessionId });
      const result = await executeToolPipeline(execTool, { command }, { sandboxContext: context });
      expect(result.suspended).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // 拒绝执行
      hitlApprovalManager.submitSingleDecision(`${sessionId}:0`, 'reject');

      await new Promise((resolve) => setTimeout(resolve, 1500));

      // 验证工具未执行
      expect(toolExecuted).toBe(false);

      // 验证收到拒绝消息
      expect(wakeReceived).toBe(true);
      expect(rejectMessage).toContain('rejected');
    } finally {
      eventBus.off('thread:wake', handler);
    }
  }, 5_000);

  // ==========================================
  // 测试 4: needUserConfirm 触发审批
  // ==========================================

  it('exec 工具非白名单命令 → 触发审批', async () => {
    // 使用既不在白名单也不在黑名单的命令
    const command = 'custom-dangerous-script.sh';
    let toolExecuted = false;

    const execTool: ToolDefinition = {
      name: 'exec',
      description: 'Execute command',
      category: ToolCategory.Execute,
      parameters: z.object({ command: z.string() }),
      async *execute() {
        toolExecuted = true;
        yield { type: 'progress', content: 'executing...' };
        return { success: true, llmContent: 'Command executed' };
      }
    };

    const context = createFallbackToolContext({ workspaceRoot: tmpWorkspace, sessionId });
    const result = await executeToolPipeline(execTool, { command }, { sandboxContext: context });

    expect(result.suspended).toBe(true);
    expect(toolExecuted).toBe(false);

    // 等待后台任务启动
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(hitlApprovalManager.hasSinglePending(`${sessionId}:0`)).toBe(true);
  });

  // ==========================================
  // 测试 5: ExecPolicy allow → 自动放行
  // ==========================================

  it('ExecPolicy 白名单命令 → 自动放行', async () => {
    const command = 'ls'; // 白名单命令
    let toolExecuted = false;

    const execTool: ToolDefinition = {
      name: 'exec',
      description: 'Execute command',
      category: ToolCategory.Execute,
      parameters: z.object({ command: z.string() }),
      async *execute() {
        toolExecuted = true;
        yield { type: 'progress', content: '' };
        return { success: true, llmContent: 'Success' };
      }
    };

    const context = createFallbackToolContext({ workspaceRoot: tmpWorkspace, sessionId });
    const result = await executeToolPipeline(execTool, { command }, { sandboxContext: context });

    // 验证自动放行（不suspend）
    expect(result.suspended).toBe(false);
    expect(result.blocked).toBe(false);
    expect(toolExecuted).toBe(true);
  });

  // ==========================================
  // 测试 6: ExecPolicy deny → 自动拒绝
  // ==========================================

  it('ExecPolicy 黑名单命令 → 自动拒绝', async () => {
    const command = 'rm -rf /'; // 危险命令
    let toolExecuted = false;

    const execTool: ToolDefinition = {
      name: 'exec',
      description: 'Execute command',
      category: ToolCategory.Execute,
      parameters: z.object({ command: z.string() }),
      async *execute() {
        toolExecuted = true;
        yield { type: 'progress', content: '' };
        return { success: true, llmContent: 'Should not execute' };
      }
    };

    const context = createFallbackToolContext({ workspaceRoot: tmpWorkspace, sessionId });
    const result = await executeToolPipeline(execTool, { command }, { sandboxContext: context });

    // 验证自动拒绝
    expect(result.blocked).toBe(true);
    expect(result.suspended).toBe(false);
    expect(result.blockReason).toContain('Security policy'); // 大写 S
    expect(toolExecuted).toBe(false);
  });

  // ==========================================
  // 测试 7: 多次审批计数器递增
  // ==========================================

  it('同一会话多次审批 → approvalId 递增', async () => {
    const command1 = 'dangerous-command-1';
    const command2 = 'dangerous-command-2';

    const execTool: ToolDefinition = {
      name: 'exec',
      description: 'Execute command',
      category: ToolCategory.Execute,
      parameters: z.object({ command: z.string() }),
      async *execute() {
        yield { type: 'progress', content: 'executing...' };
        return { success: true, llmContent: 'Command executed' };
      }
    };

    const context = createFallbackToolContext({ workspaceRoot: tmpWorkspace, sessionId });

    // 第一次调用
    const result1 = await executeToolPipeline(execTool, { command: command1 }, { sandboxContext: context });
    expect(result1.suspended).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(hitlApprovalManager.hasSinglePending(`${sessionId}:0`)).toBe(true);

    // 第二次调用
    const result2 = await executeToolPipeline(execTool, { command: command2 }, { sandboxContext: context });
    expect(result2.suspended).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(hitlApprovalManager.hasSinglePending(`${sessionId}:1`)).toBe(true);

    // 验证两个审批请求都在 pending
    expect(hitlApprovalManager.hasSinglePending(`${sessionId}:0`)).toBe(true);
    expect(hitlApprovalManager.hasSinglePending(`${sessionId}:1`)).toBe(true);
  });
});
