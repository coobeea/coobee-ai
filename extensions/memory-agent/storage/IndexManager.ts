/**
 * 索引管理器
 *
 * 索引格式（每 4 行一条记忆）：
 * 标题（摘要）
 * ID 日期 重要度 关键词1 关键词2...
 * 详细描述（1-2句话）
 * 文件路径
 *
 * （空行分隔）
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { MemoryCategory, IndexEntry } from '../types/models';

export class IndexManager {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * 初始化索引目录
   */
  async initialize(): Promise<void> {
    const indexDir = path.join(this.baseDir, 'index');
    await fs.mkdir(indexDir, { recursive: true });
  }

  /**
   * 追加索引条目
   */
  async appendIndex(
    category: MemoryCategory,
    entry: {
      id: string;
      date: string;
      summary: string;
      importance: number;
      keywords: string[];
      description: string;
      contentPath: string;
    }
  ): Promise<void> {
    const indexFile = path.join(this.baseDir, 'index', `${category}.md`);

    // 格式化为 4 行文本
    const lines = [
      entry.summary,
      `${entry.id} ${entry.date} ${entry.importance} ${entry.keywords.join(' ')}`,
      entry.description,
      entry.contentPath,
      '' // 空行分隔
    ];

    const content = lines.join('\n') + '\n';

    // 追加写入
    await fs.appendFile(indexFile, content, 'utf-8');
  }

  /**
   * 读取索引文件
   */
  async readIndex(category: MemoryCategory): Promise<string> {
    const indexFile = path.join(this.baseDir, 'index', `${category}.md`);
    try {
      return await fs.readFile(indexFile, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return '';
      }
      throw err;
    }
  }

  /**
   * 解析索引内容为结构化数据（调试用）
   */
  parseIndex(content: string): IndexEntry[] {
    const entries: IndexEntry[] = [];
    const lines = content.split('\n').filter((line) => line.trim() !== '');

    for (let i = 0; i < lines.length; i += 4) {
      if (i + 3 >= lines.length) break;

      const summary = lines[i].trim();
      const metaParts = lines[i + 1].trim().split(/\s+/);
      const id = metaParts[0];
      const date = metaParts[1];
      const importance = parseInt(metaParts[2], 10);
      const keywords = metaParts.slice(3);
      const description = lines[i + 2].trim();
      const filePath = lines[i + 3].trim();

      entries.push({
        id,
        date,
        summary,
        importance,
        keywords,
        description,
        path: filePath
      });
    }

    return entries;
  }
}
