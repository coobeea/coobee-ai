# Gateway 通信层深度分析

## 1. 通信架构概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    RENDERER 层（Vue 3 前端）                                 │
│  GatewayClient: WebSocket 连接 /gateway/ws，RPC 请求 + 事件订阅               │
│  fetch(): HTTP REST 直接调用 /gateway/* 端点                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                 │ IPC + WebSocket
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MAIN 层 — Gateway 通信层                                   │
│                                                                              │
│  ┌─ GatewayServer ────────────────────────────────────────────────────────┐ │
│  │  WS: /gateway/ws  — WebSocket 连接，心跳 30s                             │ │
│  │  HTTP: /gateway/* — Koa Router 前缀，REST 端点                           │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌─ Gateway (核心编排) ────────────────────────────────────────────────────┐ │
│  │  • 方法发现: scanGatewayMethods() → 注册 chat.*, stream.*, config.* 等   │ │
│  │  • 事件桥接: scanGatewayEventBridges() → StreamBridge, ThreadBridge 等   │ │
│  │  • 请求路由: handleMessage() → methods.get(req.method) → handler()        │ │
│  │  • 事件广播: broadcastEvent() / broadcastEventIf() → 客户端订阅过滤       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌─ EventBus (内部) ──────────────────────────────────────────────────────┐ │
│  │  stream:message, stream:start, stream:end, stream:error                  │ │
│  │  thread:created, thread:updated, thread:deleted, thread:status          │ │
│  │  thread:wake, worker:status, agent:event, workspace:file-changed        │ │
│  │  process:output, process:exit, terminal:output, terminal:exit           │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌─ UnifiedGateway (可选) ─────────────────────────────────────────────────┐ │
│  │  统一路由/事件注册表，EventAdapter 桥接 EventBus → UnifiedGateway         │ │
│  │  与主 Gateway 尚未完全打通，作为适配层或未来迁移入口                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 双通道设计

| 通道          | 路径                                                       | 用途                                                                                      |
| ------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **WebSocket** | `/gateway/ws`                                              | RPC 请求（chat.send, stream.subscribe 等）、事件推送（stream.message, thread.updated 等） |
| **HTTP REST** | `/gateway/agents`, `/gateway/threads`, `/gateway/files` 等 | 兼容性 API、文件操作、Agent/Thread CRUD                                                   |

### 1.2 生命周期

```
HttpServer 启动 → Gateway.start()
  → GatewayServer 创建 WebSocketServer + HTTP Router
  → discoverMethods() 扫描 methods/*.ts
  → discoverEventBridges() 扫描 events/*.ts
  → registerHttpRoutes() 挂载 agents.ts, threads.ts 等
  → server.start()
```

---

## 2. 事件名列表及用途

| 事件名                   | 来源             | 用途                                       |
| ------------------------ | ---------------- | ------------------------------------------ |
| `stream.message`         | StreamBridge     | 流式消息 chunk，按 sessionId 过滤订阅者    |
| `stream.start`           | StreamBridge     | 流式会话开始                               |
| `stream.end`             | StreamBridge     | 流式会话结束                               |
| `stream.error`           | StreamBridge     | 流式会话错误                               |
| `thread.created`         | ThreadBridge     | Thread 创建                                |
| `thread.updated`         | ThreadBridge     | Thread 更新                                |
| `thread.deleted`         | ThreadBridge     | Thread 删除                                |
| `thread.status`          | ThreadBridge     | Thread 状态变更                            |
| `worker.status`          | WorkerBridge     | Worker 状态变更（ready/starting/error 等） |
| `agent.event`            | AgentEventBridge | Agent 通过 emit_event 工具发出的事件       |
| `workspace.file-changed` | WorkspaceBridge  | 工作区文件变化                             |
| `process.output`         | ProcessBridge    | 后台进程输出                               |
| `process.exit`           | ProcessBridge    | 后台进程退出                               |
| `terminal.output`        | TerminalBridge   | 终端输出                                   |
| `terminal.exit`          | TerminalBridge   | 终端退出                                   |

---

## 3. RPC 方法列表

| 方法                 | 命名空间 | 用途                                        |
| -------------------- | -------- | ------------------------------------------- |
| `chat.send`          | chat     | 发送消息并启动流式处理（支持 mode/agentId） |
| `chat.abort`         | chat     | 中止当前会话（预留）                        |
| `stream.subscribe`   | stream   | 订阅会话流式消息                            |
| `stream.unsubscribe` | stream   | 取消订阅                                    |
| `stream.resend`      | stream   | 重发历史消息                                |
| `stream.latestSeq`   | stream   | 获取最新序列号                              |
| `config.get`         | config   | 获取指定配置节                              |
| `config.getAll`      | config   | 获取完整配置                                |
| `config.set`         | config   | 设置指定配置节                              |
| `config.patch`       | config   | 部分更新配置                                |
| `worker.list`        | worker   | 列出 Worker 状态                            |
| `hitl.decide`        | hitl     | 审批 HITL 决策（allow/deny）                |
| `brain.stats`        | brain    | 获取智库统计                                |
| `brain.list`         | brain    | 列出经验包                                  |
| `brain.get`          | brain    | 获取经验包详情                              |
| `brain.delete`       | brain    | 删除经验包                                  |
| `system.methods`     | system   | 内置：返回所有已注册方法列表                |
| `system.health`      | system   | 内置：健康检查                              |

---

## 4. HTTP REST 端点列表

### 4.1 内置端点

| 方法 | 路径              | 用途     |
| ---- | ----------------- | -------- |
| GET  | `/gateway/health` | 健康检查 |

### 4.2 Agents

| 方法   | 路径                             | 用途                |
| ------ | -------------------------------- | ------------------- |
| GET    | `/gateway/agents`                | 列出 Agent          |
| GET    | `/gateway/agents/:id`            | 获取 Agent 详情     |
| POST   | `/gateway/agents`                | 创建 Agent          |
| POST   | `/gateway/agents/ai-create`      | AI 创建 Agent       |
| PATCH  | `/gateway/agents/:id`            | 更新 Agent          |
| DELETE | `/gateway/agents/:id`            | 删除 Agent          |
| GET    | `/gateway/agents/:id/skills`     | 获取 Agent 技能列表 |
| POST   | `/gateway/agents/:id/quick-chat` | 快速对话（SSE）     |

### 4.3 Threads

| 方法   | 路径                           | 用途             |
| ------ | ------------------------------ | ---------------- |
| GET    | `/gateway/threads`             | 列出 Thread      |
| GET    | `/gateway/threads/:id`         | 获取 Thread 详情 |
| POST   | `/gateway/threads`             | 创建 Thread      |
| PATCH  | `/gateway/threads/:id`         | 更新 Thread      |
| DELETE | `/gateway/threads/:id`         | 删除 Thread      |
| GET    | `/gateway/threads/:id/history` | 获取对话历史     |

### 4.4 Skills

| 方法   | 路径                        | 用途          |
| ------ | --------------------------- | ------------- |
| GET    | `/gateway/skills`           | 列出 Skill    |
| POST   | `/gateway/skills/import`    | 导入 Skill    |
| POST   | `/gateway/skills/ai-create` | AI 创建 Skill |
| DELETE | `/gateway/skills/:name`     | 删除 Skill    |

### 4.5 Files

| 方法 | 路径                     | 用途         |
| ---- | ------------------------ | ------------ |
| GET  | `/gateway/files/tree`    | 获取目录树   |
| GET  | `/gateway/files/content` | 获取文件内容 |
| GET  | `/gateway/files/serve`   | 静态文件服务 |
| POST | `/gateway/files/upload`  | 上传文件     |
| POST | `/gateway/files/copy`    | 复制文件     |
| POST | `/gateway/files/delete`  | 删除文件     |

### 4.6 Tavern

| 方法   | 路径                        | 用途             |
| ------ | --------------------------- | ---------------- |
| GET    | `/gateway/tavern/tasks`     | 列出 Tavern 任务 |
| GET    | `/gateway/tavern/tasks/:id` | 获取任务详情     |
| POST   | `/gateway/tavern/tasks`     | 创建任务         |
| PATCH  | `/gateway/tavern/tasks/:id` | 更新任务         |
| DELETE | `/gateway/tavern/tasks/:id` | 删除任务         |

### 4.7 Cron Jobs

| 方法   | 路径                                | 用途             |
| ------ | ----------------------------------- | ---------------- |
| GET    | `/gateway/cron-jobs`                | 列出定时任务     |
| GET    | `/gateway/cron-jobs/:id`            | 获取任务详情     |
| POST   | `/gateway/cron-jobs/parse`          | 解析 cron 表达式 |
| POST   | `/gateway/cron-jobs`                | 创建任务         |
| PATCH  | `/gateway/cron-jobs/:id`            | 更新任务         |
| DELETE | `/gateway/cron-jobs/:id`            | 删除任务         |
| POST   | `/gateway/cron-jobs/:id/trigger`    | 手动触发         |
| GET    | `/gateway/cron-jobs/:id/executions` | 获取执行记录     |

### 4.8 Brain Metrics

| 方法 | 路径                             | 用途     |
| ---- | -------------------------------- | -------- |
| GET  | `/gateway/brain-metrics/stats`   | 获取统计 |
| GET  | `/gateway/brain-metrics/records` | 获取记录 |
| POST | `/gateway/brain-metrics/clear`   | 清空     |

### 4.9 Processes

| 方法 | 路径                            | 用途         |
| ---- | ------------------------------- | ------------ |
| GET  | `/gateway/processes`            | 列出进程     |
| GET  | `/gateway/processes/:id/output` | 获取进程输出 |

### 4.10 Terminals

| 方法   | 路径                            | 用途     |
| ------ | ------------------------------- | -------- |
| POST   | `/gateway/terminals`            | 创建终端 |
| GET    | `/gateway/terminals`            | 列出终端 |
| POST   | `/gateway/terminals/:id/input`  | 发送输入 |
| POST   | `/gateway/terminals/:id/resize` | 调整大小 |
| DELETE | `/gateway/terminals/:id`        | 关闭终端 |

### 4.11 Metrics & Monitoring

| 方法 | 路径                                 | 用途         |
| ---- | ------------------------------------ | ------------ |
| GET  | `/gateway/metrics/aggregated`        | 聚合指标     |
| GET  | `/gateway/monitoring/compression`    | 压缩监控     |
| GET  | `/gateway/monitoring/memory`         | 内存监控     |
| GET  | `/gateway/monitoring/tokens`         | Token 监控   |
| GET  | `/gateway/monitoring/system`         | 系统监控     |
| GET  | `/gateway/monitoring/memory-files`   | 记忆文件列表 |
| GET  | `/gateway/monitoring/memory-content` | 记忆内容     |

---

## 5. 模块依赖关系

```
Gateway
  ├── GatewayServer (WS + HTTP 网络层)
  ├── HttpServer (Koa) — 来自 common/server
  ├── EventBus — 来自 common/eventbus
  ├── methods/* — chat, stream, config, worker, approval, brain
  ├── events/* — StreamBridge, ThreadBridge, WorkerBridge, AgentEventBridge,
  │               WorkspaceBridge, ProcessBridge, TerminalBridge
  ├── http/* — agents, threads, skills, files, tavern, cron-jobs,
  │            brain-metrics, metrics, monitoring, processes, terminals
  ├── AgentExecutor — 执行 chat.send
  ├── StreamStore — stream.resend
  ├── ThreadStore — 线程数据
  ├── ConfigStore — 配置
  ├── WorkerManager — Worker 状态
  └── ExtensionRegistry — Extension 的 gatewayMethods（未完全接入）
```

---

## 6. UnifiedGateway 与旧 Gateway 的关系

| 维度         | 主 Gateway                                 | UnifiedGateway                                             |
| ------------ | ------------------------------------------ | ---------------------------------------------------------- |
| **职责**     | 实际处理 WS/HTTP 请求、事件广播            | 统一路由/事件注册表，适配层                                |
| **入口**     | Gateway.start() → GatewayServer            | getUnifiedGateway() 单例                                   |
| **方法注册** | registerMethods() 扫描 methods/\*          | register() 手动注册                                        |
| **事件**     | EventBridge 监听 EventBus → broadcastEvent | EventAdapter 桥接 EventBus → emit()                        |
| **使用方**   | 前端 GatewayClient、HTTP 客户端            | 目前主要为扩展点，主 Gateway 未完全依赖                    |
| **迁移路径** | 当前主入口                                 | 未来可统一为 UnifiedGateway 作为唯一入口，Gateway 作为实现 |

**问题**：UnifiedGateway 与主 Gateway 未打通，Extension 的 gatewayMethods 通过 scanGatewayMethods 未读 Registry，导致 Extension 注册的 RPC 方法不可用。

---

## 7. 问题与改进建议

### 7.1 安全

| 问题                             | 影响                            | 建议                                              |
| -------------------------------- | ------------------------------- | ------------------------------------------------- |
| **files.copy 未校验 sourcePath** | 可复制任意路径文件到 workspace  | 对 sourcePath 做 isPathSafe 或 workspace 边界校验 |
| **HTTP API 无认证**              | 本机可访问，但无 token/IPC 校验 | 增加简单 token 或 IPC 校验                        |

### 7.2 事件与订阅

| 问题                                 | 影响                            | 建议                                              |
| ------------------------------------ | ------------------------------- | ------------------------------------------------- |
| **Terminal/Process 事件全量广播**    | 所有客户端收到所有终端/进程事件 | 增加订阅过滤（类似 stream 的 subscribedSessions） |
| **GatewayClient 重连后无自动重订阅** | 断线重连后需手动重新 subscribe  | onConnect 中自动重订阅当前会话                    |

### 7.3 错误处理

| 问题                             | 影响                                           | 建议                      |
| -------------------------------- | ---------------------------------------------- | ------------------------- |
| **stream.\* 方法错误处理不一致** | 部分返回 `{ok: false}` 而非 GatewayMethodError | 统一为 GatewayMethodError |
| **HTTP 错误格式无 code 字段**    | 前端难以区分错误类型                           | 增加 code 字段            |

### 7.4 扩展集成

| 问题                                | 影响                             | 建议                                               |
| ----------------------------------- | -------------------------------- | -------------------------------------------------- |
| **Extension gatewayMethods 未生效** | scanGatewayMethods 未读 Registry | Gateway 启动后从 registry.getGatewayMethods() 注册 |

### 7.5 架构

| 问题                                   | 影响                   | 建议                             |
| -------------------------------------- | ---------------------- | -------------------------------- |
| **UnifiedGateway 与主 Gateway 未打通** | 双轨并行，增加维护成本 | 明确迁移路径或作为适配层统一入口 |
| **前端 fetch 与 GatewayClient 混用**   | 数据流不一致           | 统一为 Gateway RPC 或封装 API 层 |

### 7.6 资源清理

| 问题                           | 影响   | 建议                        |
| ------------------------------ | ------ | --------------------------- |
| **EventBridge 已返回 cleanup** | 已修复 | 保持 Gateway.close() 时调用 |

### 7.7 可观测性

| 问题               | 影响         | 建议                        |
| ------------------ | ------------ | --------------------------- |
| **无请求 traceId** | 日志难以关联 | 增加 traceId/sessionId 字段 |
