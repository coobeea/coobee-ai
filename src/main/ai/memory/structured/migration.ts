/**
 * 结构化记忆系统 — Markdown 迁移工具
 *
 * 将现有 MEMORY.md + memory/*.md 文件中的记忆条目
 * 解析并导入到结构化 SQLite 存储。
 *
 * 设计原则：
 * - 只读迁移：不修改或删除原始文件
 * - 幂等执行：重复运行不会产生重复记忆（content_hash 去重）
 * - 宽容解析：尽最大努力提取有意义的条目
 */

import fs from 'node:fs';
import path from 'node:path';
import type { MemoryType } from './models';
import { computeContentHash, nowISO } from './models';
import type { StructuredMemoryStorage } from './storage';

// ==================== 类型 ====================

export interface MigrationResult {
  migratedCount: number;
  skippedCount: number;
  duplicateCount: number;
  errors: string[];
  files: string[];
}

export interface MigrationOptions {
  defaultType?: MemoryType;
  dryRun?: boolean;
}

// ==================== Migration ====================

/**
 * 从 Markdown 文件迁移记忆到结构化存储
 */
export async function migrateFromMarkdown(
  workspacePath: string,
  storage: StructuredMemoryStorage,
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const result: MigrationResult = {
    migratedCount: 0,
    skippedCount: 0,
    duplicateCount: 0,
    errors: [],
    files: []
  };

  const defaultType = options.defaultType ?? 'knowledge';

  // 1. 收集所有 Markdown 记忆文件
  const filesToMigrate: Array<{ path: string; name: string }> = [];

  const memoryMdPath = path.join(workspacePath, 'MEMORY.md');
  if (fs.existsSync(memoryMdPath)) {
    filesToMigrate.push({ path: memoryMdPath, name: 'MEMORY.md' });
  }

  const memoryDir = path.join(workspacePath, 'memory');
  if (fs.existsSync(memoryDir)) {
    const entries = fs.readdirSync(memoryDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        filesToMigrate.push({
          path: path.join(memoryDir, entry.name),
          name: `memory/${entry.name}`
        });
      }
    }
  }

  if (filesToMigrate.length === 0) return result;

  // 2. 创建 Resource 记录
  let resource: import('./models').MemoryResource | null = null;
  if (!options.dryRun) {
    resource = await storage.createResource({
      url: `migration://${workspacePath}`,
      modality: 'document',
      content: `Migrated from ${filesToMigrate.length} Markdown files`
    });
  }

  // 3. 逐文件解析并导入
  for (const file of filesToMigrate) {
    result.files.push(file.name);

    try {
      const content = fs.readFileSync(file.path, 'utf-8');
      const entries = parseMarkdownMemory(content, file.name);

      for (const entry of entries) {
        const memoryType = inferMemoryType(entry.text, entry.category, defaultType);
        const hash = computeContentHash(entry.text, memoryType);

        const existing = await storage.findItemByHash(hash);
        if (existing) {
          if (!options.dryRun) {
            await storage.reinforceItem(existing.id);
          }
          result.duplicateCount++;
          continue;
        }

        if (!options.dryRun) {
          await storage.createItem({
            resourceId: resource?.id ?? null,
            memoryType,
            summary: entry.text,
            contentHash: hash,
            happenedAt: entry.timestamp ?? null,
            reinforcementCount: 1,
            lastReinforcedAt: nowISO()
          });
        }
        result.migratedCount++;
      }
    } catch (err) {
      result.errors.push(`Failed to parse ${file.name}: ${err}`);
    }
  }

  return result;
}

// ==================== Markdown 解析 ====================

interface ParsedEntry {
  text: string;
  category?: string;
  timestamp?: string;
}

/**
 * 解析 Markdown 记忆文件为条目列表。
 * 支持多种格式：
 * - `- [HH:MM:SS] (category) text` （memory-auto 自动生成格式）
 * - `- text` （普通列表项）
 * - 普通段落（MEMORY.md 中的自由文本）
 */
function parseMarkdownMemory(content: string, _fileName: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  const lines = content.split('\n');
  let inCodeBlock = false;
  let inFrontmatter = false;
  let paragraphBuffer: string[] = [];

  const flushParagraph = (): void => {
    if (paragraphBuffer.length > 0) {
      const text = paragraphBuffer.join(' ').trim();
      if (text.length >= 10) {
        entries.push({ text: text.slice(0, 300) });
      }
      paragraphBuffer = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // frontmatter
    if (trimmed === '---') {
      if (inFrontmatter) {
        inFrontmatter = false;
        continue;
      }
      if (entries.length === 0 && paragraphBuffer.length === 0) {
        inFrontmatter = true;
        continue;
      }
    }
    if (inFrontmatter) continue;

    // code blocks
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // skip headings and horizontal rules
    if (/^#{1,6}\s/.test(trimmed) || /^[-*]{3,}$/.test(trimmed)) {
      flushParagraph();
      continue;
    }

    // empty line → flush paragraph
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    // list items with memory-auto format: - [HH:MM:SS] (category) text
    const autoFormat = trimmed.match(/^[-*]\s+\[(\d{2}:\d{2}:\d{2})\]\s+\((\w+)\)\s+(.+)$/);
    if (autoFormat) {
      flushParagraph();
      entries.push({
        text: autoFormat[3].trim(),
        category: autoFormat[2],
        timestamp: autoFormat[1]
      });
      continue;
    }

    // plain list items: - text
    const listItem = trimmed.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      const text = listItem[1].trim();
      if (text.length >= 5) {
        entries.push({ text: text.slice(0, 300) });
      }
      continue;
    }

    // paragraph text
    paragraphBuffer.push(trimmed);
  }

  flushParagraph();
  return entries;
}

/**
 * 推断记忆类型
 */
function inferMemoryType(text: string, category: string | undefined, defaultType: MemoryType): MemoryType {
  if (category) {
    const catLower = category.toLowerCase();
    if (catLower === 'explicit' || catLower === 'preference') return 'profile';
    if (catLower === 'lesson' || catLower === 'knowledge' || catLower === 'decision') return 'knowledge';
    if (catLower === 'contact') return 'profile';
    if (catLower === 'summary') return 'knowledge';
  }

  const lower = text.toLowerCase();

  if (/用户|偏好|喜欢|习惯|倾向|prefer|always use/.test(lower)) return 'profile';
  if (/经验|教训|注意|修复|解决|fix|debug|lesson/.test(lower)) return 'knowledge';
  if (/计划|上周|昨天|明天|将要|去了|参加|event|plan/.test(lower)) return 'event';

  return defaultType;
}

// ==================== Markdown 导出 ====================

/**
 * 将结构化记忆导出为 Markdown（供人工查看和备份）
 */
export async function exportToMarkdown(storage: StructuredMemoryStorage, outputDir: string): Promise<string[]> {
  const files: string[] = [];

  fs.mkdirSync(outputDir, { recursive: true });

  const categories = await storage.listCategories();
  const allItems = await storage.listItems();

  // 按分类导出
  for (const cat of categories) {
    const rels = await storage.listItemsByCategory(cat.id);
    const itemIds = new Set(rels.map((r) => r.itemId));
    const catItems = allItems.filter((i) => itemIds.has(i.id));

    if (catItems.length === 0) continue;

    const lines = [`# ${cat.name}`, '', `> ${cat.description}`, ''];
    for (const item of catItems) {
      lines.push(`- [${item.memoryType}] ${item.summary}`);
    }
    lines.push('');

    const fileName = `${cat.name}.md`;
    fs.writeFileSync(path.join(outputDir, fileName), lines.join('\n'), 'utf-8');
    files.push(fileName);
  }

  // 导出未分类的 items
  const categorizedIds = new Set<string>();
  for (const cat of categories) {
    const rels = await storage.listItemsByCategory(cat.id);
    for (const r of rels) categorizedIds.add(r.itemId);
  }
  const uncategorized = allItems.filter((i) => !categorizedIds.has(i.id));

  if (uncategorized.length > 0) {
    const lines = ['# Uncategorized Memories', ''];
    for (const item of uncategorized) {
      lines.push(`- [${item.memoryType}] ${item.summary}`);
    }
    lines.push('');

    const fileName = '_uncategorized.md';
    fs.writeFileSync(path.join(outputDir, fileName), lines.join('\n'), 'utf-8');
    files.push(fileName);
  }

  return files;
}
