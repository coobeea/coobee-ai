/**
 * search — 文件内容搜索工具
 *
 * 在工作空间内搜索文件内容（类似 grep）。
 * 支持正则表达式和文件类型过滤。
 *
 * 安全：
 *   - 搜索范围限制在 workspaceRoot 内（通过 path-guard）
 *   - 结果条数限制，防止 token 爆炸
 *
 * 分类：FileSystem | 风险：低（只读）
 */

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../types';
import { resolveSandboxPath, pathGuardErrorToToolResult } from '../../sandbox';

/** 默认最大匹配数 */
const DEFAULT_MAX_RESULTS = 50;

/** 单个文件最大匹配数 */
const MAX_MATCHES_PER_FILE = 10;

/** 最大扫描文件数（防止超大目录卡死） */
const MAX_FILES_TO_SCAN = 5000;

/** 跳过的目录名 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '__pycache__',
  '.cache',
  '.turbo',
  'coverage',
  '.nyc_output'
]);

/** 二进制文件扩展名（跳过） */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.mkv',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.o',
  '.wasm',
  '.node'
]);

export const searchTool: ToolDefinition = {
  name: 'search',
  description:
    'Search file contents in the workspace using pattern matching (grep-like).\n' +
    'Returns matching lines with file path, line number, and context.\n' +
    'Use this to find code patterns, function definitions, TODOs, etc.',
  category: ToolCategory.Search,
  needUserConfirm: false,
  parameters: z.object({
    pattern: z.string().describe('Search pattern. Supports regex syntax (e.g. "function\\s+\\w+", "TODO|FIXME")'),
    searchPath: z
      .string()
      .optional()
      .describe('Directory or file to search in (relative to workspace). Defaults to workspace root.'),
    glob: z.string().optional().describe('File name filter glob (e.g. "*.ts", "*.{ts,tsx}", "package.json")'),
    caseSensitive: z.boolean().optional().describe('Case-sensitive search. Defaults to false (case-insensitive).'),
    maxResults: z.number().optional().describe(`Maximum total matches to return. Defaults to ${DEFAULT_MAX_RESULTS}`)
  }),

  execute: async function* (
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const workspace = context?.workspaceRoot;
    if (!workspace) {
      return { success: false, llmContent: 'Error: workspace not available.' };
    }

    const pattern = params.pattern as string;
    const searchPath = (params.searchPath as string) || '.';
    const globFilter = params.glob as string | undefined;
    const caseSensitive = (params.caseSensitive as boolean) ?? false;
    const maxResults = Math.min((params.maxResults as number) || DEFAULT_MAX_RESULTS, 200);

    if (!pattern) {
      return {
        success: false,
        llmContent: 'Error: pattern is required.',
        error: { code: 'MISSING_PARAM', message: 'pattern is required' }
      };
    }

    // 解析搜索起点路径（读操作不限制目录边界）
    const resolved = resolveSandboxPath(searchPath, { workspaceRoot: workspace }, { readOnly: true });
    if (resolved.error) return pathGuardErrorToToolResult(resolved.error);

    const startPath = resolved.path;
    if (!fs.existsSync(startPath)) {
      return { success: false, llmContent: `Error: path not found: ${searchPath}` };
    }

    yield { type: 'progress', content: `Searching for "${pattern}"...`, percentage: 0 };

    // 编译正则
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
    } catch (err) {
      return {
        success: false,
        llmContent: `Error: invalid regex pattern "${pattern}": ${err instanceof Error ? err.message : err}`,
        error: { code: 'INVALID_PATTERN', message: 'Invalid regex' }
      };
    }

    // glob 过滤编译
    const globTest = globFilter ? createGlobTest(globFilter) : null;

    // 收集文件
    const files: string[] = [];
    const stat = fs.statSync(startPath);
    if (stat.isFile()) {
      files.push(startPath);
    } else {
      collectFiles(startPath, files, globTest, MAX_FILES_TO_SCAN);
    }

    // 搜索
    const matches: SearchMatch[] = [];
    let filesSearched = 0;

    for (const filePath of files) {
      if (matches.length >= maxResults) break;
      filesSearched++;

      try {
        const content = await fsPromises.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        let fileMatches = 0;

        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= maxResults) break;
          if (fileMatches >= MAX_MATCHES_PER_FILE) break;

          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            const relPath = path.relative(workspace, filePath);
            matches.push({
              file: relPath,
              line: i + 1,
              content: lines[i].length > 200 ? lines[i].slice(0, 200) + '...' : lines[i]
            });
            fileMatches++;
          }
        }
      } catch {
        // 跳过无法读取的文件
      }
    }

    if (matches.length === 0) {
      return {
        success: true,
        llmContent: `No matches found for "${pattern}" in ${filesSearched} files.`
      };
    }

    // 格式化输出
    const output = formatMatches(matches);
    const truncated = matches.length >= maxResults ? ` (truncated at ${maxResults})` : '';

    return {
      success: true,
      llmContent: `Found ${matches.length} matches${truncated} in ${filesSearched} files:\n\n${output}`
    };
  }
};

// ==================== Internal ====================

interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

function formatMatches(matches: SearchMatch[]): string {
  const groups = new Map<string, SearchMatch[]>();
  for (const m of matches) {
    const arr = groups.get(m.file) || [];
    arr.push(m);
    groups.set(m.file, arr);
  }

  const parts: string[] = [];
  for (const [file, fileMatches] of groups) {
    parts.push(`--- ${file} ---`);
    for (const m of fileMatches) {
      parts.push(`  L${m.line}: ${m.content}`);
    }
  }
  return parts.join('\n');
}

/** 递归收集文件 */
function collectFiles(
  dir: string,
  result: string[],
  globTest: ((name: string) => boolean) | null,
  maxFiles: number
): void {
  if (result.length >= maxFiles) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (result.length >= maxFiles) return;

    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      collectFiles(path.join(dir, entry.name), result, globTest, maxFiles);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;
      if (globTest && !globTest(entry.name)) continue;
      result.push(path.join(dir, entry.name));
    }
  }
}

/** 简易 glob 匹配（支持 *.ext 和 *.{ext1,ext2}） */
function createGlobTest(glob: string): (name: string) => boolean {
  // 处理 *.{ts,tsx} 格式
  const braceMatch = glob.match(/^\*\.?\{(.+)\}$/);
  if (braceMatch) {
    const exts = braceMatch[1].split(',').map((e) => '.' + e.trim());
    return (name: string) => exts.some((ext) => name.endsWith(ext));
  }

  // 处理 *.ext 格式
  if (glob.startsWith('*.')) {
    const ext = glob.slice(1); // 包含 "."
    return (name: string) => name.endsWith(ext);
  }

  // 完整文件名匹配
  return (name: string) => name === glob;
}
