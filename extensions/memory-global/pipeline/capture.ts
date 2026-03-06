/**
 * 记忆捕获逻辑
 *
 * 判断哪些内容值得被记住，并进行分类
 */

import type { MemoryCategory } from '../types/models';

/** 记忆触发模式（参考 OpenClaw） */
const MEMORY_TRIGGERS = [
  /i (am|have|live|work|study)/i, // 我是/我有/我住...
  /my (name|email|phone|address|favorite)/i, // 我的名字/邮箱...
  /call me/i, // 叫我...
  /i (like|prefer|hate|love|dislike)/i, // 我喜欢/讨厌...
  /(always|never|important|remember|note)/i, // 总是/永远不要/重要...
  /(decided|will use)/i, // 英文决策
  /(我|用户)(是|叫|住在|工作|学习)/i, // 中文：我是/我叫...
  /(我|用户)(喜欢|偏好|讨厌|习惯)/i, // 中文：我喜欢...
  /(总是|永远|一定|必须|禁止|不要|记住|注意)/i, // 中文：总是/记住...
  /(经验|教训|发现|学到|注意事项)/i, // 经验教训
  /(决定|确定|选择)(采用|使用)/i // 中文决策
];

/** 分类检测规则 */
const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: MemoryCategory }> = [
  // preference - 偏好
  { pattern: /(like|love|prefer|favorite|偏好|喜欢|习惯)/i, category: 'preference' },
  // decision - 决定
  { pattern: /(decided|will use|确定|决定|选择|采用)/i, category: 'decision' },
  // entity - 实体（邮箱、电话）
  { pattern: /[\w.-]+@[\w.-]+\.\w{2,}/, category: 'entity' },
  { pattern: /\+?\d[\d\s-]{7,}\d/, category: 'entity' },
  // lesson - 经验教训
  { pattern: /(fix|bug|issue|problem|solution|learned|经验|教训|修复|问题|解决|学到)/i, category: 'lesson' },
  // knowledge - 知识
  { pattern: /(architecture|design|pattern|standard|架构|设计|模式|标准|规范)/i, category: 'knowledge' },
  // fact - 事实陈述
  { pattern: /\b(is|are|was|were|has|have)\b/i, category: 'fact' }
];

/**
 * 判断文本是否值得被捕获为记忆
 */
export function shouldCapture(text: string, options: { minChars: number; maxChars: number }): boolean {
  const trimmed = text.trim();

  // 1. 长度过滤
  if (trimmed.length < options.minChars || trimmed.length > options.maxChars) {
    return false;
  }

  // 2. 过滤系统注入内容（防止死循环）
  if (trimmed.includes('<memory_context>') || trimmed.includes('<relevant-memories>')) {
    return false;
  }

  // 3. 过滤明显的模型生成内容（大量 Emoji + Markdown 列表）
  const emojiCount = (trimmed.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
  const hasMarkdownList = /\*\*/.test(trimmed) && /\n-/.test(trimmed);
  if (emojiCount > 3 || hasMarkdownList) {
    return false;
  }

  // 4. 防止提示词注入
  const promptInjectionPatterns = [
    /ignore (all )?prior instructions/i,
    /system prompt/i,
    /you are now/i,
    /forget (all|everything)/i
  ];
  if (promptInjectionPatterns.some((p) => p.test(trimmed))) {
    return false;
  }

  // 5. 匹配触发词
  return MEMORY_TRIGGERS.some((pattern) => pattern.test(trimmed));
}

/**
 * 检测记忆分类
 */
export function detectCategory(text: string): MemoryCategory {
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(text)) {
      return category;
    }
  }
  return 'other';
}

/**
 * 计算重要度分数（1-10）
 *
 * 基于信号词密度和文本长度
 */
export function calculateImportance(text: string): number {
  let score = 5; // 基础分

  // 匹配触发词越多，越重要
  const triggerCount = MEMORY_TRIGGERS.filter((p) => p.test(text)).length;
  score += Math.min(triggerCount, 3); // 最多加 3 分

  // 文本长度适中时加分
  if (text.length >= 50 && text.length <= 200) {
    score += 1;
  }

  // 包含 "important" 等关键词加分
  if (/(important|critical|key|重要|关键|核心)/i.test(text)) {
    score += 1;
  }

  return Math.min(Math.max(score, 1), 10);
}
