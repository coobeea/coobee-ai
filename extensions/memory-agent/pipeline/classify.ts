/**
 * LLM 驱动的记忆分类
 *
 * 通过 memory-analyzer Agent 进行分类，
 * 提示词来自 Agent 定义（agents/memory-analyzer.json），不在此硬编码。
 */

import type { ClassificationResult, MemoryCategory } from '../types/models';
import type { ExtensionApi } from '../../../src/main/common/extension';

const AGENT_ID = 'memory-analyzer';
const CLASSIFY_INPUT_MAX_CHARS = 4000;

let cachedInstructions: string | null = null;

/** @internal 仅供测试使用 */
export function _resetInstructionsCache(): void {
  cachedInstructions = null;
}

/**
 * 从 AgentStore 加载 memory-analyzer 的 instructions（带缓存）
 */
async function getAnalyzerInstructions(api: ExtensionApi): Promise<string> {
  if (cachedInstructions) return cachedInstructions;

  try {
    const store = await api.services.agent.getStore();
    const agent = await store.get(AGENT_ID);
    if (agent?.instructions) {
      cachedInstructions = agent.instructions;
      return cachedInstructions;
    }
  } catch (err) {
    api.logger.warn('[memory-agent classify] 无法加载 memory-analyzer Agent 定义，使用内置回退', {
      error: err instanceof Error ? err.message : String(err)
    });
  }

  const FALLBACK = `你是一个记忆分类专家。分析 Agent 输出内容，以 JSON 输出：{ "shouldRemember": boolean, "category": "preference|decision|lesson|entity|knowledge|fact", "importance": 1-10, "summary": "...", "keywords": [...], "memory": "...", "reason": "..." }`;
  cachedInstructions = FALLBACK;
  return FALLBACK;
}

/**
 * 使用 memory-analyzer Agent 对 Agent 输出进行分类
 */
export async function classifyMemory(api: ExtensionApi, agentOutput: string): Promise<ClassificationResult> {
  let trimmed = agentOutput;
  if (trimmed.length > CLASSIFY_INPUT_MAX_CHARS) {
    trimmed = trimmed.slice(0, CLASSIFY_INPUT_MAX_CHARS) + '\n\n... (内容过长，已截断)';
  }

  const input = `Agent 输出内容：\n${trimmed}`;
  const systemPrompt = await getAnalyzerInstructions(api);

  try {
    api.logger.info('[memory-agent classify] 通过 memory-analyzer Agent 调用 LLM', {
      agentId: AGENT_ID,
      inputLength: input.length
    });

    const response = await api.services.llm.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input }
    ]);

    api.logger.info('[memory-agent classify] LLM 返回', { preview: response.substring(0, 200) });

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
