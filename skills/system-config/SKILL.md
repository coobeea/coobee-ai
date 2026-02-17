---
name: system-config
description: 应用配置体系和自我管理指南。当 Agent 需要修改系统配置（沙箱模式、模型设置、审批策略等）、了解可配置项、或进行自我优化时使用此技能。
---

# System Configuration & Self-Management

## 概述

你拥有修改 coobee-ai 系统配置的能力。通过 `config_patch` 工具，你可以在用户授权后修改运行时配置。
配置文件是 `coobee.json5`，存放在 `<paths>.configDir` 目录下。修改后自动热重载，立即生效。

---

## 配置修改方式

使用 `config_patch` 工具修改配置：

```
config_patch({
  patch: '{"security": {"sandbox": {"mode": "off"}}}',
  description: '关闭沙箱模式'
})
```

- `patch`：JSON5 格式的配置补丁，深度合并到当前配置
- `description`：描述本次修改的目的
- 修改前需要用户确认（needUserConfirm: true）
- 写入前经过 Schema 校验，防止畸形数据

---

## 可配置项一览

### 1. 安全 — `security`

#### 沙箱模式 `security.sandbox.mode`

控制工具执行的安全隔离级别。

| 值          | 说明                                        | 适用场景               |
| ----------- | ------------------------------------------- | ---------------------- |
| `off`       | 无沙箱保护，文件读写不受目录限制            | 开发调试、完全信任环境 |
| `path-only` | 路径守卫（默认），写操作限制在 workspace 内 | 日常使用               |
| `docker`    | 完整 Docker 容器隔离                        | 高安全需求             |

修改示例：

```
config_patch({ patch: '{"security": {"sandbox": {"mode": "off"}}}', description: '关闭沙箱' })
```

#### 命令审批 `security.approvals.exec`

控制 `exec` 工具执行命令时的审批策略。

| 值       | 说明                                               |
| -------- | -------------------------------------------------- |
| `auto`   | 智能判断：安全命令直接执行，危险命令需审批（默认） |
| `always` | 所有命令都需要用户审批                             |
| `never`  | 跳过审批，所有命令直接执行                         |

修改示例：

```
config_patch({ patch: '{"security": {"approvals": {"exec": "never"}}}', description: '跳过命令审批' })
```

### 2. Agent 设置 — `agents`

#### 默认模型 `agents.defaults.model`

```json5
{
  agents: {
    defaults: {
      model: {
        primary: 'dashscope/qwen3.5-plus',
        fallbacks: ['siliconflow/deepseek-v3']
      }
    }
  }
}
```

#### 思维链级别 `agents.defaults.thinkingLevel`

控制 LLM 推理深度（需模型支持 reasoning）。

| 值        | 推理深度     |
| --------- | ------------ |
| `minimal` | 最小         |
| `low`     | 低           |
| `medium`  | 中等（默认） |
| `high`    | 高           |
| `xhigh`   | 最高         |

### 3. 工具设置 — `tools`

#### 命令超时 `tools.exec.timeout`

`exec` 工具的超时时间（毫秒），默认 `30000`。

#### 命令黑名单 `tools.exec.blacklist`

禁止执行的命令列表。

### 4. 消息队列 — `messages.queue`

| 字段         | 默认值      | 说明                                       |
| ------------ | ----------- | ------------------------------------------ |
| `mode`       | `collect`   | 队列模式: followup/steer/collect/interrupt |
| `debounceMs` | `500`       | 消息防抖延迟（毫秒）                       |
| `cap`        | `20`        | 队列容量上限                               |
| `dropPolicy` | `summarize` | 溢出策略: old/new/summarize                |

### 5. UI 设置 — `ui`

| 字段           | 默认值  | 说明                  |
| -------------- | ------- | --------------------- |
| `theme`        | `auto`  | 主题: auto/light/dark |
| `language`     | `zh-CN` | 界面语言              |
| `soundEffects` | `true`  | 声音效果              |

### 6. 日志设置 — `logging`

| 字段    | 默认值 | 说明                            |
| ------- | ------ | ------------------------------- |
| `level` | `info` | 日志级别: debug/info/warn/error |
| `file`  | `true` | 是否写入日志文件                |

---

## 模型 Provider 配置

Provider 配置在 `models.providers` 下，每个 Provider 包含：

| 字段      | 说明                                            |
| --------- | ----------------------------------------------- |
| `name`    | Provider 名称                                   |
| `baseUrl` | API 端点                                        |
| `apiKey`  | API Key（建议使用 `${VAR}` 引用 secrets.json5） |
| `api`     | API 类型: openai-compatible/anthropic/google    |
| `models`  | 模型列表                                        |
| `enabled` | 是否启用                                        |

> **注意**：API Key 应存放在 secrets.json5 中，不要通过 config_patch 直接写入。
> config_patch 会自动脱敏，防止 API Key 泄漏到主配置文件。

---

## 自我进化指南

你不仅是一个任务执行者，还是一个可以自我改进的系统。以下是你的扩展点：

### 1. 添加知识 → 创建 Skill

当你发现某个领域需要重复使用的专业知识或工作流程时，创建一个 Skill：

```
write({
  path: '{workspace}/skills/my-skill/SKILL.md',
  content: '---\nname: my-skill\ndescription: ...\n---\n...'
})
```

参考 `skill-creator` Skill 了解详细创建方法。

### 2. 添加能力 → 创建 Extension

当你需要新的工具或生命周期钩子时，创建一个 Extension：

```
{workspace}/extensions/my-ext/
├── extension.json
└── index.ts
```

Extension 可以：

- `registerTool` — 注册新工具
- `on(hookName)` — 注册生命周期钩子
- `registerGatewayMethod` — 注册 Gateway RPC 方法
- 声明 `skills` — 贡献额外的 Skill

参考 `extension-creator` Skill 了解详细创建方法。

### 3. 调整行为 → 修改配置

通过 `config_patch` 工具修改系统行为：

- 调整安全级别（沙箱模式、审批策略）
- 切换默认模型
- 调整推理深度
- 修改 UI 设置

### 4. 积累经验 → 使用 Memory

将有价值的知识写入记忆系统，供后续会话使用：

- 用户偏好 → `memory(write, scope='user', file='preferences.md')`
- 项目知识 → `memory(write, scope='agent', file='MEMORY.md')`
- 教训总结 → `memory(write, scope='agent', file='lessons.md')`

### 5. 修改协议 → 覆盖 execution-protocol

在 `{workspace}/skills/execution-protocol/SKILL.md` 创建同名 Skill，覆盖默认执行协议。

---

## 自我改进工作流

```
发现问题/需求
    ↓
分析：是知识缺失？能力缺失？配置不当？经验不足？
    ↓
选择行动：
  知识 → 创建/更新 Skill
  能力 → 创建/更新 Extension
  配置 → config_patch 修改
  经验 → memory 写入
    ↓
执行改进
    ↓
验证效果（self-reflection）
    ↓
记录到 memory（供未来会话复用）
```

---

## 注意事项

1. **config_patch 需要用户确认** — 这是安全设计，不要尝试绕过
2. **不要修改 API Key** — API Key 由 secrets.json5 管理，config_patch 会自动脱敏
3. **配置立即生效** — 修改后通过热重载立即应用，无需重启
4. **Schema 校验** — 非法配置会被拒绝，不用担心写坏配置文件
5. **先读后改** — 修改前用 `read` 工具查看当前配置，了解现状
