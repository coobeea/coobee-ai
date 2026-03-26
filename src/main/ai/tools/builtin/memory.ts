/**
 * memory — 记忆管理工具
 *
 * 让 Agent 搜索和管理自己的记忆（跨 Agent 级和会话级）。
 *
 * 存储结构：
 *   Agent 级（永久）：homes/{agentId}/memory/  — 由 memory-agent 扩展自动分类
 *   Session 级（随会话）：{workspace}/memory/   — 由 memory-thread 扩展自动写入
 *
 * scope:
 *   - "agent"   — 操作 Agent 级记忆（homes/{agentId}/memory/）
 *   - "session" — 操作 Session 级记忆（{workspace}/memory/）
 *   - 不指定    — search/list 同时搜两层，write 默认写 session
 *
 * 操作：
 *   - list:   列出可用记忆文件
 *   - get:    读取指定记忆文件内容
 *   - write:  写入/更新记忆文件（仅 session 级）
 *   - search: 搜索记忆内容（多关键字、评分、片段提取）
 *
 * 分类：Memory | 风险：低
 *
 * @module tools/builtin/memory
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../types';
import { log } from '@main/common/logger';
import { resolveSandboxPath } from '../../sandbox';

const MEMORY_EXTENSIONS = ['.md', '.json', '.txt', '.yaml', '.yml'];
const MAX_FILE_SIZE = 100_000;
const MAX_SNIPPETS_PER_FILE = 5;
const SNIPPET_CONTEXT_LINES = 2;
const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_MIN_SCORE = 0.1;

// ==================== 工具定义 ====================

export const memoryTool: ToolDefinition = {
  name: 'memory',
  description:
    'Search and manage Agent memory across two tiers.\n\n' +
    'Tiers:\n' +
    '- agent: persistent memory in homes/{agentId}/memory/ (auto-classified by memory-agent extension)\n' +
    '- session: current session memory in {workspace}/memory/ (auto-written by memory-thread extension)\n\n' +
    'Actions:\n' +
    '- list: list memory files\n' +
    '- get: read a memory file\n' +
    '- write: create/update a memory file (session scope only)\n' +
    '- search: search memory by keywords (multi-keyword, ranked results)\n\n' +
    'When scope is omitted, search/list scan both tiers. Write defaults to session.\n' +
    'Results are tagged with [agent] or [session] to indicate their source.',
  category: ToolCategory.Memory,
  needUserConfirm: false,
  parameters: z.object({
    action: z.enum(['list', 'get', 'write', 'search']).describe('The action to perform'),
    scope: z
      .enum(['agent', 'session'])
      .optional()
      .describe('Memory tier. "agent" = persistent cross-session, "session" = current workspace. Omit to search both.'),
    file: z
      .string()
      .optional()
      .describe('File name or relative path within the memory directory. For get/write actions.'),
    content: z.string().optional().describe('Content to write (for write action, Markdown recommended)'),
    append: z.boolean().optional().describe('If true, append content instead of overwriting (for write action)'),
    query: z
      .string()
      .optional()
      .describe('Search query — supports multiple keywords separated by spaces (for search action)'),
    maxResults: z.number().optional().describe('Maximum search results to return (default 10)')
  }),

  execute: async function* (
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const action = params.action as string;
    const scope = params.scope as 'agent' | 'session' | undefined;
    const file = params.file as string | undefined;
    const content = params.content as string | undefined;
    const append = params.append as boolean | undefined;
    const query = params.query as string | undefined;
    const maxResults = (params.maxResults as number) || DEFAULT_MAX_RESULTS;

    const roots = resolveMemoryRoots(context);
    if (!roots.agentMemoryDir && !roots.sessionMemoryDir) {
      return {
        success: false,
        llmContent: 'Error: Memory system not initialized (no workspace or agent home available)',
        error: { code: 'NOT_INITIALIZED', message: 'Cannot resolve memory paths' }
      };
    }

    // ==================== list ====================
    if (action === 'list') {
      yield { type: 'progress', content: 'Listing memory files...', percentage: 0 };

      const files = collectAllMemoryFiles(roots, scope);

      if (files.length === 0) {
        return {
          success: true,
          llmContent:
            `No memory files found${scope ? ` in ${scope} scope` : ''}.\n\n` +
            'Tip: Memory files are auto-created by memory-agent and memory-thread extensions during conversations.'
        };
      }

      const lines = files.map((f) => {
        const sizeKB = (f.size / 1024).toFixed(1);
        const modified = new Date(f.modifiedAt).toISOString().slice(0, 19);
        return `[${f.tier}] ${f.displayPath}  (${sizeKB}KB, ${modified})`;
      });

      return {
        success: true,
        llmContent:
          `Memory files (${files.length} files):\n` +
          `[agent] = persistent cross-session, [session] = current workspace\n\n` +
          lines.join('\n')
      };
    }

    // ==================== get ====================
    if (action === 'get') {
      if (!file) {
        return {
          success: false,
          llmContent: 'Error: file is required for get action.',
          error: { code: 'MISSING_PARAM', message: 'file is required' }
        };
      }

      const effectiveScope = scope || 'session';
      const memDir = effectiveScope === 'agent' ? roots.agentMemoryDir : roots.sessionMemoryDir;
      if (!memDir) {
        return {
          success: false,
          llmContent: `Error: ${effectiveScope} memory is not available (missing ${effectiveScope === 'agent' ? 'agentId/userHome' : 'workspace'})`,
          error: { code: 'NOT_AVAILABLE', message: `${effectiveScope} memory not available` }
        };
      }

      const filePath = resolveFileSafe(memDir, file);
      if (!filePath) {
        return {
          success: false,
          llmContent: `Error: invalid file path "${file}" — path escapes memory directory`,
          error: { code: 'INVALID_PATH', message: 'Path escapes memory directory' }
        };
      }

      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          llmContent: `Memory file not found: ${file} (in ${effectiveScope} scope)`,
          error: { code: 'NOT_FOUND', message: `File not found: ${file}` }
        };
      }

      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_SIZE) {
        return {
          success: false,
          llmContent: `Memory file too large: ${file} (${(stat.size / 1024).toFixed(1)}KB, max ${MAX_FILE_SIZE / 1024}KB)`,
          error: { code: 'TOO_LARGE', message: `File exceeds ${MAX_FILE_SIZE} bytes` }
        };
      }

      const fileContent = fs.readFileSync(filePath, 'utf-8');
      return {
        success: true,
        llmContent: `[${effectiveScope}/${file}]\n\n${fileContent}`
      };
    }

    // ==================== write ====================
    if (action === 'write') {
      if (scope === 'agent') {
        return {
          success: false,
          llmContent:
            'Error: Agent-level memory is managed by the memory-agent extension automatically.\n' +
            'Use scope="session" (or omit scope) to write session-level memory.',
          error: { code: 'READONLY_SCOPE', message: 'Agent memory is auto-managed' }
        };
      }

      if (!file) {
        return {
          success: false,
          llmContent: 'Error: file is required for write action.',
          error: { code: 'MISSING_PARAM', message: 'file is required' }
        };
      }
      if (content === undefined || content === null) {
        return {
          success: false,
          llmContent: 'Error: content is required for write action',
          error: { code: 'MISSING_PARAM', message: 'content is required' }
        };
      }

      const memDir = roots.sessionMemoryDir;
      if (!memDir) {
        return {
          success: false,
          llmContent: 'Error: session memory is not available (no workspace)',
          error: { code: 'NOT_AVAILABLE', message: 'Session memory not available' }
        };
      }

      const filePath = resolveFileSafe(memDir, file, true);
      if (!filePath) {
        return {
          success: false,
          llmContent: `Error: invalid file path "${file}" — path escapes memory directory`,
          error: { code: 'INVALID_PATH', message: 'Path escapes memory directory' }
        };
      }

      yield { type: 'progress', content: `Writing to session/${file}...`, percentage: 50 };

      const exists = fs.existsSync(filePath);

      if (append && exists) {
        const existing = fs.readFileSync(filePath, 'utf-8');
        const separator = existing.endsWith('\n') ? '\n' : '\n\n';
        fs.writeFileSync(filePath, existing + separator + content, 'utf-8');
        log.info(`[memory] Appended: session/${file}`);
        return {
          success: true,
          llmContent: `Memory file appended: session/${file}`
        };
      }

      let finalContent = content;
      if (file.endsWith('.md') && !content.startsWith('---')) {
        const now = new Date().toISOString();
        finalContent = `---\nupdated: ${now}\n---\n\n${content}`;
      }

      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, finalContent, 'utf-8');

      log.info(`[memory] ${exists ? 'Updated' : 'Created'}: session/${file}`);

      return {
        success: true,
        llmContent: `Memory file ${exists ? 'updated' : 'created'}: session/${file} (${finalContent.length} bytes)`
      };
    }

    // ==================== search ====================
    if (action === 'search') {
      if (!query) {
        return {
          success: false,
          llmContent: 'Error: query is required for search action',
          error: { code: 'MISSING_PARAM', message: 'query is required' }
        };
      }

      yield {
        type: 'progress',
        content: `Searching memory for "${query}"...`,
        percentage: 0
      };

      const results = searchAllMemoryFiles(roots, scope, query, {
        maxResults,
        minScore: DEFAULT_MIN_SCORE
      });

      if (results.length === 0) {
        return {
          success: true,
          llmContent: `No matches found for "${query}"${scope ? ` in ${scope} memory` : ''}.`
        };
      }

      const output = results
        .map((r) => {
          const scoreStr = (r.score * 100).toFixed(0);
          const sectionStr = r.section ? ` (§ ${r.section})` : '';
          return `[${r.tier}] ${r.file}${sectionStr} [relevance: ${scoreStr}%]\n${r.snippet}`;
        })
        .join('\n\n');

      return {
        success: true,
        llmContent: `Search results for "${query}" (${results.length} matches):\n\n${output}`
      };
    }

    return {
      success: false,
      llmContent: `Unknown action: "${action}". Valid actions: list, get, write, search`,
      error: { code: 'UNKNOWN_ACTION', message: `Unknown action: ${action}` }
    };
  }
};

// ==================== 路径解析 ====================

interface MemoryRoots {
  agentMemoryDir?: string;
  sessionMemoryDir?: string;
}

function resolveMemoryRoots(context?: ToolExecutionContext): MemoryRoots {
  const roots: MemoryRoots = {};

  if (context?.workspaceRoot) {
    roots.sessionMemoryDir = path.join(context.workspaceRoot, 'memory');
    fs.mkdirSync(roots.sessionMemoryDir, { recursive: true });
  }

  if (context?.agentId && context?.userHome) {
    const agentDir = path.join(context.userHome, 'homes', context.agentId, 'memory');
    if (fs.existsSync(agentDir)) {
      roots.agentMemoryDir = agentDir;
    }
  }

  return roots;
}

function resolveFileSafe(memDir: string, file: string, forWrite = false): string | null {
  const result = resolveSandboxPath(file, { workspaceRoot: memDir });
  if (result.error) {
    log.warn(`[memory] Path guard blocked: "${file}" — ${result.error.message}`);
    return null;
  }

  const target = path.join(memDir, file);
  if (forWrite) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  return target;
}

// ==================== 文件列举 ====================

interface MemoryFileInfo {
  displayPath: string;
  absolutePath: string;
  size: number;
  modifiedAt: number;
  tier: 'agent' | 'session';
}

function collectAllMemoryFiles(roots: MemoryRoots, scope?: 'agent' | 'session'): MemoryFileInfo[] {
  const results: MemoryFileInfo[] = [];

  if ((!scope || scope === 'agent') && roots.agentMemoryDir) {
    for (const f of listMemoryFilesRecursive(roots.agentMemoryDir)) {
      results.push({ ...f, displayPath: f.relativePath, tier: 'agent' });
    }
  }

  if ((!scope || scope === 'session') && roots.sessionMemoryDir) {
    for (const f of listMemoryFilesRecursive(roots.sessionMemoryDir)) {
      results.push({ ...f, displayPath: f.relativePath, tier: 'session' });
    }
  }

  return results.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

interface InternalFileInfo {
  relativePath: string;
  absolutePath: string;
  size: number;
  modifiedAt: number;
}

function listMemoryFilesRecursive(dir: string, prefix = ''): InternalFileInfo[] {
  const results: InternalFileInfo[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      results.push(...listMemoryFilesRecursive(fullPath, relativePath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (MEMORY_EXTENSIONS.includes(ext)) {
        const stat = fs.statSync(fullPath);
        results.push({ relativePath, absolutePath: fullPath, size: stat.size, modifiedAt: stat.mtimeMs });
      }
    }
  }

  return results;
}

// ==================== 搜索 ====================

export interface MemorySearchResult {
  file: string;
  score: number;
  snippet: string;
  section?: string;
  tier: 'agent' | 'session';
}

interface SearchOptions {
  maxResults?: number;
  minScore?: number;
}

function searchAllMemoryFiles(
  roots: MemoryRoots,
  scope: 'agent' | 'session' | undefined,
  query: string,
  options?: SearchOptions
): MemorySearchResult[] {
  const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;
  const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;

  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((k) => k.length > 0);
  if (keywords.length === 0) return [];

  const files = collectAllMemoryFiles(roots, scope);
  const results: MemorySearchResult[] = [];

  for (const fileInfo of files) {
    if (fileInfo.size > MAX_FILE_SIZE) continue;

    let content: string;
    try {
      content = fs.readFileSync(fileInfo.absolutePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    const totalWords = content.toLowerCase().split(/\s+/).length || 1;

    let weightedScore = 0;
    let matchCount = 0;
    const matchedLineIndices: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase();
      let lineMatchCount = 0;

      for (const kw of keywords) {
        if (lineLower.includes(kw)) {
          lineMatchCount++;
        }
      }

      if (lineMatchCount > 0) {
        matchCount += lineMatchCount;
        matchedLineIndices.push(i);
        if (lines[i].startsWith('#')) {
          weightedScore += lineMatchCount * 2;
        } else {
          weightedScore += lineMatchCount;
        }
      }
    }

    if (matchCount === 0) continue;

    let score = Math.min(1, (weightedScore / keywords.length) * (1 / Math.log2(totalWords + 2)));
    score = Math.min(1, score);

    if (score < minScore) continue;

    const snippets: string[] = [];
    const usedLines = new Set<number>();

    for (let idx = 0; idx < matchedLineIndices.length && snippets.length < MAX_SNIPPETS_PER_FILE; idx++) {
      const lineIdx = matchedLineIndices[idx];
      if (usedLines.has(lineIdx)) continue;

      const start = Math.max(0, lineIdx - SNIPPET_CONTEXT_LINES);
      const end = Math.min(lines.length - 1, lineIdx + SNIPPET_CONTEXT_LINES);

      const snippetLines: string[] = [];
      for (let j = start; j <= end; j++) {
        usedLines.add(j);
        const prefix = j === lineIdx ? '> ' : '  ';
        snippetLines.push(`${prefix}L${j + 1}: ${lines[j]}`);
      }
      snippets.push(snippetLines.join('\n'));
    }

    const section = findSection(lines, matchedLineIndices[0]);

    results.push({
      file: fileInfo.displayPath,
      score,
      snippet: snippets.join('\n  ---\n'),
      section,
      tier: fileInfo.tier
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

function findSection(lines: string[], lineIndex: number): string | undefined {
  for (let i = lineIndex; i >= 0; i--) {
    const match = lines[i].match(/^#{1,3}\s+(.+)/);
    if (match) return match[1].trim();
  }
  return undefined;
}
