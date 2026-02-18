/**
 * glob — 文件名搜索工具
 *
 * 在工作空间内按模式搜索文件名（类似 find + glob）。
 * 返回匹配的文件列表及基本信息。
 *
 * 安全：
 *   - 搜索范围限制在 workspaceRoot 内（通过 path-guard）
 *   - 结果条数限制，防止 token 爆炸
 *
 * 分类：FileSystem | 风险：低（只读）
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../types';
import { resolveSandboxPath, pathGuardErrorToToolResult } from '../../sandbox';
import { checkAborted } from '../pipeline';

/** 默认最大结果数 */
const DEFAULT_MAX_RESULTS = 100;

/** 最大扫描条目数 */
const MAX_ENTRIES = 10000;

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

export const globTool: ToolDefinition = {
  name: 'glob',
  description:
    'Find files by name pattern in the workspace.\n' +
    'Returns matching file paths with size and modification time.\n' +
    'Supports glob patterns: *.ts, **/*.test.ts, package.json, src/**/*.vue',
  category: ToolCategory.FileSystem,
  needUserConfirm: false,
  parameters: z.object({
    pattern: z
      .string()
      .describe('Glob pattern to match file names (e.g. "*.ts", "**/*.test.ts", "package.json", "src/**/*.vue")'),
    searchPath: z
      .string()
      .optional()
      .describe('Base directory to search in (relative to workspace). Defaults to workspace root.'),
    maxResults: z.number().optional().describe(`Maximum results to return. Defaults to ${DEFAULT_MAX_RESULTS}`)
  }),

  execute: async function* (
    params: Record<string, unknown>,
    signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const aborted = checkAborted(signal);
    if (aborted) return aborted;

    const workspace = context?.workspaceRoot;
    if (!workspace) {
      return { success: false, llmContent: 'Error: workspace not available.' };
    }

    const pattern = params.pattern as string;
    const searchPath = (params.searchPath as string) || '.';
    const maxResults = Math.min((params.maxResults as number) || DEFAULT_MAX_RESULTS, 500);

    if (!pattern) {
      return {
        success: false,
        llmContent: 'Error: pattern is required.',
        error: { code: 'MISSING_PARAM', message: 'pattern is required' }
      };
    }

    // 解析搜索起点（读操作不限制目录边界）
    const resolved = resolveSandboxPath(searchPath, { workspaceRoot: workspace }, { readOnly: true });
    if (resolved.error) return pathGuardErrorToToolResult(resolved.error);

    const startPath = resolved.path;
    if (!fs.existsSync(startPath)) {
      return { success: false, llmContent: `Error: path not found: ${searchPath}` };
    }

    yield { type: 'progress', content: `Finding files matching "${pattern}"...`, percentage: 0 };

    // 编译 glob 模式为匹配函数
    const matcher = compileGlobPattern(pattern);

    // 收集匹配文件
    const matches: GlobMatch[] = [];
    walkDirectory(startPath, workspace, matcher, matches, maxResults, MAX_ENTRIES);

    if (matches.length === 0) {
      return {
        success: true,
        llmContent: `No files found matching "${pattern}".`
      };
    }

    // 按路径排序
    matches.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    // 格式化输出
    const lines = matches.map((m) => {
      const sizeStr = formatFileSize(m.size);
      const timeStr = new Date(m.modifiedAt).toISOString().slice(0, 19);
      return `${m.relativePath}  (${sizeStr}, ${timeStr})`;
    });

    const truncated = matches.length >= maxResults ? ` (truncated at ${maxResults})` : '';

    return {
      success: true,
      llmContent: `Found ${matches.length} files matching "${pattern}"${truncated}:\n\n` + lines.join('\n')
    };
  }
};

// ==================== Internal ====================

interface GlobMatch {
  relativePath: string;
  size: number;
  modifiedAt: number;
}

/** 递归遍历目录 */
function walkDirectory(
  dir: string,
  workspace: string,
  matcher: (relPath: string) => boolean,
  results: GlobMatch[],
  maxResults: number,
  maxEntries: number,
  entriesScanned = { count: 0 }
): void {
  if (results.length >= maxResults || entriesScanned.count >= maxEntries) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults || entriesScanned.count >= maxEntries) return;
    entriesScanned.count++;

    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(workspace, fullPath);

    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      walkDirectory(fullPath, workspace, matcher, results, maxResults, maxEntries, entriesScanned);
    } else if (entry.isFile()) {
      if (matcher(relPath)) {
        try {
          const stat = fs.statSync(fullPath);
          results.push({
            relativePath: relPath,
            size: stat.size,
            modifiedAt: stat.mtimeMs
          });
        } catch {
          // 跳过无法访问的文件
        }
      }
    }
  }
}

/**
 * 编译 glob 模式为匹配函数
 *
 * 支持的模式：
 *   - *.ts         → 匹配任意 .ts 文件（任何目录深度）
 *   - **\/*.test.ts → 匹配任意深度的 .test.ts 文件
 *   - src/*.vue    → 匹配 src/ 直接子目录下的 .vue 文件
 *   - package.json → 精确匹配文件名
 */
function compileGlobPattern(pattern: string): (relPath: string) => boolean {
  // 简单精确文件名匹配（如 "package.json"）
  if (!pattern.includes('*') && !pattern.includes('?')) {
    return (relPath) => {
      const name = path.basename(relPath);
      return name === pattern || relPath === pattern;
    };
  }

  // 纯扩展名匹配（*.ext）— 匹配任意深度
  if (pattern.startsWith('*.') && !pattern.includes('/') && !pattern.includes('**')) {
    const ext = pattern.slice(1);
    return (relPath) => relPath.endsWith(ext);
  }

  // 通用 glob 转正则
  const regexStr = globToRegex(pattern);
  try {
    const regex = new RegExp(regexStr, 'i');
    return (relPath) => regex.test(relPath);
  } catch {
    // 转换失败，降级到简单名称包含匹配
    const stripped = pattern.replace(/[*?]/g, '');
    return (relPath) => relPath.includes(stripped);
  }
}

/** 将 glob 模式转为正则表达式字符串 */
function globToRegex(glob: string): string {
  let result = '^';
  let i = 0;

  while (i < glob.length) {
    const c = glob[i];

    if (c === '*') {
      if (glob[i + 1] === '*') {
        // **/ → 匹配任意深度的目录
        if (glob[i + 2] === '/') {
          result += '(?:.*/)?';
          i += 3;
        } else {
          result += '.*';
          i += 2;
        }
      } else {
        // * → 匹配除 / 外的任意字符
        result += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      result += '[^/]';
      i++;
    } else if (c === '.') {
      result += '\\.';
      i++;
    } else if (c === '{') {
      // {a,b} → (a|b)
      const end = glob.indexOf('}', i);
      if (end > i) {
        const alternatives = glob
          .slice(i + 1, end)
          .split(',')
          .map((s) => s.trim());
        result += '(' + alternatives.map(escapeRegex).join('|') + ')';
        i = end + 1;
      } else {
        result += '\\{';
        i++;
      }
    } else {
      result += escapeRegex(c);
      i++;
    }
  }

  result += '$';
  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
