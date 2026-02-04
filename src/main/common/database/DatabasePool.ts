import { Client, createClient } from '@libsql/client'
import { promises as fs } from 'fs'
import path from 'path'

import { log } from '../logger'
import stateManager from '../state'
import { ensureFileIsReleased } from '../utils'
import { IConnection, SqlError } from './types'

interface DatabaseConnection {
  dbPath: string
  client: Client
  lastUsed: number
}

export class Connection implements IConnection {
  private client: Client
  private dbPath: string

  constructor(client: Client, dbPath: string) {
    this.client = client
    this.dbPath = dbPath
  }

  async execute(sql: string, params?: any[]): Promise<number> {
    const result = await this.client.execute({
      sql,
      args: params || []
    })

    return result.rowsAffected || 0
  }

  async insert(sql: string, params?: any[]): Promise<number> {
    if (!sql.trim().toLowerCase().startsWith('insert')) {
      throw new SqlError('SQL statement must be an INSERT statement')
    }
    return this.execute(sql, params)
  }

  async update(sql: string, params?: any[]): Promise<number> {
    if (!sql.trim().toLowerCase().startsWith('update')) {
      throw new SqlError('SQL statement must be an UPDATE statement')
    }
    return this.execute(sql, params)
  }

  async delete(sql: string, params?: any[]): Promise<number> {
    if (!sql.trim().toLowerCase().startsWith('delete')) {
      throw new SqlError('SQL statement must be a DELETE statement')
    }
    return this.execute(sql, params)
  }

  async query(sql: string, params?: any[]): Promise<any[]> {
    const result = await this.client.execute({
      sql,
      args: params || []
    })

    return result.rows.map((row) => {
      const obj: any = {}
      result.columns.forEach((col, index) => {
        obj[col] = row[index]
      })
      return obj
    })
  }

  async transaction<T>(fn: (tx: IConnection) => Promise<T>): Promise<T> {
    const tx = await this.client.transaction()
    const txConnection = new TransactionConnection(tx, this.dbPath)

    try {
      const result = await fn(txConnection)
      await tx.commit()
      return result
    } catch (error) {
      await tx.rollback()
      throw error
    }
  }

  getDbPath(): string {
    return this.dbPath
  }

  getClient(): Client {
    return this.client
  }
}

class TransactionConnection implements IConnection {
  private tx: any
  private dbPath: string

  constructor(tx: any, dbPath: string) {
    this.tx = tx
    this.dbPath = dbPath
  }

  async execute(sql: string, params?: any[]): Promise<number> {
    const result = await this.tx.execute({
      sql,
      args: params || []
    })

    return result.rowsAffected || 0
  }

  async insert(sql: string, params?: any[]): Promise<number> {
    if (!sql.trim().toLowerCase().startsWith('insert')) {
      throw new SqlError('SQL statement must be an INSERT statement')
    }
    return this.execute(sql, params)
  }

  async update(sql: string, params?: any[]): Promise<number> {
    if (!sql.trim().toLowerCase().startsWith('update')) {
      throw new SqlError('SQL statement must be an UPDATE statement')
    }
    return this.execute(sql, params)
  }

  async delete(sql: string, params?: any[]): Promise<number> {
    if (!sql.trim().toLowerCase().startsWith('delete')) {
      throw new SqlError('SQL statement must be a DELETE statement')
    }
    return this.execute(sql, params)
  }

  async query(sql: string, params?: any[]): Promise<any[]> {
    const result = await this.tx.execute({
      sql,
      args: params || []
    })

    return result.rows.map((row) => {
      const obj: any = {}
      result.columns.forEach((col, index) => {
        obj[col] = row[index]
      })
      return obj
    })
  }

  async transaction<T>(): Promise<T> {
    throw new SqlError('Nested transactions are not supported')
  }

  getDbPath(): string {
    return this.dbPath
  }
}

export class DatabasePool {
  private connections = new Map<string, DatabaseConnection>()
  private readonly MAX_CONNECTIONS = 10
  private readonly IDLE_TIMEOUT = 30 * 60 * 1000
  private cleanupTimer?: NodeJS.Timeout

  constructor() {
    this.startCleanupTimer()
  }

  async getConnection(dbPath: string): Promise<Connection> {
    let conn = this.connections.get(dbPath)

    if (!conn) {
      if (this.connections.size >= this.MAX_CONNECTIONS) {
        await this.closeOldestConnection()
      }

      conn = await this.createConnection(dbPath)
      this.connections.set(dbPath, conn)
    }

    conn.lastUsed = Date.now()

    return new Connection(conn.client, dbPath)
  }

  private async createConnection(dbPath: string): Promise<DatabaseConnection> {
    if (stateManager.getMaintenanceModeState()) {
      throw new SqlError('Maintenance mode is enabled')
    }

    const dir = path.dirname(dbPath)
    await fs.mkdir(dir, { recursive: true })

    const client = createClient({
      url: `file:${dbPath}`,
      intMode: 'number'
    })

    log.info('🔔 [DatabasePool] Connection created', dbPath)

    return {
      dbPath,
      client,
      lastUsed: Date.now()
    }
  }

  async releaseConnection(dbPath: string): Promise<void> {
    log.info('🔔 [DatabasePool] releaseConnection', dbPath)
    const conn = this.connections.get(dbPath)
    if (conn) {
      conn.client.close()
      this.connections.delete(dbPath)
      log.info('🔔 [DatabasePool] releaseConnection - delete', dbPath)
    }
  }

  async closeAllConnections(): Promise<void> {
    log.info('🔔 [DatabasePool] closeAllConnections', this.connections.size)
    for (const [, conn] of this.connections) {
      conn.client.close()
      log.info('🔔 [DatabasePool] closeAllConnections - one', conn.dbPath)
    }
    this.connections.clear()
    log.info('🔔 [DatabasePool] closeAllConnections - clear', this.connections.size)

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
  }

  async closeAllConnectionsAndWaitReleaseLock(): Promise<void> {
    const timeout = 1000 * 60 * 5
    const dbPaths = Array.from(this.connections.keys())
    this.closeAllConnections()
    const releasePromises = dbPaths.map((dbPath) => ensureFileIsReleased(dbPath, timeout))
    await Promise.all(releasePromises)
  }

  private async closeOldestConnection(): Promise<void> {
    let oldestConn: DatabaseConnection | null = null
    let oldestTime = Date.now()

    for (const [, conn] of this.connections) {
      if (conn.lastUsed < oldestTime) {
        oldestTime = conn.lastUsed
        oldestConn = conn
      }
    }

    if (oldestConn) {
      await this.releaseConnection(oldestConn.dbPath)
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(
      async () => {
        const now = Date.now()
        const connectionsToClose: string[] = []

        for (const [dbPath, conn] of this.connections) {
          if (now - conn.lastUsed > this.IDLE_TIMEOUT) {
            connectionsToClose.push(dbPath)
          }
        }

        for (const dbPath of connectionsToClose) {
          await this.releaseConnection(dbPath)
        }
      },
      5 * 60 * 1000
    )
  }

  getConnectionInfo(): { total: number; active: string[] } {
    return {
      total: this.connections.size,
      active: Array.from(this.connections.keys())
    }
  }
}

const pool = new DatabasePool()
export default pool
