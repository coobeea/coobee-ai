# 架构方案对比分析

> 对比原架构文档 vs 改进意见，给出客观评估和建议
>
> 分析时间：2026-02-04

---

## 📊 对比总览

| 维度         | 原架构文档 | 改进意见         | 评估结果  |
| ------------ | ---------- | ---------------- | --------- |
| **技术选型** | 多模型支持 | 统一 OpenAI      | ⚠️ 需讨论 |
| **目录结构** | 独立完整   | 与 common 整合   | ✅ 采纳   |
| **数据库**   | 独立设计   | 复用现有         | ✅ 采纳   |
| **IPC 通信** | 新设计     | 扩展现有         | ✅ 采纳   |
| **事件系统** | 新建       | 复用 EventBus    | ✅ 采纳   |
| **窗口集成** | 未明确     | Tab-Session 映射 | ✅ 采纳   |

---

## 1. 技术选型对比

### 1.1 模型选择

#### 原文档方案：多模型支持

```typescript
{
  "llm": "@anthropic-ai/sdk",      // Claude SDK
  "core": "@openai/agents",        // OpenAI Agents 框架
}
```

**优点**：

- ✅ 灵活性高，可以根据任务选择最合适的模型
- ✅ Claude 在某些任务上表现更好（如长文本理解）
- ✅ 避免单点依赖

**缺点**：

- ❌ 集成复杂度高，需要适配多个 SDK
- ❌ 维护成本高
- ❌ 不同模型行为差异大，难以统一

#### 改进意见：统一 OpenAI

```typescript
{
  "core": "@openai/agents",    // OpenAI Agents 框架
  "sdk": "openai",             // OpenAI SDK (统一使用)
}
```

**优点**：

- ✅ 简化实现，降低复杂度
- ✅ `@openai/agents` 框架原生支持
- ✅ 统一的 API 和行为
- ✅ 更快的开发速度

**缺点**：

- ❌ 失去模型选择灵活性
- ❌ 成本可能更高（OpenAI 价格）
- ❌ 受限于 OpenAI 的生态

### 1.2 推荐方案 ⭐

**折中方案：框架统一，模型可选**

```typescript
// 使用 @openai/agents 框架（统一）
// 但通过 Model Provider 机制支持多模型

import { Agent, ModelProvider } from '@openai/agents'

// 1. 默认使用 OpenAI
const defaultAgent = new Agent({
  name: 'Chat Agent',
  model: 'gpt-4-turbo', // OpenAI 模型
  instructions: '...'
})

// 2. 可选支持 Claude（通过自定义 Provider）
const customProvider: ModelProvider = {
  async chat(messages, options) {
    // 适配 Claude API
    const anthropic = new Anthropic()
    return await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      messages
    })
  }
}

const claudeAgent = new Agent({
  name: 'Claude Agent',
  modelProvider: customProvider,
  instructions: '...'
})
```

**结论**：

- ✅ **主推 OpenAI**（简化实现，快速迭代）
- ⚠️ **保留扩展性**（预留 ModelProvider 接口）
- ⏰ **后续按需**（如果需要 Claude，可以快速接入）

---

## 2. 目录结构对比

### 2.1 原文档方案

```
src/main/ai/
├── agents/       # 智能体
├── tools/        # 工具
├── skills/       # 技能
├── runtime/      # 运行时
├── services/     # 服务层
│   ├── llm/      # LLM 服务
│   ├── memory/   # 记忆服务
│   └── mcp/      # MCP 集成
├── storage/      # 数据存储
└── types/        # 类型定义
```

**评估**：

- ✅ 结构清晰，职责明确
- ❌ 与现有架构有重复（services、storage）

### 2.2 改进意见

```
src/main/
├── common/       # 现有基础设施（保留）
│   ├── database/ # 数据库（复用）✅
│   ├── ipc/      # IPC（扩展）✅
│   ├── eventbus/ # 事件总线（复用）✅
│   └── ...
└── ai/           # 新增 AI 模块
    ├── agents/   # 智能体定义
    ├── runtime/  # 运行时管理
    ├── tools/    # 工具系统
    ├── skills/   # 技能系统
    └── types/    # AI 类型定义
```

**评估**：

- ✅ 复用现有基础设施，避免重复
- ✅ 保持 AI 模块的独立性
- ✅ 更符合项目现状

### 2.3 推荐方案 ⭐

**采纳改进意见，进一步细化**：

```
src/main/
├── common/                    # 基础设施层（已有）
│   ├── app/                  # AppManager ← AI 集成点
│   ├── window/               # WindowManager ← Session 映射
│   ├── database/             # ← AI 复用
│   ├── eventbus/             # ← AI 复用
│   ├── ipc/                  # ← AI 扩展
│   └── ...
│
└── ai/                        # AI 智能体层（新增）
    ├── core/                  # 核心运行时
    │   ├── AgentRuntime.ts   # 运行时管理器
    │   ├── SessionManager.ts # 会话管理
    │   ├── AgentManager.ts   # 智能体管理
    │   └── index.ts
    │
    ├── agents/                # 智能体定义
    │   ├── triage/           # 分发智能体
    │   ├── chat/             # 对话智能体
    │   ├── research/         # 研究智能体
    │   └── index.ts
    │
    ├── tools/                 # 工具系统
    │   ├── registry/         # 工具注册表
    │   ├── web/              # 联网工具
    │   ├── file/             # 文件工具
    │   └── index.ts
    │
    ├── skills/                # 技能系统
    │   ├── manager/          # 技能管理器
    │   ├── builtin/          # 内置技能
    │   └── index.ts
    │
    ├── storage/               # AI 数据层（薄封装）
    │   ├── MessageStore.ts   # 消息存储（使用 common/database）
    │   ├── SessionStore.ts   # 会话存储
    │   └── schemas.sql       # AI 数据表定义
    │
    ├── ipc/                   # AI IPC 处理器
    │   ├── AIHandlers.ts     # AI 相关 IPC
    │   └── index.ts
    │
    ├── types/                 # AI 类型定义
    │   ├── agent.ts
    │   ├── session.ts
    │   ├── tool.ts
    │   └── index.ts
    │
    └── index.ts               # AI 模块统一导出
```

**优势**：

- ✅ 复用 `common/database`（不重复造轮子）
- ✅ 复用 `common/eventbus`（统一事件系统）
- ✅ 扩展 `common/ipc`（保持一致性）
- ✅ AI 模块职责清晰（只关注智能体逻辑）

**结论**：✅ **完全采纳改进意见的目录结构**

---

## 3. 数据库集成对比

### 3.1 原文档方案

```
ai/storage/
├── SessionStore.ts
├── MemoryStore.ts
└── schemas.sql

// 独立的数据库管理
class AIDatabase {
  private db: Database

  async initialize() {
    this.db = new Database('ai.db')
    await this.runMigrations()
  }
}
```

**评估**：

- ❌ 与现有 `DatabaseService` 重复
- ❌ 需要管理多个数据库实例
- ❌ 增加复杂度

### 3.2 改进意见

```typescript
// 复用现有 DatabaseService
import { sqliteService } from '@main/common/database'

class MessageStore {
  async save(message: Message) {
    await sqliteService.execute(`
      INSERT INTO ai_conversations (...)
      VALUES (...)
    `, [...])
  }
}
```

**评估**：

- ✅ 复用现有基础设施
- ✅ 统一的数据库连接池
- ✅ 统一的迁移管理

**结论**：✅ **完全采纳，复用 `common/database`**

---

## 4. IPC 通信对比

### 4.1 原文档方案

```
设计新的 IPC 接口，没有明确如何与现有 IPC 整合
```

### 4.2 改进意见

```typescript
// 扩展现有 IPC 系统
// src/main/common/ipc/handlers/index.ts

import { registerShellHandlers } from './shellHandlers'
import { registerTabHandlers } from './tabHandlers'
import { registerAIHandlers } from '@main/ai/ipc/AIHandlers' // 新增

export function registerAllHandlers(): void {
  registerShellHandlers()
  registerTabHandlers()
  registerAIHandlers() // ✅ 统一注册
}
```

**评估**：

- ✅ 保持 IPC 架构一致性
- ✅ 统一的注册机制
- ✅ 易于维护和调试

**结论**：✅ **完全采纳，扩展现有 IPC 系统**

---

## 5. 事件系统对比

### 5.1 原文档方案

```
可能创建新的事件系统？（未明确）
```

### 5.2 改进意见

```typescript
// 复用现有 EventBus
import { eventBus } from '@main/common/eventbus'
import { AIEventTypes } from '@shared/events'

class AgentRuntime {
  async execute() {
    // 发送事件
    eventBus.emit(AIEventTypes.MESSAGE_RECEIVED, {
      sessionId,
      message
    })
  }
}

// 在 src/shared/events.ts 中扩展
export enum AIEventTypes {
  SESSION_CREATED = 'ai:session-created',
  MESSAGE_RECEIVED = 'ai:message-received'
  // ...
}
```

**评估**：

- ✅ 统一的事件系统
- ✅ 前后端共享事件定义
- ✅ 易于调试和监控

**结论**：✅ **完全采纳，复用现有 EventBus**

---

## 6. 与 WindowManager 集成

### 6.1 原文档问题

- 未明确说明如何与现有 WindowManager 集成
- SessionManager 可能与 WindowManager 的 Tab 管理有重复

### 6.2 改进意见

```typescript
// Tab ↔ Session ↔ AgentInstance 映射
WindowManager {
  tabs: Map<tabId, TabInfo>
}
    ↕ 映射关系
AgentRuntime {
  sessions: Map<sessionId, AISession>
}

// 实现方式
class AISession {
  id: string          // sessionId
  tabId: number       // 关联的 Tab ID ✅
  agentId: string     // 使用的智能体
  history: Message[]  // 对话历史
}

// 数据库关联
CREATE TABLE ai_sessions (
  id TEXT PRIMARY KEY,
  tab_id INTEGER NOT NULL,  -- ✅ 关联到现有 tabs 表
  FOREIGN KEY (tab_id) REFERENCES tabs(id)
)
```

**评估**：

- ✅ 清晰的映射关系
- ✅ 避免重复管理
- ✅ 利用现有 Tab 系统

**结论**：✅ **完全采纳，建立 Tab-Session 映射**

---

## 7. 与 AppManager 集成

### 7.1 改进意见

```typescript
export class AppManager {
  private agentRuntime!: AgentRuntimeManager

  async initialize() {
    // ... 现有逻辑

    // 新增：初始化 AI 运行时
    this.agentRuntime = new AgentRuntimeManager()
    await this.agentRuntime.initialize()
  }

  getAgentRuntime() {
    return this.agentRuntime
  }
}
```

**评估**：

- ✅ 清晰的集成点
- ✅ 统一的生命周期管理
- ✅ 易于访问 AI 功能

**结论**：✅ **完全采纳**

---

## 8. 不应该改的设计（原文档保留）

### 8.1 Skills 技能系统 ✅ 保留

**原因**：

- Skills 是高级抽象，不依赖具体模型
- OpenAI 和 Claude 都可以使用 Skills
- 这是业务逻辑层，不是技术实现层

### 8.2 多智能体构建系统 ✅ 保留

**原因**：

- Team/Pipeline/Parallel 模式是通用设计模式
- 不依赖具体的 LLM 提供商
- `@openai/agents` 框架原生支持

### 8.3 工具权限系统 ✅ 保留

**原因**：

- 权限控制是业务需求，不是技术限制
- 智能决策引擎 + 异步队列是核心创新
- OpenAI 也需要工具权限管理

### 8.4 消息推送方案（IPC + DB）✅ 保留

**原因**：

- 这是 Electron 架构的最佳实践
- 与使用哪个 LLM 无关
- 解决了窗口关闭后恢复的核心问题

---

## 9. 需要调整的地方

### 9.1 LLM 服务层简化

#### 原文档（复杂）

```
services/llm/
├── LLMClient.ts
├── ClaudeProvider.ts   ← 删除
├── GPTProvider.ts      ← 简化
└── types.ts
```

#### 优化后（简洁）

```
services/llm/
├── OpenAIClient.ts     # 统一使用 OpenAI SDK
└── types.ts
```

```typescript
// 简化的 LLM Client
class OpenAIClient {
  private client: OpenAI

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  }

  async chat(messages: Message[], options?: ChatOptions) {
    return await this.client.chat.completions.create({
      model: options?.model || 'gpt-4-turbo',
      messages,
      stream: options?.stream || false
    })
  }
}
```

### 9.2 Agent 创建简化

#### 原文档（通用但复杂）

```typescript
const agent = AgentFactory.create({
  type: AgentType.CHAT,
  config: {
    /* 复杂配置 */
  }
})
```

#### 优化后（直接使用 OpenAI Agents）

```typescript
import { Agent } from '@openai/agents'

const chatAgent = new Agent({
  name: 'Chat Agent',
  model: 'gpt-4-turbo',
  instructions: 'You are a helpful assistant.'
})
```

---

## 10. 最终推荐架构

### 10.1 技术栈（修正后）

```typescript
{
  "core": "@openai/agents",                    // ✅ OpenAI Agents 框架
  "llm": "openai",                             // ✅ OpenAI SDK
  "agentSDK": "@anthropic-ai/claude-agent-sdk", // ⚠️ 可选保留
  "mcp": "@modelcontextprotocol/sdk",          // ✅ MCP 协议
  "database": "better-sqlite3-multiple-ciphers", // ✅ 复用现有
  "validation": "zod"                          // ✅ 参数验证
}
```

### 10.2 目录结构（最终版）

```
src/main/
│
├── common/                         # 基础设施层（已有，扩展）
│   ├── app/                       # AppManager
│   │   └── index.ts              # ← 集成 AgentRuntime
│   ├── window/                    # WindowManager
│   │   └── WindowManager.ts      # ← Session-Tab 映射
│   ├── database/                  # DatabaseService
│   │   ├── SQLiteService.ts      # ← AI 复用
│   │   └── migrations/           # ← 添加 AI 表
│   ├── eventbus/                  # EventBus
│   │   └── index.ts              # ← AI 事件定义
│   ├── ipc/                       # IPC Handlers
│   │   └── handlers/
│   │       └── index.ts          # ← 注册 AI handlers
│   └── ...
│
└── ai/                             # AI 智能体层（新增）
    │
    ├── core/                       # 核心运行时
    │   ├── AgentRuntime.ts        # 主入口，与 AppManager 集成
    │   ├── SessionManager.ts      # AI 会话管理
    │   ├── AgentManager.ts        # 智能体实例管理
    │   ├── MessageBroadcaster.ts  # 消息推送器（IPC + DB）
    │   └── index.ts
    │
    ├── agents/                     # 智能体定义
    │   ├── triage/                # 分发智能体
    │   │   └── TriageAgent.ts
    │   ├── chat/                  # 对话智能体
    │   │   └── ChatAgent.ts
    │   ├── research/              # 研究智能体
    │   │   └── ResearchAgent.ts
    │   └── index.ts
    │
    ├── tools/                      # 工具系统
    │   ├── registry/              # 工具注册表
    │   │   ├── ToolRegistry.ts
    │   │   └── types.ts
    │   ├── web/                   # 联网工具
    │   │   ├── SearchTool.ts
    │   │   └── ScrapeTool.ts
    │   ├── file/                  # 文件工具
    │   │   ├── ReadTool.ts
    │   │   └── WriteTool.ts
    │   ├── permission/            # 权限系统
    │   │   ├── PermissionEngine.ts
    │   │   └── ApprovalQueue.ts
    │   └── index.ts
    │
    ├── skills/                     # 技能系统
    │   ├── manager/               # 技能管理器
    │   │   ├── SkillManager.ts
    │   │   └── types.ts
    │   ├── builtin/               # 内置技能
    │   │   ├── research.ts
    │   │   └── coding.ts
    │   └── index.ts
    │
    ├── storage/                    # AI 数据访问层（薄封装）
    │   ├── MessageStore.ts        # 使用 sqliteService
    │   ├── SessionStore.ts        # 使用 sqliteService
    │   ├── ToolStore.ts           # 使用 sqliteService
    │   └── schemas.sql            # AI 表定义
    │
    ├── ipc/                        # AI IPC 处理器
    │   ├── handlers.ts            # AI 相关 IPC handlers
    │   └── index.ts
    │
    ├── types/                      # AI 类型定义
    │   ├── agent.ts
    │   ├── session.ts
    │   ├── tool.ts
    │   ├── skill.ts
    │   └── index.ts
    │
    └── index.ts                    # 统一导出
```

### 10.3 集成点设计

```typescript
// 1. AppManager 集成（src/main/common/app/index.ts）
export class AppManager {
  private agentRuntime!: AgentRuntimeManager

  async initialize() {
    // ... 现有初始化

    // 初始化 AI 运行时
    const { AgentRuntimeManager } = await import('@main/ai')
    this.agentRuntime = new AgentRuntimeManager()
    await this.agentRuntime.initialize()
  }
}

// 2. WindowManager 映射（src/main/common/window/WindowManager.ts）
export class WindowManager {
  async createTab(windowId: number, config: TabConfig) {
    const tab = await this.createTabInternal(windowId, config)

    // 如果是 AI 对话 Tab，创建关联的 AI Session
    if (config.type === 'chat') {
      const { sessionManager } = await import('@main/ai')
      await sessionManager.createSession({
        tabId: tab.id,
        agentType: 'chat'
      })
    }

    return tab
  }
}

// 3. 数据库迁移（src/main/common/database/migrations/）
// 添加 AI 表迁移文件
export async function migration_006_ai_tables(db: Database) {
  await db.exec(`
    CREATE TABLE ai_sessions (...);
    CREATE TABLE ai_conversations (...);
    CREATE TABLE ai_tool_executions (...);
  `)
}

// 4. IPC 注册（src/main/common/ipc/handlers/index.ts）
import { registerAIHandlers } from '@main/ai/ipc'

export function registerAllHandlers() {
  registerShellHandlers()
  registerTabHandlers()
  registerAIHandlers() // ✅ 新增
}

// 5. EventBus 扩展（src/shared/events.ts）
export enum EventTypes {
  // ... 现有事件

  // AI 事件（新增）
  AI_SESSION_CREATED = 'ai:session-created',
  AI_MESSAGE_RECEIVED = 'ai:message-received',
  AI_TOOL_EXECUTING = 'ai:tool-executing',
  AI_STREAMING_CHUNK = 'ai:streaming-chunk'
}
```

---

## 11. 改进建议采纳情况

| 建议项                 | 原方案   | 改进意见        | 是否采纳    | 理由               |
| ---------------------- | -------- | --------------- | ----------- | ------------------ |
| **统一 OpenAI**        | 多模型   | OpenAI only     | ✅ 采纳     | 简化实现，快速迭代 |
| **目录与 common 并列** | ai/ 独立 | 与 common/ 同级 | ✅ 采纳     | 符合项目结构       |
| **复用 database**      | 独立 DB  | 复用现有        | ✅ 采纳     | 避免重复           |
| **扩展 IPC**           | 新建     | 扩展现有        | ✅ 采纳     | 保持一致性         |
| **复用 EventBus**      | 未明确   | 扩展现有        | ✅ 采纳     | 统一事件系统       |
| **Tab-Session 映射**   | 未明确   | 明确映射        | ✅ 采纳     | 关键整合点         |
| **与 AppManager 集成** | 未明确   | 明确集成        | ✅ 采纳     | 统一入口           |
| **Skills 系统**        | 详细设计 | 简化实现        | ⚠️ 部分采纳 | 保持概念，简化代码 |
| **多智能体**           | 详细设计 | 保持不变        | ✅ 保留     | 设计合理           |
| **权限系统**           | 详细设计 | 保持不变        | ✅ 保留     | 核心创新           |
| **消息推送**           | IPC + DB | 保持不变        | ✅ 保留     | 最佳实践           |

---

## 12. 最终建议

### ✅ 完全采纳的改进（8 项）

1. **统一使用 OpenAI 模型** - 简化技术栈
2. **AI 模块放在 `src/main/ai/`** - 与 common 并列
3. **复用现有 database** - 避免重复建设
4. **扩展现有 IPC 系统** - 保持架构一致
5. **复用现有 EventBus** - 统一事件机制
6. **建立 Tab-Session 映射** - 关键整合点
7. **与 AppManager 集成** - 统一生命周期
8. **数据库 Schema 关联** - `tab_id` 外键关联

### ⚠️ 部分采纳的改进（2 项）

1. **Skills 实现简化** - 保持概念，但初期简化实现
2. **LLM Client 简化** - 移除 Claude Provider，只保留 OpenAI

### ✅ 原文档保留的设计（5 项）

1. **Skills 技能系统概念** - 高级抽象，模型无关
2. **多智能体构建模式** - 通用设计模式
3. **工具权限系统** - 智能决策 + 异步队列
4. **消息推送方案** - IPC + DB 双保障
5. **分层架构** - Runtime / Services / Storage

---

## 13. 行动计划

### Phase 1: 基础集成（立即开始）

#### Week 1: 目录结构 + 数据库

- [ ] 创建 `src/main/ai/` 目录结构
- [ ] 在 `database/migrations/` 添加 AI 表迁移
- [ ] 实现 `MessageStore`（复用 sqliteService）
- [ ] 实现 `SessionStore`（复用 sqliteService）

#### Week 2: 核心运行时

- [ ] 实现 `AgentRuntimeManager`
- [ ] 在 `AppManager` 中集成 AI Runtime
- [ ] 实现基础的 `ChatAgent`（OpenAI）
- [ ] 实现 `MessageBroadcaster`（IPC + DB）

#### Week 3: IPC + 事件

- [ ] 扩展 `src/shared/events.ts`（添加 AI 事件）
- [ ] 实现 `src/main/ai/ipc/handlers.ts`
- [ ] 在 WindowManager 建立 Tab-Session 映射
- [ ] 测试基础对话流程

---

## 14. 关键代码示例

### 14.1 AgentRuntime 入口

```typescript
// src/main/ai/core/AgentRuntime.ts
import { sqliteService } from '@main/common/database'
import { eventBus } from '@main/common/eventbus'
import { log } from '@main/common/logger'
import { Agent } from '@openai/agents'
import OpenAI from 'openai'

export class AgentRuntimeManager {
  private openai: OpenAI
  private agents: Map<string, Agent> = new Map()
  private sessions: Map<string, AISession> = new Map()

  async initialize(): Promise<void> {
    log.info('[AgentRuntime] 初始化 AI 运行时...')

    // 初始化 OpenAI 客户端
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })

    // 初始化内置智能体
    await this.initializeBuiltinAgents()

    log.info('[AgentRuntime] AI 运行时初始化完成')
  }

  private async initializeBuiltinAgents(): Promise<void> {
    // 创建默认智能体
    const chatAgent = new Agent({
      name: 'Chat Agent',
      model: 'gpt-4-turbo',
      instructions: 'You are a helpful AI assistant.'
    })

    this.agents.set('chat', chatAgent)
  }

  async createSession(config: CreateSessionConfig): Promise<string> {
    const sessionId = generateId()

    // 存储到数据库
    await sqliteService.execute(
      `
      INSERT INTO ai_sessions (id, tab_id, agent_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `,
      [sessionId, config.tabId, config.agentType, Date.now(), Date.now()]
    )

    // 创建内存会话对象
    const session: AISession = {
      id: sessionId,
      tabId: config.tabId,
      agentType: config.agentType,
      history: []
    }

    this.sessions.set(sessionId, session)

    // 发送事件
    eventBus.emit('ai:session-created', { sessionId, tabId: config.tabId })

    return sessionId
  }
}
```

### 14.2 AppManager 集成

```typescript
// src/main/common/app/index.ts（扩展现有文件）
import type { AgentRuntimeManager } from '@main/ai'

export class AppManager {
  // ... 现有属性
  private agentRuntime?: AgentRuntimeManager

  async initialize(): Promise<void> {
    // ... 现有初始化逻辑

    // 初始化 AI 运行时
    try {
      const { AgentRuntimeManager } = await import('@main/ai')
      this.agentRuntime = new AgentRuntimeManager()
      await this.agentRuntime.initialize()
      log.info('[App] AI 运行时初始化成功')
    } catch (error) {
      log.error('[App] AI 运行时初始化失败:', error)
    }
  }

  getAgentRuntime(): AgentRuntimeManager | undefined {
    return this.agentRuntime
  }
}
```

---

## 15. 总结

### 采纳情况总结

| 类别             | 采纳比例 | 说明                               |
| ---------------- | -------- | ---------------------------------- |
| **技术选型**     | 90%      | 统一 OpenAI，保留扩展性            |
| **目录结构**     | 100%     | 完全采纳，与 common 并列           |
| **基础设施复用** | 100%     | Database、IPC、EventBus 全部复用   |
| **集成点设计**   | 100%     | AppManager、WindowManager 集成明确 |
| **核心概念**     | 100%     | Skills、多智能体、权限系统保留     |

### 最终架构特点

1. ✅ **轻量整合** - 最大化复用现有基础设施
2. ✅ **清晰分层** - `common/` 基础层 + `ai/` 智能层
3. ✅ **统一技术栈** - OpenAI Agents + OpenAI SDK
4. ✅ **平滑集成** - 通过 AppManager、WindowManager 无缝衔接
5. ✅ **可扩展性** - 预留 ModelProvider 扩展点

### 下一步行动

建议立即开始 Phase 1 实现：

1. 创建 `src/main/ai/` 基础目录
2. 实现 `AgentRuntimeManager`
3. 添加 AI 数据库迁移
4. 在 AppManager 中集成

**你觉得这个分析合理吗？需要我开始实施吗？** 🚀
