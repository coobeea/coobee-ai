import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SharedDriveStore } from '../SharedDriveStore';

describe('SharedDriveStore', () => {
  let tempDir: string;
  let store: SharedDriveStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-drive-test-'));
    store = SharedDriveStore.createForTest(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('createEntry', () => {
    it('should create an entry with correct directory structure', async () => {
      const entry = await store.createEntry({
        agentId: 'researcher',
        topic: 'market-analysis',
        content: 'This is a market analysis report.',
        tags: ['market', 'q1'],
        summary: 'Q1 market analysis'
      });

      expect(entry.agentId).toBe('researcher');
      expect(entry.topic).toBe('market-analysis');
      expect(entry.tags).toEqual(['market', 'q1']);
      expect(entry.id).toBeTruthy();
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Verify directory exists
      const dir = path.join(tempDir, entry.path);
      expect(fs.existsSync(dir)).toBe(true);
      expect(fs.existsSync(path.join(dir, 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'content.md'))).toBe(true);
    });

    it('should sanitize topic names', async () => {
      const entry = await store.createEntry({
        agentId: 'test-agent',
        topic: 'My Report (v2)',
        content: 'content'
      });

      expect(entry.topic).toBe('my-report-v2');
    });

    it('should append to index', async () => {
      await store.createEntry({ agentId: 'a1', topic: 'topic1', content: 'c1' });
      await store.createEntry({ agentId: 'a2', topic: 'topic2', content: 'c2' });

      const entries = await store.readIndex();
      expect(entries).toHaveLength(2);
      expect(entries[0].agentId).toBe('a1');
      expect(entries[1].agentId).toBe('a2');
    });
  });

  describe('getEntry', () => {
    it('should return entry with readme and files', async () => {
      const created = await store.createEntry({
        agentId: 'agent1',
        topic: 'test-entry',
        content: 'test content',
        summary: 'test summary'
      });

      const result = await store.getEntry(created.id);
      expect(result).not.toBeNull();
      expect(result!.entry.id).toBe(created.id);
      expect(result!.readme).toContain('# test-entry');
      expect(result!.files).toContain('README.md');
      expect(result!.files).toContain('content.md');
    });

    it('should return null for non-existent entry', async () => {
      const result = await store.getEntry('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('updateEntry', () => {
    it('should update tags and summary', async () => {
      const created = await store.createEntry({
        agentId: 'agent1',
        topic: 'updatable',
        content: 'original'
      });

      const updated = await store.updateEntry(created.id, {
        tags: ['new-tag'],
        summary: 'updated summary'
      });

      expect(updated).not.toBeNull();
      expect(updated!.tags).toEqual(['new-tag']);
      expect(updated!.summary).toBe('updated summary');
    });

    it('should return null for non-existent entry', async () => {
      const result = await store.updateEntry('non-existent', { summary: 'x' });
      expect(result).toBeNull();
    });
  });

  describe('deleteEntry', () => {
    it('should delete entry and remove from index', async () => {
      const e1 = await store.createEntry({ agentId: 'a1', topic: 't1', content: 'c1' });
      const e2 = await store.createEntry({ agentId: 'a2', topic: 't2', content: 'c2' });

      const deleted = await store.deleteEntry(e1.id);
      expect(deleted).toBe(true);

      const entries = await store.readIndex();
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe(e2.id);
    });

    it('should return false for non-existent entry', async () => {
      const result = await store.deleteEntry('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await store.createEntry({ agentId: 'a1', topic: 'alpha', content: 'c1', tags: ['x'] });
      await store.createEntry({ agentId: 'a2', topic: 'beta', content: 'c2', tags: ['y'] });
      await store.createEntry({ agentId: 'a1', topic: 'gamma', content: 'c3', tags: ['x', 'z'] });
    });

    it('should list all entries', async () => {
      const entries = await store.list();
      expect(entries).toHaveLength(3);
    });

    it('should filter by agentId', async () => {
      const entries = await store.list({ agentId: 'a1' });
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.agentId === 'a1')).toBe(true);
    });

    it('should filter by keyword (topic)', async () => {
      const entries = await store.list({ keyword: 'beta' });
      expect(entries).toHaveLength(1);
      expect(entries[0].topic).toBe('beta');
    });

    it('should filter by keyword (tag)', async () => {
      const entries = await store.list({ keyword: 'z' });
      expect(entries).toHaveLength(1);
      expect(entries[0].topic).toBe('gamma');
    });

    it('should respect limit and offset', async () => {
      const entries = await store.list({ limit: 1, offset: 1 });
      expect(entries).toHaveLength(1);
    });
  });

  describe('search', () => {
    it('should find entries matching keyword', async () => {
      await store.createEntry({ agentId: 'a1', topic: 'market-report', content: 'c', summary: 'market trends' });
      await store.createEntry({ agentId: 'a2', topic: 'tech-review', content: 'c', summary: 'tech analysis' });

      const results = await store.search('market');
      expect(results).toHaveLength(1);
      expect(results[0].topic).toBe('market-report');
    });
  });

  describe('getStats', () => {
    it('should return correct stats', async () => {
      await store.createEntry({ agentId: 'a1', topic: 't1', content: 'c' });
      await store.createEntry({ agentId: 'a1', topic: 't2', content: 'c' });
      await store.createEntry({ agentId: 'a2', topic: 't3', content: 'c' });

      const stats = await store.getStats();
      expect(stats.total).toBe(3);
      expect(stats.byAgent).toEqual({ a1: 2, a2: 1 });
    });
  });

  describe('file operations', () => {
    it('should add and retrieve files', async () => {
      const entry = await store.createEntry({ agentId: 'a1', topic: 'with-files', content: 'c' });

      const added = await store.addFile(entry.id, 'data.csv', 'col1,col2\nval1,val2');
      expect(added).toBe(true);

      const file = await store.getFile(entry.id, 'data.csv');
      expect(file).not.toBeNull();
      expect(file!.toString()).toBe('col1,col2\nval1,val2');
    });

    it('should return false when adding file to non-existent entry', async () => {
      const result = await store.addFile('non-existent', 'f.txt', 'content');
      expect(result).toBe(false);
    });

    it('should return null when getting non-existent file', async () => {
      const entry = await store.createEntry({ agentId: 'a1', topic: 'no-file', content: 'c' });
      const result = await store.getFile(entry.id, 'missing.txt');
      expect(result).toBeNull();
    });
  });
});
