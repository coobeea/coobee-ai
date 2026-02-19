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

import { z } from 'zod';
import type { ToolDefinition as PiToolDefinition } from '@mariozechner/pi-coding-agent';
import type { ToolDefinition } from '../../tools/types';
import type { ToolExecutionContext } from '../../tools/types';
import { executeToolPipeline } from '../shared/ToolExecutionPipeline';

// ========== Types ==========

interface RuntimeLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

interface ConvertToolsOptions {
  /** 工具执行上下文 */
  sandboxContext: ToolExecutionContext;
  /** 日志器 */
  log: RuntimeLogger;
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
 *   - 自动注入 ToolExecutionContext（路径守卫、工具策略、Agent 信息等）
 *
 * HITL 审批：
 *   由 tool-approval Extension 在 before_tool_call Hook 中统一处理，
 *   PiMono 现在也支持 HITL（通过 Hook 异步等待用户审批）。
 */
export function convertTools(defs: ToolDefinition[], options: ConvertToolsOptions): PiToolDefinition[] {
  if (!defs.length) return [];

  const { sandboxContext } = options;

  return defs.map(
    (def) =>
      ({
        name: def.name,
        label: def.name,
        description: def.description,
        // Zod → JSON Schema（PiMono SDK 使用 TypeBox/AJV draft-07 格式）
        // z.toJSONSchema() 输出 draft-2020-12 $schema，AJV 不识别，需移除
        parameters: stripSchemaRef(z.toJSONSchema(def.parameters)),
        execute: async (
          _toolCallId: string,
          params: Record<string, unknown>,
          signal?: AbortSignal,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onUpdate?: (partialResult: any) => void
        ) => {
          // 使用共享管线：hook + policy + execute + post-hooks
          const result = await executeToolPipeline(def, params, {
            sandboxContext,
            signal,
            onUpdate: onUpdate
              ? (update) => {
                  // 桥接到 PiMono 的 onUpdate 回调（前端实时展示）
                  onUpdate({
                    content: [{ type: 'text', text: update.content }],
                    details: {
                      name: def.name,
                      updateType: update.type,
                      percentage: update.percentage
                    }
                  });
                }
              : undefined
          });

          // 处理 suspended 状态（HITL 审批）
          // 注意：pi-SDK 不原生支持 suspended，但我们在 details 中保留信息用于调试
          if (result.suspended) {
            return {
              content: [{ type: 'text', text: result.resultText }],
              details: {
                name: def.name,
                status: 'suspended',
                suspendReason: result.suspendReason
              }
            };
          }

          // 正常返回
          return {
            content: [{ type: 'text', text: result.resultText }],
            details: { name: def.name }
          };
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any as PiToolDefinition
  );
}

// ========== Internal Helpers ==========

/**
 * 移除 JSON Schema 的 $schema 元引用
 *
 * Zod 4 的 z.toJSONSchema() 默认输出 draft-2020-12 的 $schema 引用，
 * 但 pi-SDK 内部的 AJV 验证器仅支持 draft-07，遇到 2020-12 会抛出：
 *   "no schema with key or ref https://json-schema.org/draft/2020-12/schema"
 *
 * 解决：移除 $schema 属性，让 AJV 使用其默认的 draft-07 模式验证。
 */
function stripSchemaRef(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _, ...rest } = schema;
  return rest;
}
