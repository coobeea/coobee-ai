# OpenClaw 插件系统与 Agent 扩展设计

> 插件系统让外部开发者在 **不修改 OpenClaw 核心代码** 的前提下，扩展 Agent 的能力和行为。本文档从"插件能做什么"出发，解析插件的发现、加载、注册机制，以及它如何通过钩子系统在 Agent 执行的各个阶段插入自定义逻辑。

---

## 目录

1. [插件能做什么 — 一个完整例子](#1-插件能做什么--一个完整例子)
2. [插件的 10 种扩展能力](#2-插件的-10-种扩展能力)
3. [插件的发现机制](#3-插件的发现机制)
4. [插件的加载流程](#4-插件的加载流程)
5. [插件 API (OpenClawPluginApi)](#5-插件-api-openclawpluginapi)
6. [钩子系统 — 在 Agent 执行中插入逻辑](#6-钩子系统--在-agent-执行中插入逻辑)
7. [工具扩展 — 给 Agent 添加新能力](#7-工具扩展--给-agent-添加新能力)
8. [渠道扩展 — 对接新的 IM 平台](#8-渠道扩展--对接新的-im-平台)
9. [Gateway 方法扩展 — 自定义 RPC 接口](#9-gateway-方法扩展--自定义-rpc-接口)
10. [命令扩展 — 自定义聊天命令](#10-命令扩展--自定义聊天命令)
11. [服务扩展 — 后台长运行任务](#11-服务扩展--后台长运行任务)
12. [真实插件案例分析](#12-真实插件案例分析)
13. [插件 SDK](#13-插件-sdk)
14. [关键代码索引](#14-关键代码索引)

---

## 1. 插件能做什么 — 一个完整例子

先看一个真实的插件 `memory-lancedb`（长期记忆插件），它做了以下事情：

```typescript
// extensions/memory-lancedb/index.ts（简化版）
const memoryPlugin = {
  id: "memory-lancedb",
  name: "Memory (LanceDB)",
  kind: "memory",
  configSchema: memoryConfigSchema,

  register(api: OpenClawPluginApi) {
    const cfg = memoryConfigSchema.parse(api.pluginConfig);

    // ① 给 Agent 添加 3 个新工具
    api.registerTool({ name: "memory_recall", ... });   // Agent 可以搜索记忆
    api.registerTool({ name: "memory_store", ... });    // Agent 可以存储记忆
    api.registerTool({ name: "memory_forget", ... });   // Agent 可以删除记忆

    // ② 在 Agent 思考前自动注入相关记忆
    api.on("before_agent_start", async (event) => {
      const memories = await vectorDB.search(event.prompt);
      if (memories.length > 0) {
        return {
          prependContext: `相关记忆:\n${memories.map(m => `- ${m.text}`).join("\n")}`,
        };
      }
    });

    // ③ 在 Agent 执行完后自动提取并存储新记忆
    api.on("agent_end", async (event) => {
      if (event.success) {
        await extractAndStoreMemories(event.messages);
      }
    });

    // ④ 注册 CLI 命令（openclaw ltm list/search/stats）
    api.registerCli(({ program }) => {
      program.command("ltm").description("长期记忆管理").addCommand(...)
    }, { commands: ["ltm"] });

    // ⑤ 注册后台服务（定期清理过期记忆）
    api.registerService({
      id: "memory-lancedb",
      start: () => { /* 启动清理定时器 */ },
      stop: () => { /* 停止 */ },
    });
  },
};
```

一个插件可以同时扩展 **Agent 的能力（工具）**、**Agent 的行为（钩子）**、**CLI 的命令**、**后台服务** 等多个方面。

---

## 2. 插件的 10 种扩展能力

| #   | 扩展方式             | API 方法                  | 扩展的层面 | 具体作用                                |
| --- | -------------------- | ------------------------- | ---------- | --------------------------------------- |
| 1   | **工具**             | `registerTool()`          | Agent 层   | 给 Agent 添加新能力（搜索、API 调用等） |
| 2   | **生命周期钩子**     | `api.on()`                | Agent 层   | 在 Agent 执行各阶段插入逻辑             |
| 3   | **Internal Hook**    | `registerHook()`          | Agent 层   | 在命令处理/bootstrap 阶段插入逻辑       |
| 4   | **聊天命令**         | `registerCommand()`       | Agent 层   | 用户可用 /命令 直接触发，不经过 Agent   |
| 5   | **消息渠道**         | `registerChannel()`       | Gateway 层 | 对接新的 IM 平台（Matrix、MS Teams 等） |
| 6   | **Gateway RPC 方法** | `registerGatewayMethod()` | Gateway 层 | 给客户端（Web UI）提供新的 RPC 接口     |
| 7   | **HTTP 路由**        | `registerHttpRoute()`     | Gateway 层 | 给外部系统提供新的 HTTP 端点            |
| 8   | **HTTP 中间件**      | `registerHttpHandler()`   | Gateway 层 | 全局 HTTP 请求拦截                      |
| 9   | **后台服务**         | `registerService()`       | 系统层     | 长运行的后台任务                        |
| 10  | **AI 提供商**        | `registerProvider()`      | 系统层     | 对接新的 LLM 提供商                     |
| 11  | **CLI 命令**         | `registerCli()`           | 系统层     | 扩展 `openclaw` CLI 命令                |

可以看到，插件的扩展能力覆盖三个层面：

- **Agent 层**（1-4）：改变 Agent "怎么想、怎么做"
- **Gateway 层**（5-8）：改变"消息怎么进来出去"
- **系统层**（9-11）：改变"后台运行什么"

---

## 3. 插件的发现机制

Gateway 启动时，会在以下目录中按优先级搜索插件：

```
搜索顺序（高优先级 → 低优先级）：

1. 配置文件指定的路径（plugins.loadPaths）
   └── 最高优先级，用户显式指定

2. 工作区目录/.openclaw/extensions/
   └── 项目级插件

3. ~/.openclaw/extensions/
   └── 全局用户插件

4. OpenClaw 安装目录/extensions/
   └── 内置插件（Matrix, MS Teams, Zalo, 语音通话 等）
```

**发现规则**：

- 如果是目录：找 `package.json` 中的 `openclaw.extensions` 字段，或者找 `index.ts` / `index.js`
- 如果是文件：直接作为插件入口
- 每个插件必须有 `openclaw.plugin.json` 清单文件

```typescript
// src/plugins/discovery.ts — 搜索结果
type PluginCandidate = {
  idHint: string // 从 package.json 推断的 ID
  source: string // 入口文件的绝对路径
  rootDir: string // 插件根目录
  origin: 'bundled' | 'global' | 'workspace' | 'config'
  packageName?: string
  packageVersion?: string
}
```

---

## 4. 插件的加载流程

`loadOpenClawPlugins()` 是插件加载的核心函数：

```
loadOpenClawPlugins()
  │
  ├── 1. 规范化配置
  │    normalizePluginsConfig(cfg.plugins)
  │    → 得到每个插件的启用/禁用状态和配置
  │
  ├── 2. 插件发现
  │    discoverOpenClawPlugins({ workspaceDir, extraPaths })
  │    → 扫描目录，得到 PluginCandidate[]
  │
  ├── 3. 清单加载
  │    loadPluginManifestRegistry({ candidates })
  │    → 读取每个插件的 openclaw.plugin.json
  │    → 验证 id 和 configSchema
  │
  ├── 4. 创建注册中心
  │    createPluginRegistry({ logger, runtime, coreGatewayHandlers })
  │    → 空的 PluginRegistry { tools: [], hooks: [], channels: [], ... }
  │
  ├── 5. 逐个加载插件
  │    for each candidate:
  │      ├── 检查启用状态 → 禁用则跳过
  │      ├── 验证配置（JSON Schema） → 无效则跳过
  │      ├── jiti(source) 加载模块 → 失败则记录错误
  │      ├── 解析 register/activate 函数
  │      ├── createApi(record, { config, pluginConfig })
  │      │    → 构建 OpenClawPluginApi 实例
  │      └── register(api) → 插件执行自注册
  │           ├── api.registerTool(...)
  │           ├── api.on("before_agent_start", ...)
  │           ├── api.registerGatewayMethod(...)
  │           └── ...
  │
  ├── 6. 初始化全局 HookRunner
  │    initializeGlobalHookRunner(registry)
  │    → 让钩子在整个进程中可用
  │
  └── 返回 PluginRegistry
```

**关键设计决策**：

1. **同步加载**：`register(api)` 必须是同步的，异步注册会被忽略并警告
2. **方法名冲突保护**：插件注册的 Gateway 方法不能覆盖核心方法
3. **ID 去重**：同 ID 的插件只保留优先级最高的那个
4. **memory 插槽**：`kind: "memory"` 类型的插件最多只能有一个生效

---

## 5. 插件 API (OpenClawPluginApi)

每个插件在 `register(api)` 中收到的 `api` 对象是它与 OpenClaw 交互的唯一接口：

```typescript
// src/plugins/types.ts (L244-283) — 简化版
type OpenClawPluginApi = {
  // 身份信息
  id: string;                  // 插件 ID
  name: string;                // 插件名
  source: string;              // 入口文件路径
  config: OpenClawConfig;      // 全局配置（只读）
  pluginConfig?: Record<string, unknown>;  // 本插件的配置

  // 运行时能力
  runtime: PluginRuntime;      // 丰富的运行时 API
  logger: PluginLogger;        // 日志记录器

  // 注册方法（见第2章的10种能力）
  registerTool: (...) => void;
  registerHook: (...) => void;
  registerHttpHandler: (...) => void;
  registerHttpRoute: (...) => void;
  registerChannel: (...) => void;
  registerGatewayMethod: (...) => void;
  registerCli: (...) => void;
  registerService: (...) => void;
  registerProvider: (...) => void;
  registerCommand: (...) => void;

  // 新式钩子注册
  on: <K extends PluginHookName>(hookName, handler, opts?) => void;

  // 工具方法
  resolvePath: (input: string) => string;
};
```

### 5.1 PluginRuntime — 插件可用的运行时能力

`api.runtime` 提供了丰富的运行时 API，避免插件直接依赖内部模块：

| 命名空间                   | 能力                                   |
| -------------------------- | -------------------------------------- |
| `runtime.config`           | 读写配置                               |
| `runtime.system`           | 系统事件、命令执行                     |
| `runtime.media`            | 媒体处理（图片缩放、MIME 检测等）      |
| `runtime.tts`              | 文本转语音                             |
| `runtime.tools`            | 创建记忆工具                           |
| `runtime.channel`          | 渠道通用能力（消息分块、路由、配对等） |
| `runtime.channel.discord`  | Discord 专用能力                       |
| `runtime.channel.slack`    | Slack 专用能力                         |
| `runtime.channel.telegram` | Telegram 专用能力                      |
| `runtime.logging`          | 日志                                   |
| `runtime.state`            | 状态目录管理                           |

---

## 6. 钩子系统 — 在 Agent 执行中插入逻辑

钩子是插件最核心的扩展机制。它让插件可以在 Agent 执行的各个阶段"拦截"或"旁听"。

### 6.1 Agent 执行流程中的钩子分布

```
用户消息进入
  │
  ▼
message_received ← 【旁听】插件收到通知，不能修改消息
  │
  ▼
命令解析
  │
  ▼
Agent 开始
  │
  ▼
before_agent_start ← 【拦截】插件可以注入上下文到系统提示词
  │                    例: 记忆插件注入相关历史记忆
  │
  ▼
大模型思考 → 调用工具
  │             │
  │             ▼
  │     before_tool_call ← 【拦截】插件可以修改参数或阻止调用
  │             │            例: 安全插件阻止危险命令
  │             ▼
  │        工具执行
  │             │
  │             ▼
  │     tool_result_persist ← 【拦截】插件可以修改持久化的结果
  │             │               例: 压缩过大的文件读取结果
  │             ▼
  │        继续思考...
  │
  ▼
agent_end ← 【旁听】插件收到通知
  │           例: 记忆插件自动提取新记忆
  │
  ▼
回复发送给用户
```

### 6.2 钩子的两种类型

**旁听型（Void Hook）**：插件只能看到发生了什么，不能改变任何东西。多个插件并行执行。

| 钩子                                     | 触发时机         | 插件能做什么               |
| ---------------------------------------- | ---------------- | -------------------------- |
| `message_received`                       | 收到消息后       | 记日志、统计、发外部通知   |
| `agent_end`                              | Agent 执行完     | 分析对话、记录耗时、存记忆 |
| `message_sent`                           | 消息发送后       | 确认投递、审计             |
| `after_tool_call`                        | 工具执行后       | 统计、监控                 |
| `before_compaction` / `after_compaction` | 上下文压缩前后   | 记录                       |
| `session_start` / `session_end`          | 会话生命周期     | 资源管理                   |
| `gateway_start` / `gateway_stop`         | Gateway 生命周期 | 初始化/清理                |

**拦截型（Modifying Hook）**：插件可以修改数据或阻止操作。多个插件按优先级顺序执行。

| 钩子                  | 触发时机     | 插件能做什么                               |
| --------------------- | ------------ | ------------------------------------------ |
| `before_agent_start`  | Agent 开始前 | **注入上下文**到提示词、**替换**系统提示词 |
| `before_tool_call`    | 工具调用前   | **修改参数**、**阻止**工具调用             |
| `message_sending`     | 消息发送前   | **修改内容**、**取消**发送                 |
| `tool_result_persist` | 结果持久化前 | **修改/缩减**持久化的数据                  |

### 6.3 钩子注册和执行

**注册**：

```typescript
// 旁听型 — 只需看到事件
api.on('agent_end', async (event, ctx) => {
  console.log(`Agent 耗时 ${event.durationMs}ms`)
})

// 拦截型 — 通过返回值修改行为
api.on(
  'before_tool_call',
  async (event, ctx) => {
    if (event.toolName === 'exec' && event.params.command.includes('rm -rf')) {
      return { block: true, blockReason: '危险操作被阻止' }
    }
  },
  { priority: 100 }
) // 高优先级先执行
```

**执行**（在 `src/plugins/hooks.ts` 中）：

旁听型用 `Promise.all` 并行执行：

```typescript
// 所有 handler 同时开始，互不影响
const promises = hooks.map(async (hook) => {
  await hook.handler(event, ctx)
})
await Promise.all(promises)
```

拦截型用 `for...of` 顺序执行，结果逐步合并：

```typescript
let result
for (const hook of hooks) {
  // 按优先级排序后依次执行
  const handlerResult = await hook.handler(event, ctx)
  result = mergeResults(result, handlerResult) // 合并结果
}
```

### 6.4 全局 HookRunner 单例

钩子系统通过全局单例模式工作：

```
Gateway 启动
  │
  ├── 加载所有插件 → 插件通过 api.on() 注册钩子到 PluginRegistry
  │
  ├── initializeGlobalHookRunner(registry)
  │    → 创建全局唯一的 HookRunner 实例
  │
  └── 整个进程任何地方都可以通过 getGlobalHookRunner() 获取
       └── Agent 执行中的各个阶段调用对应的 hook 方法
```

这个设计的好处是 **不需要在函数参数中传递 HookRunner**，任何文件 import `getGlobalHookRunner()` 就可以使用。

### 6.5 容错：钩子错误不影响 Agent

所有钩子执行都包裹在 try-catch 中：

```typescript
// 拦截型钩子出错 → 跳过该 handler，继续下一个
catch (err) {
  logger?.error(`hook handler from ${hook.pluginId} failed: ${String(err)}`);
}

// before_tool_call 出错 → 放行工具调用
catch (err) {
  log.warn(`before_tool_call hook failed: tool=${toolName}`);
}
return { blocked: false, params };  // 出错 → 默认放行
```

核心原则：**一个插件的 bug 不能让 Agent 停止工作**。

---

## 7. 工具扩展 — 给 Agent 添加新能力

工具是 Agent 与外部世界交互的手段（读文件、执行命令、搜索等）。插件可以注册新工具：

```typescript
api.registerTool({
  name: 'jira_search',
  description: '搜索 JIRA 工单',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
      project: { type: 'string', description: '项目代码' }
    },
    required: ['query']
  },
  execute: async (toolCallId, params, signal) => {
    const results = await jiraClient.search(params.query, {
      project: params.project
    })
    return {
      content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
      details: { ok: true }
    }
  }
})
```

**插件工具和内置工具走同一条路径**：都经过策略过滤、钩子包装、AbortSignal 处理。Agent（大模型）看到的工具列表中，插件工具和内置工具没有区别。

**工具也可以是工厂函数**：根据上下文动态创建工具

```typescript
api.registerTool((ctx) => {
  // ctx 包含 agentId, sessionKey, config 等
  if (ctx.sandboxed) return null // 沙箱模式下不提供此工具
  return {
    name: 'deploy',
    description: '部署到生产环境',
    execute: async (toolCallId, params) => {
      /* ... */
    }
  }
})
```

---

## 8. 渠道扩展 — 对接新的 IM 平台

插件可以注册新的消息渠道，让 Agent 通过新的 IM 平台与用户交互：

```typescript
// extensions/matrix/index.ts（简化版）
const plugin = {
  id: 'matrix',
  register(api) {
    api.registerChannel({
      plugin: {
        id: 'matrix',
        label: 'Matrix',
        isEnabled: (cfg) => Boolean(cfg.matrix?.enabled),
        isConfigured: (cfg) => Boolean(cfg.matrix?.homeserver),
        gateway: {
          startAccount: async ({ cfg, runtime, log }) => {
            // 连接 Matrix homeserver
            const client = sdk.createClient({ baseUrl: cfg.matrix.homeserver })
            await client.login('m.login.password', { user, password })
            client.on('Room.timeline', (event) => {
              // 收到消息 → 归一化 → 交给 Gateway 处理
              const ctx = normalizeMatrixMessage(event)
              await runtime.channel.dispatch(ctx)
            })
          },
          stopAccount: async () => {
            await client.stopClient()
          }
        }
      }
    })
  }
}
```

注册后，Gateway 会在启动时像对待 Telegram、Discord 一样对待这个新渠道——自动启动、监控状态、处理消息。

---

## 9. Gateway 方法扩展 — 自定义 RPC 接口

插件可以给 Gateway 添加新的 WebSocket RPC 方法，Web UI 就可以调用：

```typescript
api.registerGatewayMethod('voicecall.initiate', async ({ params, respond, context }) => {
  const { phoneNumber, agentId } = params
  try {
    const callId = await initiateCall(phoneNumber, agentId)
    respond(true, { callId })
  } catch (err) {
    respond(false, undefined, { code: 500, message: String(err) })
  }
})
```

Web UI 调用：

```json
{
  "type": "req",
  "id": "req-1",
  "method": "voicecall.initiate",
  "params": { "phoneNumber": "+1234567890" }
}
```

**安全保护**：插件方法不能覆盖核心方法名，Gateway 会检查冲突。

---

## 10. 命令扩展 — 自定义聊天命令

插件可以注册直接在聊天中使用的 `/命令`，这些命令 **不经过 Agent**，直接由插件处理：

```typescript
api.registerCommand({
  name: 'tts', // 用户输入 /tts
  description: '文本转语音',
  acceptsArgs: true, // 接受参数
  requireAuth: true, // 需要授权
  handler: async (ctx) => {
    const text = ctx.args
    const audio = await textToSpeech(text)
    return {
      text: '语音已生成',
      media: [{ url: audio.url, mime: 'audio/mp3' }]
    }
  }
})
```

**命令处理优先级**：

```
用户输入 "/tts 你好"
  │
  ├── 1. 先匹配插件命令 → 找到 /tts → 直接执行，不进 Agent
  ├── 2. 再匹配内置命令（/new, /help, /stop 等）
  └── 3. 都不匹配 → 作为普通消息进入 Agent
```

**命令名规则**：

- 格式：`^[a-z][a-z0-9_-]*$`
- 不能用保留名：`help`, `commands`, `status`, `stop`, `restart`, `new`, `reset` 等

---

## 11. 服务扩展 — 后台长运行任务

插件可以注册后台服务，Gateway 负责它们的生命周期：

```typescript
api.registerService({
  id: 'voicecall',
  start: async (ctx) => {
    // ctx.config: 全局配置
    // ctx.stateDir: 状态目录 (~/.openclaw)
    // ctx.logger: 日志记录器
    sipServer = await startSIPServer(ctx.config.voiceCall)
    ctx.logger.info('SIP server started')
  },
  stop: async (ctx) => {
    await sipServer.close()
    ctx.logger.info('SIP server stopped')
  }
})
```

```typescript
// src/plugins/services.ts — Gateway 如何管理插件服务
export async function startPluginServices(params) {
  for (const entry of params.registry.services) {
    await entry.service.start({ config, workspaceDir, stateDir, logger })
    running.push({ id: entry.service.id, stop: entry.service.stop })
  }

  return {
    stop: async () => {
      // 按注册的逆序停止（先启动的后停止）
      for (const entry of running.toReversed()) {
        await entry.stop?.()
      }
    }
  }
}
```

---

## 12. 真实插件案例分析

### 12.1 voice-call 插件 — 语音通话

这是一个功能丰富的插件，使用了多种扩展能力：

```typescript
register(api) {
  // ① Gateway RPC 方法 — 让 Web UI 可以发起和控制通话
  api.registerGatewayMethod("voicecall.initiate", ...);
  api.registerGatewayMethod("voicecall.continue", ...);

  // ② Agent 工具 — 让 Agent 可以主动打电话
  api.registerTool({
    name: "voice_call",
    description: "拨打电话给指定号码",
    execute: async (toolCallId, params) => { /* ... */ },
  });

  // ③ CLI 命令 — openclaw voicecall status/call
  api.registerCli(({ program }) => {
    registerVoiceCallCli({ program, config });
  }, { commands: ["voicecall"] });

  // ④ 后台服务 — 维护 SIP/WebSocket 连接
  api.registerService({
    id: "voicecall",
    start: async () => { /* ... */ },
    stop: async () => { /* ... */ },
  });
}
```

### 12.2 matrix 插件 — Matrix 渠道

一个纯渠道插件，只注册了一个消息渠道：

```typescript
register(api) {
  setMatrixRuntime(api.runtime);
  api.registerChannel({ plugin: matrixPlugin });
}
```

### 12.3 memory-lancedb 插件 — 长期记忆

工具 + 钩子 + CLI + 服务的综合插件（见第 1 章的完整例子）。

### 12.4 模式总结

| 插件类型   | 主要使用的扩展能力                                           | 例子                  |
| ---------- | ------------------------------------------------------------ | --------------------- |
| 渠道插件   | `registerChannel`                                            | matrix, msteams, zalo |
| 工具插件   | `registerTool` + `on("before_agent_start")`                  | memory-lancedb        |
| 功能插件   | `registerGatewayMethod` + `registerTool` + `registerService` | voice-call            |
| 提供商插件 | `registerProvider`                                           | 自定义 LLM 提供商     |

---

## 13. 插件 SDK

OpenClaw 提供 `openclaw/plugin-sdk` 让插件开发者 import 所需的类型和工具函数：

```typescript
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'
import { emptyPluginConfigSchema, formatDocsLink } from 'openclaw/plugin-sdk'
```

SDK 导出内容包括：

- **核心类型**：`OpenClawPluginApi`, `OpenClawPluginService`, `PluginRuntime`, `OpenClawConfig`
- **渠道类型**：`ChannelPlugin`, `ChannelMessagingAdapter`, `ChannelOutboundAdapter`
- **配置 Schema**：各内置渠道的配置类型（Discord、Slack、Telegram 等）
- **工具函数**：`emptyPluginConfigSchema()`, `normalizePluginHttpPath()`, `formatDocsLink()` 等
- **渠道辅助**：消息分块、路由、配对、媒体处理等

**插件的 `openclaw.plugin.json` 清单**：

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "A custom plugin",
  "version": "1.0.0",
  "configSchema": {
    "type": "object",
    "properties": {
      "apiKey": { "type": "string" },
      "enabled": { "type": "boolean", "default": true }
    },
    "required": ["apiKey"]
  }
}
```

---

## 14. 关键代码索引

| 文件                                              | 职责                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `src/plugins/types.ts`                            | 所有插件相关类型：`OpenClawPluginApi`、14 种 Hook 类型、命令类型 |
| `src/plugins/discovery.ts`                        | 插件发现：扫描目录，生成 `PluginCandidate` 列表                  |
| `src/plugins/manifest.ts`                         | 清单加载：读取 `openclaw.plugin.json`                            |
| `src/plugins/manifest-registry.ts`                | 清单注册中心                                                     |
| `src/plugins/loader.ts`                           | 核心加载器：`loadOpenClawPlugins` 全流程                         |
| `src/plugins/registry.ts`                         | 注册中心：`PluginRegistry`、`createApi`、所有 register 实现      |
| `src/plugins/hooks.ts`                            | Hook 引擎：`createHookRunner`、Void/Modifying 两种执行模式       |
| `src/plugins/hook-runner-global.ts`               | 全局 HookRunner 单例                                             |
| `src/plugins/commands.ts`                         | 插件命令注册与执行                                               |
| `src/plugins/services.ts`                         | 插件服务生命周期管理                                             |
| `src/plugins/runtime/index.ts`                    | `createPluginRuntime` — 构建 PluginRuntime                       |
| `src/plugins/runtime/types.ts`                    | PluginRuntime 类型定义                                           |
| `src/plugin-sdk/index.ts`                         | 插件 SDK 导出                                                    |
| `src/agents/pi-tools.before-tool-call.ts`         | `before_tool_call` 钩子在 Agent 中的集成                         |
| `src/agents/session-tool-result-guard-wrapper.ts` | `tool_result_persist` 钩子在 Agent 中的集成                      |
| `src/agents/pi-embedded-runner/run/attempt.ts`    | `before_agent_start` / `agent_end` 触发点                        |
| `src/agents/openclaw-tools.ts`                    | 插件工具的加载和集成                                             |
| `extensions/voice-call/index.ts`                  | 真实插件案例：语音通话                                           |
| `extensions/matrix/index.ts`                      | 真实插件案例：Matrix 渠道                                        |
| `extensions/memory-lancedb/index.ts`              | 真实插件案例：长期记忆                                           |

---

> **总结**：OpenClaw 的插件系统通过 `OpenClawPluginApi` 提供 10+ 种扩展能力，覆盖 Agent 层（工具、钩子、命令）、Gateway 层（渠道、RPC 方法、HTTP 路由）和系统层（服务、CLI、AI 提供商）。钩子系统是其中最核心的机制——它在 Agent 执行的每个关键阶段提供了"拦截"或"旁听"的能力，让插件可以注入上下文、拦截工具调用、过滤消息内容，同时保证任何插件错误都不会影响 Agent 的正常运行。
