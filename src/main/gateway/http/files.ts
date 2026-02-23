/**
 * Files HTTP 路由
 *
 * 提供文件系统浏览能力。
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   GET /gateway/files/tree?path=<dir>&depth=<n>  — 获取目录树
 *   GET /gateway/files/content?path=<file>        — 读取文件内容（文本）
 *
 * 安全限制：
 *   - path 不能包含 .. 遍历
 *   - 只读操作，不修改文件系统
 *   - 限制深度（默认 3 层）和单层数量（最多 200）
 */

import * as fs from 'fs';
import * as path from 'path';
import type Router from '@koa/router';
import { createLogger } from '@main/common/logger';

const log = createLogger('gateway-http-files');

const MAX_DEPTH = 5;
const DEFAULT_DEPTH = 3;
const MAX_CHILDREN_PER_DIR = 200;

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

function isPathSafe(targetPath: string, rootDir?: string): boolean {
  const normalized = path.normalize(targetPath);
  if (normalized.includes('..')) {
    return false;
  }

  if (rootDir) {
    const resolved = path.resolve(targetPath);
    const resolvedRoot = path.resolve(rootDir);
    // 使用 path.relative 避免路径前缀绕过（如 C:\workspace vs C:\workspaces-evil）
    const rel = path.relative(resolvedRoot, resolved);
    // 如果相对路径以 '..' 开头或是绝对路径，说明不在 rootDir 内
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return false;
    }
  }
  return true;
}

async function buildTree(dirPath: string, depth: number, currentDepth: number): Promise<FileTreeNode[]> {
  if (currentDepth >= depth) return [];

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const filtered = entries
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_CHILDREN_PER_DIR);

  const nodes: FileTreeNode[] = [];

  for (const entry of filtered) {
    const fullPath = path.join(dirPath, entry.name);
    const node: FileTreeNode = {
      name: entry.name,
      path: fullPath,
      type: entry.isDirectory() ? 'directory' : 'file'
    };

    if (entry.isDirectory()) {
      node.children = await buildTree(fullPath, depth, currentDepth + 1);
    }

    nodes.push(node);
  }

  return nodes;
}

export function registerFileRoutes(router: Router): void {
  router.get('/files/tree', async (ctx) => {
    const dirPath = ctx.query.path as string | undefined;
    const depthStr = ctx.query.depth as string | undefined;

    if (!dirPath) {
      ctx.status = 400;
      ctx.body = { error: 'path query parameter is required' };
      return;
    }

    const { Env } = await import('@main/common/env');
    const workspacesDir = Env.paths.workspacesDir;

    if (!isPathSafe(dirPath, workspacesDir)) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid path: directory traversal not allowed' };
      return;
    }

    const depth = Math.min(Math.max(parseInt(depthStr || String(DEFAULT_DEPTH), 10), 1), MAX_DEPTH);

    try {
      const stat = await fs.promises.stat(dirPath);
      if (!stat.isDirectory()) {
        ctx.status = 400;
        ctx.body = { error: 'Path is not a directory' };
        return;
      }

      const tree = await buildTree(dirPath, depth, 0);
      ctx.body = {
        root: dirPath,
        depth,
        children: tree
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        ctx.status = 404;
        ctx.body = { error: 'Directory not found' };
        return;
      }
      log.error('[files.tree] Error:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== CONTENT ====================

  const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

  router.get('/files/content', async (ctx) => {
    const filePath = ctx.query.path as string | undefined;

    if (!filePath) {
      ctx.status = 400;
      ctx.body = { error: 'path query parameter is required' };
      return;
    }

    const { Env } = await import('@main/common/env');
    const workspacesDir = Env.paths.workspacesDir;

    if (!isPathSafe(filePath, workspacesDir)) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid path: directory traversal not allowed' };
      return;
    }

    try {
      const stat = await fs.promises.stat(filePath);

      if (stat.isDirectory()) {
        ctx.status = 400;
        ctx.body = { error: 'Path is a directory, not a file' };
        return;
      }

      if (stat.size > MAX_FILE_SIZE) {
        ctx.status = 413;
        ctx.body = { error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max: 2MB` };
        return;
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const ext = path.extname(filePath).slice(1).toLowerCase();

      ctx.body = {
        path: filePath,
        name: path.basename(filePath),
        size: stat.size,
        language: extToLanguage(ext),
        content
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        ctx.status = 404;
        ctx.body = { error: 'File not found' };
        return;
      }
      log.error('[files.content] Error:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== COPY ====================

  router.post('/files/copy', async (ctx) => {
    const body = ctx.request.body as { sourcePath?: string; targetDir?: string } | undefined;
    const sourcePath = body?.sourcePath;
    const targetDir = body?.targetDir;

    if (!sourcePath || !targetDir) {
      ctx.status = 400;
      ctx.body = { error: 'sourcePath and targetDir are required' };
      return;
    }

    const { Env } = await import('@main/common/env');
    const workspacesDir = Env.paths.workspacesDir;

    // 验证路径安全
    if (!isPathSafe(targetDir, workspacesDir)) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid target directory: directory traversal not allowed' };
      return;
    }

    try {
      // 检查源路径是否存在
      const sourceExists = await fs.promises
        .stat(sourcePath)
        .then(() => true)
        .catch(() => false);

      if (!sourceExists) {
        ctx.status = 404;
        ctx.body = { error: 'Source path not found' };
        return;
      }

      // 检查目标目录是否存在
      const targetDirStat = await fs.promises.stat(targetDir);
      if (!targetDirStat.isDirectory()) {
        ctx.status = 400;
        ctx.body = { error: 'Target path is not a directory' };
        return;
      }

      // 获取源文件/目录名
      const sourceName = path.basename(sourcePath);
      const targetPath = path.join(targetDir, sourceName);

      // 检查目标是否已存在
      const targetExists = await fs.promises
        .stat(targetPath)
        .then(() => true)
        .catch(() => false);

      if (targetExists) {
        ctx.status = 409;
        ctx.body = { error: '目标位置已存在同名文件或目录' };
        return;
      }

      // 执行复制
      const sourceStat = await fs.promises.stat(sourcePath);
      if (sourceStat.isDirectory()) {
        await copyDirectory(sourcePath, targetPath);
      } else {
        await fs.promises.copyFile(sourcePath, targetPath);
      }

      log.info(`[files.copy] 复制成功: ${sourcePath} → ${targetPath}`);

      ctx.body = {
        success: true,
        sourcePath,
        targetPath,
        type: sourceStat.isDirectory() ? 'directory' : 'file'
      };
    } catch (err) {
      log.error('[files.copy] Error:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  log.info('[files] HTTP routes registered');
}

/**
 * 递归复制目录
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(dest, { recursive: true });

  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

/** 文件扩展名 → Monaco Editor 语言标识 */
function extToLanguage(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    vue: 'html',
    json: 'json',
    json5: 'json',
    jsonl: 'json',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    svg: 'xml',
    py: 'python',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    sql: 'sql',
    graphql: 'graphql',
    dockerfile: 'dockerfile',
    toml: 'ini',
    ini: 'ini',
    env: 'ini',
    txt: 'plaintext',
    log: 'plaintext'
  };
  return map[ext] || 'plaintext';
}
