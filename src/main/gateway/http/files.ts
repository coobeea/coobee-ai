/**
 * Files HTTP 路由
 *
 * 提供文件系统浏览和文件管理能力。
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   GET  /gateway/files/tree?path=<dir>&depth=<n>  — 获取目录树
 *   GET  /gateway/files/content?path=<file>        — 读取文件内容（文本）
 *   POST /gateway/files/upload                     — 上传文件到指定目录
 *   POST /gateway/files/copy                       — 复制文件到指定目录
 *
 * 安全限制：
 *   - path 不能包含 .. 遍历
 *   - 上传/复制限制在 workspaces 目录内
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

/** 支持预览的二进制文件扩展名 */
const PREVIEWABLE_BINARY_EXTS = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.mp4',
  '.webm',
  '.ogg',
  '.mp3',
  '.wav'
];

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

  const CHUNK_SIZE_LINES = 10000; // 每次加载 10000 行
  const SMALL_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB（小于此值一次性加载）

  router.get('/files/content', async (ctx) => {
    const filePath = ctx.query.path as string | undefined;
    const offsetStr = ctx.query.offset as string | undefined;
    const limitStr = ctx.query.limit as string | undefined;

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

      const ext = path.extname(filePath).slice(1).toLowerCase();

      // 可预览的二进制文件：返回 200，content 为空，前端使用 /files/serve 加载
      if (PREVIEWABLE_BINARY_EXTS.includes(ext)) {
        ctx.body = {
          path: filePath,
          name: path.basename(filePath),
          size: stat.size,
          language: 'plaintext',
          content: '',
          chunked: false,
          previewable: true
        };
        return;
      }

      // 其他二进制文件：不支持
      if (isBinaryFile(ext)) {
        ctx.status = 415;
        ctx.body = { error: 'Binary files are not supported for preview' };
        return;
      }

      // 如果指定了 offset/limit，返回分块内容
      if (offsetStr !== undefined || limitStr !== undefined) {
        const offset = parseInt(offsetStr || '0', 10);
        const limit = parseInt(limitStr || String(CHUNK_SIZE_LINES), 10);

        const { content, totalLines, hasMore } = await readFileChunk(filePath, offset, limit);

        ctx.body = {
          path: filePath,
          name: path.basename(filePath),
          size: stat.size,
          language: extToLanguage(ext),
          content,
          chunked: true,
          offset,
          limit,
          totalLines,
          hasMore
        };
        return;
      }

      // 小文件：直接返回全部内容
      if (stat.size < SMALL_FILE_THRESHOLD) {
        const content = await fs.promises.readFile(filePath, 'utf-8');

        ctx.body = {
          path: filePath,
          name: path.basename(filePath),
          size: stat.size,
          language: extToLanguage(ext),
          content,
          chunked: false
        };
        return;
      }

      // 大文件（>= 10MB）：返回前 N 行 + 元信息
      log.info(`[files.content] 大文件分块加载: ${filePath} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);

      const { content, totalLines, hasMore } = await readFileChunk(filePath, 0, CHUNK_SIZE_LINES);

      ctx.body = {
        path: filePath,
        name: path.basename(filePath),
        size: stat.size,
        language: extToLanguage(ext),
        content,
        chunked: true,
        offset: 0,
        limit: CHUNK_SIZE_LINES,
        totalLines,
        hasMore
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

  // ==================== SERVE (Binary) ====================
  // 用于预览二进制文件（PDF、图片、视频等）
  // GET /gateway/files/serve?path=<file>

  const MIME_MAP: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogg: 'video/ogg',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska'
  };

  router.get('/files/serve', async (ctx) => {
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

      const ext = path.extname(filePath).slice(1).toLowerCase();
      if (!PREVIEWABLE_BINARY_EXTS.includes(ext)) {
        ctx.status = 415;
        ctx.body = { error: 'File type not supported for preview' };
        return;
      }

      const mimeType = MIME_MAP[ext] || 'application/octet-stream';
      ctx.type = mimeType;
      ctx.body = fs.createReadStream(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        ctx.status = 404;
        ctx.body = { error: 'File not found' };
        return;
      }
      log.error('[files.serve] Error:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== UPLOAD ====================

  router.post('/files/upload', async (ctx) => {
    const body = ctx.request.body as
      | { fileName?: string; content?: string; targetDir?: string; encoding?: string }
      | undefined;
    const fileName = body?.fileName;
    const content = body?.content;
    const targetDir = body?.targetDir;
    const encoding = body?.encoding || 'base64';

    if (!fileName || !content || !targetDir) {
      ctx.status = 400;
      ctx.body = { error: 'fileName, content, and targetDir are required' };
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
      // 检查目标目录是否存在
      const targetDirStat = await fs.promises.stat(targetDir);
      if (!targetDirStat.isDirectory()) {
        ctx.status = 400;
        ctx.body = { error: 'Target path is not a directory' };
        return;
      }

      const targetPath = path.join(targetDir, fileName);

      // 检查目标文件是否已存在
      const targetExists = await fs.promises
        .stat(targetPath)
        .then(() => true)
        .catch(() => false);

      if (targetExists) {
        ctx.status = 409;
        ctx.body = { error: '目标位置已存在同名文件' };
        return;
      }

      // 写入文件
      const buffer = Buffer.from(content, encoding as BufferEncoding);
      await fs.promises.writeFile(targetPath, buffer);

      log.info(`[files.upload] 上传成功: ${fileName} → ${targetPath} (${buffer.length} bytes)`);

      ctx.body = {
        success: true,
        fileName,
        targetPath,
        size: buffer.length
      };
    } catch (err) {
      log.error('[files.upload] Error:', err);
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
    const appHome = Env.paths.userHome;
    const systemHome = Env.paths.home;

    if (
      !isPathSafe(sourcePath, workspacesDir) &&
      !isPathSafe(sourcePath, appHome) &&
      !isPathSafe(sourcePath, systemHome)
    ) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid source path: must be within workspaces, app data, or user home' };
      return;
    }

    if (!isPathSafe(targetDir, workspacesDir)) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid target directory: directory traversal not allowed' };
      return;
    }

    try {
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

  // ==================== DELETE ====================
  router.post('/files/delete', async (ctx) => {
    const body = ctx.request.body as { path?: string } | undefined;
    const targetPath = body?.path;

    if (!targetPath) {
      ctx.status = 400;
      ctx.body = { error: 'path is required' };
      return;
    }

    const { Env } = await import('@main/common/env');
    const workspacesDir = Env.paths.workspacesDir;

    // 验证路径安全
    if (!isPathSafe(targetPath, workspacesDir)) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid path: directory traversal not allowed' };
      return;
    }

    try {
      // 检查路径是否存在
      const exists = await fs.promises
        .stat(targetPath)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        ctx.status = 404;
        ctx.body = { error: 'Path not found' };
        return;
      }

      // 删除文件或目录（递归）
      await fs.promises.rm(targetPath, { recursive: true, force: true });

      log.info(`[files.delete] 删除成功: ${targetPath}`);

      ctx.body = {
        success: true,
        path: targetPath
      };
    } catch (err) {
      log.error('[files.delete] Error:', err);
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

/**
 * 判断是否是二进制文件（不支持预览）
 */
function isBinaryFile(ext: string): boolean {
  const binaryExts = [
    'exe',
    'dll',
    'so',
    'dylib',
    'bin',
    'dat',
    'db',
    'sqlite',
    'zip',
    'tar',
    'gz',
    'rar',
    '7z',
    'jpg',
    'jpeg',
    'png',
    'gif',
    'bmp',
    'ico',
    'webp',
    'mp4',
    'avi',
    'mov',
    'mp3',
    'wav',
    'pdf',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'ppt',
    'pptx'
  ];
  return binaryExts.includes(ext.toLowerCase());
}

/**
 * 分块读取文件内容（按行）
 *
 * @param filePath 文件路径
 * @param offset 起始行号（0-based）
 * @param limit 读取行数
 * @returns 内容、总行数、是否还有更多
 */
async function readFileChunk(
  filePath: string,
  offset: number,
  limit: number
): Promise<{ content: string; totalLines: number; hasMore: boolean }> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const totalLines = lines.length;

  const start = Math.max(0, offset);
  const end = Math.min(totalLines, start + limit);
  const chunk = lines.slice(start, end).join('\n');

  return {
    content: chunk,
    totalLines,
    hasMore: end < totalLines
  };
}
