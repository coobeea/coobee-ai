---
name: runtime-env
description: 描述 Agent 运行时环境的目录结构、路径约定和可用资源。当 Agent 需要了解文件存放位置、工作空间结构、Skill 来源、Extension 系统或记忆存储时使用此技能。
---

# Runtime Environment

## 概述

你正在 **coobee-ai** 系统中运行。系统为你提供了隔离的工作空间和多级资源。
本文档描述了你的运行时环境结构，帮助你正确地读写文件、发现 Skill、管理 Extension 和使用工具。

系统在启动时会向你的上下文注入 `<runtime_environment>` 块，包含所有实际路径值和能力清单。

---

## 系统信息

`<runtime_environment>` 中包含以下系统信息：

| 键           | 说明                                                 |
| ------------ | ---------------------------------------------------- |
| `platform`   | 操作系统（darwin = macOS / win32 = Windows / linux） |
| `arch`       | CPU 架构（arm64 / x64）                              |
| `appVersion` | coobee-ai 版本号                                     |
| `isDev`      | 是否为开发模式                                       |

根据 `platform` 和 `arch` 选择正确的命令和路径格式。例如：

- macOS 使用 `open` 打开文件，Linux 使用 `xdg-open`
- arm64 架构可能需要不同的二进制文件

---

## 核心目录结构

```
{systemHome}/                         # 系统用户目录（如 /Users/xxx）
{userHome}/                           # 应用主目录（如 ~/.coobee-ai）
├── config/                           # 用户配置
├── memory/                           # 记忆存储
│   ├── user/                         # 用户级记忆（跨 Agent 共享）
│   │   └── *.json / *.md             # 偏好、长期经验、学习成果
│   └── agent/                        # Agent 级记忆（按 Agent 隔离）
│       └── {agent-id}/               # 特定 Agent 的记忆
├── skills/                           # 用户 Skill（可读写，用户安装/编写）
│   └── {skill-name}/SKILL.md
├── extensions/                       # 用户 Extension（可读写，用户安装/编写）
│   └── {ext-id}/
│       ├── extension.json            # 扩展清单
│       ├── index.ts                  # 代码入口（可选）
│       └── skills/                   # 扩展贡献的 Skill（可选）
└── workspaces/                       # Agent 工作空间总根
    └── {session-id}/                 # 你的工作空间（见 <session>.workspace）
        ├── sessions/                 # 会话持久化数据
        ├── contexts/                 # LLM 请求上下文快照（系统自动写入）
        ├── events/                   # 流式事件记录（系统自动写入）
        ├── skills/                   # 你自己生成的 Skill
        ├── extensions/               # 你自己创建的 Extension
        ├── output/                   # 你的输出文件（报告、代码、文档等）
        └── logs/                     # 运行日志
```

---

## 你的工作空间

系统为你分配了一个独立工作空间（`<session>` 中的 `workspace`）。
你的 `sessionId` 也在 `<session>` 中提供。

### 目录用途

| 子目录        | 用途         | 说明                                               |
| ------------- | ------------ | -------------------------------------------------- |
| `sessions/`   | 会话持久化   | 系统自动管理，通常无需手动操作                     |
| `contexts/`   | 上下文快照   | 系统自动记录每次 LLM 调用的输入配置和输出结果      |
| `events/`     | 事件记录     | 系统自动记录所有流式事件（JSONL 格式，完整时间线） |
| `skills/`     | 自生成 Skill | 你可以在此创建新的 Skill 供后续使用                |
| `extensions/` | 自创建扩展   | 你可以在此创建新的 Extension（会被热加载）         |
| `output/`     | 输出文件     | 生成的代码、报告、文档等放在这里                   |
| `logs/`       | 运行日志     | 执行过程的日志记录                                 |

### 文件操作建议

- **输出文件** → 放入 `{workspace}/output/`
- **自创建 Skill** → 放入 `{workspace}/skills/{skill-name}/SKILL.md`
- **自创建 Extension** → 放入 `{workspace}/extensions/{ext-id}/`
- **临时文件** → 使用 `<paths>` 中的 `temp` 目录
- **不要修改** `sessions/`、`contexts/` 和 `events/` 下的文件

---

## Skill 系统

Skill 是场景化的操作手册 —— 一段自然语言指导文本，告诉你遇到某种场景时应该如何行动。

### Skill 来源（按优先级从低到高）

| 优先级    | 来源     | 路径                  | 说明                      |
| --------- | -------- | --------------------- | ------------------------- |
| 1（最低） | 内置     | `builtinSkillsDir`    | 随系统分发，只读          |
| 1.5       | 扩展贡献 | Extension 声明的目录  | Extension manifest 中声明 |
| 2         | 用户     | `userSkillsDir`       | 用户安装/编写             |
| 3（最高） | Agent    | `{workspace}/skills/` | 你自己生成的              |

同名 Skill 高优先级覆盖低优先级。

### 创建 Skill

在 `{workspace}/skills/` 下创建子目录，包含 `SKILL.md`：

```
{workspace}/skills/my-new-skill/
├── SKILL.md              # 必须 — 技能描述和指令
├── references/           # 可选 — 参考资料
└── scripts/              # 可选 — 辅助脚本
```

SKILL.md 格式：

```markdown
---
name: My Skill Name
description: 一句话描述，告诉系统何时使用此 Skill
---

# Skill 标题

## 使用场景

描述何时应该使用这个 Skill...

## 操作步骤

1. 第一步...
2. 第二步...

## 注意事项

- 注意事项...
```

---

## Extension 系统

Extension 是动态可插拔的功能模块，可以注册工具（Tool）、生命周期钩子（Hook）、Gateway 方法，还可以贡献 Skill。

### Extension 来源（按优先级从低到高）

| 优先级    | 来源  | 路径                      | 说明             |
| --------- | ----- | ------------------------- | ---------------- |
| 1（最低） | 内置  | `builtinExtensionsDir`    | 随系统分发，只读 |
| 2         | 用户  | `userExtensionsDir`       | 用户安装/编写    |
| 3（最高） | Agent | `{workspace}/extensions/` | 你自己创建的     |

同 ID 高优先级覆盖低优先级。工作空间级 Extension 会被 `fs.watch` 热加载。

### Extension 能力

| 能力              | 说明                                         |
| ----------------- | -------------------------------------------- |
| `registerTool`    | 注册新工具，可被 LLM 通过 function call 调用 |
| `on(hookName)`    | 注册 Agent 生命周期钩子                      |
| `registerGateway` | 注册 Gateway RPC 方法                        |
| 声明 `skills`     | 在 manifest 中声明 Skill 目录                |

### 创建 Extension

最小结构：

```
{workspace}/extensions/my-ext/
├── extension.json        # 必须 — 扩展清单
└── index.ts              # 可选 — 代码入口（纯 Skill 扩展可省略）
```

extension.json 格式：

```json
{
  "id": "my-ext",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "扩展描述",
  "skills": "skills"
}
```

index.ts 代码骨架：

```typescript
import type { ExtensionApi } from '@main/common/extension'

export default {
  id: 'my-ext',
  name: 'My Extension',
  register(api: ExtensionApi) {
    // 注册工具
    api.registerTool({ ... })
    // 注册生命周期钩子
    api.on('before_agent_start', async (event) => { ... })
    // 注册 Gateway 方法
    api.registerGatewayMethod('myext.hello', async (params) => ({ ... }))
  }
}
```

### 纯 Skill 扩展

如果只需要贡献 Skill（无代码），可以省略 `index.ts`：

```
{workspace}/extensions/my-skill-pack/
├── extension.json        # 声明 skills 字段
└── skills/
    ├── skill-a/SKILL.md
    └── skill-b/SKILL.md
```

---

## 可用工具

`<tools>` 块列出了你当前可以调用的所有工具名称。工具通过 function calling 调用，每个工具有明确的参数定义。

---

## 记忆系统

| 层级     | 路径            | 说明                                      |
| -------- | --------------- | ----------------------------------------- |
| 用户级   | `memory/user/`  | 跨 Agent 共享的长期记忆（偏好、全局经验） |
| Agent 级 | `memory/agent/` | 按 Agent 隔离的记忆（特定领域学习成果）   |

- 记忆是**持久化**的，不随会话结束而清除
- 写入记忆前请确认内容有长期价值

---

## `<runtime_environment>` 字段参考

| 块           | 键                     | 说明                          |
| ------------ | ---------------------- | ----------------------------- |
| `system`     | `platform`             | 操作系统                      |
| `system`     | `arch`                 | CPU 架构                      |
| `system`     | `appVersion`           | 应用版本                      |
| `system`     | `isDev`                | 是否开发模式                  |
| `session`    | `sessionId`            | 当前会话 ID                   |
| `session`    | `workspace`            | 工作空间根目录                |
| `paths`      | `userHome`             | 应用主目录                    |
| `paths`      | `systemHome`           | 系统用户目录（如 /Users/xxx） |
| `paths`      | `temp`                 | 系统临时目录                  |
| `paths`      | `memoryDir`            | 记忆总根目录                  |
| `skills`     | `builtinSkillsDir`     | 内置 Skill 目录               |
| `skills`     | `userSkillsDir`        | 用户 Skill 目录               |
| `skills`     | `searchPaths`          | Skill 搜索路径列表            |
| `extensions` | `builtinExtensionsDir` | 内置 Extension 目录           |
| `extensions` | `userExtensionsDir`    | 用户 Extension 目录           |
| `extensions` | `searchPaths`          | Extension 搜索路径列表        |
| `extensions` | `loaded`               | 已加载的 Extension ID         |
| `tools`      | `tool`                 | 可用工具名称                  |

---

## 安全边界

以下资源**不对你开放**：

- 数据库文件（由主进程管理）
- 应用内部数据目录（userData、installDir）
- 服务端口配置（serverPort）
- API 密钥和凭据

需要这些资源时，请通过工具调用向主进程请求。
