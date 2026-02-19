/**
 * 工具执行管线 — 共享公共逻辑
 *
 * 将 OpenAI 和 PiMono 两个 Runtime 中重复的工具执行流程提取到此模块：
 *   1. before_tool_call Hook（审批 / 参数修改 / 拦截）
 *   2. sandbox toolPolicy 策略检查
 *   3. 执行工具 AsyncGenerator
 *   4. after_tool_call Hook + tool_result_persist Hook
 *
 * 各 Runtime 只需关注：
 *   - SDK 特有的 Tool 格式转换
 *   - 增量输出的桥接方式（StreamEmitter / onUpdate 回调）
 *
 * @module runtime/shared/ToolExecutionPipeline
 */

import path from 'node:path';
import os from 'node:os';
import { log } from '@main/common/logger';
import type { ToolDefinition, ToolExecutionContext, ToolResult, ToolStreamUpdate } from '../../tools/types';

// ==================== Types ====================

/** 管线执行结果 */
export interface PipelineResult {
  /** 最终文本结果（经过 hook 修改后） */
  resultText: string;
  /** 工具是否被拦截（before_tool_call block 或 policy deny） */
  blocked: boolean;
  /** 拦截原因 */
  blockReason?: string;
  /** 是否因异步操作挂起（如审批等待），Agent run 应结束并等待唤醒 */
  suspended: boolean;
  /** 挂起原因 */
  suspendReason?: string;
  /** 原始 ToolResult（未经 hook 修改） */
  rawResult?: ToolResult;
}

/** 增量输出回调 */
export type OnToolUpdate = (update: ToolStreamUpdate) => void;

/** 管线选项 */
export interface PipelineOptions {
  /** 工具执行上下文（沙箱 + Agent/Session 信息） */
  sandboxContext: ToolExecutionContext;
  /** 增量输出回调（由各 Runtime 桥接到 SDK 特定的机制） */
  onUpdate?: OnToolUpdate;
  /** AbortSignal（可选） */
  signal?: AbortSignal;
}

// ==================== Core ====================

/**
 * 执行工具的完整管线
 *
 * @param def    - 工具定义
 * @param params - 工具参数（来自 LLM）
 * @param opts   - 管线选项
 * @returns 管线执行结果
 */
export async function executeToolPipeline(
  def: ToolDefinition,
  params: Record<string, unknown>,
  opts: PipelineOptions
): Promise<PipelineResult> {
  let typedParams = params;
  const toolStartTime = Date.now();
  const sessionId = opts.sandboxContext.sessionId || '';

  // === Phase 1: before_tool_call Hook ===
  try {
    const { ExtensionManager } = await import('../../../common/extension');
    const runner = ExtensionManager.getHookRunner();
    if (runner) {
      const hookResult = await runner.runModifyingHook('before_tool_call', {
        sessionId,
        toolName: def.name,
        params: typedParams,
        needUserConfirm: def.needUserConfirm ?? false
      });
      if (hookResult) {
        // 异步挂起：工具需要审批但不阻塞 Agent run
        if (hookResult.suspend) {
          const reason = hookResult.suspendReason || 'approval-pending';
          return {
            resultText:
              `[SUSPENDED] Tool "${def.name}" execution suspended: ${reason}. ` +
              `The tool will be executed after approval. Do NOT retry this tool call — ` +
              `the system will resume automatically when the approval is received.`,
            blocked: false,
            suspended: true,
            suspendReason: reason
          };
        }
        if (hookResult.block) {
          return {
            resultText: `Error: Tool blocked — ${hookResult.blockReason || 'no reason'}`,
            blocked: true,
            suspended: false,
            blockReason: hookResult.blockReason || 'no reason'
          };
        }
        if (hookResult.params) {
          typedParams = { ...typedParams, ...hookResult.params };
        }
      }
    }
  } catch (error) {
    // Extension hook 失败不阻断工具执行，但记录日志以便排查
    log.warn(`[ToolPipeline] before_tool_call hook failed for ${def.name}:`, error);
  }

  // === Phase 2: sandbox toolPolicy 检查 ===
  try {
    const { isToolAllowed, formatToolBlockedMessage } = await import('../../sandbox');
    const toolPolicy = opts.sandboxContext.toolPolicy as import('../../sandbox/types').ResolvedToolPolicy | undefined;
    if (toolPolicy && !isToolAllowed(def.name, toolPolicy)) {
      const msg = formatToolBlockedMessage(def.name, toolPolicy);
      return {
        resultText: `Error: ${msg}`,
        blocked: true,
        suspended: false,
        blockReason: msg
      };
    }
  } catch (error) {
    // sandbox 导入失败不阻断，但记录日志
    log.warn(`[ToolPipeline] Sandbox policy check failed for ${def.name}:`, error);
  }

  // === Phase 3: 执行工具 ===
  const gen = def.execute(typedParams, opts.signal, opts.sandboxContext);
  let iterResult = await gen.next();

  // 消费 AsyncGenerator 的增量输出
  while (!iterResult.done) {
    const update = iterResult.value;
    if (opts.onUpdate) {
      opts.onUpdate(update);
    }
    iterResult = await gen.next();
  }

  // 最终结果 + 校验
  const toolResult = iterResult.value;

  // 校验 toolResult 结构
  if (!toolResult || typeof toolResult !== 'object') {
    log.warn(`[ToolPipeline] Tool ${def.name} returned invalid result (not an object):`, toolResult);
    return {
      resultText: 'Error: Tool returned invalid result structure',
      blocked: true,
      suspended: false,
      blockReason: 'Invalid tool result (not an object)'
    };
  }

  // 校验必需字段
  if (typeof toolResult.success !== 'boolean') {
    log.warn(`[ToolPipeline] Tool ${def.name} missing 'success' field:`, toolResult);
    return {
      resultText: 'Error: Tool result missing success field',
      blocked: true,
      suspended: false,
      blockReason: 'Invalid tool result (missing success field)'
    };
  }

  let resultText =
    toolResult.llmContent || (toolResult.success ? 'Success' : `Error: ${toolResult.error?.message || 'unknown'}`);

  // === Phase 4: after_tool_call + tool_result_persist Hooks ===
  try {
    const { ExtensionManager } = await import('../../../common/extension');
    const runner = ExtensionManager.getHookRunner();
    if (runner) {
      const toolDuration = Date.now() - toolStartTime;
      await runner.runVoidHook('after_tool_call', {
        sessionId,
        toolName: def.name,
        params: typedParams,
        result: resultText,
        durationMs: toolDuration
      });

      const persistResult = await runner.runModifyingHook('tool_result_persist', {
        sessionId,
        toolName: def.name,
        result: resultText
      });
      if (persistResult?.result) {
        resultText = persistResult.result;
      }
    }
  } catch (error) {
    // Extension hook 失败不阻断，但记录日志
    log.warn(`[ToolPipeline] after_tool_call / tool_result_persist hook failed for ${def.name}:`, error);
  }

  return {
    resultText,
    blocked: false,
    suspended: false,
    rawResult: toolResult
  };
}

/**
 * 创建最小化 ToolExecutionContext（Runtime 降级用）
 *
 * 当 AgentEnvInjector 未注入完整上下文时（如测试、直接调用），
 * 用合理的默认值填充所有必填字段。
 */
export function createFallbackToolContext(opts: { workspaceRoot: string; sessionId?: string }): ToolExecutionContext {
  const workspace = opts.workspaceRoot;
  const sessionId = opts.sessionId || 'unknown';
  const userHome = path.join(os.homedir(), '.coobee-ai');
  return {
    mode: 'path-only',
    workspaceRoot: workspace,
    toolPolicy: { allow: [], deny: [], confirm: [] },
    sessionId,
    threadId: sessionId,
    cwd: workspace,
    sessionsDir: path.join(workspace, 'sessions'),
    contextsDir: path.join(workspace, 'contexts'),
    eventsDir: path.join(workspace, 'events'),
    tasksDir: path.join(workspace, 'tasks'),
    outputDir: path.join(workspace, 'output'),
    userHome,
    configDir: path.join(userHome, 'config'),
    memoryDir: path.join(userHome, 'memory'),
    tempDir: os.tmpdir(),
    agentName: 'agent',
    agentMode: 'agent'
  };
}
