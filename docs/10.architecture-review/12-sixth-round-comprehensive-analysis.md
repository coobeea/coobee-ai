# 12 — 第六轮全面架构分析

> 在 P0/P1/P2 修复完成后，对整个系统的全面复盘
>
> 分析日期：2026-02-16

---

## 0. 分析背景

本轮分析基于以下修复完成后的系统状态：

- ✅ ReadyInfraHook 统一初始化三大基础设施
- ✅ Pipeline executor 接入真实 execute()
- ✅ Extension 工具合并到 Builder
- ✅ exec 工具 ask 兜底保护
- ✅ Security Middleware 速率限制 + 参数校验
- ✅ ConfigStore JSON5 输出

---

## 1. 生命周期与初始化链

### 1.1 Hook 执行顺序

**INIT 阶段**（`app.whenReady()` 之前）：

| 优先级 | Hook             | 关键 | 职责            |
| ------ | ---------------- | ---- | --------------- |
| 10     | InitEnvHook      | 否   | 环境日志        |
| 100    | InitDatabaseHook | 是   | SQLite + DuckDB |

**READY 阶段**（`app.whenReady()` 之后）：

| 优先级 | Hook                          | 关键 | 职责                                     |
| ------ | ----------------------------- | ---- | ---------------------------------------- |
| 35     | ReadyApiRegistrationHook      | 否   | HttpServer + IpcServer                   |
| 45     | ReadyGatewayHook              | 否   | Gateway 启动 → 发现方法组 → 加载 chat.ts |
| 50     | ReadyExtensionHook            | 否   | Extension + ToolRegistry                 |
| 50     | ReadyIpcRegistrationHook      | 是   | IPC handlers                             |
| 55     | **ReadyInfraHook** ✨         | 否   | ConfigStore + ProviderSystem + Pipeline  |
| 80     | ReadyWorkerHook               | 否   | Worker 发现 + 自动启动                   |
| 85     | ReadyMediaPermissionHook      | 否   | 媒体权限                                 |
| 90     | ReadyAppBootstrapHook         | 否   | Tray + Dock 图标                         |
| 400    | ReadyWindowBootstrapHook      | 是   | 主窗口                                   |
| 400    | ReadyShortcutRegistrationHook | 否   | 快捷键                                   |
| 1000   | ReadyEventRegistrationHook    | 是   | 事件处理器                               |

**BEFORE_QUIT 阶段**：

| 优先级 | Hook                   | 关键 | 职责           |
| ------ | ---------------------- | ---- | -------------- |
| 10     | BeforeQuitWorkerHook   | 否   | 停止 Worker    |
| 50     | BeforeQuitProcessHook  | 否   | 清理后台进程   |
| 100    | BeforeQuitDatabaseHook | 否   | 销毁数据库连接 |

### 1.2 关键依赖链

```
ReadyApiRegistrationHook (35) → HttpServer 就绪
    ↓
ReadyGatewayHook (45) → Gateway.start() → discoverMethods() → chat.ts 加载 → setBuilderFactory
    ↓
ReadyExtensionHook (50) → Extension 加载 → ToolRegistry 注入
    ↓
ReadyInfraHook (55) → ConfigStore + ProviderSystem + Pipeline 初始化
    ↓
首次 chat.send → Pipeline → builderFactory(mode) → createBuilder → allTools + providerConfig
```

**优势**：依赖顺序正确，Factory 在 Pipeline 之前注册，Extension 在 Builder 使用之前就绪。

### 1.3 初始化安全性

- ReadyInfraHook `critical: false`，初始化失败不阻止应用启动
- Pipeline 和 Provider 可选：`submitViaPipeline` 返回 `null` 时回退到直接 `submit`
- `applyProviderConfig` 的 try-catch 静默回退到 `.env`

---

## 2. 消息处理全链路

### 2.1 端到端数据流

```
用户输入
  → 前端 chatStore.sendMessage(text)
  → gateway.request('chat.send', { message, sessionId, mode })
  → Gateway RPC → chat.send handler
  → agentExecutor.submitViaPipeline(sid, message, mode)
      → sessionModes.set(sid, mode)
      → pipeline.submit(sid, message)
  → MessagePipeline:
      空闲 → executeWithLifecycle → doExecute → executor(sid, message, signal)
      忙碌 → 按 mode 处理:
          interrupt: abort + 执行新消息
          steer/collect/followup: enqueue + 等待 drain
  → Pipeline executor:
      → builderFactory(mode) → createBuilder(mode)
      → 合并 builtinTools + extensionTools
      → applyProviderConfig(builder)
      → execute({ sessionId, message, builder })
  → AgentExecutor.execute():
      → injectEnv(sessionId, builder)
      → runExtensionHooks: message_received → session_start → before_agent_start
      → builder.build() → AgentRuntime
      → runtime.stream(message) → AsyncGenerator<StreamChunk>
      → consumeAndForward: emitter.forward(chunk) + eventWriter.append + fireChunkHooks
      → runExtensionEndHooks: agent_end → session_end
  → StreamEmitter.forward() → EventBus
  → StreamBridge → gateway.broadcastEventIf('stream.message')
  → WebSocket → 前端 useStreamWs → chatStore.handleStreamMessage()
```

### 2.2 消息管线四模式

| 模式      | 行为                                   |
| --------- | -------------------------------------- |
| followup  | 排队，逐条执行（FIFO）                 |
| steer     | 排队，逐条执行（与 followup 相同）     |
| collect   | 排队，合并为一条 prompt 后执行         |
| interrupt | 中断当前运行，清空队列，立即执行新消息 |

### 2.3 Drain 策略

- **followup/steer/interrupt**: `drainFollowup` — 逐条出队，依次执行
- **collect**: `drainCollect` — `dequeueAll()` → `buildCollectPrompt()` → 单次执行

---

## 3. 配置系统

### 3.1 配置加载管线

```
coobee.json5
  → ConfigLoader.load():
      1. 读取文件
      2. JSON5 解析
      3. ${VAR} 环境变量替换
      4. Zod Schema 校验
      5. 默认值填充（mergeWithDefaults）
      6. 缓存
  → ConfigStore.getAll()
  → ProviderRegistry.loadFromConfig()
  → ModelSelector.updateConfig()
```

### 3.2 配置写入

```
ConfigStore.set(key, value)
  → readRawConfig() (JSON5.parse)
  → raw[key] = value
  → JSON5.stringify(config, null, 2)  ← 修复后使用 JSON5
  → fs.writeFileSync
  → loader.clearCache()
```

### 3.3 热重载链路

```
coobee.json5 变更
  → chokidar 'change'/'add'
  → ConfigWatcher.debounce(300ms)
  → processChange():
      → loader.clearCache() + snapshot()
      → hash 校验（无变化跳过）
      → diffConfigPaths(prev, next)
      → buildReloadPlan(changedPaths)
      → 触发 onReload handlers
  → ReadyInfraHook handler:
      → registry.clear() + loadFromConfig(freshConfig)
      → selector.updateConfig(freshConfig)
  → 下次 chat.send 使用新配置
```

### 3.4 Schema 结构

```
CoobeeConfigSchema
├── models: { providers: Record<string, ProviderConfig> }
├── agents: { defaults: { model }, list: Record<string, AgentEntry> }
├── messages: { queue: QueueSettings }
├── tools: { sandbox, exec }
├── security: { trustedExtensions[], experimental }
├── ui: { theme, language, soundEffects }
└── logging: { level, file }
```

---

## 4. 扩展系统

### 4.1 Extension 生命周期

```
ReadyExtensionHook (50):
  → Env.getExtensionSearchPaths()
  → ExtensionLoader.loadAll(searchPaths)
      → 扫描子目录 → extension.json → jiti.import(entry)
      → mod.register(api)
  → 工具 → ToolRegistry.getInstance().register()
  → Hook → ExtensionRegistry.hooks
  → ExtensionManager.initialize(registry) → ExtensionHookRunner
  → loader.watch() 热插拔
```

### 4.2 17 个扩展钩子

| 钩子                | 模式      | 触发位置           | 消费者        |
| ------------------- | --------- | ------------------ | ------------- |
| message_received    | void      | AgentExecutor      | —             |
| session_start       | void      | AgentExecutor      | tool-approval |
| before_agent_start  | modifying | AgentExecutor      | memory-thread |
| turn_start          | void      | AgentExecutor      | —             |
| turn_end            | void      | AgentExecutor      | —             |
| before_tool_call    | modifying | ToolExecPipeline   | tool-approval |
| after_tool_call     | void      | ToolExecPipeline   | —             |
| tool_result_persist | modifying | ToolExecPipeline   | —             |
| before_compaction   | modifying | OpenAIAgentRuntime | —             |
| after_compaction    | void      | AgentExecutor      | —             |
| agent_end           | void      | AgentExecutor      | memory-thread |
| session_end         | void      | AgentExecutor      | tool-approval |
| message_queued      | void      | MessagePipeline    | —             |
| message_dequeued    | void      | MessagePipeline    | —             |
| queue_drain_start   | void      | MessagePipeline    | —             |
| model_resolved      | void      | ModelSelector      | —             |
| model_fallback      | void      | ModelFallback      | —             |

**所有 17 个钩子在生产代码中都有触发点**。其中 5 个有内置 Extension 消费者，12 个为扩展预留。

### 4.3 工具流转

```
builtinTools (12 个) ──────┐
                           ├→ chat.ts createBuilder() → Map 合并 → allTools → builder.tools()
extensionTools (ToolRegistry) ──┘
    ↓
PiMonoBuilder / OpenAIBuilder
    ↓
SDK 原生格式转换 (PiMonoToolConverter / OpenAI function format)
    ↓
ToolExecutionPipeline (共享):
  Phase 1: before_tool_call Hook
  Phase 2: isToolAllowed (sandbox toolPolicy)
  Phase 3: def.execute()
  Phase 4: after_tool_call + tool_result_persist Hook
```

---

## 5. 安全架构

### 5.1 纵深防御层次

```
Layer 1 — Security Middleware: 速率限制 (120/分) + 参数校验
Layer 2 — exec-policy 黑名单: DANGER_PATTERNS (rm -rf, sudo, eval...)
Layer 3 — exec-policy 白名单: SAFE_BINS (ls, cat, git, npm...)
Layer 4 — exec 工具 ask 兜底: isToolApprovalAvailable() 检查
Layer 5 — ToolExecutionPipeline: before_tool_call Hook → tool-approval Extension
Layer 6 — HITL 用户审批: HitlApprovalManager.waitForSingleDecision()
Layer 7 — 路径守卫: resolveSandboxPath → workspaceRoot 内
Layer 8 — 工具策略: isToolAllowed → sandbox toolPolicy
```

### 5.2 文件工具安全

```
用户请求读/写/编辑文件
  → resolveSandboxPath(path, context)
      → 验证在 workspaceRoot 内
      → 阻止 ../ 穿越
      → 阻止符号链接逃逸
  → pathGuardErrorToToolResult (错误转换)
```

### 5.3 exec 工具安全链

```
exec(command)
  → checkExecPolicy(command)
      → 黑名单匹配 → deny (直接拒绝)
      → 白名单匹配 → allow (放行)
      → 动态 allowlist → allow
      → 未知 → ask
  → ask + 无 tool-approval → EXEC_POLICY_ASK_NO_APPROVAL (拒绝)
  → ask + 有 tool-approval → 继续执行 (由 before_tool_call Hook 处理审批)
```

---

## 6. Provider 系统

### 6.1 模型选择四级优先级

```
1. 会话覆盖: sessionOverrides.get(sessionId)
2. Agent 覆盖: agentOverrides.get(agentId) / config.agents.list[].model
3. 全局默认: config.agents.defaults.model.primary
4. 内置默认: 'openai/gpt-4o'
```

### 6.2 完整的 Provider 链

```
ReadyInfraHook
  → ProviderRegistry.loadFromConfig(config)
  → ModelSelector(config)
  → agentExecutor.setProviderSystem({ registry, selector })

chat.send → createBuilder(mode)
  → applyProviderConfig(builder)
  → selector.resolve() → ModelRef { provider, model }
  → registry.get(ref.provider) → ProviderConfig
  → resolveApiKey(provider.apiKey, provider.id) → API Key
  → builder.fromProviderConfig(provider, ref.model)
```

### 6.3 Fallback 链

- `ModelFallback` 已实现：按候选顺序尝试，可重试错误（429/5xx/超时）自动切换
- 触发 `model_fallback` 钩子
- **当前未接入** `createBuilder` 或 runtime

### 6.4 Cost Tracker

- `CostTracker` 已实现：记录 `UsageRecord`，按模型汇总
- **当前未接入** runtime/executor

---

## 7. 前端架构

### 7.1 路由

| 路径        | 组件             | 说明             |
| ----------- | ---------------- | ---------------- |
| `/`         | → `/agent`       | 重定向           |
| `/agent`    | AgentView.vue    | 三栏布局主视图   |
| `/chat`     | → `/agent`       | 重定向（已废弃） |
| `/logs`     | LogViewer.vue    | 日志查看器       |
| `/settings` | SettingsView.vue | 配置管理         |

### 7.2 AgentView 三栏布局

```
┌──────────┬──────────────────────┬───────────────┐
│ Project  │                      │               │
│ Panel    │   Workbench Panel    │  Chat Panel   │
│ (~250px) │                      │  (~380px)     │
│          │                      │               │
└──────────┴──────────────────────┴───────────────┘
                                  └── VoicePanel (底部)
```

### 7.3 Pinia Stores

| Store      | 核心状态                                     |
| ---------- | -------------------------------------------- |
| chat       | messages, isStreaming, isQueued, queueStatus |
| worker     | worker 状态（TTS 等）                        |
| preference | 用户偏好（localStorage）                     |
| loading    | 加载状态                                     |
| window     | 窗口状态                                     |
| log        | 日志状态                                     |

### 7.4 通信协议

```
前端 GatewayClient ←→ WebSocket ←→ 主进程 Gateway
  RPC: { type: 'req', id, method, params }
     → { type: 'res', id, ok, payload/error }
  Event: { type: 'event', event, payload }
```

---

## 8. 测试覆盖

### 8.1 总体数据

| 指标     | 数值      |
| -------- | --------- |
| 测试文件 | 82 个     |
| 测试用例 | ~1,250 个 |
| 单元测试 | ~90%      |
| 集成测试 | ~9%       |
| E2E 测试 | ~1%       |

### 8.2 覆盖强度

| 模块           | 覆盖评估 | 说明                                    |
| -------------- | -------- | --------------------------------------- |
| AI 工具        | ★★★★★    | 12 个工具全部有测试，含安全测试         |
| AI 沙箱        | ★★★★★    | path-guard, exec-policy, tool-policy    |
| Extension 系统 | ★★★★★    | Registry, Loader, HookRunner, Api, 集成 |
| Pipeline       | ★★★★☆    | Pipeline, Queue, DrainStrategy          |
| Provider       | ★★★★☆    | Registry, Selector, Fallback, Cost, Key |
| Config 系统    | ★★★★☆    | Loader, Watcher, Diff, Schema           |
| HITL           | ★★★★☆    | ApprovalManager, E2E                    |
| Runtime        | ★★★☆☆    | Builder, Runtime 基础，缺 Compressor    |
| Streaming      | ★★★☆☆    | Emitter, Monitor, Store                 |
| Gateway        | ★★☆☆☆    | Gateway 基础，方法组无测试              |
| Lifecycle      | ★★☆☆☆    | 13 个 Hook 仅 3 个有测试                |
| 前端           | ☆☆☆☆☆    | 无前端测试                              |
| 通用模块       | ★☆☆☆☆    | 大量 common 模块无测试                  |

---

## 9. 架构优势总结

1. **生命周期管理清晰**：Hook 系统分层明确，优先级驱动，同级并行
2. **基础设施已接入**：ConfigStore + Provider + Pipeline 通过 ReadyInfraHook 统一初始化
3. **扩展性强**：17 个钩子覆盖完整生命周期，modifying/void 双模式
4. **安全纵深**：8 层防御，从 Middleware 到 HITL 审批
5. **类型安全**：Zod Schema + TypeScript 全链路类型
6. **热重载**：配置变更自动生效，无需重启
7. **流式架构**：AsyncGenerator → StreamEmitter → EventBus → WebSocket 一气呵成
8. **Builder 模式统一**：PiMono/OpenAI 双 Runtime，共享 ToolExecutionPipeline
