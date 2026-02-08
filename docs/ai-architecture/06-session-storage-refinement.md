# Session 存储架构优化方案

> 基于 Tachikoma 多智能体系统的 Session 管理经验，优化 coobee-ai 的存储架构
>
> 创建时间：2026-02-04

---

## 目录

1. [核心设计调整](#核心设计调整)
2. [优化后的目录结构](#优化后的目录结构)
3. [SessionStore 增强设计](#sessionstore-增强设计)
4. [与现有架构的对比](#与现有架构的对比)
5. [实施建议](#实施建议)

---

## 核心设计调整

### 问题分析

**原方案**：

```
SessionStore（统一管理）
├── 数据库：Session 元数据
└── 文件：{sessionId}.jsonl（完整对话历史）
```

**问题**：

1. ❌ **缺少 Task 概念** - 一个 Session 可能有多轮对话，每轮是一个 Task
2. ❌ **缺少产物管理** - Agent 生成的代码、文件没有明确的存储位置
3. ❌ **缺少状态跟踪** - 无法追踪 Agent 的执行状态（thinking、acting）
4. ❌ **缺少工具调用日志** - 无法查看详细的工具调用记录

### 优化后的设计

```
SessionStore（三层存储）
├── 数据库（SQLite）
│   ├── sessions 表：Session 元数据
│   ├── tasks 表：Task 元数据（每轮对话一个 Task）
│   └── tool_executions 表：工具执行记录
│
├── 文件存储（JSONL + 目录）
│   └── sessions/{sessionId}/
│       ├── session.jsonl           # 对话历史（追加式）
│       ├── tasks/                  # 任务目录
│       │   ├── {taskId}.jsonl      # 任务执行日志
│       │   └── {taskId}.json       # 任务元数据
│       ├── artifacts/              # 产物目录
│       │   ├── code/
│       │   ├── documents/
│       │   └── images/
│       └── logs/                   # 详细日志
│           ├── thinking.jsonl      # 思考过程
│           └── actions.jsonl       # 工具调用
│
└── WebSocket 消息流（实时）
    └── 推送给前端的实时状态更新
```

---

## 优化后的目录结构

```
userData/
└── ai/
    ├── database/
    │   └── sessions.db             # SQLite 数据库
    │
    └── sessions/
        ├── {sessionId}/
        │   ├── session.jsonl       # 🔥 对话历史（每行一条消息）
        │   │   {"role":"user","content":"实现登录功能","timestamp":...}
        │   │   {"role":"assistant","taskId":"task-001","content":"...","timestamp":...}
        │   │   {"role":"user","content":"添加注册功能","timestamp":...}
        │   │   {"role":"assistant","taskId":"task-002","content":"...","timestamp":...}
        │   │
        │   ├── tasks/              # 🔥 任务目录
        │   │   ├── task-001/
        │   │   │   ├── metadata.json       # 任务元数据
        │   │   │   │   {
        │   │   │   │     "taskId": "task-001",
        │   │   │   │     "sessionId": "sess-001",
        │   │   │   │     "objective": "实现用户登录功能",
        │   │   │   │     "status": "completed",
        │   │   │   │     "startedAt": 1738595200000,
        │   │   │   │     "completedAt": 1738595300000,
        │   │   │   │     "agentType": "code-agent",
        │   │   │   │     "model": "gpt-4"
        │   │   │   │   }
        │   │   │   │
        │   │   │   ├── execution.jsonl     # 执行日志
        │   │   │   │   {"type":"thinking","content":"分析需求...","timestamp":...}
        │   │   │   │   {"type":"tool_call","tool":"edit_file","params":{...},"timestamp":...}
        │   │   │   │   {"type":"tool_result","success":true,"output":"...","timestamp":...}
        │   │   │   │
        │   │   │   └── summary.md          # 任务总结（可选）
        │   │   │
        │   │   └── task-002/
        │   │       └── ...
        │   │
        │   ├── artifacts/          # 🔥 产物目录
        │   │   ├── code/           # Agent 生成的代码
        │   │   │   ├── auth.ts
        │   │   │   └── user.ts
        │   │   ├── documents/      # Agent 生成的文档
        │   │   │   └── api-spec.md
        │   │   └── images/         # Agent 生成的图片
        │   │       └── diagram.png
        │   │
        │   └── logs/               # 🔥 详细日志（可选，用于调试）
        │       ├── thinking.jsonl  # 所有思考过程
        │       └── actions.jsonl   # 所有工具调用
        │
        └── {sessionId2}/
            └── ...
```

---

## SessionStore 增强设计

### 数据库 Schema

```sql
-- Session 表（元数据）
CREATE TABLE IF NOT EXISTS ai_sessions (
  id TEXT PRIMARY KEY,                  -- session-{uuid}
  agent_type TEXT NOT NULL,             -- 'chat', 'code', 'research'
  model TEXT NOT NULL,                  -- 'gpt-4', 'claude-3.5-sonnet'
  config JSON,                          -- 配置（温度、max_tokens等）
  status TEXT NOT NULL,                 -- 'active', 'completed', 'error'
  message_count INTEGER DEFAULT 0,      -- 消息数量
  task_count INTEGER DEFAULT 0,         -- 任务数量
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Task 表（每轮对话一个 Task）⭐ 新增
CREATE TABLE IF NOT EXISTS ai_tasks (
  id TEXT PRIMARY KEY,                  -- task-{uuid}
  session_id TEXT NOT NULL,             -- 关联 Session
  objective TEXT NOT NULL,              -- 任务目标
  agent_type TEXT NOT NULL,             -- Agent 类型
  model TEXT NOT NULL,                  -- 使用的模型
  status TEXT NOT NULL,                 -- 'pending', 'running', 'completed', 'failed'
  started_at INTEGER,
  completed_at INTEGER,
  duration_ms INTEGER,                  -- 执行时长
  tool_calls_count INTEGER DEFAULT 0,   -- 工具调用次数
  thinking_rounds INTEGER DEFAULT 0,    -- 思考轮数
  FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
);

-- 工具执行记录表
CREATE TABLE IF NOT EXISTS ai_tool_executions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_id TEXT,                         -- 关联 Task（可选）
  tool_name TEXT NOT NULL,
  parameters JSON NOT NULL,
  result JSON,
  status TEXT NOT NULL,                 -- 'success', 'failed', 'pending'
  error_message TEXT,
  execution_time_ms INTEGER,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES ai_tasks(id) ON DELETE SET NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_tasks_session ON ai_tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON ai_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tool_executions_session ON ai_tool_executions(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_executions_task ON ai_tool_executions(task_id);
```

### SessionStore API 设计

```typescript
// packages/ai-core/src/storage/stores/SessionStore.ts
import { DatabaseService } from '@main/common/database'
import { promises as fs } from 'fs'
import path from 'path'

export class SessionStore {
  private sessionsDir: string

  constructor(
    private db: DatabaseService,
    dataDir: string
  ) {
    this.sessionsDir = path.join(dataDir, 'sessions')
  }

  // ===== Session 管理 =====

  /**
   * 创建新会话
   */
  async createSession(session: {
    id: string
    agentType: string
    model: string
    config: any
  }): Promise<string> {
    // 1. 保存元数据到数据库
    await this.db.execute(
      `INSERT INTO ai_sessions (id, agent_type, model, config, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      [
        session.id,
        session.agentType,
        session.model,
        JSON.stringify(session.config),
        Date.now(),
        Date.now()
      ]
    )

    // 2. 创建文件目录结构
    const sessionDir = path.join(this.sessionsDir, session.id)
    await fs.mkdir(path.join(sessionDir, 'tasks'), { recursive: true })
    await fs.mkdir(path.join(sessionDir, 'artifacts/code'), { recursive: true })
    await fs.mkdir(path.join(sessionDir, 'artifacts/documents'), { recursive: true })
    await fs.mkdir(path.join(sessionDir, 'artifacts/images'), { recursive: true })
    await fs.mkdir(path.join(sessionDir, 'logs'), { recursive: true })

    // 3. 创建空的 session.jsonl
    await fs.writeFile(path.join(sessionDir, 'session.jsonl'), '', 'utf-8')

    return session.id
  }

  /**
   * 添加消息到会话（对话历史）
   */
  async appendMessage(
    sessionId: string,
    message: {
      role: 'user' | 'assistant' | 'system'
      content: string
      taskId?: string // assistant 消息关联的 taskId
    }
  ): Promise<void> {
    const sessionFile = path.join(this.sessionsDir, sessionId, 'session.jsonl')
    const line =
      JSON.stringify({
        ...message,
        timestamp: Date.now()
      }) + '\n'

    await fs.appendFile(sessionFile, line, 'utf-8')

    // 更新数据库的消息计数和时间
    await this.db.execute(
      `UPDATE ai_sessions 
       SET message_count = message_count + 1, updated_at = ? 
       WHERE id = ?`,
      [Date.now(), sessionId]
    )
  }

  /**
   * 获取会话的所有消息
   */
  async getMessages(sessionId: string): Promise<
    Array<{
      role: string
      content: string
      taskId?: string
      timestamp: number
    }>
  > {
    const sessionFile = path.join(this.sessionsDir, sessionId, 'session.jsonl')
    const content = await fs.readFile(sessionFile, 'utf-8')

    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
  }

  // ===== Task 管理 ===== ⭐ 新增

  /**
   * 创建新任务
   */
  async createTask(task: {
    id: string
    sessionId: string
    objective: string
    agentType: string
    model: string
  }): Promise<string> {
    // 1. 保存元数据到数据库
    await this.db.execute(
      `INSERT INTO ai_tasks (id, session_id, objective, agent_type, model, status, started_at)
       VALUES (?, ?, ?, ?, ?, 'running', ?)`,
      [task.id, task.sessionId, task.objective, task.agentType, task.model, Date.now()]
    )

    // 2. 创建任务目录
    const taskDir = path.join(this.sessionsDir, task.sessionId, 'tasks', task.id)
    await fs.mkdir(taskDir, { recursive: true })

    // 3. 写入任务元数据文件
    await fs.writeFile(
      path.join(taskDir, 'metadata.json'),
      JSON.stringify(
        {
          taskId: task.id,
          sessionId: task.sessionId,
          objective: task.objective,
          agentType: task.agentType,
          model: task.model,
          status: 'running',
          startedAt: Date.now()
        },
        null,
        2
      ),
      'utf-8'
    )

    // 4. 创建空的执行日志
    await fs.writeFile(path.join(taskDir, 'execution.jsonl'), '', 'utf-8')

    // 5. 更新 Session 的任务计数
    await this.db.execute('UPDATE ai_sessions SET task_count = task_count + 1 WHERE id = ?', [
      task.sessionId
    ])

    return task.id
  }

  /**
   * 追加任务执行日志
   */
  async appendTaskLog(
    sessionId: string,
    taskId: string,
    log: {
      type: 'thinking' | 'tool_call' | 'tool_result' | 'status'
      content?: string
      tool?: string
      params?: any
      result?: any
      success?: boolean
    }
  ): Promise<void> {
    const logFile = path.join(this.sessionsDir, sessionId, 'tasks', taskId, 'execution.jsonl')
    const line =
      JSON.stringify({
        ...log,
        timestamp: Date.now()
      }) + '\n'

    await fs.appendFile(logFile, line, 'utf-8')
  }

  /**
   * 完成任务
   */
  async completeTask(
    sessionId: string,
    taskId: string,
    result: {
      status: 'completed' | 'failed'
      error?: string
      summary?: string
    }
  ): Promise<void> {
    const completedAt = Date.now()

    // 1. 更新数据库
    const taskRow = await this.db.get('SELECT started_at FROM ai_tasks WHERE id = ?', [taskId])
    const duration = completedAt - taskRow.started_at

    await this.db.execute(
      `UPDATE ai_tasks 
       SET status = ?, completed_at = ?, duration_ms = ? 
       WHERE id = ?`,
      [result.status, completedAt, duration, taskId]
    )

    // 2. 更新任务元数据文件
    const metadataFile = path.join(this.sessionsDir, sessionId, 'tasks', taskId, 'metadata.json')
    const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf-8'))
    metadata.status = result.status
    metadata.completedAt = completedAt
    metadata.durationMs = duration
    if (result.error) metadata.error = result.error
    await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2), 'utf-8')

    // 3. 如果有总结，保存 summary.md
    if (result.summary) {
      const summaryFile = path.join(this.sessionsDir, sessionId, 'tasks', taskId, 'summary.md')
      await fs.writeFile(summaryFile, result.summary, 'utf-8')
    }
  }

  /**
   * 获取任务列表
   */
  async getTasks(sessionId: string): Promise<
    Array<{
      id: string
      objective: string
      status: string
      startedAt: number
      completedAt?: number
      durationMs?: number
    }>
  > {
    const rows = await this.db.all(
      `SELECT id, objective, status, started_at, completed_at, duration_ms 
       FROM ai_tasks 
       WHERE session_id = ? 
       ORDER BY started_at ASC`,
      [sessionId]
    )

    return rows.map((row) => ({
      id: row.id,
      objective: row.objective,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms
    }))
  }

  // ===== 工具执行记录 =====

  /**
   * 记录工具执行
   */
  async recordToolExecution(execution: {
    id: string
    sessionId: string
    taskId?: string
    toolName: string
    parameters: any
    result?: any
    status: 'success' | 'failed' | 'pending'
    error?: string
    executionTimeMs?: number
  }): Promise<void> {
    await this.db.execute(
      `INSERT INTO ai_tool_executions 
       (id, session_id, task_id, tool_name, parameters, result, status, error_message, execution_time_ms, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        execution.id,
        execution.sessionId,
        execution.taskId || null,
        execution.toolName,
        JSON.stringify(execution.parameters),
        execution.result ? JSON.stringify(execution.result) : null,
        execution.status,
        execution.error || null,
        execution.executionTimeMs || null,
        Date.now()
      ]
    )
  }

  // ===== 产物管理 ===== ⭐ 新增

  /**
   * 保存代码产物
   */
  async saveCodeArtifact(sessionId: string, filename: string, content: string): Promise<string> {
    const artifactPath = path.join(this.sessionsDir, sessionId, 'artifacts/code', filename)
    await fs.mkdir(path.dirname(artifactPath), { recursive: true })
    await fs.writeFile(artifactPath, content, 'utf-8')
    return artifactPath
  }

  /**
   * 保存文档产物
   */
  async saveDocumentArtifact(
    sessionId: string,
    filename: string,
    content: string
  ): Promise<string> {
    const artifactPath = path.join(this.sessionsDir, sessionId, 'artifacts/documents', filename)
    await fs.mkdir(path.dirname(artifactPath), { recursive: true })
    await fs.writeFile(artifactPath, content, 'utf-8')
    return artifactPath
  }

  /**
   * 列出所有产物
   */
  async listArtifacts(sessionId: string): Promise<{
    code: string[]
    documents: string[]
    images: string[]
  }> {
    const artifactsDir = path.join(this.sessionsDir, sessionId, 'artifacts')

    const listFiles = async (subdir: string): Promise<string[]> => {
      const dir = path.join(artifactsDir, subdir)
      try {
        return await fs.readdir(dir)
      } catch {
        return []
      }
    }

    return {
      code: await listFiles('code'),
      documents: await listFiles('documents'),
      images: await listFiles('images')
    }
  }
}
```

---

## 与现有架构的对比

### 原方案 vs 优化方案

| 维度             | 原方案              | 优化方案                | 改进          |
| ---------------- | ------------------- | ----------------------- | ------------- |
| **Session 概念** | 单一 Session        | Session + Task 分层     | ✅ 更清晰     |
| **对话历史**     | `{sessionId}.jsonl` | `session.jsonl`         | ✅ 更语义化   |
| **任务管理**     | ❌ 无               | `tasks/{taskId}/`       | ✅ 新增       |
| **产物管理**     | ❌ 无               | `artifacts/`            | ✅ 新增       |
| **执行日志**     | 混在对话历史        | `execution.jsonl`       | ✅ 分离关注点 |
| **工具调用**     | ❌ 无单独记录       | `ai_tool_executions` 表 | ✅ 可查询     |
| **实时监控**     | ❌ 无               | WebSocket 推送          | ✅ 可观测     |

### 数据流对比

**原方案**：

```
User Message → SessionStore.appendMessage() → {sessionId}.jsonl
Agent Response → SessionStore.appendMessage() → {sessionId}.jsonl
```

**优化方案**：

```
1️⃣ 用户发起对话
   User Message → SessionStore.appendMessage() → session.jsonl

2️⃣ 创建任务
   Create Task → SessionStore.createTask()
   ├─ Database: ai_tasks 表
   └─ File: tasks/{taskId}/metadata.json

3️⃣ Agent 执行
   Thinking → SessionStore.appendTaskLog() → tasks/{taskId}/execution.jsonl
   Tool Call → SessionStore.appendTaskLog() + recordToolExecution()
   Tool Result → SessionStore.appendTaskLog()

4️⃣ 生成产物
   Code → SessionStore.saveCodeArtifact() → artifacts/code/auth.ts

5️⃣ 任务完成
   Complete Task → SessionStore.completeTask()
   ├─ Update Database
   ├─ Update metadata.json
   └─ Create summary.md

6️⃣ 返回响应
   Agent Response → SessionStore.appendMessage() → session.jsonl
```

---

## 实施建议

### 阶段 1: 数据库 Schema 更新（1 天）

```bash
# 1. 创建新表
packages/ai-core/src/storage/schemas/
├── sessions.sql        # Session 表
├── tasks.sql          # Task 表（新增）
└── tool_executions.sql # 工具执行表
```

### 阶段 2: SessionStore 重构（2-3 天）

```bash
# 2. 重构 SessionStore
packages/ai-core/src/storage/stores/SessionStore.ts
├─ 保留原有方法（向后兼容）
├─ 新增 Task 管理方法
├─ 新增产物管理方法
└─ 新增日志管理方法
```

### 阶段 3: AI Gateway 集成（1 天）

```typescript
// packages/ai-gateway/src/AgentGateway.ts
export class AgentGateway {
  private sessionStore: SessionStore

  private async handleMessage(message: any): Promise<any> {
    const { type, payload } = message

    switch (type) {
      case 'create-session':
        return await this.createSession(payload)

      case 'send-message': {
        const { sessionId, message } = payload

        // 1. 记录用户消息
        await this.sessionStore.appendMessage(sessionId, {
          role: 'user',
          content: message
        })

        // 2. 创建新任务
        const taskId = `task-${Date.now()}`
        await this.sessionStore.createTask({
          id: taskId,
          sessionId,
          objective: message,
          agentType: 'chat',
          model: 'gpt-4'
        })

        // 3. 执行 Agent
        const agent = this.agents.get(sessionId)
        let response = ''

        for await (const event of agent.execute(message)) {
          switch (event.type) {
            case 'thinking':
              // 记录思考过程
              await this.sessionStore.appendTaskLog(sessionId, taskId, {
                type: 'thinking',
                content: event.content
              })
              break

            case 'tool_call':
              // 记录工具调用
              await this.sessionStore.appendTaskLog(sessionId, taskId, {
                type: 'tool_call',
                tool: event.tool,
                params: event.input
              })
              break

            case 'tool_result':
              // 记录工具结果
              await this.sessionStore.appendTaskLog(sessionId, taskId, {
                type: 'tool_result',
                tool: event.tool,
                result: event.result,
                success: event.success
              })
              break

            case 'output':
              response = event.content
              break
          }
        }

        // 4. 完成任务
        await this.sessionStore.completeTask(sessionId, taskId, {
          status: 'completed',
          summary: response
        })

        // 5. 记录 Agent 响应
        await this.sessionStore.appendMessage(sessionId, {
          role: 'assistant',
          content: response,
          taskId
        })

        return { response, taskId }
      }
    }
  }
}
```

### 阶段 4: 前端集成（1 天）

```typescript
// src/renderer/src/services/aiClient.ts
export class AIClient {
  // ...

  /**
   * 获取会话的所有任务
   */
  async getTasks(sessionId: string): Promise<Task[]> {
    // 通过 WebSocket 或 IPC 请求
    return this.request('get-tasks', { sessionId })
  }

  /**
   * 获取任务执行日志
   */
  async getTaskLogs(sessionId: string, taskId: string): Promise<LogEntry[]> {
    return this.request('get-task-logs', { sessionId, taskId })
  }

  /**
   * 获取产物列表
   */
  async getArtifacts(sessionId: string): Promise<Artifacts> {
    return this.request('get-artifacts', { sessionId })
  }
}
```

---

## 总结

### 核心改进点

1. ✅ **Task 概念** - 一个 Session 多个 Task，更清晰
2. ✅ **分层存储** - 数据库（快速查询）+ 文件（完整记录）
3. ✅ **产物管理** - 明确的 `artifacts/` 目录
4. ✅ **执行日志** - 详细的 `execution.jsonl` 记录
5. ✅ **工具追踪** - 独立的工具执行记录表
6. ✅ **向后兼容** - 保留原有 API，平滑升级

### 实施时间

- **总计：5-6 天**
  - Day 1: Schema 更新
  - Day 2-4: SessionStore 重构
  - Day 5: AI Gateway 集成
  - Day 6: 前端集成 + 测试

---

**参考资料**：

- [Tachikoma Session 管理](./Orchestrator-Worker交互机制深度解析.md#session与多任务管理)
- [文件协议规范](./Orchestrator-Worker交互机制深度解析.md#文件协议规范)
