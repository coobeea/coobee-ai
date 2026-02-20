import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DuckDBService } from '../DuckDBService';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('DuckDBService', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'duckdb-test-'));
  });

  afterEach(async () => {
    DuckDBService.destroyInstance();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (_e) {
      // Ignore cleanup errors
    }
  });

  it('should initialize as singleton', () => {
    DuckDBService.initialize(tmpDir);
    const instance1 = DuckDBService.getInstance();

    // Attempting to initialize again should not throw, just warn
    DuckDBService.initialize(tmpDir);
    const instance2 = DuckDBService.getInstance();

    expect(instance1).toBe(instance2);
  });

  it('should throw if getting instance before initialization', () => {
    expect(() => DuckDBService.getInstance()).toThrow('DuckDBService has not been initialized');
  });

  it('should execute basic queries', async () => {
    DuckDBService.initialize(tmpDir);
    const db = DuckDBService.getInstance();

    await db.execute('CREATE TABLE users (id INTEGER, name VARCHAR)');
    await db.execute("INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob')");

    const results = await db.query('SELECT * FROM users ORDER BY id');
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ id: 1, name: 'Alice' });

    const oneResult = await db.queryOne('SELECT name FROM users WHERE id = 2');
    expect(oneResult).toEqual({ name: 'Bob' });
  });

  it('should handle transactions', async () => {
    DuckDBService.initialize(tmpDir);
    const db = DuckDBService.getInstance();

    await db.execute('CREATE TABLE tx_test (val INTEGER)');

    // Successful transaction
    await db.transaction(async (conn) => {
      await conn.execute('INSERT INTO tx_test VALUES (1)');
      await conn.execute('INSERT INTO tx_test VALUES (2)');
    });

    let res = await db.query('SELECT * FROM tx_test');
    expect(res).toHaveLength(2);

    // Failed transaction should rollback
    try {
      await db.transaction(async (conn) => {
        await conn.execute('INSERT INTO tx_test VALUES (3)');
        throw new Error('Abort transaction');
      });
    } catch (_e) {
      // Expected
    }

    res = await db.query('SELECT * FROM tx_test');
    expect(res).toHaveLength(2); // Should still be 2, not 3
  });
});
