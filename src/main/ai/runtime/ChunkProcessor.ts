/**
 * ChunkProcessor — 流式块处理工具
 *
 * 从 AgentExecutor 提取的 stateless 工具，负责：
 *   - 指标采集：从 llm:done / compression:done / tool:done 提取数据写入 MetricsCollector
 *   - Extension Hook 触发：turn:start / turn:done / compression:start / compression:done
 *   - suspendReason 解析：从 tool:done 的 suspendReason 解析出 pendingOperation
 *
 * 设计：纯函数/静态方法，无状态，可被 AgentExecutor、consumeAndForward 等复用。
 */

import { createLogger } from '@main/common/logger';
import { getMetricsCollector } from '@main/metrics/MetricsCollector';
import type { StreamChunk } from './types';

const log = createLogger('ai');

/** Turn 状态（用于 turn_end 等 Hook 参数） */
export interface ChunkProcessorTurnState {
  getTurnStartTime: () => number;
  getTurnToolCallCount: () => number;
}

/** 解析后的 pendingOperation（用于 approval-pending） */
export interface ParsedPendingOperation {
  type: 'approval';
  approvalId: string;
  toolName: string;
  toolCallId: string;
  agentSessionId: string;
}

// ==================== 指标采集 ====================

/**
 * 从 stream chunk 中提取 token 用量和压缩事件，写入 MetricsCollector
 * fire-and-forget，不影响流式响应
 */
export function recordMetrics(chunk: StreamChunk, sessionId: string): void {
  try {
    const collector = getMetricsCollector();

    if (chunk.type === 'llm:done') {
      const data = chunk.data as
        | {
            usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
            responseId?: string;
          }
        | undefined;
      if (data?.usage && (data.usage.totalTokens ?? 0) > 0) {
        collector
          .recordTokenUsage({
            sessionId,
            model: 'unknown',
            promptTokens: data.usage.inputTokens ?? 0,
            completionTokens: data.usage.outputTokens ?? 0,
            totalTokens: data.usage.totalTokens ?? 0
          })
          .catch(() => {});
      }
    }

    if (chunk.type === 'compression:done') {
      const data = chunk.data as
        | {
            originalTokens?: number;
            summaryTokens?: number;
            compressionRatio?: number;
            duration?: number;
          }
        | undefined;
      if (data) {
        const before = data.originalTokens ?? 0;
        const after = data.summaryTokens ?? 0;
        if (before > 0) {
          collector
            .recordCompression({
              sessionId,
              beforeTokens: before,
              afterTokens: after,
              compressionRatio: data.compressionRatio ?? (before > 0 ? 1 - after / before : 0),
              duration: data.duration ?? 0
            })
            .catch(() => {});
        }
      }
    }

    if (chunk.type === 'tool:done') {
      const data = chunk.data as
        | {
            toolName?: string;
            toolArgs?: Record<string, unknown>;
          }
        | undefined;
      const toolName = data?.toolName ?? '';
      if (toolName === 'memory') {
        const action = (data?.toolArgs?.action as string) || 'unknown';
        const operationMap: Record<string, 'store' | 'retrieve' | 'search'> = {
          write: 'store',
          get: 'retrieve',
          list: 'retrieve',
          search: 'search'
        };
        collector
          .recordMemoryTool({
            sessionId,
            operation: operationMap[action] || 'store',
            success: true,
            duration: 0
          })
          .catch(() => {});
      }
    }
  } catch {
    // MetricsCollector 未初始化时静默忽略
  }
}

// ==================== Extension Hook ====================

/**
 * 根据 StreamChunk 类型触发对应的 Extension Hook
 *
 * 全部 fire-and-forget（不阻塞流式输出）。
 *
 * before_compaction：
 *   - 在此仅作为通知（PiMono 的 SDK 内置压缩无法拦截）
 *   - OpenAI Runtime 在 compressSessionWithChunks 中单独处理 modifying 逻辑
 *   - 为避免重复触发，OpenAI 会在 chunk.data 中标记 hookHandled: true
 */
export function fireHooks(chunk: StreamChunk, sessionId: string, turnState: ChunkProcessorTurnState): void {
  // 只关心这 4 种事件类型
  if (
    chunk.type !== 'turn:start' &&
    chunk.type !== 'turn:done' &&
    chunk.type !== 'compression:start' &&
    chunk.type !== 'compression:done'
  ) {
    return;
  }

  const fire = async (): Promise<void> => {
    const { ExtensionManager } = await import('@main/common/extension');
    const runner = ExtensionManager.getHookRunner();
    if (!runner) return;

    const data = chunk.data as Record<string, unknown> | undefined;

    switch (chunk.type) {
      case 'turn:start':
        await runner.runVoidHook('turn_start', {
          sessionId,
          turnIndex: (data?.turnIndex as number) || 1
        });
        break;

      case 'turn:done':
        await runner.runVoidHook('turn_end', {
          sessionId,
          turnIndex: (data?.turnIndex as number) || 1,
          durationMs: Date.now() - turnState.getTurnStartTime(),
          toolCallCount: turnState.getTurnToolCallCount()
        });
        break;

      case 'compression:start': {
        // 如果 OpenAI Runtime 已在压缩前调用过 modifying Hook，跳过
        if (data?.hookHandled) break;
        // 通知型：扩展可在此做 Memory Flush 等操作
        // 注意：对 PiMono 来说 skipDefault 无效（SDK 自行管理压缩）
        await runner.run('before_compaction', {
          sessionId,
          messageCount: 0, // PiMono 不提供此信息
          totalTokens: (data?.totalTokens as number) || 0,
          threshold: (data?.threshold as number) || 0
        });
        break;
      }

      case 'compression:done': {
        await runner.runVoidHook('after_compaction', {
          sessionId,
          originalTokens: (data?.originalTokens as number) || 0,
          compressedTokens: (data?.summaryTokens as number) || 0,
          compressionRatio: (data?.compressionRatio as number) || 0,
          duration: (data?.duration as number) || 0
        });
        break;
      }
    }
  };

  // Fire-and-forget：Hook 执行不阻塞流式输出
  fire().catch((err) => {
    log.warn(`[ChunkProcessor] Chunk hook failed for ${chunk.type}:`, err);
  });
}

// ==================== suspendReason 解析 ====================

/**
 * 从 suspendReason 中解析出 pendingOperation
 *
 * suspendReason 格式（来自 ToolExecutionPipeline）: "approval-pending:{approvalId}:{toolName}"
 * 例如: "approval-pending:282850582706069504:0:write"
 */
export function parseSuspendReason(suspendReason: string, sessionId: string): ParsedPendingOperation | undefined {
  if (!suspendReason) return undefined;

  // 去除可能的前缀（如果有的话）
  const reason = suspendReason.replace(/^suspended:\s*/i, '').trim();

  // 匹配格式: approval-pending:{approvalId}:{toolName}
  const match = reason.match(/^approval-pending:([^:]+:[^:]+):(.+)$/);
  if (!match) {
    log.warn(`[ChunkProcessor] Failed to parse suspendReason: ${suspendReason}`);
    return undefined;
  }

  const approvalId = match[1]; // "sessionId:index"
  const toolName = match[2]; // "write"

  return {
    type: 'approval',
    approvalId,
    toolName,
    toolCallId: '',
    agentSessionId: sessionId
  };
}
