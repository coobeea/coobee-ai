# coobee-ai AI 模块 — 全面架构分析（第二轮）

> 生成时间：2026-02-15  
> 目的：深入分析 AI 模块每个子系统的设计、当前状态和改进空间  
> 重点关注：Runtime 运行逻辑、插件机制、Skill 系统、Memory 系统、LLM 自我感知能力  
> 对标参考：OpenClaw 架构分析文档（15 篇）

---

## 一、全局架构回顾

### 1.1 核心执行链路

```
用户消息
  ↓
Gateway (IPC) → AgentExecutor.submit() / stream()
  ↓
  ├── busy 锁（同一 session 串行）
  ├── injectEnv() — 工作空间、Skill、执行协议、路径注入
  ├── Extension Hook: message_received → session_start → before_agent_start
  ├── Builder.build() → AgentRuntime 实例
  ├── runtime.stream() — AsyncGenerator<StreamChunk, ExecutionResult>
  │     ├── yield → StreamEmitter → EventBus → WebSocket → 前端
  │     └── append → events.jsonl
  ├── HITL 循环（while interrupted）
  │     ├── computePolicyDecisions() — ExecPolicy 自动决策
  │     ├── HitlApprovalManager.waitForDecisions() — Promise 阻塞
  │     ├── 用户通过前端 API 提交决策
  │     ├── runtime.approveToolCall() / rejectToolCall()
  │     ├── learnExecCommand()（approve-always 学习）
  │     └── runtime.resumeStream()
  ├── Extension Hook: agent_end → session_end
  └── runtime.destroy()
```

### 1.2 模块依赖层次

```
┌─────────────────────────────────────────────────┐
│                  AgentExecutor                    │ ← 入口编排
│  (busy锁、HITL循环、Extension Hook、Builder工厂)   │
├─────────────────────────────────────────────────┤
│        AgentEnvInjector                          │ ← 环境准备
│  (workspace、Skill扫描、执行协议注入)              │
├─────────────────────────────────────────────────┤
│        AgentRuntime (interface)                   │ ← 运行时抽象
│  ┌──────────────┐  ┌──────────────┐              │
│  │ OpenAI SDK   │  │ PiMono SDK   │              │
│  │ (有 HITL)    │  │ (无 HITL)    │              │
│  └──────────────┘  └──────────────┘              │
├─────────────────────────────────────────────────┤
│        ToolDefinition[]                          │ ← 工具层
│  (SDK 无关，统一接口，AsyncGenerator)             │
├─────────────────────────────────────────────────┤
│  sandbox/ │ hitl/ │ streaming/ │ skills/ │ memory/│← 基础设施
└─────────────────────────────────────────────────┘
```

---

## 二、Agent Runtime — 长时间运行逻辑

### 2.1 接口设计

```typescript
interface AgentRuntime {
  // 身份
  type: 'agent' | 'team' | 'swarm';
  id: string;
  name: string;
  interrupted: boolean;
  supportsHITL: boolean;

  // 生命周期
  initialize(): Promise<void>;
  destroy(): Promise<void>;

  // 执行（核心）
  stream(input: string, config?): AsyncGenerator<StreamChunk, ExecutionResult>;
  run(input: string, config?): Promise<ExecutionResult>;

  // HITL
  approveToolCall(index: number, options?): void;
  rejectToolCall(index: number, options?): void;
  resumeStream(config?): AsyncGenerator<StreamChunk, ExecutionResult>;

  // 会话
  getSession(): Promise<SessionInfo>;
  clearSession(): Promise<void>;
}
```

**设计评价**：接口抽象良好，`stream()` 返回 `AsyncGenerator` 是正确的流式设计。但 HITL 方法直接放在 Runtime 接口中导致了与 SDK 的耦合（见 2.3）。

### 2.2 两个 Runtime 实现对比

| 维度            | OpenAIAgentRuntime                     | PiMonoAgentRuntime                    |
| --------------- | -------------------------------------- | ------------------------------------- |
| SDK             | `@openai/agents`                       | `pi-coding-agent`                     |
| HITL            | ✅ SDK 原生支持                        | ❌ 不支持                             |
| `needsApproval` | 映射到 SDK 的 `needsApproval`          | 被忽略                                |
| 会话持久化      | `FileSession` (JSONL)                  | SDK 内置 JSONL                        |
| 上下文压缩      | `SessionCompressor` (主动压缩)         | `compaction()` (SDK 原生)             |
| 工具转换        | `convertTools()` → SDK `tool()` 格式   | `convertTools()` → SDK 回调格式       |
| 流式事件        | `generateStreamEvents()` 解析 SDK 事件 | `ChunkQueue` 转接 SDK 回调            |
| 防御性策略      | `checkExecPolicy()` 在 execute 回调中  | `checkExecPolicy()` 在 execute 回调中 |

### 2.3 HITL 与 SDK 耦合问题（Critical）

**当前架构**：

```
OpenAI Runtime:
  tool.needsApproval = true  →  SDK 中断  →  返回 interrupted
  →  AgentExecutor 等待  →  approve/reject  →  SDK resume()

PiMono Runtime:
  HITL 不可用  →  工具直接执行
```

**问题**：

1. HITL 完全依赖 OpenAI SDK 的 `needsApproval` 机制，PiMono 用户无法使用
2. `approveToolCall()`、`rejectToolCall()` 调用的是 `pendingState.approve(item)` — SDK 内部 API
3. `resumeStream()` 调用的是 `run(agent, pendingState)` — 需要 SDK 状态对象
4. 如果 SDK API 变更，HITL 逻辑需要跟着改

**OpenClaw 对比**：

- OpenClaw 的 HITL 只针对 exec 工具，在工具执行包装器中实现
- 不依赖 SDK 的中断机制
- 工具执行前调用 `callGatewayTool("exec.approval.request")`
- 等待结果后决定执行或拒绝

### 2.4 执行循环细节

**OpenAI 路径**：

```
1. doStream() → run(agent, input, { stream: true, session })
2. for await (event of generateStreamEvents(streamResult)):
     根据 event.type 生成 StreamChunk
     处理: raw_model_stream_event → text:delta, reasoning:delta
           tool_call_start → tool:start
           tool_call_output → tool:done
           etc.
3. await streamResult.completed
4. 检查 streamResult.interruptions
   有中断 → handleInterruptions() → 返回 { interrupted: true }
   无中断 → 提取最终输出 → 返回 { output, toolCalls }
```

**PiMono 路径**：

```
1. doStream() → agentSession.streamSimple(input)
2. SDK 通过回调推送:
     onText(text) → ChunkQueue.push(text:delta)
     onThinking(text) → ChunkQueue.push(reasoning:delta)
     onToolCall(name, args) → ChunkQueue.push(tool:start)
     onToolResult(result) → ChunkQueue.push(tool:done)
3. 从 ChunkQueue yield 所有 chunk
4. SDK 完成 → 返回 { output }
   （无中断，因为不支持 HITL）
```

### 2.5 上下文压缩

| 维度       | OpenAI                                 | PiMono              |
| ---------- | -------------------------------------- | ------------------- |
| 触发时机   | `doStream()` 执行前                    | SDK 内置自动        |
| 实现       | `SessionCompressor.compressIfNeeded()` | `compaction()` 配置 |
| 策略       | Token 计数 → 超限时生成摘要替换        | SDK 内部逻辑        |
| Token 计数 | `tiktoken` 本地计算                    | 不透明              |
| 压缩率     | 可控（保留最近 N 轮 + 摘要）           | 不可控              |

---

## 三、Extension/Plugin 系统

### 3.1 加载流程

```
应用启动 → ReadyExtensionHook (phase READY, priority 50)
  → Env.getExtensionSearchPaths()
  → 按优先级扫描目录:
      1. builtinExtensionsDir (内置, 只读)
      2. userExtensionsDir (用户安装)
      3. {workspace}/extensions/ (Agent 创建)
  → 每个子目录:
      读取 extension.json (manifest)
      使用 jiti 动态编译+执行 index.ts
      调用 register(api) → 注册 tools/hooks/gateway/skills
  → 同 ID 高优先级覆盖低优先级
  → fs.watch 监听热重载 (300ms debounce)
```

### 3.2 注册能力

| 能力         | API                                          | 说明                            |
| ------------ | -------------------------------------------- | ------------------------------- |
| 工具注册     | `api.registerTool(tool)`                     | 添加到 ToolRegistry，LLM 可调用 |
| 生命周期钩子 | `api.on(hookName, handler, { priority })`    | 拦截 Agent 生命周期             |
| Gateway 方法 | `api.registerGatewayMethod(method, handler)` | WebSocket RPC 方法              |
| Skill 贡献   | manifest 的 `skills` 字段                    | 声明 Skill 目录                 |

### 3.3 Hook 系统

| Hook                  | 模式      | 触发点           | Extension 能做什么                      |
| --------------------- | --------- | ---------------- | --------------------------------------- |
| `message_received`    | void      | 收到用户消息     | 日志、统计等副作用                      |
| `session_start`       | void      | 会话启动         | 初始化会话级资源                        |
| `before_agent_start`  | modifying | Agent 执行前     | `prependContext`、`replaceSystemPrompt` |
| `before_tool_call`    | modifying | 工具调用前       | `block`、修改 `params`                  |
| `after_tool_call`     | void      | 工具调用后       | 记录、统计                              |
| `tool_result_persist` | modifying | 工具结果持久化前 | 截断/修改 `result`                      |
| `agent_end`           | void      | Agent 执行完成   | 记录、提取记忆                          |
| `session_end`         | void      | 会话结束         | 清理会话级资源                          |

**Hook 执行规则**：

- **void hooks**：`Promise.allSettled` 并行执行
- **modifying hooks**：按 priority 高→低顺序执行，结果合并

### 3.4 与 OpenClaw 对比

| 维度       | coobee-ai                          | OpenClaw                                           |
| ---------- | ---------------------------------- | -------------------------------------------------- |
| 注册能力数 | 4 种（tool, hook, gateway, skill） | 12+ 种（+channel, service, provider, cli, http等） |
| Hook 数量  | 8 个                               | 14 个                                              |
| 加载方式   | jiti 主进程直接执行                | 同上                                               |
| 沙箱隔离   | ❌ 无                              | ❌ 无                                              |
| 热重载     | ✅ fs.watch                        | ✅ 类似                                            |
| manifest   | extension.json                     | extension.json（更丰富）                           |

### 3.5 问题分析

1. **无沙箱隔离（C-2 级）**：Extension 在主进程中执行，恶意代码可访问全部 Node.js API
2. **Extension Skill 未完全接入**：`buildAgentEnv()` 合并了 Extension 的 Skill 路径到 `agentEnv.skillPaths`（用于显示），但 `injectEnv()` 的 `scanSkills()` 只扫描三个固定路径，**不包含 Extension 贡献的 Skill 目录**
3. **Hook 编排缺乏可观测性**：没有 Hook 执行日志或性能监控
4. **生命周期 Hook 无法阻止执行**：`before_agent_start` 返回 `block: true` 的语义未实现

---

## 四、Skill 系统

### 4.1 设计理念

**核心概念**：Skill = 场景化的自然语言操作手册

与 Tool 的区别：

- **Tool** = 可执行代码，原子操作，function calling
- **Skill** = 自然语言指导，多步工作流，领域知识
- 经验法则：**"能力放 Tool，知识放 Skill"**

### 4.2 发现与加载流程

```
AgentEnvInjector.injectEnv()
  ↓
SkillManager.scanSkills([builtinSkillsDir, userSkillsDir, {workspace}/skills])
  ↓ 遍历每个 searchPath 下的子目录
  ↓ 查找 SKILL.md 文件
  ↓ 解析 YAML frontmatter (name, description)
  ↓ 去重（按目录名，先到先得）
  ↓
SkillManager.setCurrent(manager)  ← 存储到全局单例
  ↓
注入 <skill_discovery> 到 appendInstructions:
  "You have N Skills available. Use skill_list to discover them."
  ↓
LLM 执行中按需调用 skill_list → read SKILL.md → 按指令操作
```

### 4.3 内置 Skill（5 个）

| Skill               | 描述                  | 用途                                      |
| ------------------- | --------------------- | ----------------------------------------- |
| `self-reflection`   | 自我评估与修复方法论  | 配合 execution_protocol 的评估和修复步骤  |
| `runtime-env`       | 运行时环境说明        | 了解目录结构、路径约定、可用资源          |
| `skill-creator`     | 创建新 Skill 的指南   | 教 LLM 如何创建 SKILL.md                  |
| `extension-creator` | 创建 Extension 的指南 | 教 LLM 如何创建 extension.json + index.ts |
| `icon-usage`        | 图标使用指南          | Vue 组件中的图标用法（应用开发专用）      |

### 4.4 LLM 如何使用 Skill

```
阶段 1: 发现
  LLM 收到 <skill_discovery> 提示 → 调用 skill_list 工具
  → 返回 Skill 名称、描述、SKILL.md 路径列表

阶段 2: 加载
  LLM 判断某个 Skill 相关 → 调用 read 工具读取 SKILL.md
  → SKILL.md 内容进入 LLM 上下文窗口

阶段 3: 执行
  LLM 按 SKILL.md 中的指令操作
  → 可能涉及调用工具、创建文件、分析内容等

阶段 4: 创建（自我进化）
  LLM 可以在 {workspace}/skills/ 下创建新 Skill
  → 下次扫描时自动发现
```

### 4.5 问题分析

1. **Extension Skill 未被 scanSkills 发现**（Bug）：`buildAgentEnv` 把 Extension 的 Skill 目录加入了 `agentEnv.skillPaths`，但 `injectEnv()` 的 `scanSkills()` 只传了三个固定路径，未包含 Extension 贡献的
2. **Skill 优先级语义不明**：文档说"同名 Skill 高优先级覆盖低优先级"，但代码实现是"先到先得（去重）"。如果 builtinSkillsDir 先扫描，内置 Skill 会覆盖用户 Skill — 这与设计意图相反
3. **Skill 加载是惰性的但非智能的**：LLM 需要先调用 `skill_list`，然后自行判断是否相关。对于复杂场景，LLM 可能忘记查看 Skill 或选错 Skill
4. **无 Skill 版本控制**：用户 Skill 修改后无法回退
5. **Skill 内容进入上下文后不可移除**：一旦 `read`，SKILL.md 内容就占据上下文窗口，不会被清除

### 4.6 与 OpenClaw 对比

| 维度         | coobee-ai                    | OpenClaw                        |
| ------------ | ---------------------------- | ------------------------------- |
| Skill 定义   | 相同（SKILL.md 文件驱动）    | 相同                            |
| 来源层级     | 3 级（内置、用户、工作空间） | 5 级（+config路径、Plugin贡献） |
| 发现方式     | `skill_list` 工具按需发现    | 类似                            |
| 加载方式     | `read` 工具读取              | 类似                            |
| 内置数量     | 5 个                         | ~50 个                          |
| Agent 自创建 | ✅ {workspace}/skills/       | ✅                              |
| 热加载       | ❌ 需重启扫描                | ✅ 每轮扫描                     |

---

## 五、Memory 系统

### 5.1 当前实现：文件驱动的 Memory 工具

**memory 工具**是 LLM 与记忆系统交互的唯一接口。

```
记忆存储结构：
{memoryDir}/
├── user/                    # 用户级（跨 Agent 共享）
│   ├── preferences.md       # 用户偏好
│   ├── lessons-learned.md   # 经验教训
│   └── project-notes/
│       └── coobee-ai.md     # 项目笔记
└── agent/                   # Agent 级（隔离）
    └── {agent-id}/
        └── domain-knowledge.md
```

**四个操作**：

| 操作     | 说明                                          | 实现                      |
| -------- | --------------------------------------------- | ------------------------- |
| `list`   | 列出记忆文件（名称、大小、修改时间）          | `fs.readdirSync` 递归     |
| `get`    | 读取记忆文件内容                              | `fs.readFileSync`         |
| `write`  | 创建/更新记忆文件（自动加时间戳 frontmatter） | `fs.writeFileSync`        |
| `search` | 关键字搜索（行级匹配，大小写不敏感）          | 全文件遍历 + `includes()` |

**安全措施**：

- 路径穿越防护（`path.resolve` + 字符串检查）
- 符号链接穿越防护（`fs.realpathSync`）
- 文件大小限制（100KB）
- 支持格式限制（.md, .json, .txt, .yaml, .yml）

### 5.2 未接入的 Memory 模块

`src/main/ai/memory/` 下有完整但**未被业务代码引用**的记忆子系统：

| 组件                  | 用途                                           | 状态      |
| --------------------- | ---------------------------------------------- | --------- |
| `SessionMemoryStore`  | JSONL 会话历史持久化                           | ❌ 未接入 |
| `ShortTermMemory`     | 上下文窗口管理（裁剪/摘要）                    | ❌ 未接入 |
| `WorkingMemoryStore`  | 工作记忆（变量、计划、子任务、检查点）         | ❌ 未接入 |
| `LongTermMemoryStore` | SQLite 长期记忆（类型、importance、embedding） | ❌ 未接入 |
| `SessionAdapter`      | 适配 SDK Session 接口                          | ❌ 未接入 |

**LongTermMemoryStore 的设计**：

- 记忆类型：`semantic`（知识）、`episodic`（经历）、`procedural`（流程）、`preference`（偏好）、`lesson`（教训）
- 字段：id, type, content, context, importance(0-1), userId, sessionId, embedding, accessCount
- 查询：支持 userId、type、minImportance、limit、keywords（LIKE）
- 计划：embedding 向量搜索（尚未实现）

### 5.3 LLM 如何使用记忆

```
场景 1: 主动检索
  LLM 需要回忆某个知识 → memory(action='search', query='xxx')
  → 返回匹配行

场景 2: 主动存储
  LLM 完成任务后发现有价值的知识 → memory(action='write', file='xxx.md', content='...')
  → 持久化到文件

场景 3: 浏览记忆
  LLM 想了解自己知道什么 → memory(action='list')
  → 返回文件列表 → memory(action='get', file='xxx.md')
```

### 5.4 问题分析

1. **搜索能力极弱**：仅支持字符串 `includes()`，无语义搜索、无模糊匹配、无相关度排序
2. **无自动记忆提取**：LLM 不会主动把有价值的信息存入记忆。OpenClaw 通过 `agent_end` Hook 自动提取记忆
3. **无会话启动时的记忆注入**：每次会话开始时 LLM 不会自动获得过往记忆。OpenClaw 通过 `before_agent_start` Hook 注入相关记忆
4. **memory/ 模块闲置**：完整的 SQLite + 类型 + importance + embedding 设计未被使用
5. **两层作用域不够灵活**：只有 `user` 和 `agent`，缺少 `session` 级别的临时记忆

### 5.5 与 OpenClaw 对比

| 维度          | coobee-ai             | OpenClaw                        |
| ------------- | --------------------- | ------------------------------- |
| 存储后端      | 文件系统（.md/.json） | SQLite + sqlite-vec             |
| 搜索方式      | `string.includes()`   | BM25 + 向量混合搜索             |
| Embedding     | ❌ 无                 | ✅ OpenAI/Gemini/Voyage/local   |
| 自动记忆提取  | ❌ 手动               | ✅ `agent_end` Hook 自动        |
| 会话启动注入  | ❌ 无                 | ✅ `before_agent_start` Hook    |
| 记忆类型      | 无类型（纯文件）      | 5 种类型 + importance 权重      |
| 记忆工具      | 1 个（memory）        | 4 个（search/get/store/forget） |
| 每 Agent 隔离 | ✅ agent/ 目录        | ✅ per-agent index              |

---

## 六、工具系统

### 6.1 工具接口

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  needUserConfirm?: boolean;
  parameters: ZodSchema;
  execute: AsyncGenerator<ToolStreamUpdate, ToolResult, unknown>;
}

// ToolResult
interface ToolResult {
  success: boolean;
  llmContent: string; // 返回给 LLM 的文本
  error?: { code; message };
  details?: Record<string, unknown>; // 结构化数据（前端展示用）
}
```

**设计特点**：

- SDK 无关：`ToolDefinition` 不依赖任何 SDK 类型
- 流式输出：`AsyncGenerator` 支持进度更新
- 双通道输出：`llmContent` 给 LLM，`details` 给前端

### 6.2 完整工具清单（10 + N）

#### 内置工具

| 工具              | 分类          | 确认   | 功能                              | LLM 视角         |
| ----------------- | ------------- | ------ | --------------------------------- | ---------------- |
| `read`            | FileSystem    | 否     | 读取文件内容                      | "我能看到文件"   |
| `write`           | FileSystem    | **是** | 写入新文件                        | "我能创建文件"   |
| `edit`            | FileSystem    | **是** | 编辑现有文件（oldText→newText）   | "我能修改代码"   |
| `exec`            | Execute       | **是** | 执行 Shell 命令（前台/后台）      | "我能运行命令"   |
| `process`         | Execute       | 否     | 管理后台进程（list/read/kill）    | "我能监控进程"   |
| `memory`          | Memory        | 否     | 记忆管理（list/get/write/search） | "我能记住和回忆" |
| `session_status`  | Observability | 否     | 会话状态（快照数、Token、模型）   | "我能自我监控"   |
| `session_history` | Observability | 否     | 对话历史时间线                    | "我能回顾过程"   |
| `context_inspect` | Observability | 否     | LLM 调用上下文快照                | "我能内省上下文" |
| `skill_list`      | Discovery     | 否     | 列出可用 Skill                    | "我能发现能力"   |

#### Extension 贡献的工具

通过 `api.registerTool()` 动态注册，数量不定。

### 6.3 工具分类与 LLM 能力图谱

```
LLM 的能力维度：

1. 感知（Perception）
   ├── 文件系统感知: read
   ├── 进程感知: process(list/read)
   ├── 自我感知: session_status, session_history, context_inspect
   └── 能力感知: skill_list

2. 行动（Action）
   ├── 文件操作: write, edit
   ├── 命令执行: exec
   └── 进程管理: process(kill)

3. 记忆（Memory）
   └── 持久化记忆: memory(list/get/write/search)

4. 学习（Learning）
   ├── Skill 加载: skill_list → read(SKILL.md)
   └── Skill 创建: write({workspace}/skills/xxx/SKILL.md)

5. 进化（Evolution）
   ├── Extension 创建: write({workspace}/extensions/xxx/)
   └── 自我评估: self-reflection Skill + observability 工具
```

### 6.4 问题分析

1. **file-lock.ts 存在但未导出**：`tools/builtin/file-lock.ts` 文件存在但未在 `index.ts` 中导出
2. **Observability 工具依赖文件系统**：`session_status`、`session_history`、`context_inspect` 都从 `contexts/` 目录读取 JSON 文件，如果文件被清理或格式变化，工具就失效
3. **exec 工具的后台进程机制复杂**：exec 支持前台（超时终止）和后台（注册到 ProcessRegistry）两种模式，但 LLM 需要理解这个复杂性
4. **write/edit 无版本追踪**：写入/编辑文件后无法回退
5. **工具间无协调**：多个工具可能同时操作同一文件，无文件锁保护

---

## 七、环境注入与 LLM 自我感知

### 7.1 环境注入三件套

AgentEnvInjector 向每个 Agent 注入三块内容：

#### 7.1.1 执行协议（execution_protocol）

```xml
<execution_protocol>
1. Intent & Goal Extraction
   - 识别用户意图
   - 提取可验证目标（量化指标或验收清单）

2. Plan & Execute
   - 制定计划并执行

3. Self-Evaluation（任务完成后）
   - 质量评估：输出 vs 目标
   - 过程评估：效率、错误模式
   - 详细评估 → 加载 self-reflection Skill

4. Self-Repair（如发现问题，最多 3 轮）
   - 修复策略 → 修复目标 → 报告

5. Report
   - 汇总结果 + 遗留问题
</execution_protocol>
```

这是 Agent 的**五步工作法**——意图识别 → 目标量化 → 执行 → 自我评估 → 自我修复。

#### 7.1.2 运行时环境（runtime_environment）

```xml
<runtime_environment>
  <system>平台、架构、版本</system>
  <session>sessionId、workspace</session>
  <paths>userHome、systemHome、temp、memoryDir</paths>
  <skills>搜索路径列表</skills>
  <extensions>搜索路径、已加载列表</extensions>
  <tools>可用工具名称列表</tools>
</runtime_environment>
```

#### 7.1.3 Skill 发现提示

```xml
<skill_discovery>
You have N Skills available. Use `skill_list` to discover them.
</skill_discovery>
```

### 7.2 LLM 自我感知能力评估

| 维度             | 能力                        | 实现方式                                     | 完整度 |
| ---------------- | --------------------------- | -------------------------------------------- | ------ |
| 我是谁           | 知道自己在 coobee-ai 中运行 | `<runtime_environment>` 注入                 | ★★★☆   |
| 我有什么能力     | 知道可用工具和 Skill        | `<tools>` + `<skill_discovery>`              | ★★★☆   |
| 我该怎么做       | 五步工作法                  | `<execution_protocol>`                       | ★★★★   |
| 我做得怎么样     | 自我评估                    | `self-reflection` Skill + observability 工具 | ★★★★   |
| 我能改变什么     | 创建 Skill 和 Extension     | `skill-creator` + `extension-creator` Skill  | ★★★☆   |
| 我记住了什么     | 查看和搜索记忆              | `memory` 工具                                | ★★☆☆   |
| 别人对我做了什么 | Extension 和 Hook 的影响    | `<extensions>.loaded` 列表                   | ★☆☆☆   |

### 7.3 自我进化路径

当前 LLM 可以通过以下方式"进化"：

```
1. 创建 Skill
   → write({workspace}/skills/new-skill/SKILL.md)
   → 下次执行时 scanSkills 发现

2. 创建 Extension（含工具/Hook）
   → write({workspace}/extensions/new-ext/extension.json)
   → write({workspace}/extensions/new-ext/index.ts)
   → fs.watch 热加载

3. 存储记忆
   → memory(write, 'lessons-learned.md', '...')
   → 后续可 search/get 回忆

4. 自我评估 + 修复
   → execution_protocol 第 3-4 步
   → self-reflection Skill 提供方法论
   → session_history + context_inspect 提供过程数据
```

### 7.4 问题分析

1. **自我进化是被动的**：LLM 需要主动想到"我应该创建一个 Skill" 或 "我应该记住这个"。没有机制主动提醒或触发
2. **无记忆注入**：会话启动时 LLM 不会自动获得过往记忆，需要手动 `memory(search)` 或 `memory(list)`
3. **Extension 影响不透明**：LLM 只知道加载了哪些 Extension ID，不知道它们注册了什么 Hook、做了什么修改
4. **执行协议是静态的**：`buildExecutionProtocol()` 返回固定文本，不会根据任务类型、历史表现调整
5. **反馈循环未闭环**：
   - 评估结果没有自动存入记忆
   - 修复经验没有自动生成 Skill
   - 错误模式没有自动调整执行策略

---

## 八、流式输出与事件系统

### 8.1 StreamChunk 类型体系

```typescript
type StreamChunkType =
  // 运行级
  | 'run:start'
  | 'run:done'
  | 'run:error'
  | 'run:interrupted'
  | 'run:resumed'
  // 轮次级
  | 'turn:start'
  | 'turn:done'
  // LLM 级
  | 'llm:start'
  | 'llm:done'
  // 文本级
  | 'text:start'
  | 'text:delta'
  | 'text:done'
  // 推理级
  | 'reasoning:start'
  | 'reasoning:delta'
  | 'reasoning:done'
  // 工具级
  | 'tool:start'
  | 'tool:delta'
  | 'tool:pending'
  | 'tool:done'
  // HITL 级
  | 'hitl:required'
  | 'hitl:approved'
  | 'hitl:rejected'
  // 切换级
  | 'handoff:start'
  | 'handoff:done'
  // 压缩级
  | 'compression:start'
  | 'compression:done';
```

### 8.2 事件传播链

```
Runtime.stream()
  → yield StreamChunk
    → AgentExecutor
      → StreamEmitter.forward()
        → EventBus.emit('stream:{sessionId}', event)
          ├── StreamStore.append() → SQLite 持久化
          ├── StreamMonitor.record() → 统计
          └── WebSocket Broadcaster → 前端实时展示
      → AgentEventWriter.append() → events.jsonl 文件
```

### 8.3 问题分析

1. **StreamStore 失败静默丢弃**：写入 SQLite 失败时日志后跳过，无重试或死信队列
2. **events.jsonl 无清理机制**：长时间运行的 Agent 会积累大量事件文件

---

## 九、Sandbox 安全体系

### 9.1 当前实现

| 组件             | 功能                           | 状态                     |
| ---------------- | ------------------------------ | ------------------------ |
| `path-guard.ts`  | 路径越界检查                   | ✅ 已接入                |
| `exec-policy.ts` | exec 命令安全策略（黑/白名单） | ✅ 已接入                |
| `tool-policy.ts` | 工具策略规则解析               | ⚠️ 代码存在但未真正使用  |
| `context.ts`     | `resolveSandboxContext()`      | ⚠️ 仅创建 path-only 模式 |
| `docker.ts`      | Docker 容器沙箱                | ❌ 预留未实现            |

### 9.2 exec-policy 的定位问题（已知，待重构）

**当前**：`exec-policy.ts` 放在 `sandbox/` 目录，名称绑定 exec 工具，策略逻辑分散在：

- `AgentExecutor.computePolicyDecisions()` — HITL 循环中自动决策
- `OpenAIAgentRuntime.convertTools()` — execute 回调中防御性检查
- `PiMonoAgentRuntime.convertTools()` — execute 回调中策略检查

**方向**：整合到 `hitl/` 模块，成为通用工具审批策略引擎（已讨论，待实施）。

### 9.3 path-guard 的符号链接问题

**当前**：`path-guard.ts` 仅用 `path.resolve()` + `path.relative()` 做字符串比较，**未检查符号链接穿越**。

**但**：`memory.ts` 工具中的 `resolveMemoryPath()` **已实现**了 `fs.realpathSync` 检查。

**状态**：path-guard 本身（被 read/write/edit 使用）仍有符号链接漏洞，而 memory 工具已独立修复。

---

## 十、多 Agent 模式（设计储备）

### 10.1 三种编排模式

| 模式                | 实现                       | SDK 依赖         | 状态                |
| ------------------- | -------------------------- | ---------------- | ------------------- |
| Team                | `TeamRuntime.ts`           | `@openai/agents` | ⚠️ 绑定 SDK         |
| Swarm               | `swarm/` (7个文件)         | 无（自研）       | ⚠️ 代码完整但未接入 |
| Orchestrator-Worker | `orchestration/` (6个文件) | `@openai/agents` | ⚠️ 绑定 SDK         |

### 10.2 Swarm 子系统（自研）

```
SwarmCoordinator
  ├── AgentPool — Agent 生命周期管理
  ├── ConcurrencyManager — 并发控制
  ├── MessageBus — Agent 间消息通信
  ├── HandoffRouter — 任务路由
  ├── SwarmContext — 共享上下文
  └── SwarmMonitor — 监控
```

**设计评价**：Swarm 子系统是唯一不依赖 `@openai/agents` SDK 的多 Agent 方案，设计较为完整。但目前没有任何业务代码使用它。

---

## 十一、与 OpenClaw 的系统性对比

### 11.1 关键差异总结

| 维度           | coobee-ai                                  | OpenClaw                                | 差距                         |
| -------------- | ------------------------------------------ | --------------------------------------- | ---------------------------- |
| **运行环境**   | Electron 桌面应用                          | 服务端 Gateway                          | 不同场景，不可直接比较       |
| **SDK 依赖**   | 双 SDK（@openai/agents + pi-coding-agent） | 单 SDK（pi-\*）                         | coobee-ai 需维护两套转换     |
| **HITL**       | 依赖 OpenAI SDK 机制                       | 自研，在工具包装器中实现                | **coobee-ai 需要解耦**       |
| **工具策略**   | 1 层（sandbox path-guard）                 | 8 层（profile→global→agent→sandbox...） | **coobee-ai 策略体系不完整** |
| **记忆**       | 文件系统 + includes()                      | SQLite + BM25 + 向量                    | **coobee-ai 搜索能力太弱**   |
| **Skill 数量** | 5 个                                       | ~50 个                                  | 内容差距大                   |
| **Extension**  | 4 种能力                                   | 12+ 种能力                              | OpenClaw 更丰富              |
| **并发控制**   | busy 锁（同 session 串行）                 | Lane 队列（多级并发）                   | coobee-ai 更简单             |
| **错误恢复**   | 基本（超时终止）                           | 渐进式（5 级降级）                      | **coobee-ai 缺乏韧性**       |
| **自我评估**   | Skill 驱动（self-reflection）              | 无专门机制                              | **coobee-ai 更先进**         |
| **执行协议**   | 五步工作法（注入到所有 Agent）             | 无统一协议                              | **coobee-ai 更先进**         |

### 11.2 coobee-ai 的独特优势

1. **执行协议（五步工作法）**：系统级的意图→目标→执行→评估→修复闭环
2. **self-reflection Skill**：详细的自我评估方法论和修复策略
3. **Observability 工具组**：LLM 可以内省自己的执行过程
4. **Skill 自创建**：LLM 可以创建新 Skill 和 Extension 实现自我进化
5. **AgentEnv 安全子集**：清晰的环境信息暴露模型

### 11.3 coobee-ai 需要借鉴 OpenClaw 的地方

1. **HITL SDK 独立**：在工具执行包装器中实现，不依赖 SDK 中断机制
2. **多层工具策略**：profile → global → agent → sandbox 多级过滤
3. **记忆系统升级**：SQLite + 向量搜索 + 自动提取 + 会话启动注入
4. **渐进式错误恢复**：认证轮换 → 思考降级 → 上下文压缩 → 模型降级
5. **子 Agent 机制**：单级 fan-out + 结果回报

---

## 十二、总结与改进方向

### 12.1 核心架构健康度

| 子系统                             | 健康度 | 说明                                         |
| ---------------------------------- | ------ | -------------------------------------------- |
| 执行链路 (AgentExecutor → Runtime) | ★★★★☆  | 设计合理，但 AgentExecutor 过重              |
| 工具系统 (ToolDefinition)          | ★★★★☆  | SDK 无关化做得好                             |
| 流式输出 (StreamEmitter)           | ★★★★☆  | 事件类型丰富                                 |
| Skill 系统                         | ★★★☆☆  | 框架好，但内容少，Extension Skill 未完全接入 |
| Extension 系统                     | ★★★☆☆  | 基础能力有，但无沙箱、能力有限               |
| HITL 系统                          | ★★☆☆☆  | 绑定 OpenAI SDK，PiMono 不可用               |
| Memory 系统                        | ★★☆☆☆  | 文件存储 + 字符串搜索，远不够用              |
| 安全体系                           | ★★☆☆☆  | path-guard 有漏洞，sandbox 未真正启用        |
| 自我评估                           | ★★★★☆  | 五步工作法 + self-reflection 是亮点          |
| 自我进化                           | ★★★☆☆  | 框架有，但反馈循环未闭环                     |

### 12.2 最需要改进的 5 个方向

1. **HITL 独立于 SDK**：统一审批策略引擎，两个 Runtime 一致行为
2. **Memory 系统升级**：SQLite 后端 + 语义搜索 + 自动记忆提取/注入
3. **安全体系补全**：path-guard 符号链接 + 通用工具策略 + Extension 沙箱
4. **Skill 系统增强**：修复 Extension Skill 发现 bug + 增加内置 Skill
5. **反馈循环闭环**：评估→记忆→Skill 生成→策略调整的自动化
