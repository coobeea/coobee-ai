/**
 * PiMono 工具转换器
 *
 * 将统一的 ToolDefinition 转换为 pi-coding-agent SDK 原生的 PiToolDefinition。
 *
 * 职责：
 *   - Schema 转换：Zod → JSON Schema
 *   - Hook 集成：before_tool_call / after_tool_call / tool_result_persist
 *   - 策略检查：sandbox 级别 isToolAllowed
 *   - 流式桥接：AsyncGenerator yield → PiMono onUpdate 回调
 *
 * 从 PiMonoAgentRuntime.ts 提取，保持 Runtime 只做生命周期编排。
 *
 * @module runtime/pimono/PiMonoToolConverter
 */

import { z } from 'zod'
import type { ToolDefinition as PiToolDefinition } from '@mariozechner/pi-coding-agent'
import type { ToolDefinition } from '../../tools/types'
import type { SandboxContext, ResolvedToolPolicy } from '../../sandbox/types'

// ========== Types ==========

interface RuntimeLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
}

interface ConvertToolsOptions {
  /** 沙箱上下文 */
  sandboxContext: SandboxContext
  /** 日志器 */
  log: RuntimeLogger
}

// ========== Core API ==========

/**
 * 将统一 ToolDefinition 列表转换为 pi-coding-agent SDK 原生 PiToolDefinition 列表
 *
 * 核心映射：
 *   - execute 前通过 before_tool_call Hook 处理审批（tool-approval Extension）
 *   - execute 前检查工具策略（isToolAllowed，sandbox 级别拦截）
 *   - yield 的 ToolStreamUpdate 通过 PiMono 的 onUpdate 回调发送增量输出
 *   - return 的 ToolResult.llmContent 作为 AgentToolResult 返回
 *   - 自动注入 SandboxContext（路径边界、工具策略、Docker 等）
 *
 * HITL 审批：
 *   由 tool-approval Extension 在 before_tool_call Hook 中统一处理，
 *   PiMono 现在也支持 HITL（通过 Hook 异步等待用户审批）。
 */
export function convertTools(
  defs: ToolDefinition[],
  options: ConvertToolsOptions
): PiToolDefinition[] {
  if (!defs.length) return []

  const { sandboxContext, log } = options

  return defs.map(
    (def) =>
      ({
        name: def.name,
        label: def.name,
        description: def.description,
        // Zod → JSON Schema（PiMono SDK 使用 TypeBox/JSON Schema 格式）
        parameters: z.toJSONSchema(def.parameters),
        execute: async (
          _toolCallId: string,
          params: Record<string, unknown>,
          signal?: AbortSignal,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onUpdate?: (partialResult: any) => void
        ) => {
          let typedParams = params
          const toolStartTime = Date.now()

          // === Extension Hook: before_tool_call ===
          // tool-approval Extension 在此 Hook 中处理 HITL 审批和 ExecPolicy
          try {
            const { ExtensionManager } = await import('../../../common/extension')
            const runner = ExtensionManager.getHookRunner()
            if (runner) {
              const hookResult = await runner.runModifyingHook('before_tool_call', {
                sessionId: sandboxContext.sessionId || '',
                toolName: def.name,
                params: typedParams,
                needUserConfirm: def.needUserConfirm ?? false
              })
              if (hookResult) {
                if (hookResult.block) {
                  const reason = hookResult.blockReason || 'no reason'
                  return {
                    content: [{ type: 'text', text: `Error: Tool blocked — ${reason}` }],
                    details: { name: def.name }
                  }
                }
                if (hookResult.params) {
                  typedParams = { ...typedParams, ...hookResult.params }
                }
              }
            }
          } catch {
            // Extension hook 失败不阻断工具执行
          }

          // 工具策略检查：sandbox 级别拦截
          const { isToolAllowed, formatToolBlockedMessage } = await import('../../sandbox')
          if (!isToolAllowed(def.name, sandboxContext.toolPolicy)) {
            const msg = formatToolBlockedMessage(
              def.name,
              sandboxContext.toolPolicy as ResolvedToolPolicy
            )
            log.warn(`[Tool Policy] ${msg}`)
            return {
              content: [{ type: 'text', text: `Error: ${msg}` }],
              details: { name: def.name }
            }
          }

          const gen = def.execute(typedParams, signal, sandboxContext)
          let iterResult = await gen.next()

          // 消费 AsyncGenerator 的增量输出
          while (!iterResult.done) {
            const update = iterResult.value
            // 桥接到 PiMono 的 onUpdate 回调（前端实时展示）
            if (onUpdate) {
              onUpdate({
                content: [{ type: 'text', text: update.content }],
                details: {
                  name: def.name,
                  updateType: update.type,
                  percentage: update.percentage
                }
              })
            }
            iterResult = await gen.next()
          }

          // 最终结果
          const toolResult = iterResult.value
          let text =
            toolResult.llmContent ||
            (toolResult.success ? 'Success' : `Error: ${toolResult.error?.message || 'unknown'}`)

          // === Extension Hook: after_tool_call (void) + tool_result_persist (modifying) ===
          try {
            const { ExtensionManager } = await import('../../../common/extension')
            const runner = ExtensionManager.getHookRunner()
            if (runner) {
              const toolDuration = Date.now() - toolStartTime
              await runner.runVoidHook('after_tool_call', {
                sessionId: sandboxContext.sessionId || '',
                toolName: def.name,
                params: typedParams,
                result: text,
                durationMs: toolDuration
              })

              const persistResult = await runner.runModifyingHook('tool_result_persist', {
                sessionId: sandboxContext.sessionId || '',
                toolName: def.name,
                result: text
              })
              if (persistResult?.result) {
                text = persistResult.result
              }
            }
          } catch {
            // Extension hook 失败不阻断
          }

          return { content: [{ type: 'text', text }], details: { name: def.name } }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any as PiToolDefinition
  )
}
