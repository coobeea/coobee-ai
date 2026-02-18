/**
 * Files HTTP 路由
 *
 * 提供文件系统浏览能力。
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   GET /gateway/files/tree?path=<dir>&depth=<n>  — 获取目录树
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

function isPathSafe(targetPath: string): boolean {
  const normalized = path.normalize(targetPath);
  return !normalized.includes('..');
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

    if (!isPathSafe(dirPath)) {
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

  log.info('[files] HTTP routes registered');
}
