/**
 * 记忆索引层
 *
 * 为记忆文件提供轻量元数据索引，加速搜索和列表操作。
 * 索引存储在 `.memory-index.json` 文件中，与记忆文件同目录。
 *
 * 设计原则：
 *   - 文件是 source of truth，索引只是缓存
 *   - 索引过期或损坏时自动重建
 *   - 不引入额外依赖（纯文件 I/O）
 *
 * 索引结构：
 *   {workspace}/memory/.memory-index.json
 *   {userHome}/memory/.memory-index.json
 *
 * @module tools/builtin/memory-index
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '@main/common/logger';

// ==================== Types ====================

/** 单条记忆索引条目 */
export interface MemoryIndexEntry {
  /** 相对于 memory 目录的文件路径 */
  file: string;
  /** 标题（首个 # 标题行，或文件名） */
  title: string;
  /** 自动提取的标签（从标题和内容提取） */
  tags: string[];
  /** 摘要（首段文本，最多 200 字符） */
  summary: string;
  /** 最后修改时间（ISO 格式） */
  updatedAt: string;
  /** 文件大小（字节） */
  size: number;
}

/** 完整索引文件结构 */
export interface MemoryIndexFile {
  /** 索引格式版本 */
  version: 1;
  /** 索引最后更新时间 */
  lastUpdated: string;
  /** 索引条目 */
  entries: MemoryIndexEntry[];
}

/** 索引文件名 */
const INDEX_FILENAME = '.memory-index.json';

/** 支持的记忆文件扩展名 */
const MEMORY_EXTENSIONS = new Set(['.md', '.json', '.txt', '.yaml', '.yml']);

/** 摘要最大字符数 */
const MAX_SUMMARY_LENGTH = 200;

// ==================== Core API ====================

/**
 * 获取或构建记忆索引
 *
 * 如果索引文件存在且未过期，直接返回。
 * 否则扫描目录重建索引。
 *
 * @param memoryDir 记忆目录的绝对路径（如 {workspace}/memory/）
 * @returns 索引条目列表
 */
export function getOrBuildIndex(memoryDir: string): MemoryIndexEntry[] {
  const indexPath = path.join(memoryDir, INDEX_FILENAME);

  // 尝试读取已有索引
  const existing = readIndex(indexPath);
  if (existing && !isIndexStale(existing, memoryDir)) {
    return existing.entries;
  }

  // 重建索引
  return rebuildIndex(memoryDir);
}

/**
 * 重建记忆索引
 *
 * 扫描目录中的所有记忆文件，提取元数据并写入索引。
 *
 * @param memoryDir 记忆目录的绝对路径
 * @returns 索引条目列表
 */
export function rebuildIndex(memoryDir: string): MemoryIndexEntry[] {
  if (!fs.existsSync(memoryDir)) {
    return [];
  }

  const entries: MemoryIndexEntry[] = [];

  try {
    const files = fs.readdirSync(memoryDir);
    for (const file of files) {
      if (file.startsWith('.')) continue;
      const ext = path.extname(file).toLowerCase();
      if (!MEMORY_EXTENSIONS.has(ext)) continue;

      const filePath = path.join(memoryDir, file);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;

      const entry = buildEntry(file, filePath, stat);
      entries.push(entry);
    }

    // 写入索引文件
    const index: MemoryIndexFile = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      entries
    };

    const indexPath = path.join(memoryDir, INDEX_FILENAME);
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
    log.info(`[MemoryIndex] Built index: ${entries.length} entries in ${memoryDir}`);
  } catch (err) {
    log.warn(`[MemoryIndex] Failed to build index for ${memoryDir}:`, err);
  }

  return entries;
}

/**
 * 更新单个文件的索引条目
 *
 * 在记忆文件写入后调用，增量更新索引。
 *
 * @param memoryDir 记忆目录
 * @param file 文件名（相对于 memoryDir）
 */
export function updateIndexEntry(memoryDir: string, file: string): void {
  const indexPath = path.join(memoryDir, INDEX_FILENAME);
  const filePath = path.join(memoryDir, file);

  // 读取现有索引
  const index = readIndex(indexPath) || {
    version: 1 as const,
    lastUpdated: new Date().toISOString(),
    entries: [] as MemoryIndexEntry[]
  };

  try {
    const stat = fs.statSync(filePath);
    const entry = buildEntry(file, filePath, stat);

    // 替换或新增
    const existingIdx = index.entries.findIndex((e) => e.file === file);
    if (existingIdx >= 0) {
      index.entries[existingIdx] = entry;
    } else {
      index.entries.push(entry);
    }

    index.lastUpdated = new Date().toISOString();
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  } catch (err) {
    log.warn(`[MemoryIndex] Failed to update entry for ${file}:`, err);
  }
}

/**
 * 从索引中搜索记忆
 *
 * 使用标题、标签、摘要进行轻量匹配。
 * 返回评分排序的条目列表。
 *
 * @param entries 索引条目
 * @param keywords 搜索关键字
 * @returns 匹配的条目（按评分降序）
 */
export function searchIndex(
  entries: MemoryIndexEntry[],
  keywords: string[]
): Array<MemoryIndexEntry & { score: number }> {
  if (keywords.length === 0) return [];

  const lowerKeywords = keywords.map((k) => k.toLowerCase());

  return entries
    .map((entry) => {
      let score = 0;
      const titleLower = entry.title.toLowerCase();
      const summaryLower = entry.summary.toLowerCase();
      const tagsLower = entry.tags.map((t) => t.toLowerCase());

      for (const kw of lowerKeywords) {
        // 标题匹配权重最高
        if (titleLower.includes(kw)) score += 3;
        // 标签匹配
        if (tagsLower.some((t) => t.includes(kw))) score += 2;
        // 摘要匹配
        if (summaryLower.includes(kw)) score += 1;
      }

      return { ...entry, score };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ==================== Internal ====================

/** 读取索引文件 */
function readIndex(indexPath: string): MemoryIndexFile | null {
  try {
    if (!fs.existsSync(indexPath)) return null;
    const content = fs.readFileSync(indexPath, 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed.version !== 1) return null;
    return parsed as MemoryIndexFile;
  } catch {
    return null;
  }
}

/** 检查索引是否过期（任何文件的修改时间晚于索引时间） */
function isIndexStale(index: MemoryIndexFile, memoryDir: string): boolean {
  const indexTime = new Date(index.lastUpdated).getTime();
  if (isNaN(indexTime)) return true;

  try {
    const files = fs.readdirSync(memoryDir);
    for (const file of files) {
      if (file.startsWith('.')) continue;
      const ext = path.extname(file).toLowerCase();
      if (!MEMORY_EXTENSIONS.has(ext)) continue;

      const stat = fs.statSync(path.join(memoryDir, file));
      if (stat.mtimeMs > indexTime) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/** 构建单个文件的索引条目 */
function buildEntry(file: string, filePath: string, stat: fs.Stats): MemoryIndexEntry {
  let title = path.basename(file, path.extname(file));
  let summary = '';
  let tags: string[] = [];

  try {
    // 只读取前 4KB 用于提取元数据
    const content = readHead(filePath, 4096);

    // 提取标题（首个 # 标题行）
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      title = titleMatch[1].trim();
    }

    // 提取摘要（首个非标题非空行开始的段落）
    const lines = content.split('\n');
    const summaryLines: string[] = [];
    let inContent = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!inContent) {
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
          inContent = true;
          summaryLines.push(trimmed);
        }
      } else {
        if (!trimmed) break;
        summaryLines.push(trimmed);
      }
    }
    summary = summaryLines.join(' ').slice(0, MAX_SUMMARY_LENGTH);

    // 提取标签（从标题和内容中提取关键词）
    tags = extractTags(title, content);
  } catch {
    // 无法读取文件，使用默认值
  }

  return {
    file,
    title,
    tags,
    summary,
    updatedAt: stat.mtime.toISOString(),
    size: stat.size
  };
}

/** 读取文件头部 */
function readHead(filePath: string, bytes: number): string {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const bytesRead = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.toString('utf-8', 0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

/** 从内容中提取标签 */
function extractTags(title: string, content: string): string[] {
  const tags = new Set<string>();

  // YAML frontmatter tags
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const tagLine = fmMatch[1].match(/^tags:\s*\[([^\]]*)\]/m);
    if (tagLine) {
      tagLine[1].split(',').forEach((t) => {
        const trimmed = t.trim().replace(/^['"]|['"]$/g, '');
        if (trimmed) tags.add(trimmed);
      });
    }
  }

  // 从标题提取关键词
  title
    .split(/[\s,./\\-]+/)
    .filter((w) => w.length >= 2)
    .forEach((w) => tags.add(w.toLowerCase()));

  return [...tags].slice(0, 10);
}
