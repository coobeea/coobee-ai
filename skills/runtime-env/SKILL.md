---
name: Runtime Environment
description: 描述 Agent 运行时环境的目录结构、路径约定和可用资源。当 Agent 需要了解文件存放位置、工作空间结构、Skill 来源或记忆存储时使用此技能。
---

# Runtime Environment

## 概述

你正在 **coobee-ai** 系统中运行。系统为你提供了隔离的工作空间和多级资源。
本文档描述了你的运行时环境结构，帮助你正确地读写文件、发现 Skill 和管理输出。

---

## 核心目录结构

```
{userHome}/                          # 用户主目录（系统注入，见下方 <runtime_paths>）
├── config/                          # 用户配置
├── memory/                          # 记忆存储
│   ├── user/                        # 用户级记忆（跨 Agent 共享）
│   │   └── *.json / *.md            # 偏好、长期经验、学习成果
│   └── agent/                       # Agent 级记忆（按 Agent 隔离）
│       └── {agent-id}/              # 特定 Agent 的记忆
├── skills/                          # 用户 Skill（可读写，用户安装/编写）
│   └── {skill-name}/SKILL.md
└── workspaces/                      # Agent 工作空间总根
    └── {session-id}/                # 你的工作空间（见 <runtime_paths>.workspace）
        ├── sessions/                # 会话持久化数据
        ├── contexts/                # LLM 请求上下文快照（系统自动写入）
        ├── events/                  # 流式事件记录（系统自动写入）
        ├── skills/                  # 你自己生成的 Skill
        ├── output/                  # 你的输出文件（报告、代码、文档等）
        └── logs/                    # 运行日志
```

---

## 你的工作空间

系统为你分配了一个独立工作空间（`<runtime_paths>` 中的 `workspace`）。

### 目录用途

| 子目录      | 用途         | 说明                                               |
| ----------- | ------------ | -------------------------------------------------- |
| `sessions/` | 会话持久化   | 系统自动管理，通常无需手动操作                     |
| `contexts/` | 上下文快照   | 系统自动记录每次 LLM 调用的输入配置和输出结果      |
| `events/`   | 事件记录     | 系统自动记录所有流式事件（JSONL 格式，完整时间线） |
| `skills/`   | 自生成 Skill | 你可以在此创建新的 Skill 供后续使用                |
| `output/`   | 输出文件     | 生成的代码、报告、文档等放在这里                   |
| `logs/`     | 运行日志     | 执行过程的日志记录                                 |

### 文件操作建议

- **输出文件** → 放入 `{workspace}/output/`
- **自创建 Skill** → 放入 `{workspace}/skills/{skill-name}/SKILL.md`
- **临时文件** → 使用 `<runtime_paths>` 中的 `temp` 目录
- **不要修改** `sessions/`、`contexts/` 和 `events/` 下的文件

---

## Skill 系统

Skill 有三级来源，按优先级从低到高合并（同名后者覆盖前者）：

| 优先级    | 来源  | 路径                               | 说明             |
| --------- | ----- | ---------------------------------- | ---------------- |
| 1（最低） | 内置  | `<runtime_paths>.builtinSkillsDir` | 随系统分发，只读 |
| 2         | 用户  | `<runtime_paths>.userSkillsDir`    | 用户安装/编写    |
| 3（最高） | Agent | `{workspace}/skills/`              | 你自己生成的     |

### 创建 Skill

在 `{workspace}/skills/` 下创建子目录，包含 `SKILL.md`：

```
{workspace}/skills/my-new-skill/
├── SKILL.md              # 必须 — 技能描述和指令
├── references/           # 可选 — 参考资料
└── scripts/              # 可选 — 辅助脚本
```

---

## 记忆系统

| 层级     | 路径            | 说明                                      |
| -------- | --------------- | ----------------------------------------- |
| 用户级   | `memory/user/`  | 跨 Agent 共享的长期记忆（偏好、全局经验） |
| Agent 级 | `memory/agent/` | 按 Agent 隔离的记忆（特定领域学习成果）   |

- 记忆是**持久化**的，不随会话结束而清除
- 写入记忆前请确认内容有长期价值

---

## 运行时路径注入

系统在启动时会向你的上下文注入 `<runtime_paths>` 块，包含所有实际路径值。
通过这些路径你可以准确定位任何目录。

### 路径说明

| 键                 | 说明                               |
| ------------------ | ---------------------------------- |
| `workspace`        | 你的工作空间根目录                 |
| `userHome`         | 用户主目录                         |
| `temp`             | 系统临时目录                       |
| `builtinSkillsDir` | 内置 Skill 目录                    |
| `userSkillsDir`    | 用户 Skill 目录                    |
| `memoryDir`        | 记忆总根目录                       |
| `platform`         | 操作系统（darwin / win32 / linux） |
| `isDev`            | 是否为开发模式                     |

---

## 安全边界

以下资源**不对你开放**：

- 数据库文件（由主进程管理）
- 应用内部数据目录（userData、installDir）
- 服务端口配置（httpPort、wsPort）
- API 密钥和凭据

需要这些资源时，请通过工具调用向主进程请求。
