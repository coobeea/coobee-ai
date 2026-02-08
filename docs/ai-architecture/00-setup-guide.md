# AI 模块设置指南

> 已完成基础目录结构创建，现有代码完全未修改
>
> 创建时间：2026-02-04

---

## ✅ 已完成的工作

### 1. Workspace 配置

创建了 `pnpm-workspace.yaml`，启用 monorepo 模式。

### 2. AI 核心包（@coobee/ai-core）

```
packages/ai-core/
├── src/
│   ├── agents/               ✅ Agent 定义
│   │   ├── BaseAgent.ts
│   │   ├── ChatAgent.ts
│   │   └── index.ts
│   ├── tools/                ✅ 工具系统
│   │   ├── registry.ts
│   │   ├── builtin/
│   │   └── index.ts
│   ├── skills/               ✅ 技能系统（占位）
│   │   └── index.ts
│   ├── storage/              ✅ 存储层
│   │   ├── SessionStore.ts   # 混合存储实现
│   │   ├── schemas/
│   │   │   └── sessions.sql
│   │   └── index.ts
│   ├── types.ts              ✅ 类型定义
│   └── index.ts              ✅ 统一导出
├── package.json
├── tsconfig.json
└── README.md
```

**状态**: ✅ 骨架完成，代码占位（带 TODO 标记）

### 3. AI 网关包（@coobee/ai-gateway）

```
packages/ai-gateway/
├── src/
│   ├── AgentGateway.ts       ✅ AI 网关管理器
│   ├── protocol/             ✅ 通信协议
│   │   ├── messages.ts
│   │   └── index.ts
│   ├── lifecycle.ts          ✅ 生命周期管理
│   └── index.ts              ✅ 统一导出
├── package.json
├── tsconfig.json
└── README.md
```

**状态**: ✅ 骨架完成，代码占位（带 TODO 标记）

---

## 📋 目录结构一览

```
coobee-ai/
├── pnpm-workspace.yaml       ✅ 新增（workspace 配置）
├── packages/                 ✅ 新增（AI 模块）
│   ├── ai-core/
│   └── ai-gateway/
├── src/                      🔒 未修改（现有代码）
│   ├── main/
│   ├── preload/
│   ├── renderer/
│   └── shared/
├── package.json              🔒 未修改
└── ...
```

**重要提示**：

- ✅ 只创建了新的 `packages/` 目录
- 🔒 **完全没有修改现有代码**
- 📝 所有新代码都带有 TODO 标记，方便后续填充

---

## 🚀 下一步操作

### Step 1: 安装依赖

```bash
# 进入项目根目录
cd /Users/lifeng/git/git_agents/coobee-ai

# 安装所有包的依赖
pnpm install

# 这会自动安装：
# - 根目录的依赖
# - packages/ai-core 的依赖
# - packages/ai-gateway 的依赖
```

### Step 2: 构建 AI 包

```bash
# 构建所有 AI 包
pnpm --filter '@coobee/ai-*' build

# 或者分别构建
pnpm --filter @coobee/ai-core build
pnpm --filter @coobee/ai-gateway build
```

### Step 3: 开发模式（可选）

```bash
# 启动 AI 包的 watch 模式
pnpm --filter '@coobee/ai-*' dev

# 这会监听文件变化，自动重新构建
```

### Step 4: 集成到主应用（下一阶段）

参考 `04-monorepo-architecture.md` 的 "Step 4: 集成到 Electron 主应用" 部分。

---

## 🔧 配置说明

### alias 配置

AI 包可以通过 alias 引用现有代码：

```typescript
// 在 packages/ai-core 或 packages/ai-gateway 中
import { DatabaseService } from '@main/common/database'
import { logger } from '@main/common/logger'
import type { ... } from '@shared/types'
```

这些 alias 已经在各自的 `tsconfig.json` 中配置好了。

### 依赖关系

```
Electron App (src/main)
    ↓ （暂未集成）
@coobee/ai-gateway
    ↓ (workspace:*)
@coobee/ai-core
    ↓
现有基础设施 (src/main/common)
```

---

## 📝 代码填充指南

所有需要实现的地方都标记了 `TODO`，按优先级：

### 优先级 1: SessionStore（已实现骨架）

位置: `packages/ai-core/src/storage/SessionStore.ts`

- ✅ 接口定义完整
- ⚠️ 需要集成真实的 DatabaseService
- ⚠️ 需要测试文件读写

### 优先级 2: ChatAgent（占位实现）

位置: `packages/ai-core/src/agents/ChatAgent.ts`

- ⚠️ 需要实现 OpenAI API 调用
- ⚠️ 需要实现流式响应

### 优先级 3: AgentGateway（占位实现）

位置: `packages/ai-gateway/src/AgentGateway.ts`

- ✅ WebSocket 服务器已实现
- ⚠️ 需要集成 SessionStore
- ⚠️ 需要完善错误处理

### 优先级 4: 工具系统（占位）

位置: `packages/ai-core/src/tools/`

- ✅ ToolRegistry 已实现
- ⚠️ 需要添加内置工具（文件操作、网络请求等）

---

## 🎯 集成到主应用（未来步骤）

### 1. 修改 AppManager

```typescript
// src/main/common/app/index.ts
import { AgentGateway } from '@coobee/ai-gateway'

export class AppManager {
  private agentGateway!: AgentGateway

  async initialize(): Promise<void> {
    // ... 现有初始化逻辑

    // 新增：初始化 AI 网关
    this.agentGateway = new AgentGateway()
    await this.agentGateway.initialize(9000)

    log.info('[AppManager] AI 网关初始化完成')
  }
}
```

### 2. 前端连接 WebSocket

```typescript
// src/renderer/src/services/aiClient.ts
export class AIClient {
  private ws: WebSocket

  connect() {
    this.ws = new WebSocket('ws://localhost:9000')

    this.ws.onmessage = (event) => {
      const response = JSON.parse(event.data)
      console.log('[AI Client] 收到消息:', response)
    }
  }

  async createSession(config: any) {
    this.ws.send(
      JSON.stringify({
        type: 'create-session',
        payload: config
      })
    )
  }
}
```

---

## 📚 相关文档

- [04-monorepo-architecture.md](./04-monorepo-architecture.md) - 完整架构设计
- [06-session-storage-refinement.md](./06-session-storage-refinement.md) - 存储层优化方案

---

## ✅ 检查清单

- [x] 创建 pnpm-workspace.yaml
- [x] 创建 packages/ai-core 目录结构
- [x] 创建 packages/ai-gateway 目录结构
- [x] 添加 package.json 和 tsconfig.json
- [x] 创建基础代码骨架
- [x] 添加 README 说明文档
- [ ] 安装依赖（`pnpm install`）
- [ ] 构建 AI 包（`pnpm --filter '@coobee/ai-*' build`）
- [ ] 实现核心功能（SessionStore、ChatAgent 等）
- [ ] 集成到主应用（AppManager）
- [ ] 测试 WebSocket 连接

---

**现在可以开始 Step 1：安装依赖了！** 🚀

```bash
cd /Users/lifeng/git/git_agents/coobee-ai
pnpm install
```
