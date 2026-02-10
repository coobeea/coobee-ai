# pi-coding-agent Extensions 扩展系统深度分析

> 来源：`/Users/lifeng/git/git_agents/pi-mono/packages/coding-agent/examples/extensions`
>
> 总计 **60+** 个扩展示例，涵盖 11 个功能分类。

---

## 一、扩展系统架构

### 1.1 ExtensionAPI 核心能力

每个扩展导出一个接受 `ExtensionAPI` 的函数：

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // 事件拦截
  pi.on("event_name", async (event, ctx) => { ... });

  // 注册工具
  pi.registerTool({ name, label, description, parameters, execute, renderCall?, renderResult? });

  // 注册命令（/command）
  pi.registerCommand("name", { description, handler });

  // 注册快捷键
  pi.registerShortcut(Key.ctrlAlt("p"), { description, handler });

  // 注册 CLI 标志
  pi.registerFlag("flag-name", { description, type: "string" | "boolean", default });

  // 工具管理
  pi.setActiveTools(["read", "bash", "edit", "write"]);
  pi.getActiveTools();
  pi.getAllTools();

  // 模型管理
  pi.setModel(model);
  pi.setThinkingLevel("medium");

  // 消息发送
  pi.sendMessage({ customType, content, display }, { triggerTurn: boolean });
  pi.sendUserMessage(text);

  // 会话条目持久化
  pi.appendEntry("custom-type", data);

  // Shell 执行
  pi.exec("git", ["stash", "create"]);

  // 扩展间通信
  pi.events.emit("channel", data);
  pi.events.on("channel", handler);
}
```

### 1.2 ExtensionContext (ctx) 核心能力

```typescript
ctx.cwd // 工作目录
ctx.hasUI // 是否有 UI
ctx.model // 当前模型
ctx.modelRegistry // 模型注册表（find, getApiKey, getAvailable）
ctx.sessionManager // 会话管理（getBranch, getEntries, getLeafEntry）
ctx.getContextUsage() // 上下文 token 使用量

// UI 能力
ctx.ui.notify(message, level) // 通知
ctx.ui.confirm(title, message) // 确认对话框
ctx.ui.select(prompt, options) // 选择器
ctx.ui.editor(title, initial) // 编辑器
ctx.ui.setStatus(id, text) // 状态栏
ctx.ui.setWidget(id, lines) // Widget
ctx.ui.setFooter(component) // 自定义 Footer
ctx.ui.setHeader(component) // 自定义 Header
ctx.ui.setEditorText(text) // 设置编辑器内容
ctx.ui.setEditorComponent(comp) // 自定义编辑器
ctx.ui.custom(renderFn) // 完全自定义 UI

ctx.ui.theme // 主题
ctx.ui.theme.fg('accent', text) // 主题颜色
ctx.ui.theme.bold(text) // 粗体
ctx.ui.theme.strikethrough(text) // 删除线

ctx.compact(options) // 触发压缩
ctx.newSession(options) // 新建会话
ctx.shutdown() // 关闭
```

### 1.3 可拦截的事件

| 事件                     | 触发时机      | 可返回                                    |
| ------------------------ | ------------- | ----------------------------------------- |
| `agent_start`            | Agent 开始前  | —                                         |
| `agent_end`              | Agent 结束后  | —                                         |
| `turn_start`             | 每轮开始      | —                                         |
| `turn_end`               | 每轮结束      | —                                         |
| `tool_call`              | 工具调用前    | `{ block: true, reason }` 阻止            |
| `tool_result`            | 工具结果后    | —                                         |
| `before_agent_start`     | Agent 启动前  | `{ systemPrompt, message }` 修改          |
| `context`                | 构建上下文时  | `{ messages }` 过滤消息                   |
| `session_start`          | 会话启动      | —                                         |
| `session_shutdown`       | 会话关闭      | —                                         |
| `session_switch`         | 切换会话      | —                                         |
| `session_fork`           | 分叉会话      | —                                         |
| `session_tree`           | 树导航        | —                                         |
| `session_before_fork`    | 分叉前        | —                                         |
| `session_before_compact` | 压缩前        | `{ compaction }` 自定义压缩               |
| `model_select`           | 模型切换      | —                                         |
| `input`                  | 用户输入      | 转换输入                                  |
| `user_bash`              | 用户执行 bash | `{ operations }` 替换执行                 |
| `resources_discover`     | 资源发现      | `{ skillPaths, promptPaths, themePaths }` |

---

## 二、扩展分类详解

### 2.1 安全与权限控制（Lifecycle & Safety）

#### `permission-gate.ts` — 危险命令确认

拦截 `tool_call` 事件，匹配 `rm -rf`、`sudo`、`chmod 777` 等危险模式，弹出确认对话框：

```typescript
pi.on('tool_call', async (event, ctx) => {
  if (event.toolName !== 'bash') return
  const command = event.input.command as string
  if (dangerousPatterns.some((p) => p.test(command))) {
    const choice = await ctx.ui.select('⚠️ Dangerous command', ['Yes', 'No'])
    if (choice !== 'Yes') return { block: true, reason: 'Blocked by user' }
  }
})
```

#### `protected-paths.ts` — 路径保护

阻止对 `.env`、`.git/`、`node_modules/` 的 write/edit 操作。

#### `confirm-destructive.ts` — 破坏性会话操作确认

确认 clear、switch、fork 等会话操作。

#### `dirty-repo-guard.ts` — Git 脏仓库保护

未提交变更时阻止会话操作。

#### `sandbox/` — OS 级沙箱

使用 `@anthropic-ai/sandbox-runtime` 对 bash 命令实施 **OS 级文件系统和网络限制**：

```json
{
  "enabled": true,
  "network": {
    "allowedDomains": ["github.com", "*.npmjs.org"],
    "deniedDomains": []
  },
  "filesystem": {
    "denyRead": ["~/.ssh", "~/.aws", "~/.gnupg"],
    "allowWrite": [".", "/tmp"],
    "denyWrite": [".env", "*.pem", "*.key"]
  }
}
```

通过 `SandboxManager.wrapWithSandbox(command)` 将 bash 命令包装在沙箱中执行（macOS 用 `sandbox-exec`，Linux 用 `bubblewrap`）。

---

### 2.2 Plan Mode — 计划模式（read-only 探索）

**核心理念**：先分析、后执行，分两阶段工作。

```
/plan → 进入计划模式（只读）
  ↓ Agent 分析代码，输出编号计划
  ↓ 用户选择 "Execute the plan"
  ↓ 切换到执行模式（完整工具）
  ↓ Agent 逐步执行，标记 [DONE:n]
  ↓ Widget 显示进度
```

**关键实现**：

1. **工具限制**：计划模式只允许 `read, bash, grep, find, ls, questionnaire`
2. **Bash 白名单**：`cat, head, tail, grep, find, git status, git log, git diff` 等只读命令
3. **上下文注入**：通过 `before_agent_start` 注入计划模式指令
4. **进度追踪**：解析 `[DONE:n]` 标记，更新 Widget
5. **会话持久化**：通过 `pi.appendEntry()` 保存状态，支持会话恢复

**ExtensionAPI 用法亮点**：

- `pi.setActiveTools()` — 动态切换工具集
- `pi.registerShortcut(Key.ctrlAlt("p"))` — 快捷键
- `pi.on("before_agent_start")` — 注入系统消息
- `pi.on("context")` — 过滤过期的计划模式上下文
- `pi.appendEntry()` — 自定义条目持久化

---

### 2.3 Subagent — 子智能体委派

**三种执行模式**：

| 模式     | 参数               | 说明                                    |
| -------- | ------------------ | --------------------------------------- |
| Single   | `{ agent, task }`  | 单个子 Agent                            |
| Parallel | `{ tasks: [...] }` | 最多 8 个并行（4 并发）                 |
| Chain    | `{ chain: [...] }` | 串行，`{previous}` 占位符传递上一步输出 |

**Agent 定义**（Markdown + YAML frontmatter）：

```markdown
---
name: scout
description: Fast codebase recon
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
---

System prompt for the agent goes here.
```

**预设 Agent**：

| Agent      | 用途         | 模型   | 工具                       |
| ---------- | ------------ | ------ | -------------------------- |
| `scout`    | 快速代码侦察 | Haiku  | read, grep, find, ls, bash |
| `planner`  | 实施方案规划 | Sonnet | read, grep, find, ls       |
| `reviewer` | 代码审查     | Sonnet | read, grep, find, ls, bash |
| `worker`   | 通用执行     | Sonnet | 全部                       |

**工作流模板**：

| 模板                           | 流程                       |
| ------------------------------ | -------------------------- |
| `/implement <task>`            | scout → planner → worker   |
| `/scout-and-plan <task>`       | scout → planner            |
| `/implement-and-review <task>` | worker → reviewer → worker |

**实现方式**：每个子 Agent 是一个独立的 `pi` 子进程（`spawn("pi", args)`），通过 JSON 模式捕获结构化输出。

---

### 2.4 Preset — 预设配置

通过 JSON 配置文件定义命名预设（model + thinkingLevel + tools + instructions）：

```json
{
  "plan": {
    "provider": "openai-codex",
    "model": "gpt-5.2-codex",
    "thinkingLevel": "high",
    "tools": ["read", "grep", "find", "ls"],
    "instructions": "You are in PLANNING MODE..."
  },
  "implement": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "thinkingLevel": "high",
    "tools": ["read", "bash", "edit", "write"],
    "instructions": "You are in IMPLEMENTATION MODE..."
  }
}
```

**使用方式**：

- CLI：`pi --preset plan`
- 命令：`/preset`（选择器）、`/preset implement`（直接切换）
- 快捷键：`Ctrl+Shift+U`（循环切换）

---

### 2.5 自定义工具（Custom Tools）

#### `todo.ts` — Todo 管理

完整的 CRUD 工具，展示**状态持久化模式**：

- 状态存储在 `tool result details` 中（不是外部文件）
- 支持分支——分叉时状态自动正确
- 通过 `session_start/switch/fork/tree` 事件重建状态

#### `tool-override.ts` — 工具覆盖

注册同名工具覆盖内置工具（例如给 `read` 加审计日志和路径拦截）：

```typescript
pi.registerTool({
  name: "read",  // 同名 → 覆盖内置 read
  label: "read (audited)",
  async execute(id, params) {
    logAccess(path, true);  // 审计日志
    if (isBlockedPath(path)) return { block... };  // 路径拦截
    // 正常读取...
  }
});
```

#### `truncated-tool.ts` — 输出截断

包装 ripgrep，限制输出 50KB / 2000 行。

#### `ssh.ts` — SSH 远程执行

**所有工具（read/write/edit/bash）都代理到远程机器**。核心是自定义 `Operations`：

```typescript
// 远程 Read
const remoteReadOps: ReadOperations = {
  readFile: (p) => sshExec(remote, `cat ${toRemote(p)}`),
  access: (p) => sshExec(remote, `test -r ${toRemote(p)}`),
};
pi.registerTool({ ...localRead, execute: /* 使用 remoteReadOps */ });

// 远程 Bash
pi.on("user_bash", () => ({ operations: createRemoteBashOps() }));

// 修改 system prompt 中的 cwd
pi.on("before_agent_start", async (event) => ({
  systemPrompt: event.systemPrompt.replace(localCwd, `${remoteCwd} (via SSH: ${remote})`),
}));
```

---

### 2.6 System Prompt 与压缩

#### `pirate.ts` — 动态修改 System Prompt

通过 `systemPromptAppend` 追加 prompt 指令。

#### `claude-rules.ts` — Claude Rules

扫描 `.claude/rules/` 文件夹，将规则注入 system prompt。

#### `custom-compaction.ts` — 自定义压缩

替换默认压缩行为，使用 **Gemini Flash** 模型做全文总结：

```typescript
pi.on('session_before_compact', async (event, ctx) => {
  const { preparation } = event
  const allMessages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages]

  // 用 Gemini Flash 做便宜快速的摘要
  const model = ctx.modelRegistry.find('google', 'gemini-2.5-flash')
  const response = await complete(model, { messages: summaryMessages }, { apiKey })

  return {
    compaction: { summary, firstKeptEntryId, tokensBefore }
  }
})
```

#### `trigger-compact.ts` — 触发压缩

当 context token > 100k 时自动触发压缩。

---

### 2.7 Git 集成

#### `git-checkpoint.ts` — Git 检查点

每轮开始时创建 `git stash create`，分叉时可恢复代码：

```typescript
pi.on('turn_start', async () => {
  const { stdout } = await pi.exec('git', ['stash', 'create'])
  checkpoints.set(currentEntryId, stdout.trim())
})

pi.on('session_before_fork', async (event, ctx) => {
  const ref = checkpoints.get(event.entryId)
  // 提示用户是否恢复
  await pi.exec('git', ['stash', 'apply', ref])
})
```

#### `auto-commit-on-exit.ts` — 退出自动提交

使用最后助手消息作为 commit message。

---

### 2.8 命令与 UI

| 扩展                   | 功能                 | 核心 API                              |
| ---------------------- | -------------------- | ------------------------------------- |
| `handoff.ts`           | 上下文交接到新会话   | `ctx.newSession()`, `ctx.ui.editor()` |
| `tools.ts`             | 交互式工具开关       | `pi.setActiveTools()`, `SettingsList` |
| `status-line.ts`       | 状态栏进度           | `ctx.ui.setStatus()`                  |
| `widget-placement.ts`  | Widget 定位          | `ctx.ui.setWidget()`                  |
| `model-status.ts`      | 模型切换通知         | `pi.on("model_select")`               |
| `custom-footer.ts`     | 自定义 Footer        | `ctx.ui.setFooter()`                  |
| `custom-header.ts`     | 自定义 Header        | `ctx.ui.setHeader()`                  |
| `modal-editor.ts`      | Vim-like 编辑器      | `ctx.ui.setEditorComponent()`         |
| `rainbow-editor.ts`    | 彩虹文字特效         | `ctx.ui.setEditorComponent()`         |
| `notify.ts`            | 桌面通知（OSC 777）  | 终端转义序列                          |
| `snake.ts`             | 贪吃蛇游戏           | 自定义 UI + 键盘处理                  |
| `doom-overlay/`        | DOOM 游戏 overlay    | 35 FPS 实时渲染                       |
| `summarize.ts`         | GPT-5.2 总结对话     | `complete()` + transient UI           |
| `shutdown-command.ts`  | /quit 命令           | `ctx.shutdown()`                      |
| `reload-runtime.ts`    | 安全重载             | `pi.on("reload")`                     |
| `interactive-shell.ts` | 交互命令（vim/htop） | `pi.on("user_bash")`                  |
| `inline-bash.ts`       | `!{command}` 展开    | `pi.on("input")`                      |
| `question.ts`          | 用户交互 UI          | `ctx.ui.select()`                     |
| `questionnaire.ts`     | 多问题 Tab 导航      | `ctx.ui.custom()`                     |
| `timed-confirm.ts`     | 自动消失确认框       | `AbortSignal`                         |
| `send-user-message.ts` | 扩展发送消息         | `pi.sendUserMessage()`                |

---

### 2.9 Custom Providers — 自定义模型提供商

| 目录                          | 提供商     | 说明                            |
| ----------------------------- | ---------- | ------------------------------- |
| `custom-provider-anthropic/`  | Anthropic  | OAuth 支持 + 自定义流处理       |
| `custom-provider-gitlab-duo/` | GitLab Duo | 代理模式，兼容 Anthropic/OpenAI |
| `custom-provider-qwen-cli/`   | 通义千问   | OAuth 设备流 + OpenAI 兼容      |

---

### 2.10 资源动态发现

#### `dynamic-resources/` — 动态加载资源

```typescript
pi.on('resources_discover', () => ({
  skillPaths: [join(baseDir, 'SKILL.md')],
  promptPaths: [join(baseDir, 'dynamic.md')],
  themePaths: [join(baseDir, 'dynamic.json')]
}))
```

---

### 2.11 扩展间通信

#### `event-bus.ts` — EventBus

```typescript
// 监听
pi.events.on('my:notification', (data) => {
  ctx.ui.notify(`Event from ${data.from}: ${data.message}`)
})

// 发送
pi.events.emit('my:notification', { message: 'hello', from: 'extension-a' })
```

---

### 2.12 会话元数据

| 扩展              | 功能                            |
| ----------------- | ------------------------------- |
| `session-name.ts` | 给会话命名（用于会话选择器）    |
| `bookmark.ts`     | 给条目加标签（用于 /tree 导航） |

---

## 三、关键设计模式总结

### 3.1 状态持久化模式

```
状态 → tool result details → getBranch() 重建
```

不用外部文件，状态随会话分支自动正确。

### 3.2 工具覆盖模式

```
pi.registerTool({ name: "read" })  →  覆盖内置 read
```

同名注册即覆盖，可叠加审计、拦截、远程代理等逻辑。

### 3.3 Operations 抽象模式

```typescript
createBashTool(cwd, { operations: customBashOps })
createReadTool(cwd, { operations: customReadOps })
```

工具的 I/O 操作可替换——本地、SSH、沙箱、Docker 等。

### 3.4 两阶段模式（Plan → Execute）

```
只读工具 → 分析 → 输出计划 → 切换 → 完整工具 → 执行 → 进度追踪
```

### 3.5 事件拦截模式

```
pi.on("tool_call") → { block: true, reason } → 工具被阻止
pi.on("before_agent_start") → { systemPrompt } → 修改 system prompt
pi.on("context") → { messages } → 过滤上下文
pi.on("session_before_compact") → { compaction } → 自定义压缩
pi.on("user_bash") → { operations } → 替换 bash 执行
```

---

## 四、对 Coobee-AI 集成的启示

### 4.1 可直接复用的功能

| 功能            | 对应扩展                                      | 优先级                                    |
| --------------- | --------------------------------------------- | ----------------------------------------- |
| **Plan Mode**   | `plan-mode/`                                  | 高 — 先分析后执行是 Coding Agent 核心模式 |
| **权限控制**    | `permission-gate.ts` + `protected-paths.ts`   | 高 — 安全必备                             |
| **自定义压缩**  | `custom-compaction.ts` + `trigger-compact.ts` | 高 — 我们已有 SessionCompressor           |
| **Git 检查点**  | `git-checkpoint.ts`                           | 中 — 代码回滚保障                         |
| **工具开关**    | `tools.ts`                                    | 中 — 动态配置                             |
| **Preset 预设** | `preset.ts`                                   | 中 — 模式快速切换                         |
| **SSH 远程**    | `ssh.ts`                                      | 低 — 后续扩展                             |
| **子 Agent**    | `subagent/`                                   | 低 — 我们先做单 Agent                     |

### 4.2 架构借鉴

1. **Operations 抽象** — 工具执行层可替换（本地/远程/沙箱）
2. **事件拦截** — 工具调用前拦截（安全/审计/限流）
3. **两阶段工作流** — Plan → Execute
4. **状态存储在 session details** — 不依赖外部文件，支持分支
5. **扩展发现** — 多目录自动发现（全局 + 项目级）

### 4.3 ExtensionAPI 对我们的参考

我们可以在 Coobee-AI 中设计类似的扩展系统：

```typescript
interface CodingExtensionAPI {
  // 事件拦截
  on(event: string, handler: EventHandler): void

  // 工具注册
  registerTool(tool: ToolDefinition): void

  // 命令注册
  registerCommand(name: string, handler: CommandHandler): void

  // 工具管理
  setActiveTools(tools: string[]): void

  // 消息发送
  sendMessage(msg: CustomMessage, options?: { triggerTurn: boolean }): void

  // 会话持久化
  appendEntry(type: string, data: any): void
}
```
