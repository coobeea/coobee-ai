/**
 * LLM 驱动的记忆分类
 */

import type { ClassificationResult, MemoryCategory } from '../types/models';
import type { ExtensionApi } from '../../../src/main/common/extension';

/** 分类提示词 */
const CLASSIFICATION_PROMPT = `你是一个记忆分类专家。请分析 Agent 输出内容，判断是否值得记住，并提取关键信息。

**分类维度**：
- **preference**：用户偏好、习惯、风格
- **decision**：决策、选择、判断
- **lesson**：经验教训、踩坑记录
- **entity**：人物、项目、工具、概念
- **knowledge**：知识点、原理、方法论
- **fact**：事实、数据、状态

**判断标准**：
- 值得记住：包含关键决策、重要偏好、知识点、实体信息、经验教训等
- 不值得记住：纯问候、简单确认、无信息量的对话
- 注意：必须归类到以上 6 个明确维度之一，不接受模糊分类

请以 JSON 格式输出（严格 JSON，不要 markdown 代码块）：

{
  "shouldRemember": true,
  "category": "preference",
  "importance": 8,
  "summary": "用户偏好使用文件系统而非数据库",
  "keywords": ["文件系统", "数据库", "存储"],
  "memory": "用户明确表示倾向使用文件系统存储而非数据库，认为文件系统更简单可控。",
  "reason": "包含明确的技术偏好"
}`;

const CLASSIFY_INPUT_MAX_CHARS = 4000;

/**
 * 使用 LLM 对 Agent 输出进行分类
 */
export async function classifyMemory(api: ExtensionApi, agentOutput: string): Promise<ClassificationResult> {
  let trimmed = agentOutput;
  if (trimmed.length > CLASSIFY_INPUT_MAX_CHARS) {
    trimmed = trimmed.slice(0, CLASSIFY_INPUT_MAX_CHARS) + '\n\n... (内容过长，已截断)';
  }

  const input = `Agent 输出内容：\n${trimmed}`;

  try {
    api.logger.info('[memory-agent classify] 调用 LLM API...', { inputLength: input.length });
    const response = await api.services.llm.chat([
      { role: 'system', content: CLASSIFICATION_PROMPT },
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
