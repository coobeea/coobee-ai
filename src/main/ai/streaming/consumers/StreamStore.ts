/**
 * 流式消息存储（消费者 1：持久化）
 * 监听 EventBus 的流式事件，保存到数据库
 */

import { eventBus } from '@main/common/eventbus'
import { SQLiteService } from '@main/common/database'
import { StreamEventType, type StreamEvent, type StreamMessage } from '../types'
import { readFile } from 'fs/promises'
import { join } from 'path'

/**
 * 流式消息存储
 */
export class StreamStore {
  private db: SQLiteService
  private initialized = false

  // 批量写入配置
  private messageQueue: StreamMessage[] = []
  private flushInterval = 1000 // 1秒刷新一次
  private maxBatchSize = 100 // 最大批量大小
  private flushTimer: NodeJS.Timeout | null = null

  constructor() {
    this.db = SQLiteService.getInstance()
  }

  /**
   * 初始化（创建表结构 + 注册事件监听）
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // 1. 创建表结构
    await this.createSchema()

    // 2. 注册事件监听
    this.registerEventListeners()

    // 3. 启动定时刷新
    this.startFlushTimer()

    this.initialized = true
    console.log('[StreamStore] Initialized with batch writing')
  }

  /**
   * 创建数据库 Schema
   */
  private async createSchema(): Promise<void> {
    const schemaPath = join(__dirname, '../schemas', 'stream_messages.sql')
    try {
      const schema = await readFile(schemaPath, 'utf-8')
      await this.db.execute(schema)
    } catch (_error) {
      console.warn('[StreamStore] Schema file not found, creating inline')
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS stream_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          data JSON,
          timestamp INTEGER NOT NULL,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          source_name TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_session_sequence 
          ON stream_messages(session_id, sequence);

        CREATE INDEX IF NOT EXISTS idx_session_timestamp 
          ON stream_messages(session_id, timestamp);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_session_seq_unique 
          ON stream_messages(session_id, sequence);
      `)
    }
  }

  /**
   * 启动定时刷新
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flushQueue().catch((error) => {
        console.error('[StreamStore] Failed to flush queue:', error)
      })
    }, this.flushInterval)
  }

  /**
   * 注册事件监听器（消费者核心）
   */
  private registerEventListeners(): void {
    // 监听消息事件 - 改为入队而不是立即写入
    eventBus.on(StreamEventType.MESSAGE, (event: StreamEvent) => {
      if (event.message) {
        this.enqueueMessage(event.message)
      }
    })

    console.log('[StreamStore] Event listeners registered')
  }

  /**
   * 入队消息（批量写入）
   */
  private enqueueMessage(message: StreamMessage): void {
    this.messageQueue.push(message)

    // 队列满时立即刷新
    if (this.messageQueue.length >= this.maxBatchSize) {
      this.flushQueue().catch((error) => {
        console.error('[StreamStore] Failed to flush full queue:', error)
      })
    }
  }

  /**
   * 刷新队列（批量写入数据库）
   */
  private async flushQueue(): Promise<void> {
    if (this.messageQueue.length === 0) {
      return
    }

    // 取出当前队列中的所有消息
    const batch = this.messageQueue.splice(0, this.messageQueue.length)

    try {
      // 使用事务批量插入
      await this.db.transaction(async () => {
        for (const message of batch) {
          await this.saveMessage(message)
        }
      })

      console.log(`[StreamStore] Flushed ${batch.length} messages`)
    } catch (error) {
      console.error('[StreamStore] Batch write failed:', error)
      // 写入失败时，将消息重新入队（简化实现，实际可能需要死信队列）
      this.messageQueue.unshift(...batch)
    }
  }

  /**
   * 保存消息（内部方法）
   */
  private async saveMessage(message: StreamMessage): Promise<void> {
    await this.db.execute(
      `INSERT INTO stream_messages 
       (id, session_id, sequence, type, content, data, timestamp, 
        source_type, source_id, source_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.sessionId,
        message.sequence,
        message.type,
        message.content,
        JSON.stringify(message.data || {}),
        message.timestamp,
        message.source.type,
        message.source.id,
        message.source.name,
        Date.now()
      ]
    )

    console.log(`[StreamStore] Saved message: ${message.sessionId}#${message.sequence}`)
  }

  /**
   * 获取消息（按序号范围）
   */
  async getMessages(
    sessionId: string,
    fromSequence: number = 1,
    limit: number = 100
  ): Promise<StreamMessage[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM stream_messages 
       WHERE session_id = ? AND sequence >= ? 
       ORDER BY sequence ASC 
       LIMIT ?`,
      [sessionId, fromSequence, limit]
    )

    return rows.map((row) => this.rowToMessage(row))
  }

  /**
   * 获取最新序号
   */
  async getLatestSequence(sessionId: string): Promise<number> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      `SELECT MAX(sequence) as max_seq FROM stream_messages WHERE session_id = ?`,
      [sessionId]
    )

    return (row?.max_seq as number) || 0
  }

  /**
   * 清理旧消息
   */
  async cleanOldMessages(sessionId: string, keepLast: number = 1000): Promise<void> {
    await this.db.execute(
      `DELETE FROM stream_messages 
       WHERE session_id = ? 
       AND sequence <= (
         SELECT MAX(sequence) - ? FROM stream_messages WHERE session_id = ?
       )`,
      [sessionId, keepLast, sessionId]
    )

    console.log(`[StreamStore] Cleaned old messages for session: ${sessionId}`)
  }

  /**
   * 清理会话所有消息
   */
  async clearSession(sessionId: string): Promise<void> {
    await this.db.execute(`DELETE FROM stream_messages WHERE session_id = ?`, [sessionId])
    console.log(`[StreamStore] Cleared all messages for session: ${sessionId}`)
  }

  /**
   * 数据库行转消息
   */
  private rowToMessage(row: Record<string, unknown>): StreamMessage {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      sequence: row.sequence as number,
      type: row.type as StreamMessage['type'],
      content: row.content as string,
      data: row.data ? JSON.parse(row.data as string) : undefined,
      timestamp: row.timestamp as number,
      source: {
        type: row.source_type as 'agent' | 'team',
        id: row.source_id as string,
        name: row.source_name as string
      }
    }
  }

  /**
   * 获取队列统计信息
   */
  getQueueStats(): {
    queueSize: number
    maxBatchSize: number
    flushInterval: number
  } {
    return {
      queueSize: this.messageQueue.length,
      maxBatchSize: this.maxBatchSize,
      flushInterval: this.flushInterval
    }
  }

  /**
   * 清理资源
   */
  async destroy(): Promise<void> {
    // 停止定时器
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }

    // 刷新剩余消息
    await this.flushQueue()

    console.log('[StreamStore] Destroyed')
  }
}

/**
 * 全局 StreamStore 实例
 */
export const streamStore = new StreamStore()
