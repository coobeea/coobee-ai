/**
 * memory-auto — 记忆自动化 Extension
 *
 * 两个核心功能：
 *   1. before_agent_start: 读取 MEMORY.md 摘要 + 相关记忆，注入到上下文
 *   2. agent_end: 检测输出中的记忆信号词，自动追加到 memory/{date}.md
 *
 * 参考：OpenClaw memory-core 的 Memory Flush + memory-lancedb 的自动捕获
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ExtensionApi } from '../../src/main/common/extension';

// ==================== 常量 ====================

/** MEMORY.md 注入最大字符数 */
const MAX_CORE_MEMORY_CHARS = 2000;

/** 搜索相关记忆最大结果数 */
const MAX_RECALL_RESULTS = 5;

/** 搜索最低分数 */
const MIN_RECALL_SCORE = 0.15;

/** 记忆信号词（出现在 Agent 输出中触发自动记录）
 * 注意：中文匹配不使用 \b word boundary（\b 不适用于 CJK 字符） */
const MEMORY_SIGNAL_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  // 明确的记忆请求
  { pattern: /(remember|记住|注意|备忘)/i, category: 'explicit' },
  // 偏好类
  { pattern: /(always|总是|始终)\s*(use|prefer|用|使用)/i, category: 'preference' },
  { pattern: /(never|不要|禁止|避免)\s*(use|do|用|使用|这样)/i, category: 'preference' },
  { pattern: /\b(prefer)\b/i, category: 'preference' },
  { pattern: /(偏好|倾向)/i, category: 'preference' },
  { pattern: /(用户|你)(喜欢|习惯|倾向于|偏好)/i, category: 'preference' },
  // 经验教训类
  { pattern: /(important|重要|关键).*(note|lesson|发现|教训|经验)/i, category: 'lesson' },
  { pattern: /(learned|学到|总结|结论).*(that|了|到|是)/i, category: 'lesson' },
  { pattern: /(经验|教训|注意事项|踩坑|bug|修复|解决)/i, category: 'lesson' },
  { pattern: /\b(fix|resolve|debug|workaround|solution)\b/i, category: 'lesson' },
  // 知识/决策类
  { pattern: /(架构|设计方案|选型|规范|约定|标准)/i, category: 'knowledge' },
  { pattern: /\b(architecture|convention|standard|pattern)\b/i, category: 'knowledge' },
  { pattern: /(最终|确定|决定)(采用|选择|使用)/i, category: 'decision' },
  // 联系信息
  { pattern: /[\w.-]+@[\w.-]+\.\w{2,}/i, category: 'contact' },
  { pattern: /\+?\d[\d\s-]{7,}\d/i, category: 'contact' }
];

/** 过滤条件：太短、太长、或明显是代码/格式化内容 */
const MIN_SIGNAL_TEXT_LENGTH = 10;
const MAX_SIGNAL_TEXT_LENGTH = 500;

/** Agent 输出最小长度（低于此值不做任何记忆处理） */
const MIN_OUTPUT_FOR_MEMORY = 30;

/** 自动摘要阈值：输出达到此长度且无信号词匹配时，提取摘要 */
const MIN_OUTPUT_FOR_SUMMARY = 200;

// ==================== Extension 模块 ====================

export default {
  id: 'memory-auto',
  name: 'Memory Auto',
  register(api: ExtensionApi) {
    // ========== before_agent_start: 记忆注入 ==========
    api.on(
      'before_agent_start',
      async (event) => {
        try {
          const workspace = await getWorkspace(event.sessionId);
          if (!workspace) return;

          const blocks: string[] = [];

          // 1. 读取 MEMORY.md 摘要
          const coreMemory = readMemoryMdHead(workspace, MAX_CORE_MEMORY_CHARS);
          if (coreMemory) {
            blocks.push(`<core_memory>\n${coreMemory}\n</core_memory>`);
          }

          // 2. 基于用户消息搜索相关记忆
          const keywords = extractKeywords(event.prompt);
          if (keywords.length > 0) {
            const recalled = searchMemoryDir(
              path.join(workspace, 'memory'),
              keywords,
              MAX_RECALL_RESULTS,
              MIN_RECALL_SCORE
            );
            if (recalled.length > 0) {
              const items = recalled.map((r) => `- [${r.file}] ${r.snippet}`).join('\n');
              blocks.push(`<recalled_memories>\n${items}\n</recalled_memories>`);
            }
          }

          if (blocks.length === 0) return;

          return {
            prependContext: blocks.join('\n\n')
          };
        } catch (err) {
          api.logger.warn(`Memory injection failed: ${err}`);
          return;
        }
      },
      { priority: 30 } // 较低优先级，在其他 Hook 之后
    );

    // ========== agent_end: 记忆信号检测 + 交互摘要 ==========
    api.on(
      'agent_end',
      async (event) => {
        try {
          const workspace = await getWorkspace(event.sessionId);
          if (!workspace) return;

          const output = (event.output || '').trim();
          if (!output || output.length < MIN_OUTPUT_FOR_MEMORY) return;

          const entries: string[] = [];
          const timestamp = new Date().toISOString().slice(11, 19);

          // 1. 信号词匹配
          const signals = detectMemorySignals(output);
          for (const s of signals) {
            entries.push(`- [${timestamp}] (${s.category}) ${s.text}\n`);
          }

          // 2. 自动摘要：对较长的有意义输出，提取首段作为交互记录
          if (entries.length === 0 && output.length >= MIN_OUTPUT_FOR_SUMMARY) {
            const summary = extractSummary(output);
            if (summary) {
              entries.push(`- [${timestamp}] (summary) ${summary}\n`);
            }
          }

          if (entries.length === 0) return;

          const today = new Date().toISOString().slice(0, 10);
          const memoryDir = path.join(workspace, 'memory');
          fs.mkdirSync(memoryDir, { recursive: true });
          const memoryFile = path.join(memoryDir, `${today}.md`);

          const exists = fs.existsSync(memoryFile);
          const header = exists ? '' : `# Memory — ${today}\n\n`;

          fs.appendFileSync(memoryFile, header + entries.join(''), 'utf-8');

          api.logger.info(`[memory-auto] Captured ${entries.length} entries → memory/${today}.md`);
        } catch (err) {
          api.logger.warn(`Memory signal capture failed: ${err}`);
        }
      },
      { priority: 50 }
    );
  }
};

// ==================== 辅助函数 ====================

/** 获取 Agent 工作空间路径 */
async function getWorkspace(sessionId: string): Promise<string | null> {
  try {
    const { Env } = await import('../../src/main/common/env');
    return await Env.getAgentWorkspaceDir(sessionId);
  } catch {
    return null;
  }
}

/** 读取 MEMORY.md 的前 N 个字符 */
function readMemoryMdHead(workspace: string, maxChars: number): string | null {
  const memoryMdPath = path.join(workspace, 'MEMORY.md');
  if (!fs.existsSync(memoryMdPath)) return null;

  try {
    const content = fs.readFileSync(memoryMdPath, 'utf-8');
    if (content.trim().length === 0) return null;

    if (content.length <= maxChars) return content.trim();

    // 截断到最近的行边界
    const truncated = content.slice(0, maxChars);
    const lastNewline = truncated.lastIndexOf('\n');
    return (lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated) + '\n...(truncated)';
  } catch {
    return null;
  }
}

/** 从用户消息中提取关键词（简单分词 + 过滤停用词） */
function extractKeywords(prompt: string): string[] {
  const stopWords = new Set([
    'the',
    'a',
    'an',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'can',
    'shall',
    'to',
    'of',
    'in',
    'for',
    'on',
    'with',
    'at',
    'by',
    'from',
    'as',
    'into',
    'through',
    'during',
    'before',
    'after',
    'above',
    'below',
    'between',
    'and',
    'but',
    'or',
    'nor',
    'not',
    'so',
    'yet',
    'both',
    'either',
    'neither',
    'each',
    'every',
    'all',
    'any',
    'few',
    'more',
    'most',
    'other',
    'some',
    'such',
    'no',
    'only',
    'own',
    'same',
    'than',
    'too',
    'very',
    'just',
    'it',
    'its',
    'this',
    'that',
    'these',
    'those',
    'i',
    'me',
    'my',
    'you',
    'your',
    'he',
    'him',
    'his',
    'she',
    'her',
    'we',
    'us',
    'our',
    'they',
    'them',
    'their',
    'what',
    'which',
    'who',
    'whom',
    'where',
    'when',
    'why',
    'how',
    // 中文停用词
    '的',
    '了',
    '在',
    '是',
    '我',
    '有',
    '和',
    '就',
    '不',
    '人',
    '都',
    '一',
    '一个',
    '上',
    '也',
    '很',
    '到',
    '说',
    '要',
    '去',
    '你',
    '会',
    '着',
    '没有',
    '看',
    '好',
    '自己',
    '这',
    '他',
    '她',
    '它',
    '们',
    '那',
    '些',
    '吗',
    '呢',
    '吧',
    '啊',
    '嗯',
    '哦'
  ]);

  return prompt
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w))
    .slice(0, 10); // 最多 10 个关键词
}

/** 在 memory/ 目录中搜索（简化版，用于 Hook 注入） */
function searchMemoryDir(
  memoryDir: string,
  keywords: string[],
  maxResults: number,
  minScore: number
): Array<{ file: string; snippet: string; score: number }> {
  if (!fs.existsSync(memoryDir)) return [];

  const results: Array<{ file: string; snippet: string; score: number }> = [];

  const entries = fs.readdirSync(memoryDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const filePath = path.join(memoryDir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const contentLower = content.toLowerCase();
    let matchCount = 0;
    for (const kw of keywords) {
      if (contentLower.includes(kw)) matchCount++;
    }

    if (matchCount === 0) continue;

    const score = matchCount / keywords.length;
    if (score < minScore) continue;

    // 提取第一个匹配行的片段
    const lines = content.split('\n');
    let snippet = '';
    for (const line of lines) {
      const lineLower = line.toLowerCase();
      if (keywords.some((kw) => lineLower.includes(kw))) {
        snippet = line.trim().slice(0, 120);
        break;
      }
    }

    results.push({ file: entry.name, snippet, score });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

/**
 * 从 Agent 输出中提取摘要（首个有意义的段落，截断到 200 字符）
 * 跳过代码块、空行、纯标记行
 */
function extractSummary(output: string): string | null {
  const lines = output.split('\n');
  const meaningful: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const trimmed = line.trim();
    if (!trimmed) {
      if (meaningful.length > 0) break; // 遇到空行结束首段
      continue;
    }

    // 跳过纯 Markdown 格式行
    if (/^[-*]{3,}$/.test(trimmed)) continue; // hr
    if (/^#{1,6}\s/.test(trimmed) && meaningful.length === 0) {
      // 标题行作为摘要起始
      meaningful.push(trimmed.replace(/^#+\s*/, ''));
      continue;
    }

    meaningful.push(trimmed);
  }

  if (meaningful.length === 0) return null;

  const text = meaningful.join(' ').trim();
  if (text.length < MIN_SIGNAL_TEXT_LENGTH) return null;
  return text.length > 200 ? text.slice(0, 200) + '...' : text;
}

/** 检测 Agent 输出中的记忆信号词 */
function detectMemorySignals(output: string): Array<{ text: string; category: string }> {
  const signals: Array<{ text: string; category: string }> = [];
  const seen = new Set<string>();

  // 按句子/段落拆分
  const paragraphs = output.split(/\n{2,}/);

  for (const para of paragraphs) {
    const trimmed = para.trim();

    // 过滤太短/太长
    if (trimmed.length < MIN_SIGNAL_TEXT_LENGTH || trimmed.length > MAX_SIGNAL_TEXT_LENGTH) continue;

    // 过滤代码块
    if (trimmed.startsWith('```') || trimmed.startsWith('    ')) continue;

    // 检查信号词
    for (const { pattern, category } of MEMORY_SIGNAL_PATTERNS) {
      if (pattern.test(trimmed)) {
        // 去重
        const key = trimmed.slice(0, 50);
        if (seen.has(key)) continue;
        seen.add(key);

        signals.push({
          text: trimmed.length > 200 ? trimmed.slice(0, 200) + '...' : trimmed,
          category
        });
        break; // 一个段落只匹配一次
      }
    }

    // 最多 3 条
    if (signals.length >= 3) break;
  }

  return signals;
}
