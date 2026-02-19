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
 * 执行工具核心流程（Phase 1.5 - 4）
 *
 * 包含：before_tool_call Hook、sandbox policy、execute、after_tool_call Hook
 *
 * @param def    - 工具定义
 * @param params - 工具参数
 * @param opts   - 管线选项
 * @returns 管线执行结果
 */
async function executeToolCore(
  def: ToolDefinition,
  params: Record<string, unknown>,
  opts: PipelineOptions
): Promise<PipelineResult> {
  let typedParams = params;
  const toolStartTime = Date.now();
  const sessionId = opts.sandboxContext.sessionId || '';

  // === Phase 1.5: before_tool_call Hook (Extension 扩展点) ===
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
        // Extension 可以 block 或修改参数
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
        // suspend 逻辑已在 Phase 1 统一处理，Extension hook 不应返回 suspend
        if (hookResult.suspend) {
          log.warn(`[ToolPipeline] Extension returned suspend in Phase 1.5, ignoring (审批逻辑已在 Phase 1 处理)`);
        }
      }
    }
  } catch (error) {
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
 * 执行工具的完整管线（入口）
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
  const typedParams = params;
  const sessionId = opts.sandboxContext.sessionId || '';

  // === Phase 1: 审批判断（仅 exec 工具）===

  // 只有 exec 工具需要通过 ExecPolicy 审批
  if (def.name === 'exec' && params.command) {
    try {
      const { checkExecPolicy } = await import('../../sandbox/exec-policy');
      const policy = checkExecPolicy(params.command as string);

      if (policy.action === 'deny') {
        log.warn(`[ToolPipeline] ExecPolicy deny: "${String(params.command).slice(0, 50)}", reason=${policy.reason}`);
        return {
          resultText: `Error: Command rejected by security policy: ${policy.reason}`,
          blocked: true,
          suspended: false,
          blockReason: `Security policy: ${policy.reason}`
        };
      }

      // policy.action === 'allow' → 自动放行，跳过审批
      if (policy.action === 'allow') {
        log.info(`[ToolPipeline] ExecPolicy allow: "${String(params.command).slice(0, 50)}"`);
        // 继续执行，不需要审批
      }

      // policy.action === 'ask' → 需要用户审批
      if (policy.action === 'ask') {
        return await requestUserApproval(sessionId, def.name, typedParams, def, opts);
      }
    } catch (error) {
      log.warn(`[ToolPipeline] ExecPolicy check failed for ${def.name}:`, error);
      // 检查失败，继续执行（不阻塞）
    }
  }

  // === Phase 1.5-4: 执行工具核心流程 ===
  // 审批通过或不需要审批时，执行完整流程
  return await executeToolCore(def, typedParams, opts);
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

// ==================== 审批逻辑（内置核心功能）====================

/** 会话级审批计数器（用于生成 approvalId）*/
const sessionApprovalCounters = new Map<string, number>();

/**
 * 重置会话的审批计数器（会话开始时调用）
 */
export function resetApprovalCounter(sessionId: string): void {
  sessionApprovalCounters.delete(sessionId);
}

/**
 * 请求用户审批（异步模式 - OpenClaw 风格）
 *
 * 流程：
 *   1. 发送 hitl:required 事件到前端
 *   2. 启动后台任务（fire-and-forget）：等待审批 → 执行工具 → 发送完成事件
 *   3. 立即返回 suspended（不等待）
 *
 * @param def - 工具定义（用于后台执行）
 * @param params - 工具参数
 * @param opts - Pipeline 选项（包含 context 和 signal）
 * @returns PipelineResult (suspended)
 */
async function requestUserApproval(
  sessionId: string,
  toolName: string,
  params: Record<string, unknown>,
  def: ToolDefinition,
  opts: PipelineOptions
): Promise<PipelineResult> {
  // 获取审批索引
  const index = sessionApprovalCounters.get(sessionId) ?? 0;
  sessionApprovalCounters.set(sessionId, index + 1);

  const approvalId = `${sessionId}:${index}`;

  log.info(`[ToolPipeline] Requesting approval: approvalId=${approvalId}, tool=${toolName}`);

  // 1. 发送 hitl:required 事件到前端
  try {
    const { AgentEventWriter } = await import('../../AgentEventWriter');
    AgentEventWriter.dispatchForSession(sessionId, {
      type: 'hitl:required',
      content: `Approval required: ${toolName}`,
      data: {
        index,
        toolName,
        arguments: JSON.stringify(params),
        action: 'required',
        approvalId
      }
    });
  } catch (error) {
    log.warn(`[ToolPipeline] Failed to emit hitl:required:`, error);
  }

  // 2. 启动后台任务（fire-and-forget）
  void (async () => {
    try {
      log.info(`[ToolPipeline] Background task started: approvalId=${approvalId}`);

      // 2.1 等待用户审批
      const { hitlApprovalManager } = await import('../../hitl/HitlApprovalManager');
      const decision = await hitlApprovalManager.waitForSingleDecision(approvalId, 300000); // 5分钟超时

      if (!decision || decision === 'reject') {
        log.info(`[ToolPipeline] Background: approval ${decision ? 'rejected' : 'timeout'}: ${approvalId}`);

        // 发送拒绝事件
        const { AgentEventWriter } = await import('../../AgentEventWriter');
        AgentEventWriter.dispatchForSession(sessionId, {
          type: 'hitl:rejected',
          content: `rejected: ${toolName}`,
          data: { index, toolName, action: 'rejected', reason: decision ? undefined : 'timeout' }
        });

        // 发送唤醒事件（带拒绝结果）
        const { eventBus } = await import('../../../common/eventbus');
        eventBus.emit('thread:wake', {
          threadId: sessionId,
          reason: 'tool-done',
          toolResult: `Tool "${toolName}" was ${decision ? 'rejected by user' : 'timed out'}.`,
          toolName
        });
        return;
      }

      log.info(`[ToolPipeline] Background: approved: ${approvalId}, decision=${decision}`);

      // 发送批准事件
      const { AgentEventWriter } = await import('../../AgentEventWriter');
      AgentEventWriter.dispatchForSession(sessionId, {
        type: 'hitl:approved',
        content: `approved: ${toolName}`,
        data: { index, toolName, action: 'approved' }
      });

      // 2.2 执行工具核心流程（Phase 1.5-4）
      log.info(`[ToolPipeline] Background: executing tool core: ${toolName}`);

      // 🔑 关键：直接调用核心流程，不再走审批判断
      const pipelineResult = await executeToolCore(def, params, opts);

      // 检查执行结果
      if (pipelineResult.blocked) {
        throw new Error(`Tool blocked: ${pipelineResult.blockReason || 'unknown'}`);
      }
      if (pipelineResult.suspended) {
        throw new Error('Tool should not suspend again after approval');
      }

      const resultText = pipelineResult.resultText;
      log.info(`[ToolPipeline] Background: tool executed: ${toolName}, length=${resultText.length}`);

      // 2.4 发送完成事件，唤醒 Agent
      const { eventBus } = await import('../../../common/eventbus');
      eventBus.emit('thread:wake', {
        threadId: sessionId,
        reason: 'tool-done',
        toolResult: resultText,
        toolName
      });
    } catch (error) {
      log.error(`[ToolPipeline] Background task failed: ${toolName}`, error);

      // 发送错误事件
      const { eventBus } = await import('../../../common/eventbus');
      eventBus.emit('thread:wake', {
        threadId: sessionId,
        reason: 'tool-done',
        toolResult: `Tool "${toolName}" failed: ${error instanceof Error ? error.message : String(error)}`,
        toolName
      });
    }
  })();

  // 3. 立即返回 suspended（不等待后台任务）
  return {
    resultText:
      `Tool "${toolName}" requires user approval. ` +
      `The request has been sent to the user. ` +
      `Please wait for their decision. ` +
      `Do NOT retry this tool call — the system will resume automatically when the approval is received.`,
    blocked: false,
    suspended: true,
    suspendReason: `approval-pending:${approvalId}:${toolName}`
  };
}
