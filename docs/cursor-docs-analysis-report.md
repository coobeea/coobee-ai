# Cursor 文档分析报告

> 基于 https://cursor.com/docs 及 https://docs.cursor.com 的文档整理

## 1. 文档结构概览

### 主要章节

| 章节              | 子章节                                                                               | 说明             |
| ----------------- | ------------------------------------------------------------------------------------ | ---------------- |
| **Get Started**   | quickstart, concepts, models, pricing                                                | 入门与基础概念   |
| **Agent**         | overview, modes, review, terminal, browser, security, hooks, third-party-hooks       | 智能体核心能力   |
| **Context**       | rules, commands, skills, subagents, semantic-search, mentions, mcp, ignore-files     | 上下文与规则系统 |
| **Features**      | tab, cloud-agent, cli, inline-edit, bugbot, shared-transcripts                       | 功能特性         |
| **Integrations**  | slack, linear, github, git, gitlab, deeplinks                                        | 外部集成         |
| **Configuration** | extensions, kbd, themes, shell, worktrees, languages                                 | 配置             |
| **Account**       | billing, teams, enterprise                                                           | 账户与团队       |
| **Cookbook**      | agent-workflows, building-mcp-server, web-development, data-science, large-codebases | 实践指南         |

### 规则与智能体相关核心页面

- `docs/context/rules.md` - 规则系统
- `docs/context/commands.md` - 自定义命令
- `docs/context/skills.md` - Agent Skills
- `docs/context/subagents.md` - 子代理
- `docs/agent/overview.md` - Agent 概览
- `docs/agent/modes.md` - Agent 模式
- `docs/agent/hooks.md` - 钩子系统
- `docs/cloud-agent.md` - 云智能体
- `docs/cookbook/agent-workflows.md` - Agent 工作流

---

## 2. 规则系统 (Rules) 深度分析

### 2.1 规则的定义和语法

**核心机制**：LLM 在每次 completion 之间不保留记忆，规则在 prompt 层面提供持久、可复用的上下文。

**文件格式**：

- 支持 `.md` 和 `.mdc` 扩展名
- `.mdc` 支持 YAML frontmatter 控制激活方式
- 内容为 Markdown，可引用文件（如 `@filename.ts`）

**Frontmatter 字段**：

```yaml
---
description: '规则描述，用于智能匹配'
alwaysApply: false # true 时每次会话都应用
globs: ['**/*.py'] # 文件匹配模式，可选
---
```

### 2.2 规则的作用域

| 类型              | 存储位置                | 作用域      | 版本控制 |
| ----------------- | ----------------------- | ----------- | -------- |
| **Project Rules** | `.cursor/rules/`        | 当前项目    | ✅       |
| **User Rules**    | Cursor Settings → Rules | 全局        | ❌       |
| **Team Rules**    | Dashboard               | 团队/组织   | 云端管理 |
| **AGENTS.md**     | 项目根或子目录          | 项目/子目录 | ✅       |

**AGENTS.md 嵌套**：支持在子目录放置 `AGENTS.md`，子目录指令与父级合并，更具体的优先。

### 2.3 规则的激活类型

| 类型                        | 对应配置                             | 触发条件                           |
| --------------------------- | ------------------------------------ | ---------------------------------- |
| **Always Apply**            | `alwaysApply: true`                  | 每次会话都应用                     |
| **Apply Intelligently**     | `alwaysApply: false` + `description` | Agent 根据描述判断是否相关         |
| **Apply to Specific Files** | `globs` 模式                         | 上下文包含匹配文件时应用           |
| **Apply Manually**          | 无 globs/alwaysApply                 | 通过 `@rule-name` 在聊天中手动引用 |

### 2.4 规则的优先级和继承

**优先级（高→低）**：

1. Team Rules（最高）
2. Project Rules
3. User Rules
4. Legacy `.cursorrules`
5. AGENTS.md（最低）

冲突时：按上述顺序合并，先出现的优先。

**Team Rules 特殊行为**：

- 支持 `Enforce this rule`：强制启用，用户无法关闭
- 支持 glob 模式做文件级作用域
- 内容为自由文本，无目录结构

### 2.5 规则的最佳实践

**推荐**：

- 引用文件而非复制内容，保持规则简短
- 规则聚焦、可执行、有明确作用域
- 单条规则控制在 500 行以内
- 将规则纳入版本控制
- 从简单开始，只在重复犯错时再增加规则

**避免**：

- 复制代码库中已有的内容
- 为罕见场景写冗长说明
- 罗列常见命令（Agent 已了解）
- 复制整本风格指南（用 linter 代替）

### 2.6 规则导入

- **Remote Rules**：从 GitHub 仓库导入，自动同步更新
- **Agent Skills**：从 skills 生态导入，始终作为「Agent 决定」类规则，不可配置为 always-apply 或 manual

---

## 3. 智能体系统 (Agent) 深度分析

### 3.1 智能体的概念和类型

**Agent 三要素**：

1. **User messages**：用户提示与追问
2. **Tools**：文件编辑、代码库搜索、终端执行等
3. **Instructions**：系统提示 + 规则

**工具集**：

- 语义搜索、文件/文件夹搜索
- Web 搜索
- 读取规则（Fetch Rules）
- 读写文件（含图片）
- 编辑文件
- 执行 Shell 命令
- 浏览器控制
- 图像生成
- 向用户提问（ask questions）

**无工具调用次数限制**。

### 3.2 Agent 模式 (Modes)

| 模式      | 适用场景                 | 能力                       | 工具              |
| --------- | ------------------------ | -------------------------- | ----------------- |
| **Agent** | 复杂功能、重构           | 自主探索、多文件编辑       | 全部              |
| **Ask**   | 学习、规划、提问         | 只读探索                   | 仅搜索类          |
| **Plan**  | 需先规划再实现的复杂功能 | 先制定计划再执行           | 全部              |
| **Debug** | 难复现的 bug             | 假设生成、日志、运行时分析 | 全部 + 调试服务器 |

**Plan 模式流程**：澄清需求 → 研究代码库 → 生成计划 → 用户审阅/编辑 → 点击执行。

**Debug 模式流程**：探索与假设 → 添加日志 → 用户复现 → 分析日志 → 针对性修复 → 验证并清理。

### 3.3 智能体如何被触发和调用

**本地 Agent**：

- 侧边栏 Cmd+I 打开
- 用户输入消息触发
- 支持消息队列：Enter 排队，Cmd+Enter 立即发送

**Cloud Agent 触发方式**：

1. Cursor Web：cursor.com/agents
2. Cursor Desktop：Agent 输入框选择 Cloud
3. Slack：@cursor
4. GitHub：PR/Issue 评论 `@cursor`
5. Linear：@cursor
6. API 调用

**子代理 (Subagents) 触发**：

- **自动委托**：主 Agent 根据任务复杂度、描述、上下文决定
- **显式调用**：`/verifier confirm...` 或自然语言「Use the verifier subagent...」

### 3.4 子代理 (Subagents) 机制

**特点**：

- 独立上下文窗口
- 可并行执行
- 可配置专用 prompt、工具、模型
- 支持前台（阻塞等待）和后台（立即返回）模式

**内置子代理**：

- **Explore**：代码库搜索与分析
- **Bash**：执行 Shell 命令序列
- **Browser**：浏览器控制（MCP）

**自定义子代理**：

- 项目级：`.cursor/agents/`、`.claude/agents/`、`.codex/agents/`
- 用户级：`~/.cursor/agents/` 等
- 格式：Markdown + YAML frontmatter（name, description, model, readonly, background）

### 3.5 Agent Skills

**定义**：可移植、版本可控的能力包，教 Agent 完成领域任务。

**目录**：

- 项目：`.agents/skills/`、`.cursor/skills/`
- 用户：`~/.cursor/skills/`
- 兼容：`.claude/skills/`、`.codex/skills/`

**结构**：

```
skill-name/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

**SKILL.md frontmatter**：`name`、`description`、`disable-model-invocation`（仅手动调用时加载）等。

### 3.6 与用户的交互模式

- **消息队列**：任务进行中可继续输入，按序执行
- **Checkpoints**：自动快照，支持撤销
- **Ask questions**：Agent 可提问，等待回答时继续读文件、编辑、运行命令
- **导出与分享**：导出 Markdown、只读链接、Fork 对话

---

## 4. 自动化任务执行机制

### 4.1 Hooks 系统

**作用**：在 Agent 循环的特定阶段插入自定义脚本，观察、拦截或修改行为。

**通信**：stdio + JSON 双向通信。

**主要 Hook 事件**：

| 事件                                           | 阶段         | 用途                           |
| ---------------------------------------------- | ------------ | ------------------------------ |
| `sessionStart` / `sessionEnd`                  | 会话生命周期 | 注入上下文、审计               |
| `beforeSubmitPrompt`                           | 提交前       | 校验 prompt                    |
| `beforeReadFile` / `afterFileEdit`             | 文件操作     | 控制访问、格式化               |
| `beforeShellExecution` / `afterShellExecution` | Shell        | 审计、拦截危险命令             |
| `beforeMCPExecution` / `afterMCPExecution`     | MCP          | 控制 MCP 工具                  |
| `subagentStart` / `subagentStop`               | 子代理       | 控制 Task 工具                 |
| `stop`                                         | Agent 完成   | 实现循环（如「直到测试通过」） |
| `preCompact`                                   | 上下文压缩前 | 观察压缩行为                   |

**Hook 类型**：

- **Command-based**：Shell 脚本，stdin 收 JSON，stdout 返 JSON，exit 2 表示拒绝
- **Prompt-based**：用 LLM 评估自然语言策略，返回 `{ ok, reason }`

**配置位置**：`.cursor/hooks.json`（项目）或 `~/.cursor/hooks.json`（用户）

### 4.2 长运行循环（stop hook）

通过 `stop` hook 实现「运行直到达成目标」：

```json
{
  "hooks": {
    "stop": [{ "command": "bun run .cursor/hooks/grind.ts" }]
  }
}
```

脚本根据 `status`、`loop_count` 等决定是否返回 `followup_message` 继续下一轮。

### 4.3 Commands（自定义命令）

**存储**：

- Team：Dashboard
- 全局：`~/.cursor/commands`
- 项目：`.cursor/commands`

**触发**：在输入框输入 `/` 后选择命令。

**格式**：纯 Markdown，描述步骤和检查项。

### 4.4 Cloud Agent 自动化

- **运行环境**：独立 VM，不依赖本地网络
- **能力**：构建、测试、桌面/浏览器控制
- **CI 修复**：可自动尝试修复 PR 的 CI 失败（仅 GitHub Actions）
- **触发**：Web、Desktop、Slack、GitHub、Linear、API

### 4.5 CLI 与 CI/CD

**Headless 模式**：

- `agent -p`（print 模式）用于脚本
- `--force` 允许直接修改文件
- `--output-format json|stream-json|text` 控制输出

**GitHub Actions**：

- 安装 Cursor CLI，设置 `CURSOR_API_KEY`
- 支持完全自主或受限自主（通过 permission 配置）
- 可限制允许的 Shell 命令、读写路径等

### 4.6 推送 vs 拉取

- **拉取**：用户主动发起（Chat、CLI、Web、Slack、GitHub 评论）
- **推送**：无文档明确描述服务端主动推送；Cloud Agent 通过外部触发（如 PR 评论）启动
- **轮询**：未提及
- **事件驱动**：GitHub PR 评论、Slack 消息等作为触发事件

---

## 5. 对 coobee-ai 项目的启发

### 5.1 规则系统

| Cursor 设计                   | coobee-ai 可借鉴                                    |
| ----------------------------- | --------------------------------------------------- |
| 多级规则（Team/Project/User） | 可区分系统级、Agent 级、Skill 级规则                |
| `globs` 文件匹配              | 为规则增加 `globs` 或路径模式，实现文件级作用域     |
| `description` 智能匹配        | 用 description 驱动「按需加载」规则，减少上下文占用 |
| AGENTS.md 嵌套                | 支持子目录 `AGENTS.md`，实现分层指令                |
| 规则引用文件 `@file`          | 规则中引用模板、示例文件，避免复制大段代码          |

### 5.2 智能体与子代理

| Cursor 设计                      | coobee-ai 可借鉴                                              |
| -------------------------------- | ------------------------------------------------------------- |
| 子代理独立上下文                 | 复杂任务拆给专用子 Agent，避免主会话膨胀                      |
| 前台/后台模式                    | 支持阻塞式与异步子任务                                        |
| 内置 Explore/Bash/Browser 子代理 | 为高频、高 token 操作提供专用子 Agent                         |
| Skills 与 Subagents 分工         | Skills 做单次、轻量任务；Subagents 做多步、需隔离上下文的任务 |

### 5.3 自动化与 Hooks

| Cursor 设计             | coobee-ai 可借鉴                                                   |
| ----------------------- | ------------------------------------------------------------------ |
| 生命周期 Hooks          | 在 `sessionStart`、`beforeToolUse`、`afterFileEdit` 等阶段插入逻辑 |
| stop hook 循环          | 实现「运行直到测试通过」等目标驱动循环                             |
| Command + Prompt 双类型 | 简单策略用脚本，复杂策略用 LLM 评估                                |
| 权限控制（exit 2 拒绝） | 在敏感操作前做策略校验，支持显式拒绝                               |

### 5.4 命令与 Skills

| Cursor 设计                | coobee-ai 可借鉴                                  |
| -------------------------- | ------------------------------------------------- |
| `/` 命令触发               | 为常用工作流提供快捷命令入口                      |
| Skills 目录结构            | 统一 `SKILL.md` + `scripts/` + `references/` 结构 |
| `disable-model-invocation` | 支持「仅手动调用」的 Skill，减少误触发            |
| 从 GitHub 导入             | 支持从远程仓库同步 Rules/Skills                   |

### 5.5 实现思路摘要

1. **规则引擎**：支持 frontmatter（description、globs、alwaysApply），按会话/文件/手动三种激活方式加载。
2. **子 Agent 调度**：主 Agent 根据任务类型和描述选择子 Agent，支持并行与串行。
3. **Hook 框架**：定义统一 JSON 协议，在关键生命周期节点调用外部脚本或 LLM。
4. **命令系统**：`.cursor/commands` 或等价目录，Markdown 定义步骤，`/` 触发。
5. **CLI 无头模式**：提供 `--print`、`--force` 等参数，便于 CI 和脚本集成。

---

## 附录：文档链接索引

| 主题           | URL                                                 |
| -------------- | --------------------------------------------------- |
| 规则           | https://cursor.com/docs/context/rules.md            |
| 命令           | https://cursor.com/docs/context/commands.md         |
| Skills         | https://cursor.com/docs/context/skills.md           |
| 子代理         | https://cursor.com/docs/context/subagents.md        |
| Agent 概览     | https://cursor.com/docs/agent/overview.md           |
| Agent 模式     | https://cursor.com/docs/agent/modes.md              |
| Hooks          | https://cursor.com/docs/agent/hooks.md              |
| Cloud Agent    | https://cursor.com/docs/cloud-agent.md              |
| Agent 工作流   | https://cursor.com/docs/cookbook/agent-workflows.md |
| CLI Headless   | https://cursor.com/docs/cli/headless.md             |
| GitHub Actions | https://cursor.com/docs/cli/github-actions.md       |
| 文档站点图     | https://cursor.com/llms.txt                         |
