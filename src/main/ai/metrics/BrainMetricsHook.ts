/**
 * BrainMetricsHook - Brain 工具调用监控扩展
 *
 * 通过 Extension Hook 拦截工具调用，记录 Brain 相关工具的使用情况
 */

import { log } from '@main/common/logger';
import { getBrainMetrics } from './BrainMetrics';
import type { ToolResult } from '../tools/types';

/**
 * 工具执行前的 Hook
 */
export async function onBeforeToolCall(context: {
  toolName: string;
  args: unknown;
  sessionId: string;
  agentId?: string;
}): Promise<void> {
  // 只处理 brain 相关工具
  if (!context.toolName.startsWith('brain')) {
    return;
  }

  log.debug(`[BrainMetricsHook] 工具调用开始: ${context.toolName} by ${context.agentId || 'unknown'}`);
}

/**
 * 工具执行后的 Hook
 */
export async function onAfterToolCall(context: {
  toolName: string;
  args: unknown;
  result: ToolResult;
  sessionId: string;
  agentId?: string;
}): Promise<void> {
  // 只处理 brain 相关工具
  if (!context.toolName.startsWith('brain')) {
    return;
  }

  try {
    const metrics = getBrainMetrics();
    const success = !context.result.error;
    const agentId = context.agentId || 'unknown';

    if (context.toolName === 'brain_search' || context.toolName === 'brain-search') {
      // 记录搜索
      const args = context.args as { query?: string };
      const resultContent = context.result.llmContent || context.result.userContent || '';

      // 判断是否命中：结果不为空且不包含"未找到"等关键词
      const hit =
        success &&
        resultContent.length > 0 &&
        !resultContent.includes('未找到') &&
        !resultContent.includes('not found') &&
        !resultContent.includes('No results');

      const resultCount = hit ? (resultContent.match(/\n/g) || []).length : 0;

      await metrics.recordCall({
        toolType: 'search',
        agentId,
        success,
        hit,
        query: args.query,
        resultCount,
        error: context.result.error?.message
      });

      log.debug(`[BrainMetricsHook] 记录搜索: query="${args.query}", hit=${hit}, resultCount=${resultCount}`);
    } else if (context.toolName === 'brain_publish' || context.toolName === 'brain-publish') {
      // 记录发布
      const args = context.args as { topic?: string; content?: string };

      await metrics.recordCall({
        toolType: 'publish',
        agentId,
        success,
        topic: args.topic,
        error: context.result.error?.message
      });

      log.debug(`[BrainMetricsHook] 记录发布: topic="${args.topic}", success=${success}`);
    }
  } catch (error) {
    log.error('[BrainMetricsHook] 记录指标失败', error);
  }
}
