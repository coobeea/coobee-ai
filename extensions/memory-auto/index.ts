/**
 * memory-auto — 记忆自动化 Extension
 *
 * 两个核心功能：
 *   1. before_agent_start: 从结构化记忆语义检索 + Markdown 兜底，注入到上下文
 *   2. agent_end: 通过结构化记忆管线自动提取 + 信号词检测兜底
 *
 * 架构：优先使用 StructuredMemoryService，
 * 若未初始化则降级到原有 Markdown 文件方式。
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

          // 尝试从结构化记忆系统检索
          const structuredContext = await tryStructuredRetrieve(event.prompt);
          if (structuredContext) {
            blocks.push(`<memory_context>\n${structuredContext}\n</memory_context>`);
          }

          // 降级：读取 MEMORY.md 摘要（结构化系统可能不含所有旧数据）
          if (!structuredContext) {
            const coreMemory = readMemoryMdHead(workspace, MAX_CORE_MEMORY_CHARS);
            if (coreMemory) {
              blocks.push(`<core_memory>\n${coreMemory}\n</core_memory>`);
            }

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
      { priority: 30 }
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

          // 尝试通过结构化记忆管线提取
          const structuredResult = await tryStructuredMemorize(output, event.sessionId);
          if (structuredResult) {
            api.logger.info(`[memory-auto] Structured memorize: ${structuredResult.itemCount} items extracted`);
            // 仍然写入 Markdown 作为可读备份
          }

          // 同时继续 Markdown 记录（保持向后兼容）
          const entries: string[] = [];
          const timestamp = new Date().toISOString().slice(11, 19);

          const signals = detectMemorySignals(output);
          for (const s of signals) {
            entries.push(`- [${timestamp}] (${s.category}) ${s.text}\n`);
          }

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

    // ========== before_compaction: 压缩前记忆落盘 ==========
    // 代码级别的 Memory Flush：在上下文压缩前，从 session 历史中提取
    // 关键记忆并写入 Agent Home，确保重要信息不因压缩而丢失。
    // 通过 Extension Hook 实现而非硬编码在某个 Runtime 中，
    // 使 OpenAI / PiMono 等所有 Runtime 均可受益。
    api.on(
      'before_compaction',
      async (event) => {
        try {
          const agentId = event.agentId;
          if (!agentId) {
            api.logger.debug('[memory-auto] before_compaction: no agentId, skipping flush');
            return;
          }

          const agentHome = await getAgentHome(agentId);
          if (!agentHome) return;

          const workspace = await getWorkspace(event.sessionId);
          if (!workspace) return;

          const sessionContent = readSessionContent(workspace);
          if (!sessionContent || sessionContent.length < MIN_OUTPUT_FOR_MEMORY) return;

          // 提取记忆信号和摘要
          const entries: string[] = [];
          const timestamp = new Date().toISOString().slice(11, 19);

          const signals = detectMemorySignals(sessionContent);
          for (const s of signals) {
            entries.push(`- [${timestamp}] (compaction-flush/${s.category}) ${s.text}\n`);
          }

          if (entries.length === 0 && sessionContent.length >= MIN_OUTPUT_FOR_SUMMARY) {
            const summary = extractSummary(sessionContent);
            if (summary) {
              entries.push(`- [${timestamp}] (compaction-flush/summary) ${summary}\n`);
            }
          }

          if (entries.length === 0) return;

          // 写入 Agent Home 的 memory 目录
          const today = new Date().toISOString().slice(0, 10);
          const memoryDir = path.join(agentHome, 'memory');
          fs.mkdirSync(memoryDir, { recursive: true });
          const memoryFile = path.join(memoryDir, `${today}.md`);

          const exists = fs.existsSync(memoryFile);
          const header = exists ? '' : `# Memory — ${today}\n\n`;

          fs.appendFileSync(memoryFile, header + entries.join(''), 'utf-8');

          api.logger.info(
            `[memory-auto] Pre-compaction flush: ${entries.length} entries → homes/${agentId}/memory/${today}.md`
          );
        } catch (err) {
          api.logger.warn(`[memory-auto] Pre-compaction flush failed: ${err}`);
        }
      },
      { priority: 10 }
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

/** 获取 Agent Home 目录路径 */
async function getAgentHome(agentId: string): Promise<string | null> {
  try {
    const { Env } = await import('../../src/main/common/env');
    return Env.getAgentHomeDir(agentId);
  } catch {
    return null;
  }
}

/**
 * 从 workspace/sessions/ 目录中读取最近的 session 内容
 *
 * 提取 assistant 角色的消息文本，用于记忆信号检测。
 * 仅读取最近 MAX_SESSION_LINES 行以控制内存和处理时间。
 */
function readSessionContent(workspace: string, maxLines = 200): string | null {
  const sessionsDir = path.join(workspace, 'sessions');
  if (!fs.existsSync(sessionsDir)) return null;

  const files = fs
    .readdirSync(sessionsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
    .sort((a, b) => {
      const statA = fs.statSync(path.join(sessionsDir, a.name));
      const statB = fs.statSync(path.join(sessionsDir, b.name));
      return statB.mtimeMs - statA.mtimeMs;
    });

  if (files.length === 0) return null;

  try {
    const content = fs.readFileSync(path.join(sessionsDir, files[0].name), 'utf-8');
    const lines = content.trim().split('\n').slice(-maxLines);
    const texts: string[] = [];

    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        const role = item?.item?.role || item?.role;
        const text = item?.item?.content || item?.content;
        if (role === 'assistant' && typeof text === 'string') {
          texts.push(text);
        }
      } catch {
        // skip malformed lines
      }
    }

    return texts.join('\n\n');
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

// ==================== 结构化记忆集成 ====================

/**
 * 尝试使用结构化记忆系统进行语义检索。
 * 返回格式化的上下文字符串，或 null（系统未初始化时降级）。
 */
async function tryStructuredRetrieve(query: string): Promise<string | null> {
  try {
    const { StructuredMemoryService } = await import('../../src/main/ai/memory/structured/service');
    const svc = StructuredMemoryService.getInstance();
    if (!svc.initialized) return null;

    const result = await svc.retrieve({
      query,
      topK: MAX_RECALL_RESULTS,
      mode: 'salience'
    });

    if (!result.context || result.items.length === 0) return null;
    return result.context;
  } catch {
    return null;
  }
}

interface StructuredMemorizeResult {
  itemCount: number;
}

/**
 * 尝试通过结构化记忆管线提取并存储记忆。
 * 返回提取结果，或 null（系统未初始化或 LLM 不可用时降级）。
 */
async function tryStructuredMemorize(output: string, _sessionId: string): Promise<StructuredMemorizeResult | null> {
  try {
    const { StructuredMemoryService } = await import('../../src/main/ai/memory/structured/service');
    const svc = StructuredMemoryService.getInstance();
    if (!svc.initialized) return null;

    const result = await svc.memorizeContent({
      content: output,
      source: 'agent_end_auto'
    });

    if (!result) return null;
    return { itemCount: result.items.length };
  } catch {
    return null;
  }
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
