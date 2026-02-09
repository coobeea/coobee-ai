# 10 - 记忆与会话管理

> 来源：`examples/memory/memory.ts`, `memory/file.ts`, `memory/oai.ts`, `memory/oai-compact.ts`, `memory/oai-compact-stateless.ts`, `memory/sessions/file.ts`, `memory/sessions/prisma.ts`, `memory/prisma/schema.prisma`

## 概述

Session 是 SDK 内置的会话管理机制，自动处理多轮对话的历史记录存储和恢复。SDK 提供了四种内置 Session 实现，并支持自定义扩展。

## Session 接口

所有 Session 实现都遵循统一接口：

```typescript
interface Session {
  // 获取或创建会话 ID
  getSessionId(): Promise<string>

  // 获取会话历史项（可限制数量）
  getItems(limit?: number): Promise<AgentInputItem[]>

  // 添加历史项
  addItems(items: AgentInputItem[]): Promise<void>

  // 移除并返回最后一个项
  popItem(): Promise<AgentInputItem | undefined>

  // 清除整个会话
  clearSession(): Promise<void>
}
```

## 四种内置 Session

### 1. MemorySession — 内存会话

最简单的实现，数据存储在进程内存中：

```typescript
import { Agent, MemorySession, run } from '@openai/agents'

const session = new MemorySession()

const agent = new Agent({
  name: 'Assistant',
  instructions: 'You are a helpful assistant.'
})

// 第一轮
let result = await run(agent, 'What is the largest country in South America?', {
  session
})
console.log(result.finalOutput) // "Brazil..."

// 第二轮 — Session 自动维护上下文
result = await run(agent, 'What is the capital of that country?', {
  session
})
console.log(result.finalOutput) // "Brasilia..."
```

**特点**：

- 零配置，开箱即用
- 数据在进程结束后丢失
- 适用于临时对话、测试

### 2. FileSession — 文件会话

将会话数据持久化到本地 JSON 文件：

```typescript
import { FileSession } from './sessions'

const session = new FileSession({ dir: './tmp/' })

let result = await run(agent, 'Hello', { session })
// 数据保存在 ./tmp/<sessionId>.json

// 恢复会话（不同进程/重启后）
const sessionId = await session.getSessionId()
const restoredSession = new FileSession({ dir: './tmp/', sessionId })
result = await run(agent, 'Continue our chat', { session: restoredSession })
```

**FileSession 实现要点**：

```typescript
class FileSession implements Session {
  async getSessionId(): Promise<string> {
    if (!this.#sessionId) {
      this.#sessionId = randomUUID().replace(/-/g, '').slice(0, 24)
    }
    // 确保文件存在
    const file = this.#filePath(this.#sessionId)
    try {
      await fs.access(file)
    } catch {
      await fs.writeFile(file, '[]', 'utf8')
    }
    return this.#sessionId
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const items = await this.#readItems(sessionId)
    if (typeof limit === 'number' && limit >= 0) {
      return items.slice(-limit) // 返回最后 N 条
    }
    return items
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    const current = await this.#readItems(sessionId)
    // JSON 序列化/反序列化避免引用问题
    const serialized = items.map((item) => JSON.parse(JSON.stringify(item)))
    const next = current.concat(serialized)
    await this.#writeItems(sessionId, next)
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    const items = await this.#readItems(sessionId)
    const last = items.pop()
    await this.#writeItems(sessionId, items)
    return last
  }

  async clearSession(): Promise<void> {
    await fs.unlink(this.#filePath(sessionId))
  }
}
```

**特点**：

- 跨进程/重启持久化
- 通过 `sessionId` 恢复会话
- 适用于单机部署、开发调试

### 3. OpenAIConversationsSession — OpenAI 服务端会话

利用 OpenAI Conversations API 管理会话：

```typescript
import { OpenAIConversationsSession } from '@openai/agents'

const session = new OpenAIConversationsSession()

let result = await run(agent, 'Hello', { session })
// 会话数据存储在 OpenAI 服务端
```

**特点**：

- 零本地存储
- 自动管理上下文窗口
- 需要网络连接

### 4. PrismaSession — 数据库会话

基于 Prisma ORM 的数据库持久化：

```typescript
import { PrismaSession } from './sessions'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const session = new PrismaSession({ client: prisma })

try {
  let result = await run(agent, 'Hello', { session })
  // 数据存储在数据库中
} finally {
  await prisma.$disconnect()
}
```

**数据库 Schema（SQLite / PostgreSQL）**：

```prisma
model Session {
  id        String        @id
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
  items     SessionItem[]
}

model SessionItem {
  id        Int      @id @default(autoincrement())
  sessionId String
  position  Int
  item      Json     // 存储序列化的 AgentInputItem
  createdAt DateTime @default(now())

  session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, position])
  @@unique([sessionId, position])
}
```

**PrismaSession 实现要点**：

```typescript
class PrismaSession implements Session {
  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const take = typeof limit === 'number' && limit >= 0 ? limit : undefined
    const records = await this.#client.sessionItem.findMany({
      where: { sessionId },
      orderBy: { position: take ? 'desc' : 'asc' },
      take
    })
    return records.map((r) => r.item as AgentInputItem)
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    // 支持事务
    await this.#withClient(async (client) => {
      const last = await client.sessionItem.findFirst({
        where: { sessionId },
        orderBy: { position: 'desc' }
      })
      let position = last?.position ?? 0

      const payload = items.map((item) => ({
        sessionId,
        position: ++position,
        item: JSON.parse(JSON.stringify(item))
      }))

      await client.sessionItem.createMany({ data: payload })
    })
  }
}
```

**特点**：

- 适用于生产环境
- 支持事务和并发
- 可使用任何 Prisma 支持的数据库

## 四种 Session 对比

| 特性       | MemorySession | FileSession | OAIConversationsSession | PrismaSession |
| ---------- | ------------- | ----------- | ----------------------- | ------------- |
| 持久化     | 否            | 文件        | OpenAI 服务端           | 数据库        |
| 跨进程     | 否            | 是          | 是                      | 是            |
| 配置复杂度 | 零            | 低          | 低                      | 中            |
| 适用场景   | 测试          | 开发/单机   | 轻量应用                | 生产环境      |
| 查询能力   | 无            | 简单        | 有限                    | 完整          |

## 会话压缩

`OpenAIResponsesCompactionSession` 装饰器自动压缩过长的历史记录：

### 基础用法

```typescript
import { OpenAIResponsesCompactionSession, MemorySession } from '@openai/agents'

const session = new OpenAIResponsesCompactionSession({
  model: 'gpt-5.2', // 用于压缩的模型
  underlyingSession: new MemorySession(), // 底层 Session
  shouldTriggerCompaction: ({ compactionCandidateItems }) => {
    // 当历史记录达到 4 条时触发压缩
    return compactionCandidateItems.length >= 4
  }
})

let result = await run(agent, 'First question', { session })
result = await run(agent, 'Second question', { session })
result = await run(agent, 'Third question', { session })
result = await run(agent, 'Fourth question', { session })
// 第四次运行时自动触发压缩
```

### 装饰器模式

压缩层包裹底层 Session，可以自由组合：

```typescript
// 压缩 + 文件持久化
const session = new OpenAIResponsesCompactionSession({
  model: 'gpt-5.2',
  underlyingSession: new FileSession({ dir: './tmp/' }),
  shouldTriggerCompaction: ({ compactionCandidateItems }) => compactionCandidateItems.length >= 10
})
```

### 手动压缩

```typescript
await session.runCompaction({ force: true })
```

### 无状态压缩

当 `store: false` 时，自动切换到 `input` 压缩模式：

```typescript
const agent = new Agent({
  modelSettings: {
    store: false // 禁用 OpenAI 端存储
  }
})

const session = new OpenAIResponsesCompactionSession({
  model: 'gpt-5.2',
  underlyingSession: new MemorySession(),
  shouldTriggerCompaction: ({ compactionCandidateItems }) => compactionCandidateItems.length >= 4
})
// 自动使用 input 压缩模式（而非默认的 responses.compact）
```

### 两种压缩模式

| 模式                | 说明                           | 条件                      |
| ------------------- | ------------------------------ | ------------------------- |
| `responses.compact` | 使用 OpenAI Responses API 压缩 | 默认（`store: true`）     |
| `input`             | 压缩输入历史                   | `store: false` 时自动切换 |

## 流式 + Session

Session 同样支持流式模式：

```typescript
const session = new MemorySession()

const stream = await run(agent, 'Hello', { session, stream: true })
for await (const event of stream.toTextStream()) {
  process.stdout.write(event)
}
```

## 自定义 Session 实现

实现 `Session` 接口即可创建自定义存储：

```typescript
import type { Session, AgentInputItem } from '@openai/agents'

class RedisSession implements Session {
  constructor(
    private redisClient: Redis,
    private sessionId?: string
  ) {}

  async getSessionId(): Promise<string> {
    if (!this.sessionId) {
      this.sessionId = generateId()
      await this.redisClient.set(`session:${this.sessionId}`, '[]')
    }
    return this.sessionId
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const data = await this.redisClient.get(`session:${this.sessionId}`)
    const items: AgentInputItem[] = JSON.parse(data || '[]')
    return limit ? items.slice(-limit) : items
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    const current = await this.getItems()
    current.push(...items)
    await this.redisClient.set(`session:${this.sessionId}`, JSON.stringify(current))
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    const items = await this.getItems()
    const last = items.pop()
    await this.redisClient.set(`session:${this.sessionId}`, JSON.stringify(items))
    return last
  }

  async clearSession(): Promise<void> {
    await this.redisClient.del(`session:${this.sessionId}`)
  }
}
```

## 最佳实践

1. **开发阶段用 MemorySession** — 简单快速
2. **生产环境用 PrismaSession** — 可靠持久
3. **长对话启用压缩** — 避免 Token 溢出
4. **设置合理的压缩阈值** — 根据模型上下文窗口调整
5. **恢复会话时传入 sessionId** — 确保加载正确的历史

## 下一步

- Human-in-the-Loop + Session → [11-hitl.md](./11-hitl.md)
- 上下文管理方式对比 → [09-context-and-dynamic-prompt.md](./09-context-and-dynamic-prompt.md)
