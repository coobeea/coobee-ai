/**
 * TavernStore 单元测试
 *
 * 验证：
 * 1. CRUD 操作（创建、读取、更新、删除）
 * 2. JSONL 索引正确性
 * 3. getPendingTasks 过滤和排序
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { TavernStore, type Task } from '../TavernStore';

let tmpDir: string;
let store: TavernStore;

function makeTavernDir(): string {
  const dir = path.join(tmpDir, 'tavern');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createStore(tavernDir: string): TavernStore {
  TavernStore.resetInstance();
  const s = new TavernStore();
  (s as unknown as { tavernDir: string }).tavernDir = tavernDir;
  return s;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'test-task-1',
    title: 'Test Task',
    description: 'A test task',
    amount: 10,
    files: [],
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe('TavernStore', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-store-test-'));
    const tavernDir = makeTavernDir();
    store = createStore(tavernDir);
  });

  afterEach(() => {
    TavernStore.resetInstance();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('writeMeta / readMeta', () => {
    it('写入并读取任务元数据', async () => {
      const task = makeTask({ id: 'meta-1' });
      await store.writeMeta('meta-1', task);

      const loaded = await store.readMeta('meta-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('meta-1');
      expect(loaded!.title).toBe('Test Task');
    });

    it('不存在的任务返回 null', async () => {
      const loaded = await store.readMeta('nonexistent');
      expect(loaded).toBeNull();
    });
  });

  describe('readIndex / writeIndex / appendToIndex', () => {
    it('空索引返回空数组', async () => {
      const tasks = await store.readIndex();
      expect(tasks).toEqual([]);
    });

    it('appendToIndex 追加记录', async () => {
      const task1 = makeTask({ id: 't1' });
      const task2 = makeTask({ id: 't2', title: 'Second' });

      await store.appendToIndex(task1);
      await store.appendToIndex(task2);

      const tasks = await store.readIndex();
      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe('t1');
      expect(tasks[1].id).toBe('t2');
    });

    it('writeIndex 覆写所有记录', async () => {
      const task1 = makeTask({ id: 't1' });
      const task2 = makeTask({ id: 't2' });
      await store.appendToIndex(task1);
      await store.appendToIndex(task2);

      await store.writeIndex([task2]);

      const tasks = await store.readIndex();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('t2');
    });
  });

  describe('updateTask', () => {
    it('更新任务状态', async () => {
      const task = makeTask({ id: 'upd-1' });
      await store.writeMeta('upd-1', task);
      await store.appendToIndex(task);

      const updated = await store.updateTask('upd-1', { status: 'completed' });
      expect(updated?.status).toBe('completed');

      const fromMeta = await store.readMeta('upd-1');
      expect(fromMeta?.status).toBe('completed');

      const fromIndex = await store.readIndex();
      expect(fromIndex[0].status).toBe('completed');
    });

    it('更新 threadId', async () => {
      const task = makeTask({ id: 'upd-2' });
      await store.writeMeta('upd-2', task);
      await store.appendToIndex(task);

      const updated = await store.updateTask('upd-2', { threadId: 'session-123' });
      expect(updated?.threadId).toBe('session-123');
    });

    it('不存在的任务返回 null', async () => {
      const result = await store.updateTask('nonexistent', { status: 'completed' });
      expect(result).toBeNull();
    });
  });

  describe('getPendingTasks', () => {
    it('只返回 pending 状态的任务', async () => {
      const t1 = makeTask({ id: 't1', status: 'pending', createdAt: '2026-01-01T00:00:00Z' });
      const t2 = makeTask({ id: 't2', status: 'completed' });
      const t3 = makeTask({ id: 't3', status: 'pending', createdAt: '2026-01-02T00:00:00Z' });

      for (const t of [t1, t2, t3]) {
        await store.appendToIndex(t);
      }

      const pending = await store.getPendingTasks();
      expect(pending).toHaveLength(2);
      expect(pending[0].id).toBe('t1');
      expect(pending[1].id).toBe('t3');
    });

    it('按创建时间升序排列（FIFO）', async () => {
      const t1 = makeTask({ id: 'early', status: 'pending', createdAt: '2026-01-01T00:00:00Z' });
      const t2 = makeTask({ id: 'late', status: 'pending', createdAt: '2026-06-01T00:00:00Z' });

      await store.appendToIndex(t2);
      await store.appendToIndex(t1);

      const pending = await store.getPendingTasks();
      expect(pending[0].id).toBe('early');
      expect(pending[1].id).toBe('late');
    });
  });

  describe('deleteTask', () => {
    it('删除任务文件和索引', async () => {
      const task = makeTask({ id: 'del-1' });
      await store.writeMeta('del-1', task);
      await store.appendToIndex(task);

      await store.deleteTask('del-1');

      const meta = await store.readMeta('del-1');
      expect(meta).toBeNull();

      const index = await store.readIndex();
      expect(index).toHaveLength(0);
    });
  });
});
