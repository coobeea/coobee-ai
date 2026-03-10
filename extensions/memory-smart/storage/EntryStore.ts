/**
 * 记忆内容存储器
 *
 * 按月存储，路径格式：entries/{category}/{YYYY-MM}.md
 *
 * 内容格式（纯文本）：
 * === mem-{id} ===
 * 时间: {timestamp}
 * 摘要: {summary}
 * 重要度: {importance}
 * 分类: {category}
 * 关键词: {keywords}
 *
 * Agent 输出:
 * {content}
 *
 * 记忆提取:
 * {memory}
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { MemoryEntry, MemoryCategory } from '../types/models';

export class EntryStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * 初始化内容目录
   */
  async initialize(): Promise<void> {
    const entriesDir = path.join(this.baseDir, 'entries');
    await fs.mkdir(entriesDir, { recursive: true });
  }

  /**
   * 追加记忆条目到月度文件
   */
  async appendEntry(entry: MemoryEntry): Promise<string> {
    const categoryDir = path.join(this.baseDir, 'entries', entry.category);
    await fs.mkdir(categoryDir, { recursive: true });

    // 计算月度文件路径
    const month = entry.timestamp.substring(0, 7); // YYYY-MM
    const monthFile = path.join(categoryDir, `${month}.md`);
    const relativePath = `entries/${entry.category}/${month}.md`;

    // 格式化内容
    const content = this.formatEntry(entry);

    // 追加写入
    await fs.appendFile(monthFile, content, 'utf-8');

    return relativePath;
  }

  /**
   * 格式化记忆条目为纯文本
   */
  private formatEntry(entry: MemoryEntry): string {
    const lines = [
      `=== ${entry.id} ===`,
      `时间: ${entry.timestamp}`,
      `摘要: ${entry.summary}`,
      `重要度: ${entry.importance}`,
      `分类: ${entry.category}`,
      `关键词: ${entry.keywords.join(' ')}`,
      '',
      'Agent 输出:',
      entry.content,
      '',
      '记忆提取:',
      entry.memory,
      '',
      '' // 空行分隔下一条
    ];

    return lines.join('\n') + '\n';
  }

  /**
   * 读取月度文件
   */
  async readMonthEntries(category: MemoryCategory, month: string): Promise<string> {
    const monthFile = path.join(this.baseDir, 'entries', category, `${month}.md`);
    try {
      return await fs.readFile(monthFile, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return '';
      }
      throw err;
    }
  }
}
