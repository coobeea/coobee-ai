---
name: runtime-env
description: 描述 Agent 运行时环境的目录结构、路径约定和可用资源。当 Agent 需要了解文件存放位置、工作空间结构、Skill 来源、Extension 系统或记忆存储时使用此技能。
---

# Runtime Environment

## 概述

你正在 **coobee-ai** 系统中运行。系统为你提供了隔离的工作空间和多级资源。

**系统信息**：

- 平台: `<runtime_environment>` 中的 `platform`, `arch`, `appVersion`
- 工作空间: `<session>` 中的 `workspace`
- 路径: `<runtime_environment>` 中的 `paths`

---

## 核心目录结构（概览）

```
{userHome}/                           # 应用主目录（如 ~/.coobee-ai）
├── config/                           # 配置文件
├── agents/                           # Agent 定义
├── threads/                          # 会话线程
├── memory/                           # 记忆存储
├── skills/                           # 用户 Skill
├── extensions/                       # 用户 Extension
├── workers/                          # Worker 子进程
└── workspaces/                       # Agent 工作空间
    └── {session-id}/                 # 你的工作空间
```

---

## 📚 主题索引（按需查阅）

详细说明请查看对应的 references 文件：

### 核心系统

1. **[路径系统](./references/paths.md)** - 核心路径说明、环境变量
2. **[Agent 系统](./references/agents.md)** - Agent 定义、管理方式
3. **[会话线程](./references/threads.md)** - Thread 结构、生命周期
4. **[工作空间](./references/workspace.md)** - 你的工作目录、文件组织

### 扩展机制

5. **[Skill 系统](./references/skills.md)** - Skill 来源、创建方法、配置
6. **[Extension 系统](./references/extensions.md)** - Extension 能力、创建方法
7. **[Worker 管理](./references/workers.md)** - Worker 配置、启停控制 ⭐

### 数据存储

8. **[记忆系统](./references/memory.md)** - 用户级/Agent 级记忆

---

## 🔍 快速查找

### 文件存放位置问题

→ 查看 [路径系统](./references/paths.md) 或 [工作空间](./references/workspace.md)

### Skill 相关问题

→ 查看 [Skill 系统](./references/skills.md)

### Extension 相关问题

→ 查看 [Extension 系统](./references/extensions.md)

### Agent 创建和管理

→ 查看 [Agent 系统](./references/agents.md)

### Worker 启停控制 ⭐

→ 查看 [Worker 管理](./references/workers.md)

### 记忆读写

→ 查看 [记忆系统](./references/memory.md)

---

## 💡 使用方式

### 渐进式阅读

```
需要了解某个主题时:
  ↓
1. 在索引中找到对应主题
  ↓
2. 使用 read 工具读取 references/xxx.md
  ↓
3. 获取详细信息
  ↓
4. 执行相应操作
```

**优势**: 按需加载，节省 Token，提高效率

---

## ⚠️ 安全边界

以下资源**不对你开放**：

- 数据库文件（由主进程管理）
- 应用内部数据目录（userData、installDir）
- 服务端口配置（serverPort）
- API 密钥和凭据（由 secrets.json5 管理）

需要这些资源时，请通过工具调用向主进程请求。

---

## 🚀 快速上手

1. **了解路径** → `read skills/runtime-env/references/paths.md`
2. **管理 Worker** → `read skills/runtime-env/references/workers.md`
3. **创建 Skill** → `read skills/runtime-env/references/skills.md`
4. **使用记忆** → `read skills/runtime-env/references/memory.md`
