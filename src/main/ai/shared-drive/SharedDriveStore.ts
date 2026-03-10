/**
 * SharedDriveStore - 多智能体共享网盘存储
 *
 * 提供跨智能体的共享文件存储，支持按规范组织数据：
 *   agentId / date / topic 三级目录结构
 *   index.jsonl 全局索引用于快速查询
 *
 * 存储结构：
 *   .home/shared-drive/
 *   ├── index.jsonl              全局索引
 *   ├── {agentId}/
 *   │   └── {date}/{topic}/
 *   │       ├── README.md        条目说明
 *   │       └── ...              数据文件
 *   └── _shared/                 公共区域
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '@main/common/logger';
import { nanoid } from 'nanoid';

const log = createLogger('shared-drive');

// ==================== 类型定义 ====================

export interface SharedDriveEntry {
  /** 条目唯一 ID */
  id: string;
  /** 写入者的智能体 ID */
  agentId: string;
  /** 主题（英文连字符命名） */
  topic: string;
  /** 日期（YYYY-MM-DD） */
  date: string;
  /** 相对路径（agentId/date/topic） */
  path: string;
  /** 标签 */
  tags: string[];
  /** 摘要 */
  summary: string;
  /** 文件列表（相对于条目目录） */
  files: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateEntryOptions {
  agentId: string;
  topic: string;
  content: string;
  tags?: string[];
  summary?: string;
  /** 自定义日期（默认当天） */
  date?: string;
}

export interface ListOptions {
  agentId?: string;
  date?: string;
  keyword?: string;
  limit?: number;
  offset?: number;
}

// ==================== Store ====================

export class SharedDriveStore {
  private static instance: SharedDriveStore | null = null;
  private driveDir!: string;

  static async getInstance(): Promise<SharedDriveStore> {
    if (!SharedDriveStore.instance) {
      const { Env } = await import('@main/common/env');
      const store = new SharedDriveStore();
      store.driveDir = Env.paths.sharedDriveDir;
      SharedDriveStore.instance = store;
    }
    return SharedDriveStore.instance;
  }

  /** 仅供测试注入 */
  static createForTest(driveDir: string): SharedDriveStore {
    const store = new SharedDriveStore();
    store.driveDir = driveDir;
    return store;
  }

  static resetInstance(): void {
    SharedDriveStore.instance = null;
  }

  // ==================== 路径 ====================

  private get indexPath(): string {
    return path.join(this.driveDir, 'index.jsonl');
  }

  private entryDir(agentId: string, date: string, topic: string): string {
    return path.join(this.driveDir, agentId, date, topic);
  }

  private entryDirById(relativePath: string): string {
    return path.join(this.driveDir, relativePath);
  }

  private async ensureDir(dirPath: string): Promise<void> {
    await fs.promises.mkdir(dirPath, { recursive: true });
  }

  // ==================== 索引读写 ====================

  async readIndex(): Promise<SharedDriveEntry[]> {
    try {
      const content = await fs.promises.readFile(this.indexPath, 'utf-8');
      const lines = content
        .trim()
        .split('\n')
        .filter((line) => line.trim());
      return lines.map((line) => JSON.parse(line) as SharedDriveEntry);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  private async writeIndex(entries: SharedDriveEntry[]): Promise<void> {
    await this.ensureDir(this.driveDir);
    const lines = entries.map((e) => JSON.stringify(e)).join('\n');
    await fs.promises.writeFile(this.indexPath, lines + (entries.length > 0 ? '\n' : ''), 'utf-8');
  }

  private async appendToIndex(entry: SharedDriveEntry): Promise<void> {
    await this.ensureDir(this.driveDir);
    const line = JSON.stringify(entry) + '\n';
    await fs.promises.appendFile(this.indexPath, line, 'utf-8');
  }

  // ==================== CRUD ====================

  async createEntry(opts: CreateEntryOptions): Promise<SharedDriveEntry> {
    const date = opts.date || new Date().toISOString().slice(0, 10);
    const topic = this.sanitizeTopic(opts.topic);
    const dir = this.entryDir(opts.agentId, date, topic);
    await this.ensureDir(dir);

    // 写入 README.md
    const readme = this.buildReadme(opts, date);
    await fs.promises.writeFile(path.join(dir, 'README.md'), readme, 'utf-8');

    // 如果 content 不是纯 README，写入主内容文件
    if (opts.content && opts.content.length > 0) {
      await fs.promises.writeFile(path.join(dir, 'content.md'), opts.content, 'utf-8');
    }

    const files = await this.listFiles(dir);
    const relativePath = `${opts.agentId}/${date}/${topic}`;

    const entry: SharedDriveEntry = {
      id: nanoid(12),
      agentId: opts.agentId,
      topic,
      date,
      path: relativePath,
      tags: opts.tags || [],
      summary: opts.summary || opts.content.substring(0, 200),
      files,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.appendToIndex(entry);
    log.info(`[SharedDrive] Created entry: ${relativePath} (id=${entry.id})`);
    return entry;
  }

  async getEntry(entryId: string): Promise<{ entry: SharedDriveEntry; readme: string; files: string[] } | null> {
    const entries = await this.readIndex();
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return null;

    const dir = this.entryDirById(entry.path);
    let readme = '';
    try {
      readme = await fs.promises.readFile(path.join(dir, 'README.md'), 'utf-8');
    } catch {
      // README 可能不存在
    }

    const files = await this.listFiles(dir);
    return { entry: { ...entry, files }, readme, files };
  }

  async updateEntry(
    entryId: string,
    updates: { content?: string; tags?: string[]; summary?: string }
  ): Promise<SharedDriveEntry | null> {
    const entries = await this.readIndex();
    const idx = entries.findIndex((e) => e.id === entryId);
    if (idx < 0) return null;

    const entry = entries[idx];
    const dir = this.entryDirById(entry.path);

    if (updates.content !== undefined) {
      await fs.promises.writeFile(path.join(dir, 'content.md'), updates.content, 'utf-8');
    }
    if (updates.tags) entry.tags = updates.tags;
    if (updates.summary) entry.summary = updates.summary;
    entry.updatedAt = new Date().toISOString();
    entry.files = await this.listFiles(dir);

    entries[idx] = entry;
    await this.writeIndex(entries);
    return entry;
  }

  async deleteEntry(entryId: string): Promise<boolean> {
    const entries = await this.readIndex();
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return false;

    const dir = this.entryDirById(entry.path);
    await fs.promises.rm(dir, { recursive: true, force: true });

    const filtered = entries.filter((e) => e.id !== entryId);
    await this.writeIndex(filtered);
    log.info(`[SharedDrive] Deleted entry: ${entry.path} (id=${entryId})`);
    return true;
  }

  // ==================== 查询 ====================

  async list(opts?: ListOptions): Promise<SharedDriveEntry[]> {
    let entries = await this.readIndex();

    if (opts?.agentId) {
      entries = entries.filter((e) => e.agentId === opts.agentId);
    }
    if (opts?.date) {
      entries = entries.filter((e) => e.date === opts.date);
    }
    if (opts?.keyword) {
      const kw = opts.keyword.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.topic.toLowerCase().includes(kw) ||
          e.summary.toLowerCase().includes(kw) ||
          e.tags.some((t) => t.toLowerCase().includes(kw))
      );
    }

    entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const offset = opts?.offset || 0;
    const limit = opts?.limit || 50;
    return entries.slice(offset, offset + limit);
  }

  async search(keyword: string): Promise<SharedDriveEntry[]> {
    return this.list({ keyword });
  }

  async getStats(): Promise<{ total: number; byAgent: Record<string, number> }> {
    const entries = await this.readIndex();
    const byAgent: Record<string, number> = {};
    for (const e of entries) {
      byAgent[e.agentId] = (byAgent[e.agentId] || 0) + 1;
    }
    return { total: entries.length, byAgent };
  }

  // ==================== 文件操作 ====================

  async addFile(entryId: string, filename: string, content: Buffer | string): Promise<boolean> {
    const entries = await this.readIndex();
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return false;

    const dir = this.entryDirById(entry.path);
    await this.ensureDir(dir);
    const safeName = this.sanitizeFilename(filename);
    await fs.promises.writeFile(path.join(dir, safeName), content);

    // 更新索引中的文件列表
    const idx = entries.findIndex((e) => e.id === entryId);
    entries[idx].files = await this.listFiles(dir);
    entries[idx].updatedAt = new Date().toISOString();
    await this.writeIndex(entries);
    return true;
  }

  async getFile(entryId: string, filename: string): Promise<Buffer | null> {
    const entries = await this.readIndex();
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return null;

    const filePath = path.join(this.entryDirById(entry.path), filename);
    try {
      return await fs.promises.readFile(filePath);
    } catch {
      return null;
    }
  }

  // ==================== 辅助 ====================

  private async listFiles(dir: string): Promise<string[]> {
    try {
      const items = await fs.promises.readdir(dir);
      return items.filter((f) => !f.startsWith('.'));
    } catch {
      return [];
    }
  }

  private sanitizeTopic(topic: string): string {
    return topic
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 80);
  }

  private sanitizeFilename(filename: string): string {
    return filename.replace(/[/\\:*?"<>|]/g, '_').substring(0, 200);
  }

  private buildReadme(opts: CreateEntryOptions, date: string): string {
    const tags = opts.tags?.length ? opts.tags.map((t) => `\`${t}\``).join(', ') : '_none_';
    return [
      `# ${opts.topic}`,
      '',
      `- **Agent**: ${opts.agentId}`,
      `- **Date**: ${date}`,
      `- **Tags**: ${tags}`,
      '',
      '## Summary',
      '',
      opts.summary || opts.content.substring(0, 300),
      ''
    ].join('\n');
  }
}
