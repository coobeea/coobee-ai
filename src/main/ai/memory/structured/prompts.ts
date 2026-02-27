/**
 * 结构化记忆系统 — LLM 提取 Prompt 模板
 *
 * 参考 memU 的 prompt 设计，按记忆类型分离提取规则。
 * 使用 XML 输出格式（比 JSON 更稳定）。
 */

import type { MemoryType } from './models';

// ==================== 通用常量 ====================

const CATEGORIES_PLACEHOLDER = '{categories}';
const RESOURCE_PLACEHOLDER = '{resource}';

// ==================== Profile 提取 ====================

const PROFILE_PROMPT = `# Task Objective
你是一个专业的用户记忆提取器。你的核心任务是从对话中提取关于用户的**长期稳定信息**（基本信息、偏好、特征等）。

# Rules
- 使用 "用户" 指代对话中的用户
- 每条记忆必须**完整独立**，不依赖上下文即可理解
- 每条记忆使用陈述句，不超过 30 字
- 仅提取用户**直接陈述或确认**的事实，禁止推测
- 禁止提取临时性/一次性信息（如天气、当前心情）
- 禁止提取事件类信息（事件属于 event 类型）
- 禁止提取助手的建议或推测
- 如果没有可提取的信息，返回空的 <item></item>

# Memory Categories
${CATEGORIES_PLACEHOLDER}

# Output Format (XML)
<item>
    <memory>
        <content>记忆内容</content>
        <categories>
            <category>分类名</category>
        </categories>
    </memory>
</item>

# Example
Input: "我 30 岁，在互联网公司做产品经理。下周末打算去旅行。"
Output:
<item>
    <memory>
        <content>用户是 30 岁的产品经理</content>
        <categories><category>personal_info</category></categories>
    </memory>
    <memory>
        <content>用户在互联网公司工作</content>
        <categories><category>work_life</category></categories>
    </memory>
</item>

# Input
<resource>
${RESOURCE_PLACEHOLDER}
</resource>`;

// ==================== Event 提取 ====================

const EVENT_PROMPT = `# Task Objective
你是一个专业的用户记忆提取器。你的核心任务是从对话中提取**具体事件和经历**（在特定时间发生的活动、计划、经历）。

# Rules
- 使用 "用户" 指代对话中的用户
- 每条记忆必须**完整独立**，包含时间/地点/人物等关键信息
- 每条记忆使用陈述句，不超过 50 字
- 仅提取用户**直接陈述或确认**的事件
- 需要包含时间相关信息（何时发生/计划发生）
- 禁止提取行为模式、习惯、偏好等（属于 profile 类型）
- 禁止提取助手的建议
- 如果没有可提取的事件，返回空的 <item></item>

# Memory Categories
${CATEGORIES_PLACEHOLDER}

# Output Format (XML)
<item>
    <memory>
        <content>事件描述</content>
        <categories>
            <category>分类名</category>
        </categories>
    </memory>
</item>

# Example
Input: "我 30 岁，在互联网公司做产品经理。下周末打算去旅行。"
Output:
<item>
    <memory>
        <content>用户下周末计划去旅行</content>
        <categories><category>activities</category></categories>
    </memory>
</item>

# Input
<resource>
${RESOURCE_PLACEHOLDER}
</resource>`;

// ==================== Knowledge 提取 ====================

const KNOWLEDGE_PROMPT = `# Task Objective
你是一个专业的用户记忆提取器。你的核心任务是从对话中提取**事实知识、概念和定义**（客观的、可复用的知识信息）。

# Rules
- 每条记忆必须是客观事实或已确认的知识
- 每条记忆使用陈述句，不超过 50 字
- 仅提取对话中**明确讨论或确认**的知识
- 禁止提取主观观点、个人偏好（属于 profile 类型）
- 禁止提取个人事件（属于 event 类型）
- 禁止提取众所周知的常识
- 如果没有可提取的知识，返回空的 <item></item>

# Memory Categories
${CATEGORIES_PLACEHOLDER}

# Output Format (XML)
<item>
    <memory>
        <content>知识描述</content>
        <categories>
            <category>分类名</category>
        </categories>
    </memory>
</item>

# Example
Input: "Python 装饰器是一个接受函数返回函数的高阶函数，@ 符号是语法糖。"
Output:
<item>
    <memory>
        <content>Python 装饰器是接受函数返回函数的高阶函数，@ 是语法糖</content>
        <categories><category>knowledge</category></categories>
    </memory>
</item>

# Input
<resource>
${RESOURCE_PLACEHOLDER}
</resource>`;

// ==================== Prompt Registry ====================

const PROMPT_MAP: Record<string, string> = {
  profile: PROFILE_PROMPT,
  event: EVENT_PROMPT,
  knowledge: KNOWLEDGE_PROMPT
};

/** 核心提取类型（Phase 2 仅启用这 3 种） */
export const ENABLED_MEMORY_TYPES: MemoryType[] = ['profile', 'event', 'knowledge'];

/**
 * 构建提取 prompt
 */
export function buildExtractionPrompt(memoryType: MemoryType, resource: string, categories: string): string | null {
  const template = PROMPT_MAP[memoryType];
  if (!template) return null;
  return template.replace(CATEGORIES_PLACEHOLDER, categories).replace(RESOURCE_PLACEHOLDER, resource);
}

/**
 * 格式化分类列表为 prompt 文本
 */
export function formatCategoriesForPrompt(categories: Array<{ name: string; description: string }>): string {
  return categories.map((c) => `- ${c.name}: ${c.description}`).join('\n');
}

// ==================== XML 解析 ====================

export interface ExtractedMemory {
  content: string;
  categories: string[];
}

/**
 * 从 LLM 的 XML 输出中解析记忆条目。
 * 宽容解析：使用正则而非严格 XML parser，处理 LLM 输出不规范的情况。
 */
export function parseExtractionResponse(xmlText: string): ExtractedMemory[] {
  const results: ExtractedMemory[] = [];

  const memoryPattern = /<memory>([\s\S]*?)<\/memory>/g;
  let match: RegExpExecArray | null;

  while ((match = memoryPattern.exec(xmlText)) !== null) {
    const block = match[1];

    const contentMatch = block.match(/<content>([\s\S]*?)<\/content>/);
    if (!contentMatch) continue;

    const content = contentMatch[1].trim();
    if (!content || content.length < 3) continue;

    const categories: string[] = [];
    const catPattern = /<category>([\s\S]*?)<\/category>/g;
    let catMatch: RegExpExecArray | null;
    while ((catMatch = catPattern.exec(block)) !== null) {
      const cat = catMatch[1].trim();
      if (cat) categories.push(cat);
    }

    results.push({ content, categories });
  }

  return results;
}
