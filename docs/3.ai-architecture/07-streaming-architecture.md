# 流式输出架构设计

> 基于 EventBus + 持久化 + WebSocket 的可恢复流式输出方案
>
> 创建时间：2026-02-04

---

## 🎯 问题分析

### SSE 的问题

**当前 SSE (Server-Sent Events) 方案**：

```
Agent/Team → SSE → 前端
```

**核心问题**：

1. ❌ **连接断开无法恢复**：网络波动、客户端刷新、长时间运行都会导致连接中断
2. ❌ **消息丢失**：断开后已发送但前端未收到的消息无法追溯
3. ❌ **无法回溯**：无法查看历史消息流
4. ❌ **难以监控**：缺少统一的消息管理和监控

---

## 💡 新方案：EventBus + 持久化 + WebSocket

### 架构概览

```
┌──────────────────────────────────────────────────────────────┐
│                    流式输出三层架构                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Layer 1: 生产层（Agent/Team Runtime）                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  AgentRuntime / TeamRuntime                            │  │
│  │    ↓ 生成消息                                          │  │
│  │  StreamChunk { id, type, content, timestamp }          │  │
│  └────────────────────────────────────────────────────────┘  │
│                         ↓                                    │
│  Layer 2: 分发层（EventBus + 持久化）                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  EventBus.emit('stream:chunk', chunk)                  │  │
│  │    ├─→ StreamStore.save(chunk)  // 持久化             │  │
│  │    └─→ WebSocket 订阅者                               │  │
│  └────────────────────────────────────────────────────────┘  │
│                         ↓                                    │
│  Layer 3: 传输层（WebSocket）                                │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  WebSocket → 前端                                      │  │
│  │  • 实时推送                                            │  │
│  │  • 断线重连                                            │  │
│  │  • 消息补发（基于消息 ID）                             │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔧 核心设计

### 1. 消息结构

```typescript
/**
 * 流式消息块
 */
interface StreamMessage {
  /** 消息唯一 ID（雪花 ID） */
  id: string

  /** 会话 ID */
  sessionId: string

  /** 消息序号（单调递增） */
  sequence: number

  /** 消息类型 */
  type: 'text' | 'tool_call' | 'tool_result' | 'thinking' | 'done' | 'error'

  /** 消息内容 */
  content: string

  /** 额外数据 */
  data?: Record<string, unknown>

  /** 时间戳 */
  timestamp: number

  /** 来源（agent/team） */
  source: {
    type: 'agent' | 'team'
    id: string
    name: string
  }
}
```

---

### 2. EventBus 事件定义

```typescript
// src/main/ai/streaming/events.ts

/**
 * 流式事件类型
 */
export enum StreamEventType {
  /** 新消息块 */
  CHUNK = 'stream:chunk',

  /** 流开始 */
  START = 'stream:start',

  /** 流结束 */
  END = 'stream:end',

  /** 流错误 */
  ERROR = 'stream:error',

  /** 客户端连接 */
  CLIENT_CONNECT = 'stream:client:connect',

  /** 客户端断开 */
  CLIENT_DISCONNECT = 'stream:client:disconnect',

  /** 客户端请求补发 */
  CLIENT_RESEND = 'stream:client:resend'
}

/**
 * 流式事件数据
 */
export interface StreamEvent {
  type: StreamEventType
  sessionId: string
  data: StreamMessage | { fromSequence: number } | { error: string }
  timestamp: number
}
```

---

### 3. 持久化存储

#### 存储结构

```
数据库表：stream_messages
├── id (TEXT PRIMARY KEY)          - 消息 ID（雪花 ID）
├── session_id (TEXT)              - 会话 ID
├── sequence (INTEGER)             - 消息序号
├── type (TEXT)                    - 消息类型
├── content (TEXT)                 - 消息内容
├── data (JSON)                    - 额外数据
├── timestamp (INTEGER)            - 时间戳
├── source_type (TEXT)             - 来源类型（agent/team）
├── source_id (TEXT)               - 来源 ID
├── source_name (TEXT)             - 来源名称
└── created_at (INTEGER)           - 创建时间

索引：
- idx_session_sequence: (session_id, sequence)  -- 快速按序查询
- idx_session_timestamp: (session_id, timestamp) -- 时间范围查询
```

#### SQL Schema

```sql
-- src/main/ai/storage/schemas/stream_messages.sql

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

-- 索引：快速按序查询
CREATE INDEX IF NOT EXISTS idx_session_sequence
  ON stream_messages(session_id, sequence);

-- 索引：时间范围查询
CREATE INDEX IF NOT EXISTS idx_session_timestamp
  ON stream_messages(session_id, timestamp);

-- 唯一约束：同一会话内序号唯一
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_seq_unique
  ON stream_messages(session_id, sequence);
```

---

### 4. StreamStore（存储管理）

```typescript
// src/main/ai/streaming/StreamStore.ts

import { SQLiteService } from '@main/common/database'
import { SnowflakeIdGenerator } from '@main/utils'
import type { StreamMessage } from './types'

export class StreamStore {
  private db: SQLiteService
  private idGenerator: SnowflakeIdGenerator
  private sequenceCounters = new Map<string, number>() // sessionId -> 当前序号

  constructor() {
    this.db = SQLiteService.getInstance()
    this.idGenerator = new SnowflakeIdGenerator(1) // workerId = 1
  }

  async initialize(): Promise<void> {
    // 执行 SQL schema
    // ...
  }

  /**
   * 保存消息（自动生成 ID 和 序号）
   */
  async saveMessage(
    sessionId: string,
    type: StreamMessage['type'],
    content: string,
    source: StreamMessage['source'],
    data?: Record<string, unknown>
  ): Promise<StreamMessage> {
    // 1. 生成消息 ID
    const id = this.idGenerator.generate().toString()

    // 2. 获取或初始化序号
    let sequence = this.sequenceCounters.get(sessionId) || 0
    sequence++
    this.sequenceCounters.set(sessionId, sequence)

    // 3. 构建消息
    const message: StreamMessage = {
      id,
      sessionId,
      sequence,
      type,
      content,
      data,
      timestamp: Date.now(),
      source
    }

    // 4. 持久化
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

    return message
  }

  /**
   * 获取消息（按序号范围）
   */
  async getMessages(
    sessionId: string,
    fromSequence: number,
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
   * 清理旧消息（可选）
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
  }

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
}

export const streamStore = new StreamStore()
```

---

### 5. StreamManager（流式管理）

```typescript
// src/main/ai/streaming/StreamManager.ts

import { eventBus } from '@main/common/eventbus'
import { streamStore } from './StreamStore'
import { StreamEventType } from './events'
import type { StreamMessage } from './types'

export class StreamManager {
  /**
   * 发送流式消息（自动持久化 + 发送事件）
   */
  async sendMessage(
    sessionId: string,
    type: StreamMessage['type'],
    content: string,
    source: StreamMessage['source'],
    data?: Record<string, unknown>
  ): Promise<StreamMessage> {
    // 1. 持久化
    const message = await streamStore.saveMessage(sessionId, type, content, source, data)

    // 2. 发送事件（触发 WebSocket 推送）
    eventBus.emit(StreamEventType.CHUNK, {
      type: StreamEventType.CHUNK,
      sessionId,
      data: message,
      timestamp: Date.now()
    })

    return message
  }

  /**
   * 开始流
   */
  async startStream(sessionId: string, source: StreamMessage['source']): Promise<void> {
    await this.sendMessage(sessionId, 'text', '[Stream Started]', source)

    eventBus.emit(StreamEventType.START, {
      type: StreamEventType.START,
      sessionId,
      data: { source },
      timestamp: Date.now()
    })
  }

  /**
   * 结束流
   */
  async endStream(sessionId: string, source: StreamMessage['source']): Promise<void> {
    await this.sendMessage(sessionId, 'done', '[Stream Ended]', source)

    eventBus.emit(StreamEventType.END, {
      type: StreamEventType.END,
      sessionId,
      data: { source },
      timestamp: Date.now()
    })
  }

  /**
   * 补发消息（断线重连）
   */
  async resendMessages(sessionId: string, fromSequence: number): Promise<StreamMessage[]> {
    const messages = await streamStore.getMessages(sessionId, fromSequence)

    // 逐条发送事件
    for (const message of messages) {
      eventBus.emit(StreamEventType.CHUNK, {
        type: StreamEventType.CHUNK,
        sessionId,
        data: message,
        timestamp: Date.now()
      })
    }

    return messages
  }

  /**
   * 获取最新序号（用于客户端同步）
   */
  async getLatestSequence(sessionId: string): Promise<number> {
    return await streamStore.getLatestSequence(sessionId)
  }
}

export const streamManager = new StreamManager()
```

---

### 6. 集成到 Runtime

```typescript
// src/main/ai/runtime/AgentRuntime.ts (修改)

import { streamManager } from '../streaming/StreamManager'

export class AgentRuntime implements IExecutable {
  // ...

  async runStream(
    input: string,
    config: ExecutionConfig,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult> {
    console.log(`[AgentRuntime] Running agent in stream mode: ${this.name}`)

    const source = {
      type: 'agent' as const,
      id: this.id,
      name: this.name
    }

    // 开始流
    await streamManager.startStream(this.sessionId, source)

    try {
      // 执行 Agent
      const result = await run(this.agent, input)

      // 发送文本块（自动持久化 + 发送事件）
      await streamManager.sendMessage(this.sessionId, 'text', result.finalOutput || '', source)

      // 结束流
      await streamManager.endStream(this.sessionId, source)

      // 同时调用回调（兼容旧接口）
      onChunk({
        type: 'text',
        content: result.finalOutput || ''
      })

      onChunk({
        type: 'done',
        content: ''
      })

      return {
        output: result.finalOutput || '',
        toolCalls: [],
        skillsUsed: Array.from(this.activeSkills.keys()).filter((id) => this.activeSkills.get(id)),
        duration: 0,
        metadata: {
          agentId: this.id,
          sessionId: this.sessionId
        }
      }
    } catch (error: unknown) {
      // 发送错误消息
      await streamManager.sendMessage(
        this.sessionId,
        'error',
        error instanceof Error ? error.message : String(error),
        source
      )

      throw error
    }
  }
}
```

---

## 🌐 WebSocket 实现

### WebSocket 协议

```typescript
// src/main/ai/streaming/protocol.ts

/**
 * 客户端 → 服务端
 */
export interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'resend' | 'ping'
  sessionId?: string
  fromSequence?: number // 用于 resend
}

/**
 * 服务端 → 客户端
 */
export interface ServerMessage {
  type: 'message' | 'resend_batch' | 'pong' | 'error'
  data: StreamMessage | StreamMessage[] | { error: string }
}
```

### WebSocket 服务

```typescript
// src/main/ai/streaming/WebSocketService.ts

import WebSocket from 'ws'
import { eventBus } from '@main/common/eventbus'
import { streamManager } from './StreamManager'
import { StreamEventType } from './events'
import type { StreamMessage } from './types'

export class WebSocketService {
  private wss!: WebSocket.Server
  private clients = new Map<WebSocket, Set<string>>() // client -> sessionIds

  initialize(port: number): void {
    this.wss = new WebSocket.Server({ port })

    this.wss.on('connection', (ws) => {
      console.log('[WebSocket] Client connected')
      this.clients.set(ws, new Set())

      ws.on('message', (data) => {
        this.handleClientMessage(ws, data.toString())
      })

      ws.on('close', () => {
        console.log('[WebSocket] Client disconnected')
        this.clients.delete(ws)
      })
    })

    // 监听 EventBus 事件
    this.setupEventListeners()
  }

  private setupEventListeners(): void {
    // 监听新消息块
    eventBus.on(StreamEventType.CHUNK, (event) => {
      const message = event.data as StreamMessage
      this.broadcastToSession(message.sessionId, {
        type: 'message',
        data: message
      })
    })
  }

  private async handleClientMessage(ws: WebSocket, data: string): Promise<void> {
    try {
      const msg = JSON.parse(data)

      switch (msg.type) {
        case 'subscribe':
          // 订阅会话
          if (msg.sessionId) {
            const sessions = this.clients.get(ws)
            sessions?.add(msg.sessionId)
            console.log(`[WebSocket] Client subscribed to session: ${msg.sessionId}`)
          }
          break

        case 'unsubscribe':
          // 取消订阅
          if (msg.sessionId) {
            const sessions = this.clients.get(ws)
            sessions?.delete(msg.sessionId)
          }
          break

        case 'resend':
          // 补发消息
          if (msg.sessionId && typeof msg.fromSequence === 'number') {
            const messages = await streamManager.resendMessages(msg.sessionId, msg.fromSequence)
            ws.send(
              JSON.stringify({
                type: 'resend_batch',
                data: messages
              })
            )
          }
          break

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', data: {} }))
          break
      }
    } catch (error) {
      console.error('[WebSocket] Error handling message:', error)
    }
  }

  private broadcastToSession(sessionId: string, message: ServerMessage): void {
    for (const [ws, sessions] of this.clients) {
      if (sessions.has(sessionId) && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message))
      }
    }
  }
}

export const webSocketService = new WebSocketService()
```

---

## 🎨 前端使用示例

```typescript
// 前端 WebSocket 客户端

class StreamClient {
  private ws!: WebSocket
  private sessionId: string
  private lastSequence = 0

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  connect(): void {
    this.ws = new WebSocket('ws://localhost:8080')

    this.ws.onopen = () => {
      // 订阅会话
      this.send({
        type: 'subscribe',
        sessionId: this.sessionId
      })

      // 请求补发（如果是重连）
      if (this.lastSequence > 0) {
        this.send({
          type: 'resend',
          sessionId: this.sessionId,
          fromSequence: this.lastSequence + 1
        })
      }
    }

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)

      if (msg.type === 'message') {
        this.handleMessage(msg.data)
      } else if (msg.type === 'resend_batch') {
        msg.data.forEach((m: StreamMessage) => this.handleMessage(m))
      }
    }

    this.ws.onclose = () => {
      // 自动重连
      setTimeout(() => this.connect(), 1000)
    }
  }

  private handleMessage(message: StreamMessage): void {
    // 更新序号
    this.lastSequence = Math.max(this.lastSequence, message.sequence)

    // 显示消息
    console.log(`[${message.sequence}] ${message.type}: ${message.content}`)
  }

  private send(data: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }
}

// 使用
const client = new StreamClient('session-001')
client.connect()
```

---

## ✅ 方案优势

| 特性         | SSE           | 新方案                 |
| ------------ | ------------- | ---------------------- |
| **可恢复性** | ❌ 不可恢复   | ✅ 断线重连 + 消息补发 |
| **消息顺序** | ⚠️ 依赖连接   | ✅ 序号保证顺序        |
| **历史查询** | ❌ 无法查询   | ✅ 数据库查询          |
| **监控能力** | ❌ 无统一监控 | ✅ EventBus + 日志     |
| **双向通信** | ❌ 单向       | ✅ WebSocket 双向      |
| **性能**     | ✅ 高         | ✅ 高（异步持久化）    |

---

## 🚀 实施步骤

### Phase 1：基础设施

1. ✅ 创建 `StreamMessage` 类型
2. ✅ 创建 `stream_messages` 表
3. ✅ 实现 `StreamStore`
4. ✅ 实现 `StreamManager`

### Phase 2：集成 Runtime

5. ⏳ 修改 `AgentRuntime.runStream()`
6. ⏳ 修改 `TeamRuntime.runStream()`
7. ⏳ 添加事件发送

### Phase 3：WebSocket 服务

8. ⏳ 实现 `WebSocketService`
9. ⏳ 实现协议处理
10. ⏳ 实现断线重连

### Phase 4：前端集成

11. ⏳ 实现前端 WebSocket 客户端
12. ⏳ 实现消息渲染
13. ⏳ 实现断线重连逻辑

---

## 💡 总结

你提出的方案完美解决了 SSE 的核心问题：

1. ✅ **EventBus 解耦**：生产者和消费者解耦，灵活扩展
2. ✅ **持久化保证**：消息不会丢失，可以回溯
3. ✅ **WebSocket 双向**：支持补发、心跳、控制
4. ✅ **序号机制**：保证顺序，支持增量同步

这是一个 **生产级** 的流式输出方案！🎉

---

**维护者**：coobee-ai Team  
**最后更新**：2026-02-04
