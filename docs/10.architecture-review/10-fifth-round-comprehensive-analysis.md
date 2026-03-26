# 10 — 第五轮全面架构分析

> 基于三大基础设施（配置系统、模型 Provider、消息管线）落地后的完整系统审视
>
> 分析日期：2026-02-12

---

## 0. 分析背景

经过 09 号基础设施计划的 5 个阶段实施，系统新增了：

- **统一配置系统**：Zod Schema + JSON5 + 热重载
- **模型 Provider 体系**：四级选择 + Fallback 链 + 成本追踪
- **消息管线**：四种排队模式 + 中断/排水策略
- **5 个新扩展钩子**：`message_queued` / `message_dequeued` / `queue_drain_start` / `model_resolved` / `model_fallback`
- **前端设置页面**：SettingsView + 中断按钮 + 队列状态 UX

本文对整个系统（后端 + 前端 + 协议 + 工具 + 安全）进行一次全面审视。

---

## 1. 系统架构全景

### 1.1 进程模型

```
┌────────────────────────────────────────────────────────────────┐
│                     Electron Main Process                       │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Lifecycle    │  │ Gateway      │  │ AI Engine              │ │
│  │ Manager     │──│ (WS + HTTP)  │──│ AgentExecutor          │ │
│  │ (3 phases)  │  │ RPC Protocol │  │ Runtime (PiMono/OpenAI)│ │
│  └─────────────┘  └──────────────┘  │ Pipeline               │ │
│                                      │ Provider               │ │
│  ┌─────────────┐  ┌──────────────┐  │ Tools                  │ │
│  │ Extension   │  │ Config       │  │ HITL                   │ │
│  │ System      │──│ System       │──│ Streaming              │ │
│  │ (17 hooks)  │  │ (JSON5+Zod)  │  └────────────────────────┘ │
│  └─────────────┘  └──────────────┘                              │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Storage     │  │ Security     │  │ Worker Manager         │ │
│  │ SQLite      │  │ Sandbox      │  │ (ASR/TTS)              │ │
│  │ DuckDB      │  │ Exec Policy  │  └────────────────────────┘ │
│  └─────────────┘  └──────────────┘                              │
└────────────────────────────────────────────────────────────────┘
         ▲ WebSocket / IPC
         │
┌────────┴───────────────────────────────────────────────────────┐
│                   Electron Renderer Process                      │
│                                                                 │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ Router   │  │ Pinia Stores │  │ Vue 3 Components         │ │
│  │ (4 route)│  │ (6 stores)   │  │ AgentView (3-panel)      │ │
│  └──────────┘  └──────────────┘  │ SettingsView             │ │
│                                   │ LogViewer                │ │
│  ┌──────────┐  ┌──────────────┐  └──────────────────────────┘ │
│  │ Gateway  │  │ Composables  │                                │
│  │ Client   │  │ (Stream/IPC) │  ┌──────────────────────────┐ │
│  └──────────┘  └──────────────┘  │ Sub-Windows              │ │
│                                   │ Shell/Console/Browser    │ │
│                                   └──────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### 1.2 核心数据流

```
用户输入
  → ChatPanel → chatStore.sendMessage()
  → gateway.request('chat.send')
  → Gateway WS → chat.send handler
  → AgentExecutor.submit() / submitViaPipeline()
  → MessagePipeline.submit() (如果已初始化)
  → AgentExecutor.execute()
    → Extension Hooks: message_received → session_start → before_agent_start
    → ModelSelector.resolve() → model_resolved hook
    → Builder.build() → Runtime
    → Runtime.stream() yields StreamChunk
    → consumeAndForward()
      → StreamEmitter → EventBus → StreamBridge → Gateway WS
      → AgentEventWriter → events.jsonl
      → fireChunkHooks → turn_start/turn_end/before_compaction/after_compaction
    → Extension Hooks: agent_end → session_end
    → drainQueue() → queue_drain_start → message_dequeued hooks
  → 前端收到 stream.message event → chatStore.handleStreamMessage()
```

---

## 2. 生命周期系统

### 2.1 三阶段模型

| 阶段          | 时机                   | 用途                           |
| ------------- | ---------------------- | ------------------------------ |
| `INIT`        | `app.whenReady()` 之前 | 环境信息、数据库初始化         |
| `READY`       | `app.whenReady()` 之后 | HTTP/Gateway/IPC、窗口、Worker |
| `BEFORE_QUIT` | 退出之前               | Worker 停止、进程清理、DB 关闭 |

### 2.2 READY 阶段 Hook 执行顺序

| 优先级 | Hook                     | 职责                               |
| ------ | ------------------------ | ---------------------------------- |
| 35     | ReadyApiRegistrationHook | HTTP + IPC 服务注册                |
| 45     | ReadyGatewayHook         | Gateway WebSocket 启动             |
| 50     | ReadyExtensionHook       | Extension 加载 + ToolRegistry 填充 |
| 50     | ReadyIpcRegistrationHook | IPC 处理器注册                     |
| 80     | ReadyWorkerHook          | Worker 发现与自启动                |

### 2.3 Hook 发现机制

```typescript
// src/main/common/scan.ts
import.meta.glob('@main/lifecycle/**/*Hook.ts', { eager: true });
```

- 导出符合 `LifecycleHook` 接口的模块自动注册
- 同优先级 Hook 通过 `Promise.allSettled` 并行执行
- `critical: true` 的 Hook 失败会中止整个阶段

---

## 3. 扩展系统（Extension System）

### 3.1 架构概览

```
Extension 模块 (extension.json + index.ts)
  → ExtensionLoader.load()
    → validate manifest → trust check → register skills
    → jiti dynamic import → mod.register(api)
      → api.on(hookName, handler) → ExtensionRegistry.registerHook()
      → api.registerTool(tool) → ExtensionRegistry.registerTool()
      → api.registerGatewayMethod(method, handler)
  → ExtensionManager.initialize(registry)
    → ExtensionHookRunner 就绪
```

### 3.2 17 种钩子清单

| 钩子                  | 模式      | 触发点                         | 用途                          |
| --------------------- | --------- | ------------------------------ | ----------------------------- |
| `before_agent_start`  | modifying | AgentExecutor                  | 注入上下文/替换 System Prompt |
| `agent_end`           | void      | AgentExecutor                  | Agent 执行完成通知            |
| `before_tool_call`    | modifying | ToolExecutionPipeline          | 修改参数/阻止调用             |
| `after_tool_call`     | void      | ToolExecutionPipeline          | 工具执行后审计                |
| `tool_result_persist` | modifying | ToolExecutionPipeline          | 修改持久化结果                |
| `message_received`    | void      | AgentExecutor                  | 收到用户消息                  |
| `session_start`       | void      | AgentExecutor                  | 会话开始                      |
| `session_end`         | void      | AgentExecutor                  | 会话结束                      |
| `turn_start`          | void      | AgentExecutor (chunk)          | 轮次开始                      |
| `turn_end`            | void      | AgentExecutor (chunk)          | 轮次完成                      |
| `before_compaction`   | modifying | AgentExecutor / OpenAI Runtime | 压缩前自定义                  |
| `after_compaction`    | void      | AgentExecutor (chunk)          | 压缩完成                      |
| `message_queued`      | void      | MessagePipeline                | 消息入队                      |
| `message_dequeued`    | void      | MessagePipeline                | 消息出队                      |
| `queue_drain_start`   | void      | MessagePipeline                | 排水开始                      |
| `model_resolved`      | void      | ModelSelector                  | 模型选择完成                  |
| `model_fallback`      | void      | ModelFallback                  | 模型回退触发                  |

### 3.3 两种执行模式

- **void（旁听型）**：`Promise.allSettled` 并行，互不影响，13 种
- **modifying（拦截型）**：按优先级顺序执行，结果逐步合并，4 种

### 3.4 合并规则

| 钩子                | `prependContext` | `block` | `params`         | `result` | `skipDefault` |
| ------------------- | ---------------- | ------- | ---------------- | -------- | ------------- |
| before_agent_start  | 拼接（\n）       | —       | —                | —        | —             |
| before_tool_call    | —                | OR 合并 | 浅合并（后覆前） | —        | —             |
| tool_result_persist | —                | —       | —                | 后覆前   | —             |
| before_compaction   | —                | —       | —                | —        | OR 合并       |

### 3.5 内置 Extension

| Extension       | 功能                                    |
| --------------- | --------------------------------------- |
| `tool-approval` | 工具调用审批（exec policy + HITL 流程） |
| `memory-thread` | 自动内存提取                            |

---

## 4. 配置系统（Config System）

### 4.1 架构

```
coobee.json5
  → ConfigLoader (JSON5 → env resolve → Zod validate → defaults merge → cache)
  → ConfigStore (get/set/patch → file write → cache clear)
  → ConfigWatcher (chokidar → debounce → diff → ReloadPlan → callbacks)
  → Gateway methods (config.get / config.set / config.patch / config.getAll)
```

### 4.2 Schema 结构

```
CoobeeConfig
├── models.providers: Record<string, ProviderConfig>
├── agents.defaults.model: { primary, fallbacks }
├── agents.list: AgentEntry[]
├── messages.queue: { mode, debounceMs, cap, dropPolicy }
├── tools.exec: { timeout, blacklist }
├── security.sandbox: { mode }
├── security.approvals: { exec }
├── ui: { theme, language, soundEffects }
└── logging: { level, file }
```

### 4.3 热重载机制

- chokidar 监听 `coobee.json5` 变更
- 300ms 防抖
- `diffConfigPaths(prev, next)` → 变更路径列表
- `buildReloadPlan(changedPaths)` → 分类为 `hot` / `none`
- **Hot**：`ui.*`, `logging.*` — 立即生效
- **None**：`models.*`, `agents.*`, `messages.*` — 下次访问时生效

### 4.4 与旧系统共存

| 配置源                    | 状态       | 内容                          |
| ------------------------- | ---------- | ----------------------------- |
| `.env`                    | 旧，待迁移 | LLM API Key / BaseURL / Model |
| `electron-store`          | 旧，并行   | UI 偏好（theme, autoStart）   |
| `SQLite AgentConfigStore` | 已扩展     | Agent 配置 + `model_ref`      |
| `coobee.json5`            | 新         | 统一配置（Zod 校验）          |

---

## 5. 模型 Provider 体系

### 5.1 架构

```
ProviderRegistry
  ├── 4 内置 Provider (openai/anthropic/aliyun/minimax)
  ├── loadFromConfig(CoobeeConfig) → 用户自定义 Provider
  └── get/getAll/getEnabled

ModelCatalog
  └── listAll / find / listByCapability / listByProvider

ModelSelector (四级优先级)
  ├── Level 1: sessionOverrides
  ├── Level 2: agentOverrides / config.agents.list
  ├── Level 3: config.agents.defaults.model.primary
  └── Level 4: fallbackDefault (openai/gpt-4o)

ModelFallback
  └── run(candidates, execute)
      ├── 按序尝试
      ├── 可重试错误 → 下一候选
      ├── AbortError → 立即停止
      └── model_fallback hook

CostTracker
  └── record(provider, model, tokens) → getTotalCost() / getSummaryByModel()

ApiKeyResolver
  └── 解析 ${VAR} 模板 / 环境变量 / 直接值
```

### 5.2 内置 Provider 清单

| Provider  | 模型                                       | API 风格          |
| --------- | ------------------------------------------ | ----------------- |
| openai    | gpt-4o, gpt-4o-mini, o3-mini               | openai            |
| anthropic | claude-sonnet-4-20250514, claude-3-5-haiku | anthropic         |
| aliyun    | qwen3-max, qwen3-plus, qwen3-mini          | openai-compatible |
| minimax   | MiniMax-M1                                 | openai-compatible |

### 5.3 Builder 集成

`PiMonoBuilder.fromProviderConfig(config, modelId)` 从 Provider 配置构建运行时，优先级高于 `.env`。

---

## 6. 消息管线（Message Pipeline）

### 6.1 架构

```
MessagePipeline
  ├── queues: Map<string, SessionQueue>
  ├── abortManager: AbortManager
  ├── executor: PipelineExecutor
  └── globalSettings: QueueSettings

submit(sessionId, message)
  ├── 空闲 → executeWithLifecycle()
  └── 忙碌 → 按模式处理
      ├── interrupt → abort + clear + 立即执行
      ├── steer → 入队（merge 语义）
      ├── collect → 入队（合并处理）
      └── followup → 入队（逐条处理）

executeWithLifecycle()
  → AbortManager.create(signal)
  → executor(sessionId, message, signal)
  → drainQueue()
    → followup: 逐条出队 → 逐条执行
    → collect: 全部出队 → 合并为一条 → 单次执行
```

### 6.2 队列配置

| 参数       | 默认值   | 说明                          |
| ---------- | -------- | ----------------------------- |
| mode       | followup | 排队模式                      |
| debounceMs | 500      | 防抖间隔                      |
| cap        | 20       | 最大队列深度                  |
| dropPolicy | old      | 溢出策略（old/new/summarize） |

### 6.3 AgentExecutor 集成

- `initPipeline(settings?)` — 创建管线
- `submitViaPipeline(sessionId, message)` — 管线提交
- `abort(sessionId)` — 优先管线中断，回退到 busySessions
- `submit()` 优先通过管线，管线未初始化则回退到原逻辑

---

## 7. 运行时系统（Runtime System）

### 7.1 双运行时

| Runtime | SDK                           | 适用场景          |
| ------- | ----------------------------- | ----------------- |
| PiMono  | @mariozechner/pi-coding-agent | 默认 Agent 模式   |
| OpenAI  | @openai/agents                | OpenAI Agents SDK |

### 7.2 Builder 模式

```typescript
agentExecutor.piMono()
  .name('coobee')
  .mode('agent')
  .model('gpt-4o')
  .instructions(...)
  .fromProviderConfig(providerConfig, modelId)  // 新增
  .build()
  → PiMonoAgentRuntime
```

### 7.3 环境注入（AgentEnvInjector）

```
injectEnv(sessionId, builder)
  1. 获取工作空间目录
  2. 构建 AgentEnv（平台信息、技能路径、工具列表）
  3. 扫描技能（SkillManager）
  4. 构建执行协议（buildExecutionProtocol）
  5. 构建运行时路径描述（formatRuntimePaths）
  6. 注入沙箱上下文（createPathOnlyContext）
  7. 设置 sessionDir / workspaceRoot / contextDir
```

### 7.4 流式事件类型

```
StreamChunkType (28 种):
  run:   start / done / error / interrupted / resumed
  turn:  start / done
  llm:   start / done
  text:  start / delta / done
  reasoning: start / delta / done
  tool:  start / delta / pending / done
  hitl:  required / approved / rejected
  handoff: start / done
  compression: start / done
```

---

## 8. Gateway 系统

### 8.1 协议

| 方向            | 格式                                     |
| --------------- | ---------------------------------------- |
| 客户端 → 服务端 | `{ type: 'req', id, method, params }`    |
| 服务端 → 客户端 | `{ type: 'res', id, ok, payload/error }` |
| 服务端推送      | `{ type: 'event', event, payload }`      |

### 8.2 RPC 方法清单

| 命名空间 | 方法                                      | 来源        |
| -------- | ----------------------------------------- | ----------- |
| chat     | send, abort                               | chat.ts     |
| stream   | subscribe, unsubscribe, resend, latestSeq | stream.ts   |
| config   | get, getAll, set, patch                   | config.ts   |
| hitl     | decide                                    | approval.ts |
| worker   | (worker 管理)                             | worker.ts   |
| system   | methods, health                           | 内置        |

### 8.3 事件推送

```
StreamEmitter → EventBus(stream:message)
  → StreamBridge → gateway.broadcastEventIf('stream.*', subscribedSessions)
  → 前端 GatewayClient.on('stream.message', handler)
  → useStreamWs → chatStore.handleStreamMessage()
```

---

## 9. 工具系统

### 9.1 内置工具（12 种）

| 类别          | 工具                                             | 需要确认        |
| ------------- | ------------------------------------------------ | --------------- |
| FileSystem    | read, write, edit                                | write/edit 需要 |
| Search        | search, glob                                     | 否              |
| Execute       | exec, process                                    | exec 需要       |
| Memory        | memory, memory-index                             | 否              |
| Observability | session_status, session_history, context_inspect | 否              |
| Discovery     | skill_list                                       | 否              |

### 9.2 ToolExecutionPipeline（四阶段）

```
Phase 1: before_tool_call Hook → 可阻止/修改参数
Phase 2: Sandbox toolPolicy → isToolAllowed()
Phase 3: Execute → tool.execute(params, signal, context)
Phase 4: after_tool_call + tool_result_persist Hooks
```

### 9.3 ToolRegistry

- 管理 builtin + extension 注册的工具
- `getInstance().getAll()` 返回全部可用工具

---

## 10. 安全体系

### 10.1 沙箱

| 模式      | 说明             |
| --------- | ---------------- |
| off       | 无限制           |
| path-only | 路径守卫（默认） |
| docker    | 容器隔离         |

### 10.2 路径守卫

- `resolveSandboxPath()` — 校验路径在 workspace/sandbox 内
- 阻止 `../`、绝对路径逃逸、符号链接穿越
- 应用于：read, write, edit, search, glob, memory

### 10.3 Exec 策略（三级）

```
checkExecPolicy(command):
  1. 黑名单匹配 → deny（rm -rf, sudo, curl|sh 等）
  2. 白名单匹配 → allow（ls, cat, grep, git, npm 等）
  3. 动态学习列表 → allow（approve-always 学习到的命令）
  4. 其他 → ask（需要用户审批）
```

### 10.4 HITL 审批流程

```
LLM 调用工具 → ToolExecutionPipeline
  → tool-approval Extension: before_tool_call
    → exec: checkExecPolicy() → deny/allow/ask
    → needUserConfirm tools: always ask
  → 需要审批:
    → emit hitl:required → 前端显示审批 UI
    → waitForSingleDecision(approvalId, 120s)
    → 用户决策 → hitl.decide → submitSingleDecision()
    → emit hitl:approved / hitl:rejected
    → 继续/阻止执行
```

---

## 11. 前端架构

### 11.1 路由

| 路径      | 视图         | 说明               |
| --------- | ------------ | ------------------ |
| /agent    | AgentView    | 三栏主视图（默认） |
| /logs     | LogViewer    | 日志查看器         |
| /settings | SettingsView | 配置管理           |

### 11.2 Pinia Store 清单

| Store      | 职责                                |
| ---------- | ----------------------------------- |
| chat       | 消息列表、流式状态、队列状态、abort |
| preference | 用户偏好（localStorage）            |
| loading    | 加载状态                            |
| log        | 日志 + 过滤                         |
| window     | 窗口信息                            |
| worker     | Worker 状态                         |

### 11.3 通信方式

| 方式                   | 用途                  |
| ---------------------- | --------------------- |
| WebSocket (Gateway)    | RPC 请求 + 事件推送   |
| IPC (Electron)         | 窗口管理、Tab、对话框 |
| EventBus (In-Renderer) | 组件间通信            |

---

## 12. 测试覆盖

### 12.1 统计

| 维度             | 数量                   |
| ---------------- | ---------------------- |
| 测试文件         | 77 个                  |
| 基础设施相关测试 | 21 个文件 / 319 个用例 |
| 扩展系统测试     | 9 个文件               |
| 运行时测试       | 8 个文件               |
| 工具测试         | 7 个文件               |
| HITL 测试        | 4 个文件               |
| 沙箱测试         | 4 个文件               |

### 12.2 覆盖情况

| 模块             | 覆盖状态                                 |
| ---------------- | ---------------------------------------- |
| Config System    | 完整（schema/loader/diff/watcher）       |
| Provider System  | 完整（registry/selector/fallback/cost）  |
| Message Pipeline | 完整（queue/drain/pipeline 四种模式）    |
| Extension Hooks  | 完整（17 种钩子 + runner + integration） |
| Tool System      | 较好（builtin 工具 + registry）          |
| HITL             | 较好（manager + e2e）                    |
| Sandbox          | 较好（path-guard + context + policy）    |
| Gateway Methods  | 缺失（chat.send / config.\* 无测试）     |
| Exec Policy      | 缺失（无单元测试）                       |

---

## 13. 总结

### 13.1 架构优势

1. **清晰的分层**：Lifecycle → Gateway → AgentExecutor → Runtime，职责明确
2. **强大的扩展性**：17 种钩子覆盖 Agent 全生命周期，Extension 可注入工具/方法/技能
3. **类型安全**：Zod Schema 驱动配置，全量 TypeScript
4. **流式优先**：AsyncGenerator → StreamChunk → EventBus → WebSocket，端到端流式
5. **双运行时**：PiMono + OpenAI Agents SDK，灵活适配不同 LLM SDK
6. **完备的安全链**：Path Guard + Exec Policy + Tool Policy + HITL 审批

### 13.2 当前状态

系统已从"单 Provider + 无排队 + 分散配置"演进到"多 Provider + 四模式管线 + 统一配置"，核心基础设施代码已编写并通过 319 个测试。但新旧系统的**集成接缝**尚未完全缝合——详见 `11-issues-and-next-steps.md`。
