/**
 * Extension Hook 执行引擎
 *
 * 两种执行模式：
 *   - void（旁听型）：Promise.allSettled 并行，每个 handler 独立 try-catch
 *   - modifying（拦截型）：按优先级顺序执行，结果合并
 *
 * 合并规则：
 *   - prependContext：多个拼接（\n 分隔）
 *   - replaceSystemPrompt：后者覆盖前者
 *   - block：任一为 true 则 true
 *   - params：后者浅合并前者
 *   - result：后者覆盖前者
 */

import { ExtensionRegistry } from './ExtensionRegistry';
import {
  EXTENSION_HOOK_MODE,
  type ExtensionHookName,
  type ExtensionHookEventMap,
  type ExtensionHookResultMap,
  type BeforeAgentStartResult,
  type BeforeToolCallResult,
  type ToolResultPersistResult,
  type BeforeCompactionResult
} from './types';

export class ExtensionHookRunner {
  constructor(private registry: ExtensionRegistry) {}

  /**
   * 执行旁听型 Hook（void）
   * 所有 handler 并行执行，任何 handler 抛错不影响其他
   */
  async runVoidHook<K extends ExtensionHookName>(name: K, event: ExtensionHookEventMap[K]): Promise<void> {
    const hooks = this.registry.getHooks(name);
    if (hooks.length === 0) return;

    await Promise.allSettled(
      hooks.map(async (hook) => {
        const start = Date.now();
        try {
          await hook.handler(event);
        } catch (err) {
          console.error(`[ExtensionHookRunner] void hook "${name}" from "${hook.extensionId}" failed:`, err);
        } finally {
          logHookTiming(name, hook.extensionId, Date.now() - start);
        }
      })
    );
  }

  /**
   * 执行拦截型 Hook（modifying）
   * 按优先级顺序执行，结果逐步合并
   */
  async runModifyingHook<K extends ExtensionHookName>(
    name: K,
    event: ExtensionHookEventMap[K]
  ): Promise<ExtensionHookResultMap[K]> {
    const hooks = this.registry.getHooks(name);
    if (hooks.length === 0) return undefined as ExtensionHookResultMap[K];

    let merged: Record<string, unknown> | undefined;

    for (const hook of hooks) {
      const start = Date.now();
      try {
        const result = await hook.handler(event);
        if (result == null) continue;

        if (!merged) {
          merged = { ...(result as Record<string, unknown>) };
        } else {
          merged = mergeResult(name, merged, result as Record<string, unknown>);
        }
      } catch (err) {
        console.error(`[ExtensionHookRunner] modifying hook "${name}" from "${hook.extensionId}" failed:`, err);
        // 跳过失败的 handler，继续下一个
      } finally {
        logHookTiming(name, hook.extensionId, Date.now() - start);
      }
    }

    return (merged ?? undefined) as ExtensionHookResultMap[K];
  }

  /**
   * 通用入口：自动判断 void / modifying 模式
   */
  async run<K extends ExtensionHookName>(name: K, event: ExtensionHookEventMap[K]): Promise<ExtensionHookResultMap[K]> {
    const mode = EXTENSION_HOOK_MODE[name];
    if (mode === 'void') {
      await this.runVoidHook(name, event);
      return undefined as ExtensionHookResultMap[K];
    }
    return this.runModifyingHook(name, event);
  }
}

/**
 * 合并两个 modifying hook 的结果
 */
function mergeResult(
  hookName: ExtensionHookName,
  prev: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  switch (hookName) {
    case 'before_agent_start':
      return mergeBeforeAgentStart(prev as BeforeAgentStartResult, next as BeforeAgentStartResult) as unknown as Record<
        string,
        unknown
      >;

    case 'before_tool_call':
      return mergeBeforeToolCall(prev as BeforeToolCallResult, next as BeforeToolCallResult) as unknown as Record<
        string,
        unknown
      >;

    case 'tool_result_persist':
      return mergeToolResultPersist(
        prev as ToolResultPersistResult,
        next as ToolResultPersistResult
      ) as unknown as Record<string, unknown>;

    case 'before_compaction':
      return mergeBeforeCompaction(prev as BeforeCompactionResult, next as BeforeCompactionResult) as unknown as Record<
        string,
        unknown
      >;

    default:
      // 默认：后覆盖前
      return { ...prev, ...next };
  }
}

function mergeBeforeAgentStart(prev: BeforeAgentStartResult, next: BeforeAgentStartResult): BeforeAgentStartResult {
  return {
    prependContext: joinOptional(prev.prependContext, next.prependContext),
    replaceSystemPrompt: next.replaceSystemPrompt ?? prev.replaceSystemPrompt
  };
}

function mergeBeforeToolCall(prev: BeforeToolCallResult, next: BeforeToolCallResult): BeforeToolCallResult {
  return {
    block: prev.block || next.block,
    blockReason: next.blockReason ?? prev.blockReason,
    params: next.params ? { ...(prev.params ?? {}), ...next.params } : prev.params
  };
}

function mergeToolResultPersist(prev: ToolResultPersistResult, next: ToolResultPersistResult): ToolResultPersistResult {
  return {
    result: next.result ?? prev.result
  };
}

function mergeBeforeCompaction(prev: BeforeCompactionResult, next: BeforeCompactionResult): BeforeCompactionResult {
  return {
    // 任一扩展要求跳过默认压缩 → 则跳过（同 block 语义）
    skipDefault: prev.skipDefault || next.skipDefault,
    // 自定义摘要：后者覆盖前者
    customSummary: next.customSummary ?? prev.customSummary
  };
}

/** 拼接两个可选字符串 */
function joinOptional(a?: string, b?: string): string | undefined {
  if (a && b) return `${a}\n${b}`;
  return b ?? a;
}

// ==================== Hook 执行时间监控 ====================

/** 慢 Hook 警告阈值（毫秒） */
const HOOK_WARN_THRESHOLD_MS = 1000;
/** 超慢 Hook 错误阈值（毫秒） */
const HOOK_ERROR_THRESHOLD_MS = 5000;

/** 记录 Hook 执行时间，超过阈值时输出告警 */
function logHookTiming(hookName: string, extensionId: string, durationMs: number): void {
  if (durationMs >= HOOK_ERROR_THRESHOLD_MS) {
    console.error(
      `[ExtensionHookRunner] SLOW hook "${hookName}" from "${extensionId}": ${durationMs}ms (threshold: ${HOOK_ERROR_THRESHOLD_MS}ms)`
    );
  } else if (durationMs >= HOOK_WARN_THRESHOLD_MS) {
    console.warn(
      `[ExtensionHookRunner] Slow hook "${hookName}" from "${extensionId}": ${durationMs}ms (threshold: ${HOOK_WARN_THRESHOLD_MS}ms)`
    );
  }
}
