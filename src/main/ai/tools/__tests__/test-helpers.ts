/**
 * 测试辅助工具
 *
 * 公共的测试工具函数，避免在多个测试文件中重复实现。
 */

import type { ToolResult } from '../types';

/**
 * 消费 AsyncGenerator 的所有输出（泛型版本）
 *
 * 收集所有中间更新（update）和最终结果（return value）。
 * 常用于测试工具的增量输出和最终返回值。
 *
 * 支持任意类型的 Update（ToolExecutionUpdate, ToolStreamUpdate 等）。
 *
 * @param gen AsyncGenerator（工具执行生成器）
 * @returns { updates: T[], result: ToolResult }
 */
export async function consumeGenerator<T = unknown>(
  gen: AsyncGenerator<T, ToolResult, unknown>
): Promise<{
  updates: T[];
  result: ToolResult;
}> {
  const updates: T[] = [];
  let result = await gen.next();

  while (!result.done) {
    updates.push(result.value);
    result = await gen.next();
  }

  return { updates, result: result.value };
}
