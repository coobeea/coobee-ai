# OpenClaw 与 Coobee-AI 架构对比分析

> 基于 OpenClaw 三篇核心文档（Gateway 钩子系统、统一外部对接、插件系统与 Agent 扩展）的深度研究，结合 coobee-ai 当前架构，提炼出可借鉴的设计理念和具体改进方向。

---

## 目录

1. [OpenClaw 核心设计理念提炼](#1-openclaw-核心设计理念提炼)
2. [Coobee-AI 现有架构概览](#2-coobee-ai-现有架构概览)
3. [逐维度对比分析](#3-逐维度对比分析)
4. [重点改进方向](#4-重点改进方向)
5. [改进优先级与路线图](#5-改进优先级与路线图)

---

## 1. OpenClaw 核心设计理念提炼

### 1.1 Gateway 钩子系统（05-gateway-hook-system-deep-dive）

OpenClaw 的 Gateway 钩子系统的核心是 **"在消息处理的完整链路上，提供可插拔的拦截/旁听点"**。

**7 个钩子覆盖消息全生命周期**：

```
消息进入 → message_received（旁听）
  → 命令解析 → command:* (Internal Hook)
  → Agent 开始 → before_agent_start（拦截：注入上下文）
  → 工具调用 → before_tool_call（拦截：修改参数/阻止）
  → 结果持久化 → tool_result_persist（拦截：裁剪结果）
  → Agent 完成 → agent_end（旁听）
  → 消息发送 → message_sending（拦截：修改/取消）
```

**关键设计决策**：

| 设计点       | 做法                                        | 原因                                         |
| ------------ | ------------------------------------------- | -------------------------------------------- |
| 两种钩子类型 | Void（旁听，并行）/ Modifying（拦截，顺序） | 旁听不阻塞主流程；拦截需要确定顺序和合并策略 |
| 优先级机制   | priority 数值越大越先执行                   | 多插件共存时确定执行顺序                     |
| 容错哲学     | 任何钩子出错都不阻断 Agent                  | 插件 bug 不能让 Agent 瘫痪                   |
| 全局单例     | `getGlobalHookRunner()` 任意位置可调用      | 不需要在函数参数中传递 HookRunner            |
| 合并策略     | prependContext 拼接，systemPrompt 后覆盖前  | 多个插件的输出可以共存                       |

### 1.2 统一外部对接（06-gateway-external-interface）

OpenClaw 的 Gateway 是 **"单进程多协议服务器"**，核心理念是 **消息来源无关性**。

**三种入口最终汇聚到同一条处理路径**：

```
WebSocket RPC（智能客户端）─┐
HTTP REST（Webhook/API）───┼── 归一化 → dispatchReplyFromConfig → Agent 核心
消息渠道（IM 平台）────────┘
```

**关键设计决策**：

| 设计点          | 做法                                       | 原因                       |
| --------------- | ------------------------------------------ | -------------------------- |
| 统一端口        | 一个端口服务 WS + HTTP                     | 简化部署和配置             |
| 消息归一化      | `FinalizedMsgContext` 统一字段             | 不管来源如何，后续处理一致 |
| RPC 方法分组    | 80+ 方法按功能分组注册                     | 清晰的职责划分，插件可扩展 |
| 认证分层        | 本地直连/Token/Password/Tailscale/设备配对 | 不同场景不同方案           |
| 权限模型        | role + scopes                              | 细粒度控制访问能力         |
| HTTP 路由优先级 | Webhook > 插件 > API > 静态资源            | 确保外部回调优先处理       |

### 1.3 插件系统与 Agent 扩展（07-plugin-system-agent-extension）

OpenClaw 插件系统的核心是 **"统一的 `OpenClawPluginApi` 接口，覆盖三个扩展层面"**。

**10+ 种扩展能力**：

| 层面           | 能力                                        | API                                                                                    |
| -------------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Agent 层**   | 工具、生命周期钩子、Internal Hook、聊天命令 | `registerTool`, `api.on`, `registerHook`, `registerCommand`                            |
| **Gateway 层** | 消息渠道、RPC 方法、HTTP 路由、HTTP 中间件  | `registerChannel`, `registerGatewayMethod`, `registerHttpRoute`, `registerHttpHandler` |
| **系统层**     | 后台服务、AI 提供商、CLI 命令               | `registerService`, `registerProvider`, `registerCli`                                   |

**关键设计决策**：

| 设计点     | 做法                                        | 原因                   |
| ---------- | ------------------------------------------- | ---------------------- |
| 同步注册   | `register(api)` 必须同步                    | 确保启动顺序确定性     |
| 发现机制   | 多目录搜索（配置/工作区/全局/内置）+ 优先级 | 灵活的插件来源         |
| 清单驱动   | `openclaw.plugin.json` 声明元数据           | 加载前就能知道插件信息 |
| 方法名保护 | 插件不能覆盖核心方法                        | 安全性                 |
| 配置验证   | JSON Schema 校验                            | 加载前验证配置合法性   |
| 运行时 API | `PluginRuntime` 封装系统能力                | 插件不直接依赖内部模块 |

---

## 2. Coobee-AI 现有架构概览

### 2.1 生命周期系统

Coobee-AI 使用 `LifecycleManager` 管理应用生命周期，分三个阶段：

```
INIT（app.whenReady 前）
  ├── InitEnvHook (priority: 10) — 环境变量
  └── InitDatabaseHook (priority: 20) — 数据库

READY（app.whenReady 后）
  ├── ReadyApiRegistrationHook (priority: 35) — HTTP 服务器
  ├── ReadyWsHubHook (priority: 40) — WebSocket 消息总线
  ├── ReadyIpcRegistrationHook (priority: 45) — IPC
  ├── ReadyEventRegistrationHook (priority: 50) — 事件注册
  ├── ReadyWindowBootstrapHook (priority: 60) — 窗口
  ├── ReadyRuntimeHook (priority: 70) — Worker 运行时
  ├── ReadyShortcutRegistrationHook (priority: 75) — 快捷键
  ├── ReadyMediaPermissionHook (priority: 85) — 媒体权限
  └── ReadyAppBootstrapHook (priority: 90) — 应用引导

BEFORE_QUIT
  ├── BeforeQuitDatabaseHook — 数据库清理
  └── BeforeQuitRuntimeHook — 运行时清理
```

**特点**：

- 基于约定的自动扫描（`@main/lifecycle/**/*Hook.ts`）
- 按优先级排序，同优先级并行执行
- 区分 critical / non-critical hook
- Hook 只关注应用层面的启动/关闭，**不涉及 Agent 执行流程**

### 2.2 Agent 执行流程

```
API 端点（chat/chatStream）
  │
  ▼
AgentExecutor
  ├── 并发控制（busySessions 锁）
  ├── injectEnv（工作空间、Skill、运行时路径）
  ├── Builder.build() → Runtime 创建 + 初始化
  ├── runtime.stream(message)
  │   ├── StreamChunk → emitter.forward() → EventBus
  │   ├── StreamChunk → events.jsonl 持久化
  │   └── StreamChunk → yield（SSE 消费者）
  ├── HITL 循环（中断 → 等待决策 → 恢复）
  └── runtime.destroy()
```

**特点**：

- 无状态生命周期：每次请求 创建 → 推理 → 销毁
- Builder 模式配置 Agent（工具、Skill、指令等）
- 没有 Agent 执行层面的钩子（before_agent_start / agent_end 等）
- HITL 通过 Promise 等待模式实现

### 2.3 通信架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Main Process                             │
│                                                              │
│  ┌──────────────┐  ┌──────────┐  ┌─────────────────────┐   │
│  │  HttpServer   │  │ WsHub    │  │ IpcServer            │   │
│  │  (Koa, REST)  │  │ (WS消息) │  │ (Electron IPC)       │   │
│  │  port: 8765   │  │ 共享端口  │  │ main ↔ renderer     │   │
│  └──────┬───────┘  └────┬─────┘  └──────────┬──────────┘   │
│         │               │                    │               │
│         │    ┌──────────┴──────────┐        │               │
│         │    │     Channels        │        │               │
│         │    │  ┌─────────────┐    │        │               │
│         │    │  │StreamChannel│    │        │               │
│         │    │  │WorkerChannel│    │        │               │
│         │    │  └─────────────┘    │        │               │
│         │    └─────────────────────┘        │               │
│         │                                    │               │
│    ┌────┴────────────────────────────────────┴──────┐       │
│    │              EventBus                           │       │
│    │  stream:message, stream:start, stream:end, ...  │       │
│    └─────────────────────────────────────────────────┘       │
│                                                              │
│    ┌──────────────────────────────────────────────────┐     │
│    │           AgentExecutor (单例)                    │     │
│    │  ├── PiMonoBuilder / OpenAIBuilder               │     │
│    │  ├── Runtime 创建 → 推理 → 销毁                  │     │
│    │  ├── StreamEmitter → EventBus                    │     │
│    │  └── HITL 审批管理                               │     │
│    └──────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### 2.4 模块发现机制

Coobee-AI 使用 **约定式目录扫描**：

| 模块类型      | 目录                  | 命名约定            |
| ------------- | --------------------- | ------------------- |
| 生命周期 Hook | `src/main/lifecycle/` | `*Hook.ts`          |
| API 路由      | `src/main/api/`       | 文件路径 → 路由路径 |
| WS Channel    | `src/main/channels/`  | `*Channel.ts`       |
| 事件处理器    | `src/main/events/`    | `*Changed.ts`       |

---

## 3. 逐维度对比分析

### 3.1 Agent 执行钩子系统

| 维度           | OpenClaw                                          | Coobee-AI                    | 差距分析                              |
| -------------- | ------------------------------------------------- | ---------------------------- | ------------------------------------- |
| Agent 开始前   | `before_agent_start` — 注入上下文、替换系统提示词 | 无 — Builder 硬编码指令      | **高优先级**：无法动态注入记忆/上下文 |
| 工具调用前     | `before_tool_call` — 修改参数、阻止执行           | 无 — 工具直接执行            | **中优先级**：无安全审计/参数修改能力 |
| 工具结果持久化 | `tool_result_persist` — 裁剪/修改结果             | 无 — 原样记录到 events.jsonl | **低优先级**：当前会话数据量可控      |
| Agent 完成后   | `agent_end` — 分析/统计/存记忆                    | 无 — 只有日志                | **高优先级**：无法自动提取和存储记忆  |
| 消息发送前     | `message_sending` — 修改/取消/过滤                | 无 — 直接发送                | **中优先级**：无内容安全过滤          |
| 消息接收后     | `message_received` — 记录/统计                    | 仅 EventBus 日志             | **低优先级**：现有日志够用            |

**核心差距**：Coobee-AI 的 Agent 执行是一个"黑盒"流水线，没有任何扩展点让外部模块在执行过程中插入逻辑。这意味着**记忆注入、安全审计、结果压缩、对话分析**等能力无法以解耦的方式实现。

### 3.2 插件/扩展体系

| 维度          | OpenClaw                 | Coobee-AI              | 差距分析         |
| ------------- | ------------------------ | ---------------------- | ---------------- |
| 扩展发现      | 多目录搜索 + 清单驱动    | 固定目录 + 约定扫描    | 不支持外部插件   |
| 扩展注册      | 统一 `OpenClawPluginApi` | 放文件即注册           | 无注册 API       |
| 扩展配置      | 每插件 JSON Schema       | 无                     | 无独立配置       |
| 扩展隔离      | 各插件独立命名空间       | 共享进程/模块          | 无隔离           |
| 工具扩展      | `registerTool()`         | Builder.tools() 硬编码 | 不支持动态工具   |
| 渠道扩展      | `registerChannel()`      | 放文件到 channels/     | 类似但无 SDK     |
| HTTP 路由扩展 | `registerHttpRoute()`    | 放文件到 api/          | 类似但无动态注册 |
| 后台服务      | `registerService()`      | RuntimeManager 硬编码  | 不支持动态服务   |

**核心差距**：Coobee-AI 没有插件系统。所有扩展都需要修改核心代码。虽然约定式扫描提供了一定的模块化，但无法支持"不修改核心代码即可扩展"的场景。

### 3.3 外部对接能力

| 维度            | OpenClaw                     | Coobee-AI            | 差距分析         |
| --------------- | ---------------------------- | -------------------- | ---------------- |
| 协议支持        | WS RPC + HTTP REST + IM 渠道 | HTTP + WS + IPC      | 作为桌面应用够用 |
| 认证机制        | 5 种认证方式                 | 无（本地应用）       | 暂不需要         |
| 权限模型        | role + scopes                | 无                   | 暂不需要         |
| 消息归一化      | FinalizedMsgContext          | 无统一消息格式       | **值得借鉴**     |
| WS RPC          | 结构化 req/res/event + 握手  | 简单的 prefix:action | **可渐进增强**   |
| Webhook         | 支持外部 HTTP 回调           | 不支持               | 未来需要时添加   |
| OpenAI 兼容 API | 完整支持                     | 不支持               | 可作为长期目标   |

**核心差距**：作为 Electron 桌面应用，coobee-ai 的外部对接需求与 OpenClaw（服务器端 Gateway）有本质不同。认证、权限、多渠道目前不是刚需。但 **消息归一化** 和 **结构化 RPC** 的理念值得借鉴。

### 3.4 EventBus vs Hook 系统

| 维度     | OpenClaw Plugin Typed Hooks          | Coobee-AI EventBus        |
| -------- | ------------------------------------ | ------------------------- |
| 类型安全 | 14 种强类型钩子                      | 字符串事件名              |
| 返回值   | 支持（拦截型钩子通过返回值修改行为） | 不支持（fire-and-forget） |
| 执行顺序 | 拦截型有优先级排序                   | 无                        |
| 合并策略 | 有明确的合并规则                     | 无                        |
| 容错     | 每个 handler 独立 try-catch          | 无                        |
| 场景     | Agent 执行全生命周期                 | 应用级事件通知            |

**核心差距**：EventBus 只适合"通知"场景（A 发生了什么事），不适合"拦截"场景（A 即将发生，我要修改/阻止它）。Agent 执行过程中的很多扩展需求（注入上下文、审计工具调用、过滤输出）都是"拦截"场景。

---

## 4. 重点改进方向

### 4.1 🔴 P0 — Agent 执行钩子（AgentHooks）

**目标**：在 Agent 执行的关键节点提供扩展点，让模块可以注入上下文、审计工具调用、分析执行结果。

**设计方案**：

```typescript
// src/main/ai/hooks/types.ts

/** Agent 钩子类型 */
type AgentHookName =
  | 'before_agent_start' // Agent 开始前 — 修改型
  | 'before_tool_call' // 工具调用前 — 修改型
  | 'after_tool_call' // 工具调用后 — 旁听型
  | 'agent_end' // Agent 完成后 — 旁听型
  | 'message_sending' // 消息发送前 — 修改型

/** 旁听型钩子：不能修改，只能观察 */
interface VoidHookHandler<E, C> {
  (event: E, ctx: C): void | Promise<void>
}

/** 拦截型钩子：通过返回值修改行为 */
interface ModifyingHookHandler<E, C, R> {
  (event: E, ctx: C): R | undefined | Promise<R | undefined>
}

/** 钩子注册选项 */
interface HookOptions {
  priority?: number // 数字越大越先执行（默认 0）
  id?: string // 标识（用于日志/调试）
}
```

**before_agent_start 示例**：

```typescript
// 记忆模块注册钩子
agentHooks.on(
  'before_agent_start',
  async (event, ctx) => {
    // event: { prompt, messages, builder }
    // ctx: { sessionId, workspace }
    const memories = await vectorDB.search(event.prompt, { limit: 5 })
    if (memories.length > 0) {
      return {
        prependContext: `相关历史记忆:\n${memories.map((m) => `- ${m.text}`).join('\n')}`
      }
    }
  },
  { priority: 100, id: 'memory-inject' }
)
```

**在 AgentExecutor 中的集成点**：

```typescript
// AgentExecutor.execute() 改造后
private async execute(request: ExecuteRequest): Promise<ExecutionResult> {
  // ... 环境注入 ...

  // ★ 钩子 1: before_agent_start
  const hookResult = await agentHooks.run('before_agent_start', {
    prompt: message,
    builder,
    sessionId,
  }, { sessionId, workspace })

  if (hookResult?.prependContext) {
    builder.appendInstructions(hookResult.prependContext)
  }

  // ... 创建 Runtime, stream ...

  // ★ 钩子 2: agent_end
  void agentHooks.run('agent_end', {
    sessionId,
    success: !result.error,
    durationMs: Date.now() - startTime,
    output: result.output,
  }, { sessionId, workspace })

  return result
}
```

**实现要点**：

- 参考 OpenClaw 的 `createHookRunner` + Void/Modifying 两种模式
- 容错：任何 handler 出错不阻断 Agent 执行
- 全局单例：`getAgentHookRunner()` 任意位置可调用
- 通过 EventBus 或 Hook 目录扫描自动发现 handler

### 4.2 🟡 P1 — 工具注册 API

**目标**：让模块（未来的插件）可以动态注册工具，而不是在 API 层硬编码 Builder.tools()。

**当前问题**：

```typescript
// 当前：API 层硬编码
function createChatBuilder() {
  return agentExecutor.piMono()
    .name('chat-agent')
    .instructions(CHAT_INSTRUCTIONS)
    .tools([...])  // 硬编码工具列表
}
```

**改进方案**：

```typescript
// src/main/ai/tools/ToolRegistry.ts

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()

  /** 注册工具 */
  register(tool: ToolDefinition): void
  /** 注册工厂工具（根据上下文动态创建） */
  registerFactory(factory: (ctx: ToolContext) => ToolDefinition | null): void
  /** 获取所有工具（Builder 调用） */
  getTools(ctx?: ToolContext): ToolDefinition[]
}

export const toolRegistry = new ToolRegistry()

// 各模块自注册
// src/main/tools/searchTool.ts
toolRegistry.register({
  name: 'web_search',
  description: '搜索网页',
  parameters: { ... },
  execute: async (params) => { ... }
})

// Builder 自动加载
function createChatBuilder() {
  return agentExecutor.piMono()
    .name('chat-agent')
    .instructions(CHAT_INSTRUCTIONS)
    .tools(toolRegistry.getTools())  // 动态获取
}
```

**好处**：

- 工具定义与 API 层解耦
- 支持模块化注册（每个工具一个文件）
- 为未来插件系统做铺垫

### 4.3 🟡 P1 — 结构化 WS RPC 协议

**目标**：将当前简单的 `prefix:action` 消息格式升级为结构化的 RPC 协议，支持请求-响应和错误处理。

**当前问题**：

```typescript
// 当前：简单的 type + data
{ type: 'worker:start', workerName: 'whisper-asr' }

// 无法：
// - 追踪请求和响应的对应关系
// - 返回结构化错误
// - 等待服务端确认
```

**改进方案**（渐进式，兼容现有协议）：

```typescript
// 新增 RPC 消息格式（与现有格式共存）
interface WsRpcRequest {
  type: 'rpc:req'
  id: string // 请求 ID
  method: string // 如 'worker.start'
  params?: unknown // 参数
}

interface WsRpcResponse {
  type: 'rpc:res'
  id: string // 对应的请求 ID
  ok: boolean
  payload?: unknown // 成功时的数据
  error?: { code: number; message: string } // 错误时的信息
}

interface WsRpcEvent {
  type: 'rpc:event'
  event: string // 如 'worker.status_changed'
  payload: unknown
}
```

**好处**：

- 客户端可以 `await` 一个 RPC 调用的结果
- 错误处理更清晰
- 为插件注册自定义 RPC 方法做铺垫

### 4.4 🟢 P2 — 消息归一化层

**目标**：借鉴 OpenClaw 的 `FinalizedMsgContext`，为进入 Agent 的消息建立统一格式。

**当前问题**：

- API 路由直接将参数传给 AgentExecutor
- 不同入口（HTTP POST / SSE / IPC）的参数格式可能不一致
- 没有统一的消息元数据（来源、发送者、时间戳）

**改进方案**：

```typescript
// src/main/ai/common/AgentMessage.ts

interface AgentMessageContext {
  /** 消息内容 */
  content: string
  /** 会话 ID */
  sessionId: string
  /** 消息来源 */
  source: 'http' | 'sse' | 'ipc' | 'ws' | 'webhook'
  /** 发送者标识 */
  senderId?: string
  /** 时间戳 */
  timestamp: number
  /** 附件（图片、文件等） */
  attachments?: MessageAttachment[]
  /** 元数据（扩展字段） */
  metadata?: Record<string, unknown>
}
```

**好处**：

- 统一处理入口，便于日志和审计
- 钩子系统可以基于统一格式做拦截
- 为未来多渠道入口做准备

### 4.5 🟢 P2 — 插件系统基础框架

**目标**：建立轻量级的插件发现和注册机制，让未来的扩展可以以"插件"形式存在。

**阶段性方案**（不一步到位，先建骨架）：

```
Phase 1: 约定式插件目录 + 简单 API
  - plugins/ 目录（或 extensions/）
  - 每个插件一个子目录 + index.ts + manifest.json
  - 提供 PluginApi: registerTool, on(hookName), registerService

Phase 2: 钩子集成
  - 插件通过 api.on() 注册 Agent 生命周期钩子
  - 插件通过 api.registerTool() 注册工具

Phase 3: 完整隔离
  - 插件配置验证
  - 插件生命周期管理（start/stop）
  - 插件 SDK 独立包
```

**Phase 1 最小实现**：

```typescript
// src/main/plugins/types.ts
interface CoobeePlugin {
  id: string
  name: string
  register(api: PluginApi): void
}

interface PluginApi {
  /** 注册 Agent 工具 */
  registerTool(tool: ToolDefinition): void
  /** 注册 Agent 生命周期钩子 */
  on(hookName: AgentHookName, handler: Function, opts?: HookOptions): void
  /** 注册后台服务 */
  registerService(service: PluginService): void
  /** 日志 */
  logger: PluginLogger
}
```

### 4.6 🟢 P2 — before_tool_call 安全审计

**目标**：在工具执行前增加拦截层，支持安全策略检查和参数审计。

**与 HITL 的关系**（参考 OpenClaw 设计）：

```
大模型决定调用工具
  │
  ▼
before_tool_call 钩子 → 插件/策略可修改参数或阻止
  │
  ▼ (如果没被阻止)
工具内部逻辑
  ├── 检查安全策略
  ├── 需要审批 → HITL 流程
  ├── 审批通过 → 实际执行
  └── 返回结果
```

**好处**：

- before_tool_call 是编程式的自动化检查（规则引擎）
- HITL 是人工审批
- 两者互补：自动化先过滤，人工处理复杂场景

---

## 5. 改进优先级与路线图

### 优先级矩阵

| 改进项           | 优先级 | 影响范围                 | 工作量 | 依赖关系 |
| ---------------- | ------ | ------------------------ | ------ | -------- |
| Agent 执行钩子   | 🔴 P0  | 核心（记忆、安全、分析） | 中     | 无       |
| 工具注册 API     | 🟡 P1  | Agent 层                 | 小     | 无       |
| 结构化 WS RPC    | 🟡 P1  | 前后端通信               | 中     | 无       |
| 消息归一化       | 🟢 P2  | Agent 入口               | 小     | P0       |
| 插件系统框架     | 🟢 P2  | 全局                     | 大     | P0 + P1  |
| before_tool_call | 🟢 P2  | Agent 安全               | 中     | P0       |

### 建议路线图

```
Phase 1（近期）— 建立 Agent 扩展基础
  ├── 实现 AgentHooks（before_agent_start + agent_end）
  ├── 实现 ToolRegistry（动态工具注册）
  └── 修改 AgentExecutor 集成钩子

Phase 2（中期）— 增强通信和安全
  ├── WS RPC 协议升级
  ├── 消息归一化层
  ├── before_tool_call 钩子
  └── 完善 after_tool_call + message_sending

Phase 3（远期）— 插件生态
  ├── 插件发现 + 加载框架
  ├── PluginApi 设计与实现
  ├── 插件 SDK
  └── 示例插件（记忆、安全审计）
```

---

## 附录：OpenClaw 设计中值得直接借鉴的细节

### A. 容错哲学

```typescript
// 所有钩子执行都包裹在 try-catch 中
try {
  const result = await handler(event, ctx)
  // ...
} catch (err) {
  log.warn(`hook failed: ${hookName}, error=${String(err)}`)
}
// 出错 → 默认行为（放行/跳过），不阻断 Agent
```

**原则：一个扩展模块的 bug 不能让 Agent 停止工作。**

### B. 工具包装模式

OpenClaw 通过"包装"原有工具的 `execute` 函数来注入 before_tool_call 钩子，而不是修改工具本身：

```typescript
function wrapToolWithHook(tool, ctx) {
  const originalExecute = tool.execute
  return {
    ...tool,
    execute: async (params) => {
      const outcome = await runBeforeToolCallHook({ toolName: tool.name, params, ctx })
      if (outcome.blocked) throw new Error(outcome.reason)
      return originalExecute(outcome.params) // 可能被修改过的参数
    }
  }
}
```

这种装饰器模式非常优雅，可以直接借鉴。

### C. 两套钩子系统共存

OpenClaw 有 Internal Hooks（老式，字符串键匹配）和 Plugin Typed Hooks（新式，强类型）共存。我们可以从一开始就只用一套（Typed Hooks），避免历史包袱。

### D. HookRunner 全局单例

```typescript
// 任意文件中即可使用
const hookRunner = getAgentHookRunner()
if (hookRunner?.hasHooks('before_agent_start')) {
  const result = await hookRunner.runBeforeAgentStart(event, ctx)
}
```

快速路径：没有注册钩子时直接跳过，零开销。

### E. 同步钩子的防御

OpenClaw 的 `tool_result_persist` 是同步钩子，如果 handler 意外返回 Promise，会检测并忽略：

```typescript
if (out && typeof (out as any).then === 'function') {
  logger?.warn('handler returned Promise; this hook is synchronous')
  continue
}
```

这种防御性编程值得借鉴。

---

> **总结**：OpenClaw 的最核心设计理念可以用三句话概括：(1) **Agent 执行链路上的每个关键节点都应该有扩展点**；(2) **扩展模块的故障不应影响核心流程**；(3) **统一的 API 让扩展覆盖多个层面**。Coobee-AI 当前最大的差距在于 Agent 执行流程缺乏钩子系统，这限制了记忆注入、安全审计、对话分析等高级能力的实现。建议从 **Agent 执行钩子 + 工具注册 API** 开始，逐步构建扩展基础设施。
