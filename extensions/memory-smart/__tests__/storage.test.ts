/**
 * 存储功能测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexManager } from '../storage/IndexManager';
import { EntryStore } from '../storage/EntryStore';
import type { MemoryEntry } from '../types/models';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

describe('IndexManager', () => {
  let tempDir: string;
  let indexManager: IndexManager;

  beforeEach(async () => {
    const os = await import('node:os');
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-smart-test-'));
    indexManager = new IndexManager(tempDir);
    await indexManager.initialize();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should initialize index directory', async () => {
    const indexDir = path.join(tempDir, 'index');
    const stat = await fs.stat(indexDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('should append index entry', async () => {
    await indexManager.appendIndex('preference', {
      id: 'mem-123',
      date: '2026-03-05',
      summary: '用户偏好文件系统',
      importance: 8,
      keywords: ['文件系统', '数据库'],
      description: '用户明确倾向文件系统存储',
      contentPath: 'entries/preference/2026-03.md'
    });

    const content = await indexManager.readIndex('preference');
    expect(content).toContain('用户偏好文件系统');
    expect(content).toContain('mem-123');
    expect(content).toContain('entries/preference/2026-03.md');
  });

  it('should parse index correctly', async () => {
    await indexManager.appendIndex('decision', {
      id: 'mem-456',
      date: '2026-03-06',
      summary: '决定使用 LanceDB',
      importance: 9,
      keywords: ['LanceDB', 'SQLite'],
      description: '替换 SQLite 为 LanceDB',
      contentPath: 'entries/decision/2026-03.md'
    });

    const content = await indexManager.readIndex('decision');
    const entries = indexManager.parseIndex(content);

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('mem-456');
    expect(entries[0].summary).toBe('决定使用 LanceDB');
    expect(entries[0].importance).toBe(9);
    expect(entries[0].keywords).toEqual(['LanceDB', 'SQLite']);
  });

  it('should handle multiple entries', async () => {
    await indexManager.appendIndex('knowledge', {
      id: 'mem-001',
      date: '2026-03-01',
      summary: 'Vue 3 最佳实践',
      importance: 7,
      keywords: ['Vue3', 'Composition API'],
      description: '使用 script setup 语法',
      contentPath: 'entries/knowledge/2026-03.md'
    });

    await indexManager.appendIndex('knowledge', {
      id: 'mem-002',
      date: '2026-03-02',
      summary: 'Tailwind CSS 4 新特性',
      importance: 6,
      keywords: ['Tailwind', 'CSS'],
      description: '使用 CSS 配置而非 JS',
      contentPath: 'entries/knowledge/2026-03.md'
    });

    const content = await indexManager.readIndex('knowledge');
    const entries = indexManager.parseIndex(content);

    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe('mem-001');
    expect(entries[1].id).toBe('mem-002');
  });
});

describe('EntryStore', () => {
  let tempDir: string;
  let entryStore: EntryStore;

  beforeEach(async () => {
    const os = await import('node:os');
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-smart-test-'));
    entryStore = new EntryStore(tempDir);
    await entryStore.initialize();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should initialize entries directory', async () => {
    const entriesDir = path.join(tempDir, 'entries');
    const stat = await fs.stat(entriesDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('should append entry to month file', async () => {
    const entry: MemoryEntry = {
      id: 'mem-123',
      timestamp: '2026-03-05T14:22:23.210Z',
      summary: '用户偏好文件系统',
      importance: 8,
      category: 'preference',
      keywords: ['文件系统', '数据库'],
      content: '好的，我们将使用文件系统存储，这样更简单可控。',
      memory: '用户倾向文件系统存储'
    };

    const relativePath = await entryStore.appendEntry(entry);

    expect(relativePath).toBe('entries/preference/2026-03.md');

    const content = await entryStore.readMonthEntries('preference', '2026-03');
    expect(content).toContain('=== mem-123 ===');
    expect(content).toContain('摘要: 用户偏好文件系统');
    expect(content).toContain('关键词: 文件系统 数据库');
  });

  it('should handle multiple entries in same month', async () => {
    const entry1: MemoryEntry = {
      id: 'mem-001',
      timestamp: '2026-03-01T10:00:00.000Z',
      summary: '记忆 1',
      importance: 7,
      category: 'fact',
      keywords: ['关键词1'],
      content: 'Agent 输出 1',
      memory: '记忆内容 1'
    };

    const entry2: MemoryEntry = {
      id: 'mem-002',
      timestamp: '2026-03-15T15:00:00.000Z',
      summary: '记忆 2',
      importance: 8,
      category: 'fact',
      keywords: ['关键词2'],
      content: 'Agent 输出 2',
      memory: '记忆内容 2'
    };

    await entryStore.appendEntry(entry1);
    await entryStore.appendEntry(entry2);

    const content = await entryStore.readMonthEntries('fact', '2026-03');
    expect(content).toContain('=== mem-001 ===');
    expect(content).toContain('=== mem-002 ===');
  });

  it('should create month files across different months', async () => {
    const entryMarch: MemoryEntry = {
      id: 'mem-mar',
      timestamp: '2026-03-15T10:00:00.000Z',
      summary: '三月记忆',
      importance: 7,
      category: 'lesson',
      keywords: ['三月'],
      content: '三月的输出',
      memory: '三月的记忆'
    };

    const entryApril: MemoryEntry = {
      id: 'mem-apr',
      timestamp: '2026-04-10T10:00:00.000Z',
      summary: '四月记忆',
      importance: 6,
      category: 'lesson',
      keywords: ['四月'],
      content: '四月的输出',
      memory: '四月的记忆'
    };

    await entryStore.appendEntry(entryMarch);
    await entryStore.appendEntry(entryApril);

    const marchContent = await entryStore.readMonthEntries('lesson', '2026-03');
    const aprilContent = await entryStore.readMonthEntries('lesson', '2026-04');

    expect(marchContent).toContain('mem-mar');
    expect(marchContent).not.toContain('mem-apr');
    expect(aprilContent).toContain('mem-apr');
    expect(aprilContent).not.toContain('mem-mar');
  });
});
