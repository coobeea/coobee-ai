import path from 'path'

import { generateSnowflakeId } from '../../utils/SnowflakeIdGenerator'
import pool, { Connection } from './DatabasePool'

const DB_NAME = 'database.db'

export const getDatabasePath = (dataPath: string): string => {
  return path.join(dataPath, DB_NAME)
}

export class DatabaseService {
  private dbPath: string

  constructor(dataPath: string) {
    this.dbPath = getDatabasePath(dataPath)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const connection = await pool.getConnection(this.dbPath)
    return connection.query(sql, params) as Promise<T[]>
  }

  async execute(sql: string, params: unknown[] = []): Promise<number> {
    const connection = await pool.getConnection(this.dbPath)
    return connection.execute(sql, params)
  }

  async insert(sql: string, params: unknown[] = []): Promise<number> {
    const connection = await pool.getConnection(this.dbPath)
    return connection.insert(sql, params)
  }

  async update(sql: string, params: unknown[] = []): Promise<number> {
    const connection = await pool.getConnection(this.dbPath)
    return connection.update(sql, params)
  }

  async delete(sql: string, params: unknown[] = []): Promise<number> {
    const connection = await pool.getConnection(this.dbPath)
    return connection.delete(sql, params)
  }

  async transaction<T>(callback: (connection: Connection) => Promise<T>): Promise<T> {
    const connection = await pool.getConnection(this.dbPath)
    return connection.transaction(async (tx) => {
      return callback(tx as Connection)
    })
  }

  async releaseConnection(): Promise<void> {
    await pool.releaseConnection(this.dbPath)
  }

  async createAndReleaseConnection(): Promise<void> {
    await pool.getConnection(this.dbPath)
    await pool.releaseConnection(this.dbPath)
  }

  /**
   * 生成 Snowflake ID（返回 string）
   */
  public generateId(): string {
    return generateSnowflakeId()
  }

  /**
   * 生成 Snowflake ID（返回 bigint）
   * @deprecated 推荐使用 generateId() 返回 string
   */
  public generateIdBigInt(): bigint {
    return BigInt(generateSnowflakeId())
  }
}
