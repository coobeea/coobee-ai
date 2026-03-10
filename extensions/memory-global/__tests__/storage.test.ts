/**
 * LanceDB 存储层测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LanceDBStorage } from '../storage/lancedb';
import type { MemoryEntry } from '../types/models';

let tempDir: string;
let storage: LanceDBStorage;

beforeEach(async () => {
  const os = await import('node:os');
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-global-test-'));
  storage = new LanceDBStorage(tempDir);
  await storage.initialize();
});

afterEach(async () => {
  await storage.close();
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('LanceDBStorage', () => {
  it('应该能添加记忆条目', async () => {
    const entry: MemoryEntry = {
      id: randomUUID(),
      text: 'I prefer TypeScript over JavaScript',
      vector: new Array(1536).fill(0.1),
      importance: 7,
      category: 'preference',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0
    };

    await storage.add(entry);

    const all = await storage.listAll();
    expect(all.length).toBe(1);
    expect(all[0].text).toBe(entry.text);
  });

  it('应该能批量添加记忆', async () => {
    const entries: MemoryEntry[] = [
      {
        id: randomUUID(),
        text: 'Memory 1',
        vector: new Array(1536).fill(0.1),
        importance: 5,
        category: 'fact',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0
      },
      {
        id: randomUUID(),
        text: 'Memory 2',
        vector: new Array(1536).fill(0.2),
        importance: 6,
        category: 'preference',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0
      }
    ];

    await storage.addBatch(entries);

    const all = await storage.listAll();
    expect(all.length).toBe(2);
  });

  it('应该能按分类筛选记忆', async () => {
    await storage.addBatch([
      {
        id: randomUUID(),
        text: 'Preference 1',
        vector: new Array(1536).fill(0.1),
        importance: 5,
        category: 'preference',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0
      },
      {
        id: randomUUID(),
        text: 'Fact 1',
        vector: new Array(1536).fill(0.1),
        importance: 5,
        category: 'fact',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0
      }
    ]);

    const preferences = await storage.listByCategory('preference');
    expect(preferences.length).toBe(1);
    expect(preferences[0].category).toBe('preference');
  });

  it('应该能删除记忆条目', async () => {
    const id = randomUUID();
    const entry: MemoryEntry = {
      id,
      text: 'To be deleted',
      vector: new Array(1536).fill(0.1),
      importance: 5,
      category: 'other',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0
    };

    await storage.add(entry);
    expect((await storage.listAll()).length).toBe(1);

    await storage.delete(id);
    expect((await storage.listAll()).length).toBe(0);
  });

  it('应该能获取统计信息', async () => {
    await storage.addBatch([
      {
        id: randomUUID(),
        text: 'Pref 1',
        vector: new Array(1536).fill(0.1),
        importance: 5,
        category: 'preference',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0
      },
      {
        id: randomUUID(),
        text: 'Pref 2',
        vector: new Array(1536).fill(0.1),
        importance: 5,
        category: 'preference',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0
      },
      {
        id: randomUUID(),
        text: 'Fact 1',
        vector: new Array(1536).fill(0.1),
        importance: 5,
        category: 'fact',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0
      }
    ]);

    const stats = await storage.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byCategory.preference).toBe(2);
    expect(stats.byCategory.fact).toBe(1);
  });
});
