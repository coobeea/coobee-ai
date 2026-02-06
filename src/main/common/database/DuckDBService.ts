import { DuckDBInstance } from '@duckdb/node-api'
import { promises as fs } from 'fs'
import path from 'path'

import { generateSnowflakeId } from '../../utils/SnowflakeIdGenerator'
import { log } from '../logger'
import { SqlError } from '../types'

const DB_NAME = 'analytics.duckdb'

/**
 * 获取 DuckDB 数据库路径
 */
export const getDuckDBPath = (dataPath: string): string => {
  return path.join(dataPath, DB_NAME)
}

/**
 * 确保 DuckDB 数据库目录存在
 */
export async function ensureDuckDBDir(dbPath: string): Promise<void> {
  const dir = path.dirname(dbPath)
  await fs.mkdir(dir, { recursive: true })
}

/**
 * DuckDB 连接包装类
 * 封装 @duckdb/node-api，提供统一的查询接口
 */
export class DuckDBConnection {
  private instance: DuckDBInstance
  private dbPath: string

  private constructor(instance: DuckDBInstance, dbPath: string) {
    this.instance = instance
    this.dbPath = dbPath
  }

  /**
   * 创建 DuckDB 数据库连接
   */
  static async create(dbPath: string): Promise<DuckDBConnection> {
    try {
      const instance = await DuckDBInstance.create(dbPath)
      log.info('[DuckDB] 数据库连接已创建:', dbPath)
      return new DuckDBConnection(instance, dbPath)
    } catch (error) {
      throw new SqlError(`Failed to create DuckDB connection: ${error}`)
    }
  }

  /**
   * 执行 SQL 查询（返回结果）
   */
  async query(sql: string): Promise<unknown[]> {
    try {
      const connection = await this.instance.connect()
      const result = await connection.run(sql)
      const rows = result.getRows()
      return rows
    } catch (error) {
      throw new SqlError(`Query failed: ${error}`)
    }
  }

  /**
   * 执行 SQL（INSERT/UPDATE/DELETE，不返回结果）
   */
  async execute(sql: string): Promise<void> {
    try {
      const connection = await this.instance.connect()
      await connection.run(sql)
    } catch (error) {
      throw new SqlError(`Execute failed: ${error}`)
    }
  }

  /**
   * 查询单条数据
   */
  async queryOne(sql: string): Promise<unknown | null> {
    const results = await this.query(sql)
    return results.length > 0 ? results[0] : null
  }

  /**
   * 执行事务
   */
  async transaction<T>(fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
    try {
      await this.execute('BEGIN TRANSACTION')
      const result = await fn(this)
      await this.execute('COMMIT')
      return result
    } catch (error) {
      await this.execute('ROLLBACK')
      throw new SqlError(`Transaction failed: ${error}`)
    }
  }

  /**
   * 从 Parquet 文件读取数据
   */
  async readParquet(filePath: string): Promise<unknown[]> {
    return this.query(`SELECT * FROM read_parquet('${filePath}')`)
  }

  /**
   * 导出查询结果到 Parquet 文件
   */
  async writeParquet(sql: string, outputPath: string): Promise<void> {
    await this.execute(`COPY (${sql}) TO '${outputPath}' (FORMAT PARQUET)`)
  }

  /**
   * 从 CSV 文件读取数据
   */
  async readCSV(
    filePath: string,
    options?: { header?: boolean; delimiter?: string }
  ): Promise<unknown[]> {
    const header = options?.header !== false ? 'TRUE' : 'FALSE'
    const delimiter = options?.delimiter || ','
    return this.query(
      `SELECT * FROM read_csv_auto('${filePath}', header=${header}, delim='${delimiter}')`
    )
  }

  /**
   * 导出查询结果到 CSV 文件
   */
  async writeCSV(sql: string, outputPath: string): Promise<void> {
    await this.execute(`COPY (${sql}) TO '${outputPath}' (FORMAT CSV, HEADER TRUE)`)
  }

  /**
   * 获取表结构信息
   */
  async describeTable(tableName: string): Promise<unknown[]> {
    return this.query(`DESCRIBE ${tableName}`)
  }

  /**
   * 获取所有表名
   */
  async showTables(): Promise<string[]> {
    const results = await this.query('SHOW TABLES')
    return results.map((row: any) => row.name) // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    try {
      this.instance.closeSync()
      log.info('[DuckDB] 数据库连接已关闭:', this.dbPath)
    } catch (error) {
      log.error('[DuckDB] 关闭连接失败:', error)
    }
  }

  /**
   * 获取数据库路径
   */
  getDbPath(): string {
    return this.dbPath
  }

  /**
   * 获取原生 DuckDB 实例
   */
  getInstance(): DuckDBInstance {
    return this.instance
  }
}

/**
 * DuckDB 服务类（单例模式）
 * 提供简洁的 DuckDB 数据库操作接口，适用于 OLAP 场景
 */
export class DuckDBService {
  private static instance: DuckDBService | null = null
  private dbPath: string
  private connection: DuckDBConnection | null = null

  private constructor(dataPath: string) {
    this.dbPath = getDuckDBPath(dataPath)
  }

  /**
   * 初始化 DuckDBService 单例实例
   * 仅在应用启动时调用一次（在 InitDatabaseHook 中）
   */
  public static initialize(dataPath: string): void {
    if (DuckDBService.instance) {
      log.warn('[DuckDBService] 单例实例已存在，跳过初始化')
      return
    }
    DuckDBService.instance = new DuckDBService(dataPath)
    log.info('[DuckDBService] 单例实例已创建')
  }

  /**
   * 获取 DuckDBService 单例实例
   * 在应用的任何地方调用，无需传参
   */
  public static getInstance(): DuckDBService {
    if (!DuckDBService.instance) {
      throw new Error('DuckDBService has not been initialized. Call initialize() first.')
    }
    return DuckDBService.instance
  }

  /**
   * 销毁单例实例
   * 仅在应用退出时调用（在 BeforeQuitDatabaseHook 中）
   */
  public static destroyInstance(): void {
    if (DuckDBService.instance) {
      DuckDBService.instance.close()
      DuckDBService.instance = null
      log.info('[DuckDBService] 单例实例已销毁')
    }
  }

  /**
   * 获取数据库连接（懒加载）
   */
  private async getConnection(): Promise<DuckDBConnection> {
    if (!this.connection) {
      // 确保数据库目录存在
      await ensureDuckDBDir(this.dbPath)
      this.connection = await DuckDBConnection.create(this.dbPath)
    }
    return this.connection
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query<T = any>(sql: string): Promise<T[]> {
    const connection = await this.getConnection()
    return connection.query(sql) as Promise<T[]>
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async queryOne<T = any>(sql: string): Promise<T | null> {
    const connection = await this.getConnection()
    return connection.queryOne(sql) as Promise<T | null>
  }

  async execute(sql: string): Promise<void> {
    const connection = await this.getConnection()
    return connection.execute(sql)
  }

  async transaction<T>(callback: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
    const connection = await this.getConnection()
    return connection.transaction(callback)
  }

  async readParquet(filePath: string): Promise<unknown[]> {
    const connection = await this.getConnection()
    return connection.readParquet(filePath)
  }

  async writeParquet(sql: string, outputPath: string): Promise<void> {
    const connection = await this.getConnection()
    return connection.writeParquet(sql, outputPath)
  }

  async readCSV(
    filePath: string,
    options?: { header?: boolean; delimiter?: string }
  ): Promise<unknown[]> {
    const connection = await this.getConnection()
    return connection.readCSV(filePath, options)
  }

  async writeCSV(sql: string, outputPath: string): Promise<void> {
    const connection = await this.getConnection()
    return connection.writeCSV(sql, outputPath)
  }

  async describeTable(tableName: string): Promise<unknown[]> {
    const connection = await this.getConnection()
    return connection.describeTable(tableName)
  }

  async showTables(): Promise<string[]> {
    const connection = await this.getConnection()
    return connection.showTables()
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
