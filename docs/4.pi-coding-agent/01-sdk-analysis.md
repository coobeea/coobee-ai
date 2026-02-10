# pi-coding-agent SDK 分析

> 来源：`/Users/lifeng/git/git_agents/pi-mono/packages/coding-agent`
>
> 版本：0.52.9
>
> 定位：专为 Coding Agent 场景设计的 SDK，内置文件读写、Shell 执行、代码编辑等工具。
> 单智能体模式，开箱即用。

---

## 一、核心 API

### 1.1 入口：`createAgentSession()`

```typescript
import { createAgentSession } from '@mariozechner/pi-coding-agent'

const { session } = await createAgentSession({
  // 模型
  model, // Model 对象
  thinkingLevel: 'medium', // "off" | "low" | "medium" | "high"

  // 认证
  authStorage, // AuthStorage 实例
  modelRegistry, // ModelRegistry 实例

  // 工具
  tools: codingTools, // Tool[] — 内置工具集
  customTools: [], // ToolDefinition[] — 自定义工具

  // 资源
  resourceLoader, // ResourceLoader — system prompt / skills / extensions

  // 会话持久化
  sessionManager, // SessionManager — 内存 / 文件
  settingsManager, // SettingsManager — 设置覆盖

  // 工作目录
  cwd: process.cwd(),
  agentDir: '~/.pi/agent'
})
```

**返回值**：

```typescript
{
  session: AgentSession;             // 核心会话对象
  extensionsResult: LoadExtensionsResult;
  modelFallbackMessage?: string;     // 模型回退提示
}
```

### 1.2 AgentSession 主要方法

| 方法        | 签名                                | 说明                           |
| ----------- | ----------------------------------- | ------------------------------ |
| `prompt`    | `(text, options?) => Promise<void>` | 发送消息并等待 Agent 完成      |
| `subscribe` | `(listener) => () => void`          | 订阅事件，返回取消函数         |
| `abort`     | `() => Promise<void>`               | 中止当前操作                   |
| `steer`     | `(text) => Promise<void>`           | 中途打断（当前工具完成后执行） |
| `followUp`  | `(text) => Promise<void>`           | Agent 完成后追加消息           |
| `compact`   | `(instructions?) => Promise<void>`  | 手动压缩                       |
| `dispose`   | `() => void`                        | 销毁                           |

**Getter 属性**：

| 属性            | 说明             |
| --------------- | ---------------- |
| `state`         | 会话完整状态     |
| `model`         | 当前模型         |
| `thinkingLevel` | 思考级别         |
| `isStreaming`   | 是否正在流式输出 |
| `messages`      | 消息历史         |
| `sessionId`     | 会话 ID          |
| `systemPrompt`  | 当前系统提示词   |

---

## 二、事件系统

### 2.1 事件类型总表

```typescript
session.subscribe((event) => {
  switch (event.type) {
    case 'agent_start': // Agent 开始
    case 'agent_end': // Agent 结束（含所有消息）
    case 'turn_start': // 一轮开始
    case 'turn_end': // 一轮结束
    case 'message_start': // 消息开始
    case 'message_update': // 消息增量（流式）
    case 'message_end': // 消息结束
    case 'tool_execution_start': // 工具开始
    case 'tool_execution_update': // 工具进度
    case 'tool_execution_end': // 工具完成
    case 'auto_compaction_start': // 自动压缩开始
    case 'auto_compaction_end': // 自动压缩结束
    case 'auto_retry_start': // 自动重试开始
    case 'auto_retry_end': // 自动重试结束
  }
})
```

### 2.2 每个事件的字段

#### Agent 生命周期

```typescript
{ type: "agent_start" }

{
  type: "agent_end",
  messages: AgentMessage[]       // 本次执行产出的所有消息
}
```

#### Turn（轮）

```typescript
{ type: "turn_start" }

{
  type: "turn_end",
  message: AgentMessage,         // 本轮 LLM 输出的消息
  toolResults: ToolResultMessage[] // 本轮工具执行结果
}
```

#### Message（消息流式）

```typescript
{
  type: "message_start",
  message: AgentMessage
}

{
  type: "message_update",
  message: AgentMessage,
  assistantMessageEvent: AssistantMessageEvent
  // assistantMessageEvent.type 可以是：
  //   "text_delta"     → delta: string（文本增量）
  //   "thinking_delta" → delta: string（思考增量）
  //   "input_json_delta"  → delta: string
  //   "stop"           → 停止
}

{
  type: "message_end",
  message: AgentMessage
}
```

#### Tool（工具执行）

```typescript
{
  type: "tool_execution_start",
  toolCallId: string,
  toolName: string,
  args: any
}

{
  type: "tool_execution_update",
  toolCallId: string,
  toolName: string,
  args: any,
  partialResult: any             // 工具执行进度
}

{
  type: "tool_execution_end",
  toolCallId: string,
  toolName: string,
  result: any,
  isError: boolean
}
```

#### 自动压缩

```typescript
{
  type: "auto_compaction_start",
  reason: "threshold" | "overflow"
}

{
  type: "auto_compaction_end",
  result: CompactionResult | undefined,
  aborted: boolean,
  willRetry: boolean,
  errorMessage?: string
}
```

#### 自动重试

```typescript
{
  type: "auto_retry_start",
  attempt: number,
  maxAttempts: number,
  delayMs: number,
  errorMessage: string
}

{
  type: "auto_retry_end",
  success: boolean,
  attempt: number,
  finalError?: string
}
```

### 2.3 事件流时序（单工具调用）

```
agent_start
  turn_start
    message_start                     ← LLM 开始输出
    message_update (text_delta) × N   ← 文本流式
    message_update (stop)             ← LLM 停止
    message_end                       ← 消息完成
    tool_execution_start              ← 工具开始（如 bash）
    tool_execution_update × N         ← 工具进度（如 bash 输出）
    tool_execution_end                ← 工具完成
  turn_end                            ← 一轮结束（含 toolResults）
  turn_start                          ← 新一轮（LLM 基于工具结果回答）
    message_start
    message_update (text_delta) × N
    message_update (stop)
    message_end
  turn_end
agent_end
```

### 2.4 事件流时序（纯文本）

```
agent_start
  turn_start
    message_start
    message_update (thinking_delta) × N  ← 思考（如果 thinkingLevel != off）
    message_update (text_delta) × N      ← 回答
    message_update (stop)
    message_end
  turn_end
agent_end
```

---

## 三、System Prompt 与资源配置

### 3.1 自定义 System Prompt（03-custom-prompt）

通过 `DefaultResourceLoader` 的 `systemPromptOverride` 和 `appendSystemPromptOverride` 控制：

```typescript
import { DefaultResourceLoader } from '@mariozechner/pi-coding-agent'

// 方式 1：完全替换 system prompt
const loader1 = new DefaultResourceLoader({
  systemPromptOverride: () => `You are a helpful assistant.`,
  appendSystemPromptOverride: () => [] // 清除追加内容
})
await loader1.reload()

// 方式 2：在默认 prompt 后追加指令
const loader2 = new DefaultResourceLoader({
  appendSystemPromptOverride: (base) => [
    ...base,
    '## Additional Instructions\n- Always be concise\n- Use bullet points'
  ]
})
await loader2.reload()

const { session } = await createAgentSession({
  resourceLoader: loader2,
  sessionManager: SessionManager.inMemory()
})
```

**关键点**：`systemPromptOverride` 是替换，`appendSystemPromptOverride` 是追加。两者可组合使用。

### 3.2 Skills 管理（04-skills）

Skills 是注入到 system prompt 中的专用指令，自动从 `cwd/.pi/skills/` 和 `~/.pi/agent/skills/` 目录发现：

```typescript
import { type Skill } from '@mariozechner/pi-coding-agent'

// 自定义 skill
const customSkill: Skill = {
  name: 'my-skill',
  description: 'Custom project instructions',
  filePath: '/virtual/SKILL.md',
  baseDir: '/virtual',
  source: 'path',
  disableModelInvocation: false
}

const loader = new DefaultResourceLoader({
  skillsOverride: (current) => ({
    // 过滤 + 追加
    skills: [...current.skills.filter((s) => s.name.includes('browser')), customSkill],
    diagnostics: current.diagnostics
  })
})
await loader.reload()

// 查看发现的 skills
const { skills, diagnostics } = loader.getSkills()
```

### 3.3 Context Files / AGENTS.md（07-context-files）

项目上下文文件，类似 Cursor 的 AGENTS.md，自动从 cwd 向上遍历发现：

```typescript
const loader = new DefaultResourceLoader({
  agentsFilesOverride: (current) => ({
    agentsFiles: [
      ...current.agentsFiles,
      {
        path: '/virtual/AGENTS.md',
        content: `# Project Guidelines\n## Code Style\n- Use TypeScript strict mode`
      }
    ]
  })
})
await loader.reload()

// 查看发现的上下文文件
const discovered = loader.getAgentsFiles().agentsFiles
```

### 3.4 Prompt Templates（08-prompt-templates）

文件模板，通过 `/templatename` 触发注入：

```typescript
import { type PromptTemplate } from '@mariozechner/pi-coding-agent'

const deployTemplate: PromptTemplate = {
  name: 'deploy',
  description: 'Deploy the application',
  source: 'path',
  filePath: '/virtual/prompts/deploy.md',
  content: `# Deploy Instructions\n1. Build\n2. Test\n3. Deploy`
}

const loader = new DefaultResourceLoader({
  promptsOverride: (current) => ({
    prompts: [...current.prompts, deployTemplate],
    diagnostics: current.diagnostics
  })
})
await loader.reload()
```

**模板发现路径**：`cwd/.pi/prompts/` 和 `~/.pi/agent/prompts/`

### 3.5 API Keys 与 OAuth（09-api-keys-and-oauth）

```typescript
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent'

// 默认路径：~/.pi/agent/auth.json
const authStorage = new AuthStorage()
const modelRegistry = new ModelRegistry(authStorage)

// 自定义路径
const customAuth = new AuthStorage('/tmp/my-app/auth.json')
const customRegistry = new ModelRegistry(customAuth, '/tmp/my-app/models.json')

// 运行时 API Key（不持久化到磁盘）
authStorage.setRuntimeApiKey('anthropic', 'sk-my-temp-key')

// 无 models.json，只用内置模型
const simpleRegistry = new ModelRegistry(authStorage)
```

**支持的 Provider**：`anthropic`、`openai` 等，通过 `@mariozechner/pi-ai` 的 `getModel()` 选择具体模型。

### 3.6 Settings 覆盖（10-settings）

```typescript
import { SettingsManager } from '@mariozechner/pi-coding-agent'

// 从磁盘加载（global + project 合并）
const settings = SettingsManager.create()

// 覆盖设置
settings.applyOverrides({
  compaction: { enabled: false },
  retry: { enabled: true, maxRetries: 5, baseDelayMs: 1000 }
})

// 内存模式（测试用）
const inMemorySettings = SettingsManager.inMemory({
  compaction: { enabled: false },
  retry: { enabled: false }
})
```

**可配置项**：`compaction`（压缩）、`retry`（重试）、`terminal`（终端）等。

---

## 四、工具系统

### 4.1 内置工具

| 工具    | 工厂函数               | 说明                       |
| ------- | ---------------------- | -------------------------- |
| `read`  | `createReadTool(cwd)`  | 读取文件                   |
| `bash`  | `createBashTool(cwd)`  | 执行 Shell 命令            |
| `edit`  | `createEditTool(cwd)`  | 编辑文件（search/replace） |
| `write` | `createWriteTool(cwd)` | 写入文件                   |
| `grep`  | `createGrepTool(cwd)`  | 搜索文件内容               |
| `find`  | `createFindTool(cwd)`  | 查找文件                   |
| `ls`    | `createLsTool(cwd)`    | 列出目录                   |

### 4.2 工具集预设

```typescript
codingTools = [read, bash, edit, write] // 默认
readOnlyTools = [read, grep, find, ls] // 只读
allTools = { read, bash, edit, write, grep, find, ls }
```

### 4.3 自定义工具

```typescript
import { Type } from '@sinclair/typebox'

const myTool: ToolDefinition = {
  name: 'my_tool',
  label: 'My Tool',
  description: 'Does something useful',
  parameters: Type.Object({
    input: Type.String()
  }),
  execute: async (toolCallId, params, signal, onUpdate, ctx) => ({
    content: [{ type: 'text', text: `Result: ${params.input}` }],
    details: {}
  })
}

const { session } = await createAgentSession({
  customTools: [{ tool: myTool }]
})
```

---

## 五、会话管理

### 5.1 SessionManager 模式

| 模式 | 构造                                 | 说明               |
| ---- | ------------------------------------ | ------------------ |
| 内存 | `SessionManager.inMemory()`          | 不持久化，适合测试 |
| 新建 | `SessionManager.create(cwd)`         | 创建新会话文件     |
| 续接 | `SessionManager.continueRecent(cwd)` | 继续最近会话       |
| 打开 | `SessionManager.open(path)`          | 打开指定会话       |
| 列表 | `SessionManager.list(cwd)`           | 列出目录下所有会话 |

### 5.2 会话功能

- **树形结构**：支持分支（branch）、导航（navigateTree）
- **压缩**：自动/手动压缩（compaction），阈值触发或 overflow 触发
- **导出**：`exportToHtml()` 导出为 HTML
- **分叉**：`fork(entryId)` 从某个节点分叉

---

## 六、Extensions 扩展系统（06-extensions）

> **详细分析见 [02-extensions-analysis.md](./02-extensions-analysis.md)**（60+ 扩展逐个分析）

Extensions 是拦截 Agent 事件并注册自定义工具/命令的插件系统，共 **60+** 个示例扩展，涵盖 11 个分类。

### 加载方式

```typescript
const resourceLoader = new DefaultResourceLoader({
  additionalExtensionPaths: ['./my-extension.ts'],
  extensionFactories: [(pi) => { pi.on('agent_start', () => { ... }); }],
});
await resourceLoader.reload();
```

### ExtensionAPI 核心能力

```typescript
export default function (pi: ExtensionAPI) {
  pi.on("tool_call", handler);        // 事件拦截（可阻止）
  pi.registerTool({ ... });            // 注册工具
  pi.registerCommand("name", handler); // 注册命令
  pi.registerShortcut(Key, handler);   // 注册快捷键
  pi.registerFlag("name", config);     // CLI 标志
  pi.setActiveTools(["read", "bash"]); // 动态工具管理
  pi.setModel(model);                  // 切换模型
  pi.sendMessage(msg, options);        // 发送消息
  pi.appendEntry("type", data);        // 会话条目持久化
  pi.exec("git", ["status"]);          // Shell 执行
  pi.events.emit("channel", data);     // 扩展间通信
}
```

### 重要扩展分类速查

| 分类                | 代表扩展                                      | 说明                                     |
| ------------------- | --------------------------------------------- | ---------------------------------------- |
| **Plan Mode**       | `plan-mode/`                                  | 两阶段：只读分析 → 完整执行 + 进度追踪   |
| **Subagent**        | `subagent/`                                   | 子 Agent 委派（单/并行/链式），独立进程  |
| **Sandbox**         | `sandbox/`                                    | OS 级沙箱（文件系统 + 网络限制）         |
| **安全**            | `permission-gate.ts`, `protected-paths.ts`    | 危险命令确认、路径保护                   |
| **Preset**          | `preset.ts`                                   | 命名预设（model + tools + instructions） |
| **自定义压缩**      | `custom-compaction.ts`                        | 用 Gemini Flash 全文摘要替换默认压缩     |
| **Git**             | `git-checkpoint.ts`, `auto-commit-on-exit.ts` | 每轮 stash + fork 恢复                   |
| **SSH 远程**        | `ssh.ts`                                      | 所有工具代理到远程机器                   |
| **工具覆盖**        | `tool-override.ts`                            | 同名注册覆盖内置工具（审计/拦截）        |
| **Custom Provider** | `custom-provider-*/`                          | 自定义模型提供商                         |
| **动态资源**        | `dynamic-resources/`                          | 运行时加载 skills/prompts/themes         |

**扩展发现路径**：`~/.pi/agent/extensions/`、`<cwd>/.pi/extensions/`、settings.json 中的 `extensions` 数组。

---

## 七、Full Control 模式（12-full-control）

完全自定义，不依赖任何自动发现：

```typescript
import { getModel } from '@mariozechner/pi-ai'

const customAuth = new AuthStorage('/tmp/my-agent/auth.json')
if (process.env.MY_ANTHROPIC_KEY) {
  customAuth.setRuntimeApiKey('anthropic', process.env.MY_ANTHROPIC_KEY)
}

const model = getModel('anthropic', 'claude-sonnet-4-20250514')

// 完全自定义 ResourceLoader（不发现任何文件）
const resourceLoader: ResourceLoader = {
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => `You are a minimal assistant. Available: read, bash.`,
  getAppendSystemPrompt: () => [],
  getPathMetadata: () => new Map(),
  extendResources: () => {},
  reload: async () => {}
}

const { session } = await createAgentSession({
  cwd: process.cwd(),
  agentDir: '/tmp/my-agent',
  model,
  thinkingLevel: 'off',
  authStorage: customAuth,
  modelRegistry: new ModelRegistry(customAuth),
  resourceLoader,
  tools: [createReadTool(cwd), createBashTool(cwd)], // 工厂函数绑定 cwd
  sessionManager: SessionManager.inMemory(),
  settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } })
})
```

**关键点**：使用自定义 `cwd` 时必须使用工具工厂函数（`createReadTool(cwd)` 等），否则工具的路径解析会基于 `process.cwd()` 而非你指定的 `cwd`。

---

## 八、与 OpenAI Agents SDK 对比

| 方面              | pi-coding-agent                   | OpenAI Agents SDK                       |
| ----------------- | --------------------------------- | --------------------------------------- |
| **定位**          | Coding Agent 专用                 | 通用 Agent 框架                         |
| **工具**          | 内置 7 个代码工具                 | 需自行定义                              |
| **事件**          | `agent/turn/message/tool` 四层    | `raw_model/run_item/agent_updated` 三层 |
| **文本流**        | `message_update.text_delta`       | `output_text_delta.delta`               |
| **思考流**        | `message_update.thinking_delta`   | `<think>` 标签混在 text 中              |
| **工具调用**      | `tool_execution_start/update/end` | `tool_called` + `tool_output`           |
| **Turn 管理**     | 明确的 `turn_start/turn_end`      | `response_started/response_done`        |
| **会话持久化**    | SessionManager（树形 JSONL）      | 自行实现 FileSession                    |
| **压缩**          | 内置自动压缩                      | 自行实现 SessionCompressor              |
| **重试**          | 内置自动重试                      | 无                                      |
| **多智能体**      | 不需要（单 Agent 即可）           | Agent + Handoff                         |
| **System Prompt** | DefaultResourceLoader             | Agent.instructions                      |
| **参数校验**      | TypeBox                           | Zod                                     |

---

## 九、集成方案设计

### 9.1 我们需要做的

作为 Coding Agent，我们使用 **单智能体模式**：

```typescript
// 1. 创建 session
const { session } = await createAgentSession({
  model,
  thinkingLevel: 'medium',
  authStorage,
  modelRegistry,
  tools: codingTools, // read, bash, edit, write
  sessionManager: SessionManager.inMemory() // 或持久化
})

// 2. 订阅事件
session.subscribe((event) => {
  // 转换为我们的 StreamChunk 事件格式
})

// 3. 执行
await session.prompt('实现一个 XXX 功能')
```

### 9.2 事件映射

pi-coding-agent 事件到我们 StreamChunk 的映射：

| pi 事件                           | 我们的事件               | 说明                       |
| --------------------------------- | ------------------------ | -------------------------- |
| `agent_start`                     | `run:start`              | Agent 开始                 |
| `agent_end`                       | `run:done`               | Agent 结束                 |
| `turn_start`                      | `turn:start`             | 一轮开始                   |
| `turn_end`                        | `turn:done`              | 一轮结束                   |
| `message_start`                   | `llm:start`              | LLM 开始                   |
| `message_update (text_delta)`     | `text:delta`             | 文本增量                   |
| `message_update (thinking_delta)` | `reasoning:delta`        | 思考增量                   |
| `message_update (stop)`           | `text:done` + `llm:done` | LLM 完成                   |
| `message_end`                     | —                        | 可忽略（信息已在 stop 中） |
| `tool_execution_start`            | `tool:start`             | 工具开始                   |
| `tool_execution_update`           | `tool:delta`             | 工具进度                   |
| `tool_execution_end`              | `tool:done`              | 工具完成                   |
| `auto_compaction_start`           | `compression:start`      | 压缩开始                   |
| `auto_compaction_end`             | `compression:done`       | 压缩完成                   |

### 9.3 优势

1. **turn_start / turn_end 明确**：不需要像 OpenAI SDK 那样用 `response_started` 推断
2. **thinking_delta 独立**：不需要解析 `<think>` 标签
3. **tool 三阶段**：`start → update → end`，比 OpenAI 的 `called → output` 多了进度
4. **内置压缩和重试**：不需要自己实现
5. **内置代码工具**：read / bash / edit / write / grep / find / ls 开箱即用

### 9.4 需要适配的点

1. **认证**：需要用 `AuthStorage` 管理 API Key（支持多 provider）
2. **模型注册**：需要用 `ModelRegistry` 注册可用模型
3. **ResourceLoader**：可以自定义 system prompt、skills、extensions
4. **参数校验**：使用 TypeBox 而非 Zod（自定义工具时注意）
5. **事件格式转换**：pi 事件结构与我们的 StreamChunk 不同，需要适配层

---

## 十、SDK 12 个示例文件速查

| 序号 | 文件                       | 核心功能                    | 关键 API                                                       |
| ---- | -------------------------- | --------------------------- | -------------------------------------------------------------- |
| 01   | `01-minimal.ts`            | 最小用法，全部默认          | `createAgentSession()` → `session.prompt()`                    |
| 02   | `02-custom-model.ts`       | 模型选择、思考级别          | `getModel()`, `modelRegistry.getAvailable()`, `thinkingLevel`  |
| 03   | `03-custom-prompt.ts`      | 替换/追加 system prompt     | `systemPromptOverride`, `appendSystemPromptOverride`           |
| 04   | `04-skills.ts`             | Skills 发现、过滤、自定义   | `skillsOverride`, `Skill` 类型, `loader.getSkills()`           |
| 05   | `05-tools.ts`              | 工具集选择、工厂函数        | `codingTools`, `readOnlyTools`, `createCodingTools(cwd)`       |
| 06   | `06-extensions.ts`         | 事件拦截、自定义工具注册    | `extensionFactories`, `pi.on()`, `pi.registerTool()`           |
| 07   | `07-context-files.ts`      | AGENTS.md 上下文文件        | `agentsFilesOverride`, `loader.getAgentsFiles()`               |
| 08   | `08-prompt-templates.ts`   | Prompt 模板（`/name` 触发） | `promptsOverride`, `PromptTemplate` 类型                       |
| 09   | `09-api-keys-and-oauth.ts` | API Key 管理                | `AuthStorage`, `ModelRegistry`, `setRuntimeApiKey()`           |
| 10   | `10-settings.ts`           | 设置覆盖（压缩、重试等）    | `SettingsManager.create()`, `.applyOverrides()`, `.inMemory()` |
| 11   | `11-sessions.ts`           | 会话持久化、续接、列表      | `SessionManager.inMemory/create/continueRecent/open/list`      |
| 12   | `12-full-control.ts`       | 完全自定义，无自动发现      | 自定义 `ResourceLoader`, 工具工厂, `cwd` 绑定                  |

---

## 十一、最小可用示例

```typescript
import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent'
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent'

// 认证
const authStorage = new AuthStorage()
authStorage.setRuntimeApiKey('anthropic', process.env.ANTHROPIC_API_KEY!)
const modelRegistry = new ModelRegistry(authStorage)

// 创建会话
const { session } = await createAgentSession({
  authStorage,
  modelRegistry,
  thinkingLevel: 'medium',
  sessionManager: SessionManager.inMemory()
})

// 事件监听
session.subscribe((event) => {
  switch (event.type) {
    case 'agent_start':
      console.log('🚀 开始')
      break
    case 'message_update':
      if (event.assistantMessageEvent.type === 'text_delta') {
        process.stdout.write(event.assistantMessageEvent.delta)
      }
      if (event.assistantMessageEvent.type === 'thinking_delta') {
        // 思考内容（可选展示）
      }
      break
    case 'tool_execution_start':
      console.log(`\n🔧 ${event.toolName}(${JSON.stringify(event.args)})`)
      break
    case 'tool_execution_end':
      console.log(`✅ ${event.toolName} → ${event.isError ? '失败' : '成功'}`)
      break
    case 'agent_end':
      console.log('\n✨ 完成')
      break
  }
})

// 执行
await session.prompt('读取 package.json 并告诉我项目名称')
```
