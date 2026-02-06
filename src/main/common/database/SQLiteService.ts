import Database from 'better-sqlite3-multiple-ciphers'
import { promises as fs } from 'fs'
import path from 'path'

import { generateSnowflakeId } from '../../utils/SnowflakeIdGenerator'
import { log } from '../logger'
import { SqlError } from '../types'

const DB_NAME = 'database.db'

/**
 * 获取 SQLite 数据库路径
 */
export const getSQLitePath = (dataPath: string): string => {
  return path.join(dataPath, DB_NAME)
}

/**
 * 确保 SQLite 数据库目录存在
 */
export async function ensureSQLiteDir(dbPath: string): Promise<void> {
  const dir = path.dirname(dbPath)
  await fs.mkdir(dir, { recursive: true })
}

/**
 * SQLite 连接类
 * 简单封装 better-sqlite3，提供统一的异步 API
 */
export class SQLiteConnection {
  private db: Database.Database
  private dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
    this.db = this.createDatabase(dbPath)
  }

  /**
   * 创建数据库连接
   */
  private createDatabase(dbPath: string): Database.Database {
    const db = new Database(dbPath)
    // 启用 WAL 模式以提高并发性能
    db.pragma('journal_mode = WAL')
    log.info('[SQLite] 数据库连接已创建:', dbPath)
    return db
  }

  /**
   * 执行 SQL（INSERT/UPDATE/DELETE）
   */
  async execute(sql: string, params?: unknown[]): Promise<number> {
    try {
      const stmt = this.db.prepare(sql)
      const result = stmt.run(params || [])
      return result.changes
    } catch (error) {
      throw new SqlError(`Execute failed: ${error}`)
    }
  }

  /**
   * 插入数据
   */
  async insert(sql: string, params?: unknown[]): Promise<number> {
    if (!sql.trim().toLowerCase().startsWith('insert')) {
      throw new SqlError('SQL statement must be an INSERT statement')
    }
    return this.execute(sql, params)
  }

  /**
   * 更新数据
   */
  async update(sql: string, params?: unknown[]): Promise<number> {
    if (!sql.trim().toLowerCase().startsWith('update')) {
      throw new SqlError('SQL statement must be an UPDATE statement')
    }
    return this.execute(sql, params)
  }

  /**
   * 删除数据
   */
  async delete(sql: string, params?: unknown[]): Promise<number> {
    if (!sql.trim().toLowerCase().startsWith('delete')) {
      throw new SqlError('SQL statement must be a DELETE statement')
    }
    return this.execute(sql, params)
  }

  /**
   * 查询数据
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query(sql: string, params?: unknown[]): Promise<any[]> {
    try {
      const stmt = this.db.prepare(sql)
      return stmt.all(params || [])
    } catch (error) {
      throw new SqlError(`Query failed: ${error}`)
    }
  }

  /**
   * 查询单条数据
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async queryOne(sql: string, params?: unknown[]): Promise<any | null> {
    try {
      const stmt = this.db.prepare(sql)
      return stmt.get(params || []) || null
    } catch (error) {
      throw new SqlError(`Query failed: ${error}`)
    }
  }

  /**
   * 执行事务
   */
  async transaction<T>(fn: (tx: SQLiteConnection) => Promise<T>): Promise<T> {
    // better-sqlite3 的 transaction() 要求同步函数，但我们需要支持异步操作
    // 使用手动事务控制来支持异步函数
    try {
      this.db.prepare('BEGIN').run()
      const result = await fn(this)
      this.db.prepare('COMMIT').run()
      return result
    } catch (error) {
      // 发生错误时回滚
      try {
        this.db.prepare('ROLLBACK').run()
      } catch (rollbackError) {
        log.error('[SQLite] 回滚失败:', rollbackError)
      }
      throw new SqlError(`Transaction failed: ${error}`)
    }
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    try {
      // better-sqlite3 的 close() 可以安全地多次调用
      this.db.close()
      log.info('[SQLite] 数据库连接已关闭:', this.dbPath)
    } catch (error) {
      // 如果已经关闭，会抛出错误，可以忽略
      log.debug('[SQLite] 关闭连接时出错（可能已关闭）:', error)
    }
  }

  /**
   * 获取数据库路径
   */
  getDbPath(): string {
    return this.dbPath
  }

  /**
   * 获取原生 better-sqlite3 实例
   */
  getDb(): Database.Database {
    return this.db
  }
}

/**
 * SQLite 服务类（单例模式）
 * 提供简洁的 SQLite 数据库操作接口，适用于 OLTP 场景
 */
export class SQLiteService {
  private static instance: SQLiteService | null = null
  private dbPath: string
  private connection: SQLiteConnection | null = null

  private constructor(dataPath: string) {
    this.dbPath = getSQLitePath(dataPath)
  }

  /**
   * 初始化 SQLiteService 单例实例
   * 仅在应用启动时调用一次（在 InitSQLiteHook 中）
   */
  public static initialize(dataPath: string): void {
    if (SQLiteService.instance) {
      log.warn('[SQLiteService] 单例实例已存在，跳过初始化')
      return
    }
    SQLiteService.instance = new SQLiteService(dataPath)
    log.info('[SQLiteService] 单例实例已创建')
  }

  /**
   * 获取 SQLiteService 单例实例
   * 在应用的任何地方调用，无需传参
   */
  public static getInstance(): SQLiteService {
    if (!SQLiteService.instance) {
      throw new Error('SQLiteService has not been initialized. Call initialize() first.')
    }
    return SQLiteService.instance
  }

  /**
   * 销毁单例实例
   * 仅在应用退出时调用（在 BeforeQuitSQLiteHook 中）
   */
  public static destroyInstance(): void {
    if (SQLiteService.instance) {
      SQLiteService.instance.close()
      SQLiteService.instance = null
      log.info('[SQLiteService] 单例实例已销毁')
    }
  }

  /**
   * 获取数据库连接（懒加载）
   */
  private async getConnection(): Promise<SQLiteConnection> {
    if (!this.connection) {
      // 确保数据库目录存在
      await ensureSQLiteDir(this.dbPath)
      this.connection = new SQLiteConnection(this.dbPath)
    }
    return this.connection
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const connection = await this.getConnection()
    return connection.query(sql, params) as Promise<T[]>
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async queryOne<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    const connection = await this.getConnection()
    return connection.queryOne(sql, params) as Promise<T | null>
  }

  async execute(sql: string, params: unknown[] = []): Promise<number> {
    const connection = await this.getConnection()
    return connection.execute(sql, params)
  }

  async insert(sql: string, params: unknown[] = []): Promise<number> {
    const connection = await this.getConnection()
    return connection.insert(sql, params)
  }

  async update(sql: string, params: unknown[] = []): Promise<number> {
    const connection = await this.getConnection()
    return connection.update(sql, params)
  }

  async delete(sql: string, params: unknown[] = []): Promise<number> {
    const connection = await this.getConnection()
    return connection.delete(sql, params)
  }

  async transaction<T>(callback: (tx: SQLiteConnection) => Promise<T>): Promise<T> {
    const connection = await this.getConnection()
    return connection.transaction(callback)
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.connection) {
      this.connection.close()
      this.connection = null
    }
  }

  /**
   * 生成 Snowflake ID（返回 string）
   */
  public generateId(): string {
    return generateSnowflakeId()
  }
}
