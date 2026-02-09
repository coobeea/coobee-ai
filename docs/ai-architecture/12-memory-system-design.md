# 记忆系统设计

完整的记忆管理系统，包含三类记忆和上下文压缩策略。

---

## 📊 记忆系统概览

### 四类记忆

根据 Tachikoma 的设计和认知科学理论，我们的记忆系统包含**四类**：

```
┌────────────────────────────────────────────────────────────┐
│                    记忆系统架构                              │
└────────────────────────────────────────────────────────────┘

1️⃣ Session Memory（会话记忆）
   ├─ 定义: 单次会话的完整对话历史
   ├─ 范围: 从会话开始到结束的所有消息
   ├─ 存储: 文件系统（JSONL） + SQLite 元数据
   └─ 用途: 完整追溯、审计、分析

2️⃣ Short-Term Memory（短期记忆 / 上下文窗口）
   ├─ 定义: LLM 上下文窗口内的活跃记忆
   ├─ 范围: 最近 N 轮对话（受模型限制）
   ├─ 存储: 内存（Session 对象）
   ├─ 压缩策略:
   │  ├─ Trimming（修剪）: 保留最近 N 轮
   │  └─ Summarization（总结）: 压缩旧对话为摘要
   └─ 用途: 当前任务执行的即时上下文

3️⃣ Working Memory / State（工作记忆 / 状态）⭐ 新增
   ├─ 定义: 当前会话的临时变量和状态
   ├─ 范围: 任务ID、进度、中间结果、检查点
   ├─ 存储: 内存 + 文件（session.variables, progress.json）
   ├─ 特点:
   │  ├─ 结构化数据（非对话）
   │  ├─ 快速读写
   │  ├─ 支持断点续传
   │  └─ 任务级隔离
   └─ 用途:
      ├─ 存储当前计划
      ├─ 跟踪子任务状态
      ├─ 保存中间结果
      └─ 记录检查点

4️⃣ Long-Term Memory（长期记忆 / 知识库）
   ├─ 定义: 跨会话的持久化知识
   ├─ 范围: 用户偏好、经验教训、重要信息
   ├─ 存储: 向量数据库（可选）+ SQLite
   ├─ 检索: 语义搜索
   └─ 用途:
      ├─ 用户偏好记忆
      ├─ 失败教训
      └─ 成功经验
```

---

## 🔧 @openai/agents SDK 的上下文压缩支持

### SDK 原生功能

@openai/agents SDK 提供了两种上下文压缩方式：

#### 1. **Trimming（修剪）**

保留最近 N 轮对话，丢弃旧的。

**优点**:

- ✅ 确定性、简单
- ✅ 零额外延迟（无需额外模型调用）
- ✅ 最近的内容保持原样（适合调试）
- ✅ 无"摘要漂移"风险

**缺点**:

- ❌ 突然遗忘长期上下文
- ❌ 用户体验"失忆"
- ❌ 早期的重要信息被丢弃
- ❌ 如果最近一轮包含大量数据，仍可能爆掉上下文

**适用场景**:

- 任务之间独立，不需要携带历史细节
- 需要可预测性、易于评估、低延迟
- 最近几步比远期历史重要得多

#### 2. **Summarization（总结）**

将旧的对话压缩成结构化摘要，注入到对话历史中。

**优点**:

- ✅ 保留长期记忆（紧凑形式）
- ✅ 更平滑的用户体验（记住承诺和约束）
- ✅ 成本可控（一个摘要替代数百轮对话）
- ✅ 可搜索的锚点

**缺点**:

- ❌ 摘要可能丢失细节或偏差
- ❌ 增加延迟和成本（每次刷新需要模型调用）
- ❌ 错误传播（"上下文污染"）
- ❌ 可观测性复杂（需要记录摘要过程）

**适用场景**:

- 任务需要跨多轮的累积上下文
- 规划、指导、RAG 密集型分析
- 会话超过 N 轮但必须保留决策和约束

---

## 🏗️ 我们的实现方案

### 1. Session Memory（会话记忆）

完整存储所有对话，用于追溯和分析。

```typescript
// src/main/ai/memory/SessionMemoryStore.ts

/**
 * 会话记忆存储
 * 负责完整持久化对话历史
 */
export class SessionMemoryStore {
  constructor(
    private sessionManager: SessionFileManager,
    private sessionId: string
  ) {}

  /**
   * 追加消息到会话历史
   */
  async appendMessage(message: {
    role: 'user' | 'assistant' | 'tool'
    content: string
    timestamp?: number
    metadata?: Record<string, unknown>
  }): Promise<void> {
    const entry = {
      ...message,
      timestamp: message.timestamp || Date.now()
    }

    // 写入 JSONL 文件
    await this.sessionManager.appendMessage(entry)
  }

  /**
   * 获取完整对话历史
   */
  async getHistory(limit?: number): Promise<Message[]> {
    const messages = await this.sessionManager.readMessages()
    return limit ? messages.slice(-limit) : messages
  }

  /**
   * 清空会话历史
   */
  async clearHistory(): Promise<void> {
    // 清空文件
    await this.sessionManager.clearSession()
  }
}
```

### 2. Short-Term Memory（短期记忆 / 上下文窗口）

使用 @openai/agents SDK 的 Session + 自定义压缩策略。

#### 方案 A: Trimming Session（修剪式）

```typescript
// src/main/ai/memory/TrimmingSession.ts

import { SessionABC } from '@openai/agents'
import type { TResponseInputItem } from '@openai/agents'

/**
 * 修剪式 Session
 * 只保留最近 N 轮对话
 */
export class TrimmingSession extends SessionABC {
  private items: TResponseInputItem[] = []

  constructor(
    private sessionId: string,
    private maxTurns: number = 8 // 保留最近8轮
  ) {
    super()
  }

  async getItems(limit?: number): Promise<TResponseInputItem[]> {
    const trimmed = this.trimToLastTurns(this.items)
    return limit ? trimmed.slice(-limit) : trimmed
  }

  async addItems(items: TResponseInputItem[]): Promise<void> {
    this.items.push(...items)
    this.items = this.trimToLastTurns(this.items)
  }

  async popItem(): Promise<TResponseInputItem | null> {
    return this.items.pop() || null
  }

  async clearSession(): Promise<void> {
    this.items = []
  }

  /**
   * 修剪到最近 N 轮
   * 一轮 = 一个 user 消息 + 之后的所有内容（assistant、tool）
   */
  private trimToLastTurns(items: TResponseInputItem[]): TResponseInputItem[] {
    let count = 0
    let startIdx = 0

    // 从后往前扫描，找到第 N 个 user 消息
    for (let i = items.length - 1; i >= 0; i--) {
      if (this.isUserMessage(items[i])) {
        count++
        if (count === this.maxTurns) {
          startIdx = i
          break
        }
      }
    }

    return items.slice(startIdx)
  }

  private isUserMessage(item: TResponseInputItem): boolean {
    if (typeof item === 'object' && item !== null) {
      return (item as any).role === 'user'
    }
    return false
  }
}
```

#### 方案 B: Summarizing Session（总结式）

```typescript
// src/main/ai/memory/SummarizingSession.ts

import { SessionABC } from '@openai/agents'
import type { TResponseInputItem } from '@openai/agents'
import { OpenAI } from 'openai'

/**
 * 总结式 Session
 * 保留最近 N 轮 + 将旧对话压缩成摘要
 */
export class SummarizingSession extends SessionABC {
  private records: Array<{
    msg: Record<string, unknown>
    meta: { synthetic?: boolean; kind?: string }
  }> = []

  constructor(
    private sessionId: string,
    private keepLastNTurns: number = 3,
    private contextLimit: number = 5,
    private openai: OpenAI,
    private summaryModel: string = 'gpt-4o'
  ) {
    super()
  }

  async getItems(limit?: number): Promise<TResponseInputItem[]> {
    const msgs = this.records.map((r) => r.msg as TResponseInputItem)
    return limit ? msgs.slice(-limit) : msgs
  }

  async addItems(items: TResponseInputItem[]): Promise<void> {
    // 1. 添加新消息
    for (const item of items) {
      this.records.push({
        msg: item as Record<string, unknown>,
        meta: { synthetic: false }
      })
    }

    // 2. 检查是否需要总结
    const userCount = this.countUserMessages()

    if (userCount > this.contextLimit) {
      await this.summarizeOldTurns()
    }
  }

  async popItem(): Promise<TResponseInputItem | null> {
    const rec = this.records.pop()
    return (rec?.msg as TResponseInputItem) || null
  }

  async clearSession(): Promise<void> {
    this.records = []
  }

  /**
   * 统计 user 消息数量
   */
  private countUserMessages(): number {
    return this.records.filter((r) => r.msg.role === 'user' && !r.meta.synthetic).length
  }

  /**
   * 总结旧对话
   */
  private async summarizeOldTurns(): Promise<void> {
    // 1. 找到保留边界（最近 N 轮的起点）
    const boundary = this.findKeepBoundary()

    // 2. 需要总结的部分
    const toSummarize = this.records.slice(0, boundary)
    const toKeep = this.records.slice(boundary)

    if (toSummarize.length === 0) {
      return
    }

    // 3. 调用 LLM 生成摘要
    const summary = await this.generateSummary(toSummarize.map((r) => r.msg))

    // 4. 替换为摘要 + 保留的最近 N 轮
    this.records = [
      {
        msg: {
          role: 'user',
          content: '总结一下我们之前的对话'
        },
        meta: { synthetic: true, kind: 'summary_prompt' }
      },
      {
        msg: {
          role: 'assistant',
          content: summary
        },
        meta: { synthetic: true, kind: 'summary' }
      },
      ...toKeep
    ]
  }

  /**
   * 找到保留边界（最近 N 轮的起点）
   */
  private findKeepBoundary(): number {
    let count = 0
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i].msg.role === 'user' && !this.records[i].meta.synthetic) {
        count++
        if (count === this.keepLastNTurns) {
          return i
        }
      }
    }
    return 0
  }

  /**
   * 生成摘要
   */
  private async generateSummary(messages: Record<string, unknown>[]): Promise<string> {
    const SUMMARY_PROMPT = `
你是一个对话总结助手。请将以下对话历史压缩成简洁的摘要（不超过200字）。

要求：
1. 保留关键信息：用户的需求、已解决的问题、重要的决策
2. 按时间顺序：最新的信息优先级更高
3. 去除冗余：重复的内容只保留最新版本
4. 标注未解决问题：如果有未完成的任务，明确列出
5. 不要编造信息：只总结对话中实际出现的内容

格式：
- **需求**: [用户的主要需求]
- **已完成**: [已解决的问题列表]
- **进行中**: [正在处理的任务]
- **待办**: [未解决的问题]
- **关键信息**: [重要的数据、决策、约束]
    `.trim()

    const historyText = messages
      .map((m) => `${String(m.role).toUpperCase()}: ${m.content}`)
      .join('\n')

    const response = await this.openai.chat.completions.create({
      model: this.summaryModel,
      messages: [
        { role: 'system', content: SUMMARY_PROMPT },
        { role: 'user', content: historyText }
      ],
      max_tokens: 400,
      temperature: 0.3 // 低温度，保证稳定性
    })

    return response.choices[0]?.message?.content || '无法生成摘要'
  }
}
```

### 3. Working Memory / State（工作记忆 / 状态）⭐

会话级别的临时变量和状态管理。

```typescript
// src/main/ai/memory/WorkingMemoryStore.ts

/**
 * 会话状态
 */
export interface SessionState {
  sessionId: string

  // 当前计划
  currentPlan?: {
    planVersion: number
    totalSubTasks: number
    completedSubTasks: number
  }

  // 子任务状态
  completedSubtasks: string[]
  pendingSubtasks: string[]
  failedSubtasks: string[]

  // 检查点（断点续传）
  checkpoints: Array<{
    id: string
    timestamp: number
    state: Record<string, unknown>
  }>

  // 自定义变量
  variables: Record<string, unknown>

  // 元数据
  createdAt: number
  updatedAt: number
}

/**
 * 工作记忆存储
 * 管理会话级别的临时状态
 */
export class WorkingMemoryStore {
  private state: SessionState

  constructor(
    private sessionManager: SessionFileManager,
    private sessionId: string
  ) {
    this.state = {
      sessionId,
      completedSubtasks: [],
      pendingSubtasks: [],
      failedSubtasks: [],
      checkpoints: [],
      variables: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  }

  /**
   * 初始化（从文件加载状态）
   */
  async initialize(): Promise<void> {
    const savedState = await this.sessionManager.readSharedContext()

    if (savedState && typeof savedState === 'object') {
      this.state = savedState as SessionState
    }

    console.log(`[WorkingMemoryStore] Initialized for session: ${this.sessionId}`)
  }

  // ========== 变量管理 ==========

  /**
   * 设置变量
   */
  async setVariable(key: string, value: unknown): Promise<void> {
    this.state.variables[key] = value
    this.state.updatedAt = Date.now()
    await this.persist()
  }

  /**
   * 获取变量
   */
  getVariable<T = unknown>(key: string): T | undefined {
    return this.state.variables[key] as T | undefined
  }

  /**
   * 删除变量
   */
  async deleteVariable(key: string): Promise<void> {
    delete this.state.variables[key]
    this.state.updatedAt = Date.now()
    await this.persist()
  }

  /**
   * 获取所有变量
   */
  getAllVariables(): Record<string, unknown> {
    return { ...this.state.variables }
  }

  // ========== 计划状态 ==========

  /**
   * 设置当前计划
   */
  async setCurrentPlan(plan: {
    planVersion: number
    totalSubTasks: number
    completedSubTasks: number
  }): Promise<void> {
    this.state.currentPlan = plan
    this.state.updatedAt = Date.now()
    await this.persist()
  }

  /**
   * 获取当前计划
   */
  getCurrentPlan() {
    return this.state.currentPlan
  }

  // ========== 子任务状态 ==========

  /**
   * 标记子任务完成
   */
  async markSubtaskCompleted(subtaskId: string): Promise<void> {
    // 从 pending 移除
    this.state.pendingSubtasks = this.state.pendingSubtasks.filter((id) => id !== subtaskId)

    // 添加到 completed
    if (!this.state.completedSubtasks.includes(subtaskId)) {
      this.state.completedSubtasks.push(subtaskId)
    }

    this.state.updatedAt = Date.now()
    await this.persist()
  }

  /**
   * 标记子任务失败
   */
  async markSubtaskFailed(subtaskId: string): Promise<void> {
    // 从 pending 移除
    this.state.pendingSubtasks = this.state.pendingSubtasks.filter((id) => id !== subtaskId)

    // 添加到 failed
    if (!this.state.failedSubtasks.includes(subtaskId)) {
      this.state.failedSubtasks.push(subtaskId)
    }

    this.state.updatedAt = Date.now()
    await this.persist()
  }

  /**
   * 添加待执行子任务
   */
  async addPendingSubtasks(subtaskIds: string[]): Promise<void> {
    for (const id of subtaskIds) {
      if (!this.state.pendingSubtasks.includes(id)) {
        this.state.pendingSubtasks.push(id)
      }
    }

    this.state.updatedAt = Date.now()
    await this.persist()
  }

  /**
   * 获取子任务状态
   */
  getSubtaskStatus() {
    return {
      completed: [...this.state.completedSubtasks],
      pending: [...this.state.pendingSubtasks],
      failed: [...this.state.failedSubtasks]
    }
  }

  // ========== 检查点管理 ==========

  /**
   * 创建检查点（断点续传）
   */
  async createCheckpoint(customState?: Record<string, unknown>): Promise<string> {
    const checkpoint = {
      id: `checkpoint-${Date.now()}`,
      timestamp: Date.now(),
      state: {
        ...this.state,
        ...customState
      }
    }

    this.state.checkpoints.push(checkpoint)
    await this.persist()

    console.log(`[WorkingMemoryStore] Created checkpoint: ${checkpoint.id}`)
    return checkpoint.id
  }

  /**
   * 恢复到检查点
   */
  async restoreCheckpoint(checkpointId: string): Promise<boolean> {
    const checkpoint = this.state.checkpoints.find((cp) => cp.id === checkpointId)

    if (!checkpoint) {
      return false
    }

    this.state = checkpoint.state as SessionState
    await this.persist()

    console.log(`[WorkingMemoryStore] Restored checkpoint: ${checkpointId}`)
    return true
  }

  /**
   * 列出所有检查点
   */
  listCheckpoints() {
    return this.state.checkpoints.map((cp) => ({
      id: cp.id,
      timestamp: cp.timestamp
    }))
  }

  // ========== 持久化 ==========

  /**
   * 持久化状态到文件
   */
  private async persist(): Promise<void> {
    await this.sessionManager.writeSharedContext(this.state)
  }

  /**
   * 获取完整状态
   */
  getState(): SessionState {
    return { ...this.state }
  }

  /**
   * 清空状态
   */
  async clearState(): Promise<void> {
    this.state = {
      sessionId: this.sessionId,
      completedSubtasks: [],
      pendingSubtasks: [],
      failedSubtasks: [],
      checkpoints: [],
      variables: {},
      createdAt: this.state.createdAt,
      updatedAt: Date.now()
    }

    await this.persist()
  }
}
```

**使用示例**：

```typescript
const workingMemory = new WorkingMemoryStore(sessionManager, sessionId)
await workingMemory.initialize()

// 存储任务 ID
await workingMemory.setVariable('currentTaskId', 'task-001')

// 存储用户偏好
await workingMemory.setVariable('preferredLanguage', 'zh-CN')

// 更新计划状态
await workingMemory.setCurrentPlan({
  planVersion: 2,
  totalSubTasks: 6,
  completedSubTasks: 3
})

// 标记子任务完成
await workingMemory.markSubtaskCompleted('subtask-001')

// 创建检查点（断点续传）
const checkpointId = await workingMemory.createCheckpoint({
  customData: 'some important state'
})

// 恢复检查点
await workingMemory.restoreCheckpoint(checkpointId)
```

### 4. Long-Term Memory（长期记忆）

跨会话的持久化知识库。

```typescript
// src/main/ai/memory/LongTermMemoryStore.ts

/**
 * 长期记忆存储
 * 跨会话的持久化知识
 */
export class LongTermMemoryStore {
  constructor(private db: DatabaseService) {}

  /**
   * 保存记忆条目
   */
  async saveMemory(memory: {
    type: 'preference' | 'lesson' | 'experience'
    content: string
    context?: string
    importance: number // 1-10
    userId?: string
    sessionId?: string
  }): Promise<string> {
    const id = generateSnowflakeId()

    await this.db.execute(
      `INSERT INTO long_term_memory 
       (id, type, content, context, importance, user_id, session_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        memory.type,
        memory.content,
        memory.context || null,
        memory.importance,
        memory.userId || null,
        memory.sessionId || null,
        Date.now()
      ]
    )

    return id
  }

  /**
   * 检索相关记忆
   */
  async retrieveMemories(query: {
    userId?: string
    type?: string
    limit?: number
    minImportance?: number
  }): Promise<Memory[]> {
    let sql = `SELECT * FROM long_term_memory WHERE 1=1`
    const params: unknown[] = []

    if (query.userId) {
      sql += ` AND user_id = ?`
      params.push(query.userId)
    }

    if (query.type) {
      sql += ` AND type = ?`
      params.push(query.type)
    }

    if (query.minImportance) {
      sql += ` AND importance >= ?`
      params.push(query.minImportance)
    }

    sql += ` ORDER BY importance DESC, created_at DESC`

    if (query.limit) {
      sql += ` LIMIT ?`
      params.push(query.limit)
    }

    const rows = await this.db.query<Record<string, unknown>>(sql, params)
    return rows as Memory[]
  }

  /**
   * 删除过期记忆
   */
  async cleanupOldMemories(daysToKeep: number = 90): Promise<number> {
    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000

    const result = await this.db.execute(
      `DELETE FROM long_term_memory 
       WHERE created_at < ? AND importance < 5`,
      [cutoffTime]
    )

    return result.changes || 0
  }
}
```

### 数据库 Schema

```sql
-- long_term_memory.sql

CREATE TABLE IF NOT EXISTS long_term_memory (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,  -- 'preference' | 'lesson' | 'experience'
  content TEXT NOT NULL,
  context TEXT,
  importance INTEGER NOT NULL,  -- 1-10
  user_id TEXT,
  session_id TEXT,
  embedding BLOB,  -- 可选：向量嵌入（未来）
  created_at INTEGER NOT NULL,
  accessed_at INTEGER,
  access_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ltm_user_type
  ON long_term_memory(user_id, type);

CREATE INDEX IF NOT EXISTS idx_ltm_importance
  ON long_term_memory(importance);

CREATE INDEX IF NOT EXISTS idx_ltm_created
  ON long_term_memory(created_at);
```

---

## 🎯 综合使用示例

```typescript
import {
  SessionMemoryStore,
  TrimmingSession,
  SummarizingSession,
  LongTermMemoryStore
} from '@main/ai/memory'
import { getSessionFileManager } from '@main/ai/storage'
import { OpenAI } from 'openai'

async function createMemorySystem(sessionId: string, userId?: string) {
  // 1. 会话文件管理器
  const sessionManager = getSessionFileManager(sessionId)
  await sessionManager.initialize()

  // 2. Session Memory（完整历史）
  const sessionMemory = new SessionMemoryStore(sessionManager, sessionId)

  // 3. Short-Term Memory（上下文窗口）
  // 选择策略：对于独立任务用 Trimming，复杂任务用 Summarizing
  const shortTermMemory = new SummarizingSession(
    sessionId,
    3, // 保留最近3轮
    5, // 超过5轮触发总结
    new OpenAI(),
    'gpt-4o'
  )

  // 4. Long-Term Memory（跨会话知识）
  const longTermMemory = new LongTermMemoryStore(db)

  return {
    sessionMemory,
    shortTermMemory,
    longTermMemory,

    // 便捷方法
    async addUserMessage(content: string) {
      const msg = { role: 'user' as const, content, timestamp: Date.now() }

      // 存储到完整历史
      await sessionMemory.appendMessage(msg)

      // 添加到上下文窗口
      await shortTermMemory.addItems([msg])
    },

    async addAssistantMessage(content: string) {
      const msg = { role: 'assistant' as const, content, timestamp: Date.now() }

      await sessionMemory.appendMessage(msg)
      await shortTermMemory.addItems([msg])
    },

    async saveImportantMemory(content: string, type: string, importance: number) {
      await longTermMemory.saveMemory({
        type: type as any,
        content,
        importance,
        userId,
        sessionId
      })
    },

    async getRelevantMemories(type?: string) {
      return await longTermMemory.retrieveMemories({
        userId,
        type,
        minImportance: 5,
        limit: 10
      })
    }
  }
}

// 使用示例
const memory = await createMemorySystem('session-123', 'user-456')

// 添加消息
await memory.addUserMessage('我想开发一个登录功能')
await memory.addAssistantMessage('好的，我们使用JWT认证')

// 保存重要信息到长期记忆
await memory.saveImportantMemory('用户偏好使用JWT认证', 'preference', 8)

// 检索相关记忆
const preferences = await memory.getRelevantMemories('preference')
```

---

## 📊 压缩策略选择指南

| 场景                    | 推荐策略    | 原因               |
| ----------------------- | ----------- | ------------------ |
| 简单工具调用（API操作） | Trimming    | 任务独立，低延迟   |
| 代码生成（单文件）      | Trimming    | 最近上下文最重要   |
| 多轮对话（客服）        | Summarizing | 需要记住早期承诺   |
| 复杂规划（项目管理）    | Summarizing | 需要累积决策       |
| RAG分析（文档问答）     | Summarizing | 需要综合多轮信息   |
| 调试任务                | Trimming    | 需要完整的错误堆栈 |

---

## 🚀 实施步骤

### Phase 1: 基础存储（已完成）

- ✅ SessionFileManager
- ✅ 会话目录管理

### Phase 2: Session Memory（1天）

- ✅ 实现 SessionMemoryStore
- ✅ JSONL 文件存储
- ✅ 消息追加和查询

### Phase 3: Short-Term Memory（2-3天）

- ✅ 实现 TrimmingSession
- ✅ 实现 SummarizingSession
- ✅ 集成到 AgentRuntime

### Phase 4: Long-Term Memory（2-3天）

- ✅ 数据库 Schema
- ✅ LongTermMemoryStore
- ✅ 检索和管理API

### Phase 5: 测试和优化（2天）

- ✅ 单元测试
- ✅ 压缩效果评估
- ✅ 性能优化

---

## 📚 参考资料

- [OpenAI Agents SDK - Sessions](https://openai.github.io/openai-agents-js/guides/sessions/)
- [Context Engineering Cookbook](https://cookbook.openai.com/examples/agents_sdk/session_memory)
- [Tachikoma Memory Management](./Orchestrator-Worker交互机制深度解析.md#memory-management---记忆管理)
