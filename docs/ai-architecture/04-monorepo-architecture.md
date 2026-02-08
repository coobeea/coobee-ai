# Monorepo 分包架构设计（AI 模块专用）

> 使用 pnpm workspace 将 AI 模块独立成包，其他部分保持原有结构
>
> 创建时间：2026-02-04
> 更新时间：2026-02-04（调整为仅拆分 AI 模块）

---

## 目录

1. [为什么只拆分 AI 模块](#1-为什么只拆分-ai-模块)
2. [目标架构设计](#2-目标架构设计)
3. [技术实施方案](#3-技术实施方案)
4. [包的划分原则](#4-包的划分原则)
5. [实施步骤](#5-实施步骤)
6. [最佳实践](#6-最佳实践)

---

## 1. 为什么只拆分 AI 模块

### 1.1 设计思路

**核心理念**: **渐进式架构升级**

```
原则：
  ✅ 只拆分 AI 相关代码（新增功能）
  ✅ 保持现有代码稳定（Electron 基础设施）
  ✅ 降低迁移成本和风险
  ✅ 为未来 AI 能力复用打好基础
```

### 1.2 拆分策略

```
拆分原则：

  拆分 AI 模块 ← 新增功能，独立性强，需要复用
  ✅ ai-core      - AI 核心逻辑（框架无关）
  ✅ ai-gateway   - AI 网关（WebSocket 对接层）

  保持原有结构 ← 已稳定运行，无复用需求
  ✅ src/main/common/  - Electron 基础设施
  ✅ src/shared/       - 共享类型
  ✅ src/renderer/     - 前端代码
```

### 1.3 方案对比

| 方案                                | 拆分范围 | 优点                 | 缺点                  | 推荐度 |
| ----------------------------------- | -------- | -------------------- | --------------------- | ------ |
| **A. 只拆分 AI**<br/>（当前方案）⭐ | AI 模块  | 成本低、风险小、快速 | AI 包需引用 src/      | ⭐⭐⭐ |
| **B. 全面拆分**                     | 所有模块 | 最清晰、最解耦       | 成本高、风险大、慢    | ⭐⭐   |
| **C. 不拆分**                       | 无       | 0 成本               | AI 与 Electron 强耦合 | ⭐     |

**为什么选方案 A**：

- ✅ AI 是新增功能，独立出来成本最低
- ✅ 现有 Electron 代码已稳定，不需要动
- ✅ 降低风险（只改增量，不改存量）
- ✅ 达到目标（AI 可复用）

### 1.4 核心优势

| 优势          | 说明                               | 价值   |
| ------------- | ---------------------------------- | ------ |
| **AI 可复用** | AI 核心包可用于 CLI、Web 等场景    | ⭐⭐⭐ |
| **独立测试**  | AI 模块可以独立测试，无需 Electron | ⭐⭐⭐ |
| **清晰职责**  | AI 逻辑与 Electron 业务分离        | ⭐⭐⭐ |
| **低风险**    | 只改增量，不影响现有稳定代码       | ⭐⭐⭐ |
| **快速实施**  | 不需要迁移大量现有代码             | ⭐⭐⭐ |

---

## 2. 目标架构设计

### 2.1 最终目录结构

```
coobee-ai/
├── packages/                      # ⭐ 新增：AI 专用包目录
│   ├── ai-core/                  # AI 核心包（包含核心逻辑 + 存储）
│   │   ├── src/
│   │   │   ├── agents/           # Agent 定义与编排
│   │   │   ├── tools/            # 工具系统
│   │   │   ├── skills/           # 技能系统
│   │   │   ├── planning/         # 任务规划
│   │   │   ├── monitoring/       # 进度监控
│   │   │   ├── recovery/         # 恢复策略
│   │   │   ├── storage/          # 数据存储层
│   │   │   │   ├── stores/       # 数据访问层
│   │   │   │   │   ├── SessionStore.ts      # ⭐ 统一的会话存储（数据库+文件）
│   │   │   │   │   ├── TaskStore.ts
│   │   │   │   │   └── ToolExecutionStore.ts
│   │   │   │   ├── schemas/      # 数据库 Schema
│   │   │   │   └── index.ts
│   │   │   └── index.ts          # 统一导出
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   │
│   └── ai-gateway/               # AI 网关包（WebSocket 对接层）
│       ├── src/
│       │   ├── WebSocketServer.ts    # WebSocket 服务器
│       │   ├── AgentGateway.ts       # AI 网关管理器
│       │   ├── protocol/             # 通信协议定义
│       │   │   ├── messages.ts
│       │   │   └── handlers.ts
│       │   ├── lifecycle.ts          # 生命周期管理
│       │   └── index.ts
│       └── package.json
│
├── src/                           # ⭐ 保持不变：Electron 应用主体
│   ├── main/
│   │   ├── index.ts              # 主入口（引用 packages/ai-gateway）
│   │   ├── common/               # ✅ 保持不变
│   │   │   ├── app/              # AppManager
│   │   │   ├── window/           # WindowManager
│   │   │   ├── database/         # DatabaseService（被 AI 包引用）
│   │   │   ├── logger/           # Logger（被 AI 包引用）
│   │   │   ├── eventbus/         # EventBus（被 AI 包引用）
│   │   │   └── ...
│   │   └── utils/                # ✅ 保持不变
│   ├── preload/                  # ✅ 保持不变
│   ├── renderer/                 # ✅ 保持不变
│   └── shared/                   # ✅ 保持不变（被 AI 包引用）
│
├── pnpm-workspace.yaml           # ⭐ workspace 配置
├── package.json                  # 根 package.json
└── tsconfig.json                 # 根 TS 配置
```

### 2.2 包的依赖关系

```mermaid
graph TB
    App[Electron App<br/>src/main]
    Renderer[Renderer<br/>src/renderer]

    AIGateway[@coobee/ai-gateway<br/>WebSocket 网关]
    AICore[@coobee/ai-core<br/>核心逻辑 + 存储]

    Common[src/main/common<br/>基础设施]
    Shared[src/shared<br/>类型定义]

    App --> AIGateway
    App --> Common

    Renderer -.WebSocket.-> AIGateway

    AIGateway --> AICore
    AIGateway --> Common
    AIGateway --> Shared

    AICore --> Common
    AICore --> Shared

    style App fill:#e1f5ff
    style Renderer fill:#e1fff5
    style AICore fill:#fff4e1
    style AIGateway fill:#ffe1f5
    style Common fill:#f0f0f0
    style Shared fill:#e1ffe1
```

**依赖规则**:

- ✅ `src/shared/` - 0 依赖（纯类型定义）**保持原有位置**
- ✅ `src/main/common/` - Electron 基础设施 **保持原有位置**
- ✅ `@coobee/ai-core` - **AI 核心逻辑 + 存储**，依赖 `src/main/common/` 和 `src/shared/`
- ✅ `@coobee/ai-gateway` - 依赖 `@coobee/ai-core`，提供 WebSocket 对接层
- ✅ `Electron App` - 只依赖 `@coobee/ai-gateway`（在主进程中启动 WebSocket 服务器）
- ✅ `Renderer` - 通过 WebSocket 连接 `ai-gateway`（**不使用 IPC**）

**关键设计**:

- **简化架构**：只有 **2 个 AI 包**（`ai-core` + `ai-gateway`）
- **通信方式**：前端通过 **WebSocket** 与 AI 网关通信（而非 IPC）
- **依赖方向**：Electron App → ai-gateway → ai-core（单向，不可反向）
- AI 包通过 `alias` 引用 `src/` 下的模块（详见下文 3.4 TypeScript 配置）
- 避免循环依赖：`src/main/` 只引用 `packages/`，不被引用

**重要提醒**:

```
❌ ai-core 不依赖 ai-gateway
❌ ai-core 不依赖 Electron App
❌ ai-gateway 不依赖 Electron App

✅ ai-gateway 依赖 ai-core
✅ Electron App 依赖 ai-gateway
✅ Renderer 通过 WebSocket 连接 ai-gateway（不是 IPC）
```

---

## 3. 技术实施方案

### 3.1 pnpm Workspace 配置

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*' # 只包含 AI 相关的包
```

**说明**: 不需要把 `src` 加入 workspace，保持 Electron 主应用的独立性

### 3.2 根 package.json 调整

```json
{
  "name": "coobee-ai",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "pnpm --filter './packages/**' dev && electron-vite dev",
    "build": "pnpm -r --filter './packages/**' build && electron-vite build",
    "build:ai": "pnpm -r --filter './packages/**' build",
    "test": "pnpm -r test",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit && pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "vitest": "^1.0.0",
    "@types/node": "^20.10.0",
    "tsup": "^8.0.0"
  }
}
```

**关键点**:

- `build:ai` - 单独构建 AI 包
- `dev` - 先启动 AI 包的 watch 模式，再启动 Electron

### 3.3 AI 包的 package.json 模板

#### packages/ai-core/package.json

```json
{
  "name": "@coobee/ai-core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --dts --format esm",
    "dev": "tsup src/index.ts --dts --format esm --watch",
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@openai/agents": "^0.4.6",
    "openai": "^4.72.1",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.3.3",
    "vitest": "^1.0.0"
  }
}
```

**说明**:

- 不依赖 workspace 内部包
- 只依赖外部 npm 包

#### packages/ai-storage/package.json

```json
{
  "name": "@coobee/ai-storage",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsup src/index.ts --dts --format esm",
    "dev": "tsup src/index.ts --dts --format esm --watch",
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@coobee/ai-core": "workspace:*"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.3.3"
  }
}
```

**说明**:

- 通过 TypeScript alias 引用 `src/main/common/`（见 05 文档）
- 只在 workspace 内依赖 `@coobee/ai-core`

#### packages/ai-gateway/package.json

```json
{
  "name": "@coobee/ai-gateway",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsup src/index.ts --dts --format esm",
    "dev": "tsup src/index.ts --dts --format esm --watch",
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@coobee/ai-core": "workspace:*",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.12",
    "tsup": "^8.0.0",
    "typescript": "^5.3.3"
  }
}
```

**说明**:

- 依赖 `@coobee/ai-core`（核心逻辑 + 存储）
- 依赖 `ws`（WebSocket 服务器库）
- **不依赖** `electron`（网关层框架无关）

### 3.4 TypeScript 配置策略

#### 方案：使用 Path Alias（推荐）

```json
// packages/ai-storage/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "paths": {
      "@main/common/*": ["../../src/main/common/*"],
      "@shared/*": ["../../src/shared/*"]
    }
  },
  "include": ["src/**/*"]
}
```

**优点**:

- AI 包可以直接 `import { logger } from '@main/common/logger'`
- 类型安全，编译时检查
- 运行时由 Electron 主进程提供实例

**详细配置见**: 下文 Step 4（集成到 Electron 主应用）

---

## 4. 包的划分原则

### 4.1 核心包：@coobee/ai-core（包含存储）

**定位**: 框架无关的 AI 核心逻辑 + 数据存储层

**职责**:

- ✅ Agent 定义与编排
- ✅ 工具系统（Tool Registry）
- ✅ 技能系统（Skills）
- ✅ 任务规划（Planning）
- ✅ 进度监控（Monitoring）
- ✅ 恢复策略（Recovery）
- ✅ **数据存储层（Storage）**
  - SessionStore - 会话存储（数据库 + 文件混合存储）
    - 数据库：Session 元数据（ID、配置、状态等）
    - 文件：Session 完整对话历史（JSON/JSONL）
  - TaskStore - 任务存储
  - ToolExecutionStore - 工具执行记录
  - Database Schema - 数据库模式定义

**依赖**:

- `src/main/common/` - 使用 DatabaseService（通过 alias）
- `src/shared/` - 使用类型定义（通过 alias）
- `@openai/agents` - OpenAI Agents 框架
- `openai` - OpenAI SDK
- `zod` - 参数验证

**目录结构**:

```
packages/ai-core/src/
├── agents/            # Agent 定义
├── tools/             # 工具系统
├── skills/            # 技能系统
├── planning/          # 任务规划
├── monitoring/        # 进度监控
├── recovery/          # 恢复策略
├── storage/           # ⭐ 存储层
│   ├── stores/        # 数据访问层
│   │   ├── SessionStore.ts           # ⭐ 统一存储（数据库+文件）
│   │   ├── TaskStore.ts
│   │   └── ToolExecutionStore.ts
│   ├── schemas/       # 数据库 Schema
│   └── index.ts
├── types/             # 类型定义
└── index.ts           # 统一导出
```

**示例导出**:

```typescript
// packages/ai-core/src/index.ts
export { Agent, AgentConfig } from './agents'
export { Tool, ToolRegistry } from './tools'
export { Skill, SkillManager } from './skills'
export { TaskPlanner, ProjectArchetype } from './planning'
export { ProgressMonitor, HealthChecker } from './monitoring'
export { RiskManager, RecoveryAction } from './recovery'
export { SessionStore, TaskStore, ToolExecutionStore } from './storage'
export type * from './types'
```

**存储层示例（混合存储）**:

```typescript
// packages/ai-core/src/storage/stores/SessionStore.ts
import { DatabaseService } from '@main/common/database'
import { promises as fs } from 'fs'
import path from 'path'
import type { Session, SessionMessage } from '@shared/types'

export class SessionStore {
  private sessionsDir: string

  constructor(
    private db: DatabaseService,
    dataDir: string
  ) {
    this.sessionsDir = path.join(dataDir, 'sessions')
  }

  /**
   * 创建新会话
   * - 数据库：存储元数据
   * - 文件：初始化对话历史文件
   */
  async create(session: Session): Promise<string> {
    // 1. 保存元数据到数据库
    await this.db.execute(
      `
      INSERT INTO ai_sessions (id, agent_type, model, config, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        session.id,
        session.agentType,
        session.model,
        JSON.stringify(session.config),
        'active',
        Date.now(),
        Date.now()
      ]
    )

    // 2. 创建对话历史文件
    const sessionFile = path.join(this.sessionsDir, `${session.id}.jsonl`)
    await fs.mkdir(this.sessionsDir, { recursive: true })
    await fs.writeFile(sessionFile, '', 'utf-8')

    return session.id
  }

  /**
   * 添加消息到会话
   * - 追加到文件（JSONL 格式，每行一条消息）
   */
  async appendMessage(sessionId: string, message: SessionMessage): Promise<void> {
    const sessionFile = path.join(this.sessionsDir, `${sessionId}.jsonl`)
    const line =
      JSON.stringify({
        ...message,
        timestamp: Date.now()
      }) + '\n'

    await fs.appendFile(sessionFile, line, 'utf-8')

    // 更新数据库的 updated_at
    await this.db.execute('UPDATE ai_sessions SET updated_at = ? WHERE id = ?', [
      Date.now(),
      sessionId
    ])
  }

  /**
   * 获取会话完整历史
   * - 从文件读取对话历史
   */
  async getMessages(sessionId: string): Promise<SessionMessage[]> {
    const sessionFile = path.join(this.sessionsDir, `${sessionId}.jsonl`)
    const content = await fs.readFile(sessionFile, 'utf-8')

    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
  }

  /**
   * 获取会话元数据
   * - 从数据库读取
   */
  async get(sessionId: string): Promise<Session | null> {
    const row = await this.db.get('SELECT * FROM ai_sessions WHERE id = ?', [sessionId])

    if (!row) return null

    return {
      id: row.id,
      agentType: row.agent_type,
      model: row.model,
      config: JSON.parse(row.config),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
```

**优势**：

- ✅ **数据库**：快速查询 Session 列表、状态、时间
- ✅ **文件**：完整对话历史，方便查看、调试、备份
- ✅ **JSONL 格式**：每行一条消息，追加高效，查看方便

### 4.2 网关包：@coobee/ai-gateway

**定位**: WebSocket 对接层，连接 AI 核心与前端

**职责**:

- ✅ AgentGateway（整合 ai-core）
- ✅ WebSocket 服务器（提供给 renderer 的接口）
- ✅ 消息路由与处理
- ✅ 生命周期管理（初始化、销毁）
- ✅ 与 AppManager 集成

**依赖**:

- `@coobee/ai-core` - 核心逻辑 + 存储
- `src/main/common/` - 基础设施（通过 alias）
- `src/shared/` - 类型定义（通过 alias）
- `ws` - WebSocket 服务器库

**示例代码**:

```typescript
// packages/ai-gateway/src/AgentGateway.ts
import { Agent, SessionStore } from '@coobee/ai-core'
import { WebSocketServer, WebSocket } from 'ws'
import { logger } from '@main/common/logger'
import { eventBus } from '@main/common/eventbus'

export class AgentGateway {
  private wss: WebSocketServer
  private sessionStore: SessionStore
  private agents: Map<string, Agent> = new Map()

  async initialize(port: number = 9000): Promise<void> {
    logger.info(`[AI Gateway] 初始化 WebSocket 服务器，端口：${port}`)

    this.sessionStore = new SessionStore()

    this.wss = new WebSocketServer({ port })
    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws)
    })

    logger.info('[AI Gateway] WebSocket 服务器启动成功')
  }

  private handleConnection(ws: WebSocket): void {
    ws.on('message', async (data: Buffer) => {
      const message = JSON.parse(data.toString())
      const response = await this.handleMessage(message)
      ws.send(JSON.stringify(response))
    })
  }

  private async handleMessage(message: any): Promise<any> {
    const { type, payload } = message

    switch (type) {
      case 'create-session':
        return await this.createSession(payload)
      case 'send-message':
        return await this.sendMessage(payload)
      default:
        throw new Error(`未知的消息类型: ${type}`)
    }
  }

  private async createSession(config: any): Promise<{ sessionId: string }> {
    const agent = new Agent(config)
    const sessionId = await this.sessionStore.create(config)
    this.agents.set(sessionId, agent)

    eventBus.emit('ai:session-created', { sessionId })
    return { sessionId }
  }

  private async sendMessage(payload: { sessionId: string; message: string }): Promise<any> {
    // 使用 SessionStore 的 appendMessage 方法
    // 详见 Step 3 完整示例
  }
}
```

**导出**:

```typescript
// packages/ai-gateway/src/index.ts
export { AgentGateway } from './AgentGateway'
export { WebSocketMessageHandler } from './protocol/handlers'
export { initializeGateway } from './lifecycle'
```

---

## 5. 实施步骤

### Step 1: 创建 workspace 配置（10 分钟）

**目标**: 搭建 monorepo 基础

```bash
# 1. 创建 workspace 配置
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - 'packages/*'
EOF

# 2. 创建 packages 目录结构（只创建 2 个 AI 包）
mkdir -p packages/{ai-core,ai-gateway}

# 3. 为每个包创建基础文件
for pkg in ai-core ai-gateway; do
  mkdir -p packages/$pkg/src
  touch packages/$pkg/package.json
  touch packages/$pkg/tsconfig.json
  touch packages/$pkg/README.md
done
```

**产出**:

- ✅ `pnpm-workspace.yaml`
- ✅ `packages/` 目录（**2 个 AI 包**）
- ✅ 基础文件结构

### Step 2: 创建 AI 核心包（2-3 天）

**目标**: 创建 `@coobee/ai-core`（**包含核心逻辑 + 存储**，参考 `02-agent-architecture.md`）

#### 2.1 配置 package.json

```bash
cat > packages/ai-core/package.json << 'EOF'
{
  "name": "@coobee/ai-core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --dts --format esm",
    "dev": "tsup src/index.ts --dts --format esm --watch",
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@openai/agents": "^0.4.6",
    "openai": "^4.72.1",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.3.3",
    "vitest": "^1.0.0"
  }
}
EOF
```

#### 2.2 配置 TypeScript

```bash
cat > packages/ai-core/tsconfig.json << 'EOF'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "paths": {
      "@main/common/*": ["../../src/main/common/*"],
      "@shared/*": ["../../src/shared/*"]
    }
  },
  "include": ["src/**/*"]
}
EOF
```

#### 2.3 创建目录结构

```bash
cd packages/ai-core
mkdir -p src/{agents,tools,skills,planning,monitoring,recovery,storage/stores,storage/schemas,types}
```

**说明**: `storage/` 目录包含了原本 `ai-storage` 包的内容

#### 2.4 示例代码

```typescript
// packages/ai-core/src/index.ts
export * from './agents'
export * from './tools'
export * from './skills'
export * from './planning'
export * from './monitoring'
export * from './recovery'
export * from './storage' // ⭐ 导出存储层
export type * from './types'
```

```typescript
// packages/ai-core/src/storage/index.ts
export { SessionStore } from './stores/SessionStore'
export { TaskStore } from './stores/TaskStore'
export { ToolExecutionStore } from './stores/ToolExecutionStore'
export { schemas } from './schemas'
```

```typescript
// packages/ai-core/src/storage/stores/SessionStore.ts
// 已更新为混合存储（数据库 + 文件）
// 详见上文 4.1 节的完整示例
```

**产出**:

- ✅ `@coobee/ai-core` 包
- ✅ AI 核心逻辑 + 存储层
- ✅ 通过 alias 引用 `src/main/common/`

### Step 3: 创建 AI 网关包（2-3 天）

**目标**: 创建 `@coobee/ai-gateway`（WebSocket 对接层）

#### 3.1 配置 package.json

```bash
cat > packages/ai-gateway/package.json << 'EOF'
{
  "name": "@coobee/ai-gateway",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsup src/index.ts --dts --format esm",
    "dev": "tsup src/index.ts --dts --format esm --watch",
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@coobee/ai-core": "workspace:*",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.12",
    "tsup": "^8.0.0",
    "typescript": "^5.3.3"
  }
}
EOF
```

**说明**:

- 依赖 `@coobee/ai-core`（核心逻辑 + 存储）
- 依赖 `ws`（WebSocket 服务器库）
- **不依赖** `electron`（网关层框架无关，可用于非 Electron 场景）

#### 3.2 配置 TypeScript

```bash
cat > packages/ai-gateway/tsconfig.json << 'EOF'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "paths": {
      "@main/common/*": ["../../src/main/common/*"],
      "@shared/*": ["../../src/shared/*"]
    }
  },
  "include": ["src/**/*"]
}
EOF
```

#### 3.3 示例代码

```typescript
// packages/ai-gateway/src/AgentGateway.ts
import { Agent, SessionStore } from '@coobee/ai-core'
import { WebSocketServer, WebSocket } from 'ws'
import { logger } from '@main/common/logger'
import { eventBus } from '@main/common/eventbus'

export class AgentGateway {
  private wss: WebSocketServer
  private sessionStore: SessionStore
  private agents: Map<string, Agent> = new Map()

  async initialize(port: number = 9000): Promise<void> {
    logger.info(`[AI Gateway] 初始化 WebSocket 服务器，端口：${port}`)

    this.sessionStore = new SessionStore()

    // 创建 WebSocket 服务器
    this.wss = new WebSocketServer({ port })

    // 监听连接
    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws)
    })

    logger.info('[AI Gateway] WebSocket 服务器启动成功')
  }

  private handleConnection(ws: WebSocket): void {
    logger.info('[AI Gateway] 新客户端连接')

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString())
        const response = await this.handleMessage(message)
        ws.send(JSON.stringify(response))
      } catch (error) {
        logger.error('[AI Gateway] 处理消息失败:', error)
        ws.send(JSON.stringify({ error: error.message }))
      }
    })
  }

  private async handleMessage(message: any): Promise<any> {
    const { type, payload } = message

    switch (type) {
      case 'create-session':
        return await this.createSession(payload)
      case 'send-message':
        return await this.sendMessage(payload)
      default:
        throw new Error(`未知的消息类型: ${type}`)
    }
  }

  private async createSession(config: any): Promise<{ sessionId: string }> {
    const agent = new Agent(config)
    const sessionId = await this.sessionStore.create(config)
    this.agents.set(sessionId, agent)

    eventBus.emit('ai:session-created', { sessionId })
    return { sessionId }
  }

  private async sendMessage(payload: { sessionId: string; message: string }): Promise<any> {
    const { sessionId, message } = payload
    const agent = this.agents.get(sessionId)

    if (!agent) {
      throw new Error('Session not found')
    }

    // 追加用户消息到文件
    await this.sessionStore.appendMessage(sessionId, {
      role: 'user',
      content: message
    })

    // 调用 AI Agent
    const response = await agent.chat(message)

    // 追加 AI 回复到文件
    await this.sessionStore.appendMessage(sessionId, {
      role: 'assistant',
      content: response
    })

    return { response }
  }
}
```

**说明**:

- 使用 `ws` 库创建 WebSocket 服务器
- 监听端口 9000（可配置）
- 处理前端的 WebSocket 消息

**产出**:

- ✅ `@coobee/ai-gateway` 包
- ✅ WebSocket 服务器
- ✅ 消息路由与处理

### Step 4: 集成到 Electron 主应用（1 天）

**目标**: 在 `src/main/` 中使用 `@coobee/ai-gateway`

#### 4.1 更新主应用代码

```typescript
// src/main/common/app/index.ts
import { AgentGateway } from '@coobee/ai-gateway'

export class AppManager {
  private agentGateway!: AgentGateway

  async initialize(): Promise<void> {
    // ... 现有初始化逻辑

    // 新增：初始化 AI 网关（WebSocket 服务器）
    this.agentGateway = new AgentGateway()
    await this.agentGateway.initialize(9000) // 端口 9000

    log.info('[AppManager] AI 网关初始化完成')
  }

  getAgentGateway(): AgentGateway {
    return this.agentGateway
  }
}
```

#### 4.2 前端连接 WebSocket

```typescript
// src/renderer/src/services/aiClient.ts
export class AIClient {
  private ws: WebSocket | null = null

  connect(): void {
    this.ws = new WebSocket('ws://localhost:9000')

    this.ws.onopen = () => {
      console.log('[AI Client] WebSocket 连接成功')
    }

    this.ws.onmessage = (event) => {
      const response = JSON.parse(event.data)
      console.log('[AI Client] 收到消息:', response)
    }
  }

  async createSession(config: any): Promise<string> {
    return new Promise((resolve) => {
      const handler = (event: MessageEvent) => {
        const { sessionId } = JSON.parse(event.data)
        this.ws!.removeEventListener('message', handler)
        resolve(sessionId)
      }

      this.ws!.addEventListener('message', handler)
      this.ws!.send(
        JSON.stringify({
          type: 'create-session',
          payload: config
        })
      )
    })
  }

  async sendMessage(sessionId: string, message: string): Promise<any> {
    return new Promise((resolve) => {
      const handler = (event: MessageEvent) => {
        const response = JSON.parse(event.data)
        this.ws!.removeEventListener('message', handler)
        resolve(response)
      }

      this.ws!.addEventListener('message', handler)
      this.ws!.send(
        JSON.stringify({
          type: 'send-message',
          payload: { sessionId, message }
        })
      )
    })
  }
}
```

#### 4.3 更新 Electron Vite 配置

添加 alias 映射（参考 05-pure-monorepo-electron-architecture.md 了解完整的纯 Monorepo 架构）：

```typescript
// electron.vite.config.ts
export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@coobee/ai-core': path.resolve(__dirname, 'packages/ai-core/src'),
        '@coobee/ai-gateway': path.resolve(__dirname, 'packages/ai-gateway/src')
      }
    }
  }
})
```

**说明**:

- 只需要映射 2 个 AI 包
- 前端通过 **WebSocket** 连接 AI 网关
- **不使用 IPC**

**产出**:

- ✅ 主应用使用 `@coobee/ai-gateway`
- ✅ WebSocket 服务器启动
- ✅ 前端通过 WebSocket 通信
- ✅ Electron Vite 配置更新完成

---

## 6. 最佳实践

### 6.1 包命名规范

```
@coobee/ai-core        ← AI 核心逻辑（框架无关）
@coobee/ai-gateway     ← AI 网关（WebSocket 对接层）
```

**说明**:

- 只有 AI 相关的包使用 `@coobee/` 命名空间
- 其他模块保持在 `src/` 下，不创建独立包

### 6.2 版本管理

```json
// 使用 workspace:* 引用内部包
{
  "dependencies": {
    "@coobee/ai-core": "workspace:*"
  }
}
```

**说明**:

- `workspace:*` 确保始终使用 workspace 内的最新版本
- `ai-gateway` 只需依赖 `ai-core` 一个包

### 6.3 构建顺序

```bash
# pnpm 自动处理依赖顺序
pnpm -r --filter './packages/**' build

# 构建顺序（自动）:
# 1. @coobee/ai-core (0 workspace 依赖)
# 2. @coobee/ai-gateway (依赖 ai-core)
```

**说明**:

- pnpm 会根据 `dependencies` 自动确定构建顺序
- **更快**：只有 2 个包，构建速度更快

### 6.4 开发模式

#### 方式 1: 启动所有 AI 包的 watch 模式

```bash
pnpm -r --filter './packages/**' dev
```

#### 方式 2: 只开发特定包

```bash
# 只 watch ai-core
pnpm --filter @coobee/ai-core dev

# 只 watch ai-gateway
pnpm --filter @coobee/ai-gateway dev
```

#### 方式 3: 推荐的开发流程

```bash
# Terminal 1: 启动 AI 包的 watch 模式
pnpm -r --filter './packages/**' dev

# Terminal 2: 启动 Electron 应用
pnpm dev
```

### 6.5 引用 src/ 下的模块

```typescript
// packages/ai-core/src/storage/stores/SessionStore.ts

// ✅ 正确：使用 alias 引用
import { logger } from '@main/common/logger'
import { DatabaseService } from '@main/common/database'
import type { Session } from '@shared/types'

// ❌ 错误：使用相对路径
import { logger } from '../../../../src/main/common/logger'
```

**配置 alias**（在 `packages/ai-core/tsconfig.json` 中）:

```json
{
  "compilerOptions": {
    "paths": {
      "@main/common/*": ["../../src/main/common/*"],
      "@shared/*": ["../../src/shared/*"]
    }
  }
}
```

### 6.6 测试策略

```typescript
// packages/ai-core/src/__tests__/Agent.test.ts
import { describe, it, expect } from 'vitest'
import { Agent } from '../agents'

describe('Agent', () => {
  it('should create agent correctly', () => {
    const agent = new Agent({ name: 'test' })
    expect(agent.name).toBe('test')
  })
})
```

```bash
# 运行所有 AI 包的测试
pnpm -r --filter './packages/**' test

# 运行单个包的测试
pnpm --filter @coobee/ai-core test
```

---

## 7. 优势总结

### 7.1 与全面拆分方案对比

| 维度       | 只拆分 AI（当前方案）⭐ | 全面拆分（包含 common/shared） |
| ---------- | ----------------------- | ------------------------------ |
| 迁移成本   | ✅ 低（只改增量）       | ❌ 高（需迁移大量代码）        |
| 实施时间   | ✅ 快（5-7 天）         | ❌ 慢（2-3 周）                |
| 风险       | ✅ 小（不动稳定代码）   | ⚠️ 中（可能影响现有功能）      |
| AI 可复用  | ✅ 实现                 | ✅ 实现                        |
| 架构清晰度 | ⭐⭐⭐                  | ⭐⭐⭐⭐                       |

### 7.2 实际收益

**立即收益（5-7 天后）**:

- ✅ AI 模块独立成包，可以单独开发和测试
- ✅ 为未来 AI CLI 版本打好基础
- ✅ AI 包的依赖关系清晰明确
- ✅ 不影响现有 Electron 代码的稳定性

**短期收益（1-2 月）**:

- ✅ AI 核心逻辑可以在其他项目中复用
- ✅ 开发体验提升（类型提示更准确）
- ✅ 构建速度提升（AI 包增量构建）

**中期收益（3-6 月）**:

- ✅ 可以独立发布 `@coobee/ai-core` 到 npm
- ✅ 可以快速创建 AI CLI 工具
- ✅ 可以为社区提供 AI SDK

**长期收益（6+ 月）**:

- ✅ AI 能力可以用于多个产品（Web、CLI、插件）
- ✅ 社区可以基于 `@coobee/ai-core` 开发扩展
- ✅ 技术债务降低（AI 模块边界清晰）

---

## 8. 常见问题

### Q1: AI 包如何引用 src/main/common/ 下的模块？

**答**: 通过 TypeScript path alias 引用，详见 `05-pure-monorepo-electron-architecture.md`（第 4 节构建配置）。

示例：

```typescript
import { logger } from '@main/common/logger'
import { DatabaseService } from '@main/common/database'
```

### Q2: 为什么不把 common/ 和 shared/ 也拆分成包？

**答**:

- ✅ `common/` 和 `shared/` 已经很稳定，无复用需求
- ✅ 只拆分 AI 模块可以降低迁移成本和风险
- ✅ 未来如果有需要，可以再拆分

### Q3: 会不会增加复杂度？

**答**:

- ⚠️ 初期会增加一点配置复杂度（pnpm workspace、tsconfig alias）
- ✅ 但长期收益远大于成本（AI 可复用、架构更清晰）
- ✅ 只拆分 AI 模块，复杂度增加有限

### Q4: 性能会受影响吗？

**答**:

- ✅ **不会**。构建后都是普通的 JS 文件，运行时无额外开销
- ✅ 开发模式下，AI 包的 watch 构建速度很快（tsup）

### Q5: 如何调试 AI 包的代码？

**答**:

- ✅ 开发模式下，AI 包使用 watch 构建，修改即生效
- ✅ VS Code 可以直接跳转到 AI 包的源码（通过 tsconfig paths）
- ✅ 可以在 AI 包中直接打断点调试

### Q6: 实施需要多长时间？

**答**:

- ⏱️ **4-5 天**（详见第 5 节实施步骤）
- Day 1: 创建 workspace 配置（10 分钟）
- Day 2-3: 创建 `@coobee/ai-core`（包含存储，2-3 天）
- Day 4-5: 创建 `@coobee/ai-gateway` + 集成到主应用（2 天）

---

## 总结

✅ **推荐采用「只拆分 AI 模块（2 包方案）」**

**核心理由**:

1. ⭐ **极简架构** - 只有 2 个 AI 包，最小化复杂度
2. ⭐ **低风险** - 只改增量，不动存量稳定代码
3. ⭐ **快速实施** - 4-5 天即可完成
4. ⭐ **达到目标** - AI 模块独立可复用
5. ⭐ **渐进式演进** - 未来可以按需拆分其他模块

**与 3 包方案对比**:

| 维度       | 2 包方案（当前）⭐ | 3 包方案  |
| ---------- | ------------------ | --------- |
| 包数量     | ✅ 2 个            | ⚠️ 3 个   |
| 实施时间   | ✅ 4-5 天          | ⚠️ 5-7 天 |
| 管理复杂度 | ✅ 低              | ⚠️ 中     |
| 构建速度   | ✅ 快              | ⚠️ 慢     |
| AI 可复用  | ✅ 实现            | ✅ 实现   |

**实施建议**:

- 按照第 5 节的步骤依次实施
- 先创建 `@coobee/ai-core`（包含存储，最核心）
- 再创建 `@coobee/ai-gateway`（WebSocket 对接层）
- 最后集成到主应用并验证

**参考资料**:

- [pnpm Workspace 文档](https://pnpm.io/workspaces)
- [TypeScript Path Mapping](https://www.typescriptlang.org/docs/handbook/module-resolution.html#path-mapping)
- [02-agent-architecture.md](./02-agent-architecture.md) - AI 架构设计
- [05-pure-monorepo-electron-architecture.md](./05-pure-monorepo-electron-architecture.md) - 纯 Monorepo 架构模式

---

_准备好开始实施了吗？_ 🚀
