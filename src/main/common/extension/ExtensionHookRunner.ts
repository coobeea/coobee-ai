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

import { ExtensionRegistry } from './ExtensionRegistry'
import {
  EXTENSION_HOOK_MODE,
  type ExtensionHookName,
  type ExtensionHookEventMap,
  type ExtensionHookResultMap,
  type BeforeAgentStartResult,
  type BeforeToolCallResult,
  type ToolResultPersistResult
} from './types'

export class ExtensionHookRunner {
  constructor(private registry: ExtensionRegistry) {}

  /**
   * 执行旁听型 Hook（void）
   * 所有 handler 并行执行，任何 handler 抛错不影响其他
   */
  async runVoidHook<K extends ExtensionHookName>(
    name: K,
    event: ExtensionHookEventMap[K]
  ): Promise<void> {
    const hooks = this.registry.getHooks(name)
    if (hooks.length === 0) return

    await Promise.allSettled(
      hooks.map(async (hook) => {
        try {
          await hook.handler(event)
        } catch (err) {
          console.error(
            `[ExtensionHookRunner] void hook "${name}" from "${hook.extensionId}" failed:`,
            err
          )
        }
      })
    )
  }

  /**
   * 执行拦截型 Hook（modifying）
   * 按优先级顺序执行，结果逐步合并
   */
  async runModifyingHook<K extends ExtensionHookName>(
    name: K,
    event: ExtensionHookEventMap[K]
  ): Promise<ExtensionHookResultMap[K]> {
    const hooks = this.registry.getHooks(name)
    if (hooks.length === 0) return undefined as ExtensionHookResultMap[K]

    let merged: Record<string, unknown> | undefined

    for (const hook of hooks) {
      try {
        const result = await hook.handler(event)
        if (result == null) continue

        if (!merged) {
          merged = { ...(result as Record<string, unknown>) }
        } else {
          merged = mergeResult(name, merged, result as Record<string, unknown>)
        }
      } catch (err) {
        console.error(
          `[ExtensionHookRunner] modifying hook "${name}" from "${hook.extensionId}" failed:`,
          err
        )
        // 跳过失败的 handler，继续下一个
      }
    }

    return (merged ?? undefined) as ExtensionHookResultMap[K]
  }

  /**
   * 通用入口：自动判断 void / modifying 模式
   */
  async run<K extends ExtensionHookName>(
    name: K,
    event: ExtensionHookEventMap[K]
  ): Promise<ExtensionHookResultMap[K]> {
    const mode = EXTENSION_HOOK_MODE[name]
    if (mode === 'void') {
      await this.runVoidHook(name, event)
      return undefined as ExtensionHookResultMap[K]
    }
    return this.runModifyingHook(name, event)
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
      return mergeBeforeAgentStart(
        prev as BeforeAgentStartResult,
        next as BeforeAgentStartResult
      ) as unknown as Record<string, unknown>

    case 'before_tool_call':
      return mergeBeforeToolCall(
        prev as BeforeToolCallResult,
        next as BeforeToolCallResult
      ) as unknown as Record<string, unknown>

    case 'tool_result_persist':
      return mergeToolResultPersist(
        prev as ToolResultPersistResult,
        next as ToolResultPersistResult
      ) as unknown as Record<string, unknown>

    default:
      // 默认：后覆盖前
      return { ...prev, ...next }
  }
}

function mergeBeforeAgentStart(
  prev: BeforeAgentStartResult,
  next: BeforeAgentStartResult
): BeforeAgentStartResult {
  return {
    prependContext: joinOptional(prev.prependContext, next.prependContext),
    replaceSystemPrompt: next.replaceSystemPrompt ?? prev.replaceSystemPrompt
  }
}

function mergeBeforeToolCall(
  prev: BeforeToolCallResult,
  next: BeforeToolCallResult
): BeforeToolCallResult {
  return {
    block: prev.block || next.block,
    blockReason: next.blockReason ?? prev.blockReason,
    params: next.params ? { ...(prev.params ?? {}), ...next.params } : prev.params
  }
}

function mergeToolResultPersist(
  prev: ToolResultPersistResult,
  next: ToolResultPersistResult
): ToolResultPersistResult {
  return {
    result: next.result ?? prev.result
  }
}

/** 拼接两个可选字符串 */
function joinOptional(a?: string, b?: string): string | undefined {
  if (a && b) return `${a}\n${b}`
  return b ?? a
}
