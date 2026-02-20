import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteService } from '../SQLiteService';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('SQLiteService', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-test-'));
  });

  afterEach(async () => {
    SQLiteService.destroyInstance();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (_e) {
      // Ignore cleanup errors
    }
  });

  it('should initialize as singleton', () => {
    SQLiteService.initialize(tmpDir);
    const instance1 = SQLiteService.getInstance();

    // Attempting to initialize again should not throw, just warn
    SQLiteService.initialize(tmpDir);
    const instance2 = SQLiteService.getInstance();

    expect(instance1).toBe(instance2);
  });

  it('should throw if getting instance before initialization', () => {
    expect(() => SQLiteService.getInstance()).toThrow('SQLiteService has not been initialized');
  });

  it('should execute basic queries', async () => {
    SQLiteService.initialize(tmpDir);
    const db = SQLiteService.getInstance();

    await db.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
    await db.insert('INSERT INTO users (name) VALUES (?)', ['Alice']);
    await db.insert('INSERT INTO users (name) VALUES (?)', ['Bob']);

    const results = await db.query('SELECT * FROM users ORDER BY id');
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ id: 1, name: 'Alice' });

    const oneResult = await db.queryOne('SELECT name FROM users WHERE id = ?', [2]);
    expect(oneResult).toEqual({ name: 'Bob' });
  });

  it('should handle updates and deletes', async () => {
    SQLiteService.initialize(tmpDir);
    const db = SQLiteService.getInstance();

    await db.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
    await db.insert("INSERT INTO users (name) VALUES ('Alice')");

    const changes = await db.update('UPDATE users SET name = ? WHERE id = ?', ['Alice Updated', 1]);
    expect(changes).toBe(1);

    const oneResult = await db.queryOne('SELECT name FROM users WHERE id = 1');
    expect(oneResult).toEqual({ name: 'Alice Updated' });

    const deleted = await db.delete('DELETE FROM users WHERE id = ?', [1]);
    expect(deleted).toBe(1);

    const emptyResult = await db.query('SELECT * FROM users');
    expect(emptyResult).toHaveLength(0);
  });

  it('should enforce proper sql prefix for helper methods', async () => {
    SQLiteService.initialize(tmpDir);
    const db = SQLiteService.getInstance();
    await db.execute('CREATE TABLE test (id INTEGER)');

    await expect(db.insert('UPDATE test SET id = 1')).rejects.toThrow('INSERT statement');
    await expect(db.update('DELETE FROM test')).rejects.toThrow('UPDATE statement');
    await expect(db.delete('INSERT INTO test VALUES (1)')).rejects.toThrow('DELETE statement');
  });

  it('should handle transactions', async () => {
    SQLiteService.initialize(tmpDir);
    const db = SQLiteService.getInstance();

    await db.execute('CREATE TABLE tx_test (val INTEGER)');

    // Successful transaction
    await db.transaction(async (conn) => {
      await conn.insert('INSERT INTO tx_test VALUES (1)');
      await conn.insert('INSERT INTO tx_test VALUES (2)');
    });

    let res = await db.query('SELECT * FROM tx_test');
    expect(res).toHaveLength(2);

    // Failed transaction should rollback
    try {
      await db.transaction(async (conn) => {
        await conn.insert('INSERT INTO tx_test VALUES (3)');
        throw new Error('Abort transaction');
      });
    } catch (_e) {
      // Expected
    }

    res = await db.query('SELECT * FROM tx_test');
    expect(res).toHaveLength(2); // Should still be 2, not 3
  });
});
