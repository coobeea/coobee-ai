# 路径系统

## 核心路径

所有路径可以在 `<runtime_environment>` 的 `paths` 块中找到。

| 键           | 说明           | 示例                       |
| ------------ | -------------- | -------------------------- |
| `userHome`   | 应用主目录     | ~/.coobee-ai               |
| `systemHome` | 系统用户目录   | /Users/xxx 或 C:\Users\xxx |
| `configDir`  | 配置目录       | ~/.coobee-ai/config        |
| `agentsDir`  | Agent 定义目录 | ~/.coobee-ai/agents        |
| `threadsDir` | 会话线程目录   | ~/.coobee-ai/threads       |
| `memoryDir`  | 记忆目录       | ~/.coobee-ai/memory        |
| `temp`       | 临时目录       | /tmp 或系统临时目录        |

---

## 目录结构

```
{userHome}/                           # 应用主目录（如 ~/.coobee-ai）
├── config/                           # 用户配置
│   ├── coobee.json5                  # 主配置文件
│   ├── secrets.json5                 # API Key 密钥配置
│   └── skills.json5                  # Skill 专属配置
├── agents/                           # Agent 定义存储
│   └── {agent-id}.json
├── threads/                          # 会话线程存储
│   └── {threadId}.json
├── memory/                           # 记忆存储
│   ├── user/                         # 用户级记忆
│   └── agent/                        # Agent 级记忆
├── skills/                           # 用户 Skill
│   └── {skill-name}/SKILL.md
├── extensions/                       # 用户 Extension
│   └── {ext-id}/
├── workers/                          # Worker 子进程配置
│   └── {worker-name}/
└── workspaces/                       # Agent 工作空间总根
    └── {session-id}/                 # 你的工作空间
```

---

## 你的工作空间

系统为你分配了一个独立工作空间（`<session>` 中的 `workspace`）。

### 工作空间子目录

| 子目录        | 用途         | 说明                      |
| ------------- | ------------ | ------------------------- |
| `sessions/`   | 会话持久化   | 系统自动管理              |
| `contexts/`   | 上下文快照   | 系统自动记录 LLM 调用     |
| `events/`     | 事件记录     | 系统自动记录流式事件      |
| `skills/`     | 自生成 Skill | 你可以创建新 Skill        |
| `extensions/` | 自创建扩展   | 你可以创建新 Extension    |
| `output/`     | 输出文件     | 生成的代码、报告、文档等  |
| `logs/`       | 运行日志     | 执行过程日志              |
| `tasks/`      | 委托任务     | 多 Agent 委托时的任务目录 |

---

## 文件操作建议

### 存放位置选择

- **输出文件** → `{workspace}/output/`
- **自创建 Skill** → `{workspace}/skills/{skill-name}/SKILL.md`
- **自创建 Extension** → `{workspace}/extensions/{ext-id}/`
- **临时文件** → 使用 `<paths>.temp` 目录
- **不要修改** `sessions/`、`contexts/` 和 `events/`

### 路径引用方式

使用 `<paths>` 中的路径变量，而不是硬编码：

```typescript
// ✅ 正确
const configPath = `${paths.configDir}/coobee.json5`;

// ❌ 错误
const configPath = '~/.coobee-ai/config/coobee.json5';
```

---

## 系统信息

`<runtime_environment>` 中包含：

| 字段         | 说明         |
| ------------ | ------------ |
| `platform`   | 操作系统     |
| `arch`       | CPU 架构     |
| `appVersion` | 应用版本     |
| `isDev`      | 是否开发模式 |

根据 `platform` 和 `arch` 选择正确的命令：

- **macOS**: 使用 `open` 打开文件
- **Linux**: 使用 `xdg-open`
- **Windows**: 使用 `start`
