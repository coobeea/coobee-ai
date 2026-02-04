import path from 'path'

import { generateSnowflakeId, generateSnowflakeIdString } from '../utils/SnowflakeIdGenerator'
import pool, { Connection } from './DatabasePool'

const DB_NAME = 'database.db'

export const getDatabasePath = (dataPath: string) => {
  return path.join(dataPath, DB_NAME)
}

export class DatabaseService {
  private dbPath: string

  constructor(dataPath: string) {
    this.dbPath = getDatabasePath(dataPath)
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const connection = await pool.getConnection(this.dbPath)
    return connection.query(sql, params) as Promise<T[]>
  }

  async execute(sql: string, params: any[] = []): Promise<number> {
    const connection = await pool.getConnection(this.dbPath)
    return connection.execute(sql, params)
  }

  async insert(sql: string, params: any[] = []): Promise<number> {
    const connection = await pool.getConnection(this.dbPath)
    return connection.insert(sql, params)
  }

  async update(sql: string, params: any[] = []): Promise<number> {
    const connection = await pool.getConnection(this.dbPath)
    return connection.update(sql, params)
  }

  async delete(sql: string, params: any[] = []): Promise<number> {
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

  public generateId(): bigint {
    return generateSnowflakeId()
  }

  public generateIdString(): string {
    return generateSnowflakeIdString()
  }
}
