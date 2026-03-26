/**
 * LLM 驱动的记忆分类
 *
 * 通过 memory-analyzer Agent 进行分类。
 * 只需传 agentId + 内容，系统自动加载 Agent 的 instructions/model 等配置。
 */

import type { ClassificationResult, MemoryCategory } from '../types/models';
import type { ExtensionApi } from '../../../src/main/common/extension';

const AGENT_ID = 'memory-analyzer';
const CLASSIFY_INPUT_MAX_CHARS = 4000;

/**
 * 使用 memory-analyzer Agent 对 Agent 输出进行分类
 */
export async function classifyMemory(api: ExtensionApi, agentOutput: string): Promise<ClassificationResult> {
  let trimmed = agentOutput;
  if (trimmed.length > CLASSIFY_INPUT_MAX_CHARS) {
    trimmed = trimmed.slice(0, CLASSIFY_INPUT_MAX_CHARS) + '\n\n... (内容过长，已截断)';
  }

  const input = `Agent 输出内容：\n${trimmed}`;

  try {
    api.logger.info('[memory-agent classify] 通过 memory-analyzer Agent 分类', {
      agentId: AGENT_ID,
      inputLength: input.length
    });

    const response = await api.services.llm.runAgent(AGENT_ID, input);

    api.logger.info('[memory-agent classify] Agent 返回', { preview: response.substring(0, 200) });

    const cleaned = response
      .trim()
      .replace(/^```json?\s*/, '')
      .replace(/```\s*$/, '');
    const result = JSON.parse(cleaned);

    if (
      typeof result.shouldRemember !== 'boolean' ||
      typeof result.category !== 'string' ||
      typeof result.importance !== 'number' ||
      typeof result.summary !== 'string' ||
      !Array.isArray(result.keywords) ||
      typeof result.memory !== 'string'
    ) {
      throw new Error('Invalid classification result format');
    }

    return result as ClassificationResult;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    api.logger.error('[memory-agent classify] 分类失败', { error: errorMsg });
    return {
      shouldRemember: false,
      category: 'fact',
      importance: 0,
      summary: '',
      keywords: [],
      memory: '',
      reason: `Classification failed: ${errorMsg}`
    };
  }
}

/**
 * 验证分类是否有效
 */
export function isValidCategory(category: string): category is MemoryCategory {
  return ['preference', 'decision', 'lesson', 'entity', 'knowledge', 'fact'].includes(category);
}
