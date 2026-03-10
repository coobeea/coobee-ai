# OpenClaw Gateway — 统一外部对接入口

> Gateway 是 OpenClaw 的 **唯一外部对接层**。所有外部系统——Web UI、macOS App、手机 App、Telegram/Discord/Slack 等消息渠道、GitHub/Gmail 等 Webhook、第三方 API 调用——都必须通过 Gateway 与 Agent 核心交互。本文档围绕"外部系统如何连进来"这个问题，从协议、认证、路由三个层面展开。

---

## 目录

1. [Gateway 是什么](#1-gateway-是什么)
2. [Gateway 对外暴露的全部接口](#2-gateway-对外暴露的全部接口)
3. [WebSocket RPC — 主要交互通道](#3-websocket-rpc--主要交互通道)
4. [HTTP REST — 兼容性 API 与 Webhook](#4-http-rest--兼容性-api-与-webhook)
5. [消息渠道 — Telegram/Discord/Slack 等](#5-消息渠道--telegramdiscordslack-等)
6. [认证机制 — 谁能连进来](#6-认证机制--谁能连进来)
7. [权限模型 — 连进来后能做什么](#7-权限模型--连进来后能做什么)
8. [消息从外部到 Agent 的完整路径](#8-消息从外部到-agent-的完整路径)
9. [Gateway 的附属服务](#9-gateway-的附属服务)
10. [关键代码索引](#10-关键代码索引)

---

## 1. Gateway 是什么

Gateway 是一个 **单进程多协议服务器**，默认监听 `127.0.0.1:18789`：

```typescript
// src/gateway/server.impl.ts (L155-157)
export async function startGatewayServer(port = 18789, opts: GatewayServerOptions = {}): Promise<GatewayServer>;
```

它在一个端口上同时处理：

- **WebSocket 连接**：客户端（Web UI、macOS App）通过 WS 进行双向通信
- **HTTP 请求**：REST API、Webhook、Control UI 静态资源

绑定地址由配置决定：

| bind 模式  | 绑定地址                | 适用场景                |
| ---------- | ----------------------- | ----------------------- |
| `loopback` | `127.0.0.1`             | 本机使用（默认）        |
| `lan`      | `0.0.0.0`               | 局域网内其他设备访问    |
| `tailnet`  | Tailscale IP            | 通过 Tailscale 远程访问 |
| `auto`     | 优先 loopback，否则 LAN | 自动选择                |

---

## 2. Gateway 对外暴露的全部接口

Gateway 启动后，外部系统能看到的所有"门"：

```
┌─────────────────────────────────────────────────────────┐
│                  Gateway (端口 18789)                     │
│                                                          │
│  WebSocket 通道                                          │
│  ┌────────────────────────────────────────────────┐     │
│  │ ws://localhost:18789                            │     │
│  │  ├── connect 握手                               │     │
│  │  ├── chat.send / chat.abort                    │     │
│  │  ├── config.get / config.set                   │     │
│  │  ├── channels.status                           │     │
│  │  ├── exec.approval.request / resolve           │     │
│  │  ├── node.invoke / node.event                  │     │
│  │  ├── 插件注册的自定义方法                        │     │
│  │  └── ... (共 80+ 方法)                          │     │
│  └────────────────────────────────────────────────┘     │
│                                                          │
│  HTTP 端点                                               │
│  ┌────────────────────────────────────────────────┐     │
│  │ POST /hooks/wake           → 唤醒 Agent        │     │
│  │ POST /hooks/agent          → 触发 Agent 执行    │     │
│  │ POST /hooks/{mapping}      → 自定义 Webhook     │     │
│  │ POST /v1/chat/completions  → OpenAI 兼容 API    │     │
│  │ POST /v1/responses         → OpenResponses API  │     │
│  │ POST /tools/invoke         → 工具直接调用       │     │
│  │ POST /slack/events         → Slack 事件回调     │     │
│  │ GET  /                     → Control UI (Web)   │     │
│  │ 插件注册的自定义 HTTP 路由                       │     │
│  └────────────────────────────────────────────────┘     │
│                                                          │
│  消息渠道（各自维护长连接）                               │
│  ┌────────────────────────────────────────────────┐     │
│  │ Telegram Bot API (轮询)                         │     │
│  │ Discord Bot (WebSocket)                         │     │
│  │ Slack Bot (Events API)                          │     │
│  │ WhatsApp Web (Puppeteer)                        │     │
│  │ Signal (CLI bridge)                             │     │
│  │ iMessage (macOS bridge)                         │     │
│  │ 插件注册的自定义渠道 (Matrix, MS Teams, Zalo...) │     │
│  └────────────────────────────────────────────────┘     │
│                                                          │
│  网络发现                                                │
│  ┌────────────────────────────────────────────────┐     │
│  │ mDNS/Bonjour (局域网自动发现)                    │     │
│  │ Tailscale Serve/Funnel (远程暴露)               │     │
│  └────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

---

## 3. WebSocket RPC — 主要交互通道

这是所有"智能客户端"（Web UI、macOS App、iOS/Android App、Discord 监控面板）与 Gateway 通信的通道。

### 3.1 连接握手流程

WebSocket 连接建立后，需要完成一个握手协议才能开始通信：

```
客户端                                Gateway
  │                                      │
  │──── WebSocket 连接 ──────────────────>│
  │                                      │
  │<── event: connect.challenge ─────────│  // Gateway 发送挑战
  │    { nonce: "abc123", ts: 1234567 }  │
  │                                      │
  │──── req: connect ───────────────────>│  // 客户端回应
  │    {                                 │
  │      method: "connect",              │
  │      params: {                       │
  │        client: "openclaw-web/1.0",   │
  │        role: "operator",             │
  │        scopes: ["operator.admin"],   │
  │        auth: { token: "my-token" },  │
  │        minProtocol: 1,               │
  │        maxProtocol: 1,               │
  │      }                               │
  │    }                                 │
  │                                      │
  │<── res: connect OK ──────────────────│  // 握手成功
  │    {                                 │
  │      ok: true,                       │
  │      payload: {                      │
  │        protocol: 1,                  │
  │        server: "openclaw-gateway",   │
  │        features: [...],              │
  │        methods: ["chat.send", ...],  │  // 可用的 RPC 方法
  │        events: ["agent.*", ...],     │  // 可订阅的事件
  │        snapshot: { health, ... },    │  // 当前状态快照
  │      }                               │
  │    }                                 │
  │                                      │
  │  ← 现在可以发送 RPC 请求了 →          │
```

如果在超时时间内没有完成握手，连接会被关闭。

### 3.2 RPC 请求/响应

握手成功后，客户端通过 JSON 消息发送请求：

```json
// 请求
{ "type": "req", "id": "req-1", "method": "chat.send", "params": { "message": "你好" } }

// 成功响应
{ "type": "res", "id": "req-1", "ok": true, "payload": { "runId": "run-123" } }

// 错误响应
{ "type": "res", "id": "req-1", "ok": false, "error": { "code": 403, "message": "unauthorized" } }
```

### 3.3 事件广播

Gateway 也会主动向客户端推送事件：

```json
// Agent 执行进度
{ "type": "event", "event": "agent.progress", "payload": { "text": "正在读取文件..." } }

// 执行审批请求
{ "type": "event", "event": "exec.approval.requested", "payload": { "id": "...", "command": "rm file.txt" } }

// 健康状态变化
{ "type": "event", "event": "health", "payload": { "channels": {...} } }
```

### 3.4 核心 RPC 方法分类

Gateway 的 80+ RPC 方法按功能分组：

```typescript
// src/gateway/server-methods.ts (L165-191)
export const coreGatewayHandlers: GatewayRequestHandlers = {
  ...connectHandlers, // 连接管理
  ...chatHandlers, // 聊天 — chat.send, chat.abort, chat.history
  ...sendHandlers, // 消息发送 — send
  ...configHandlers, // 配置 — config.get, config.set
  ...channelsHandlers, // 渠道 — channels.status, channels.logout
  ...modelsHandlers, // 模型 — models.list
  ...sessionsHandlers, // 会话 — sessions.list, sessions.reset
  ...cronHandlers, // 定时任务 — cron.list, cron.add
  ...execApprovalsHandlers, // 执行审批配置 — exec.approvals.get/set
  ...nodeHandlers, // 远程节点 — node.list, node.invoke
  ...healthHandlers, // 健康检查 — health
  ...skillsHandlers, // 技能管理 — skills.status, skills.install
  ...updateHandlers, // 在线更新 — update.run
  ...agentHandlers, // Agent — agent, agent.wait
  ...agentsHandlers, // 多 Agent — agents.list, agents.create
  ...browserHandlers, // 浏览器 — browser.request
  ...ttsHandlers, // TTS — tts.enable, tts.convert
  ...wizardHandlers // 向导 — wizard.*
  // ...
};
```

---

## 4. HTTP REST — 兼容性 API 与 Webhook

### 4.1 OpenAI 兼容 API

Gateway 提供了 OpenAI Chat Completions 兼容接口，任何支持 OpenAI API 的工具都可以直接对接：

```bash
curl -X POST http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer my-token" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-4-sonnet",
    "messages": [
      {"role": "user", "content": "写一个 hello world"}
    ],
    "stream": true
  }'
```

支持流式和非流式响应，格式完全兼容 OpenAI。

### 4.2 OpenResponses API

还提供 OpenResponses 协议的兼容接口：

```bash
curl -X POST http://localhost:18789/v1/responses \
  -H "Authorization: Bearer my-token" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "帮我看看这个文件",
    "model": "claude-4-sonnet",
    "tools": [...]
  }'
```

支持客户端工具（function_call）、图片/文件输入。

### 4.3 HTTP Webhook

外部系统通过 HTTP POST 触发 Agent：

```bash
# 唤醒 Agent（添加系统事件，等下次心跳处理）
curl -X POST http://localhost:18789/hooks/wake \
  -H "Authorization: Bearer hook-token" \
  -d '{"text": "检查服务器状态"}'

# 直接触发 Agent 执行（创建隔离会话，立即执行）
curl -X POST http://localhost:18789/hooks/agent \
  -H "Authorization: Bearer hook-token" \
  -d '{
    "message": "New PR #123 from user: fix auth bug",
    "name": "GitHub",
    "deliver": true,
    "channel": "telegram"
  }'

# 自定义映射（如 Gmail Webhook）
curl -X POST http://localhost:18789/hooks/gmail \
  -H "Authorization: Bearer hook-token" \
  -d '{"messages": [{"from": "user@example.com", "subject": "Meeting", "body": "..."}]}'
```

Webhook 的认证是独立的 Token（配置在 `hooks.token`），和 Gateway 主认证分开。

### 4.4 HTTP 路由优先级

当 HTTP 请求进来时，按以下顺序匹配：

| 优先级 | 路径                   | 处理器                    |
| ------ | ---------------------- | ------------------------- |
| 1      | `/hooks/*`             | Webhook handler           |
| 2      | `/tools/invoke`        | 工具直接调用              |
| 3      | `/slack/events`        | Slack 事件回调            |
| 4      | 插件注册的路由         | 插件 HTTP handler         |
| 5      | `/v1/responses`        | OpenResponses API         |
| 6      | `/v1/chat/completions` | OpenAI 兼容 API           |
| 7      | Canvas/A2UI 路径       | Canvas 静态资源           |
| 8      | `/` 及其子路径         | Control UI (Web 管理界面) |
| 9      | 其他                   | 404                       |

---

## 5. 消息渠道 — Telegram/Discord/Slack 等

消息渠道是 Gateway 的特殊"客户端"——它们不是外部系统主动连进来，而是 Gateway 主动去连接外部 IM 服务。

### 5.1 渠道管理器

```typescript
// src/gateway/server-channels.ts
export function createChannelManager(opts): ChannelManager {
  return {
    startChannels, // 启动所有配置的渠道
    startChannel, // 启动单个渠道
    stopChannel, // 停止单个渠道
    getRuntimeSnapshot, // 获取所有渠道的运行状态
    markChannelLoggedOut
  };
}
```

### 5.2 渠道启动流程

```
Gateway 启动
  │
  ├── createChannelManager()
  ├── startChannels()
  │     ├── 遍历 listChannelPlugins()（内置 + 插件注册的渠道）
  │     ├── 对每个渠道：
  │     │    ├── 检查 isEnabled（配置中是否启用）
  │     │    ├── 检查 isConfigured（Token/凭证是否填了）
  │     │    └── 调用 plugin.gateway.startAccount()
  │     │         ├── Telegram: 启动 Bot 轮询
  │     │         ├── Discord: 连接 Discord Gateway
  │     │         ├── Slack: 注册 Events API
  │     │         ├── WhatsApp: 启动 Puppeteer 会话
  │     │         ├── Signal: 启动 CLI bridge
  │     │         └── 插件渠道: 按插件逻辑启动
  │     └── 每个渠道独立运行，互不影响
  │
  └── 渠道收到消息后：
        ├── 归一化为 FinalizedMsgContext
        ├── 进入 dispatchReplyFromConfig()
        └── 和 WebSocket 来的消息走同一条处理路径
```

### 5.3 渠道与 WebSocket 客户端的区别

| 特征     | 消息渠道                 | WebSocket 客户端                    |
| -------- | ------------------------ | ----------------------------------- |
| 方向     | Gateway → 外部 IM 服务   | 外部客户端 → Gateway                |
| 连接方   | Gateway 主动连出去       | 客户端主动连进来                    |
| 消息格式 | 各渠道自己的 API 格式    | 统一的 JSON RPC                     |
| 消息处理 | 归一化后走 dispatch 流程 | 通过 chat.send 方法走 dispatch 流程 |
| 认证     | 渠道自己的 Bot Token     | Gateway Token/Password              |

但最终：**不管消息从哪个渠道进来，归一化后都走同一条处理路径进入 Agent**。

---

## 6. 认证机制 — 谁能连进来

### 6.1 认证方式

Gateway 支持多种认证方式，按场景选择：

| 方式          | 使用场景           | 实现                                                              |
| ------------- | ------------------ | ----------------------------------------------------------------- |
| **本地直连**  | macOS App、CLI     | 检测来源 IP 是 loopback + Host 是 localhost → 直接信任            |
| **Token**     | Web UI、远程客户端 | `Authorization: Bearer <token>` 对比配置中的 `gateway.auth.token` |
| **Password**  | 简单密码保护       | 对比配置中的 `gateway.auth.password`                              |
| **Tailscale** | Tailscale 网络内   | 通过 `Tailscale-User-Login` 头 + `tailscale whois` 验证身份       |
| **设备配对**  | 手机 App、远程节点 | 首次连接时需要用户在 Gateway 端批准配对                           |

### 6.2 认证流程

```
客户端发起 WebSocket 连接
  │
  ├── 1. 本地直连检查
  │    └── loopback IP + localhost Host → 信任，跳过认证
  │
  ├── 2. Tailscale 检查（如果启用）
  │    └── Tailscale-User-Login 头 + whois 验证 → 信任
  │
  ├── 3. Token/Password 检查
  │    └── connect 消息中的 auth.token 或 auth.password 对比配置
  │
  └── 4. 设备配对检查（如果以上都不满足）
       ├── 有 device.publicKey + signature → 验证签名
       ├── 有 device token → verifyDeviceToken
       └── 都没有 → 发起配对请求，等待用户批准
```

---

## 7. 权限模型 — 连进来后能做什么

认证通过后，客户端的权限由 **角色(role)** 和 **范围(scopes)** 决定：

### 7.1 角色

| 角色       | 说明                                     |
| ---------- | ---------------------------------------- |
| `operator` | 人类操作员（Web UI、App 用户）           |
| `node`     | 远程节点（另一台机器上的 OpenClaw 实例） |

### 7.2 权限范围

| Scope                | 能做什么       | 举例                               |
| -------------------- | -------------- | ---------------------------------- |
| `operator.admin`     | 一切操作       | 修改配置、管理 Agent、删除会话     |
| `operator.read`      | 只读查看       | 看状态、看日志、看会话列表         |
| `operator.write`     | 发送消息和控制 | 发消息给 Agent、发 TTS、控制浏览器 |
| `operator.approvals` | 审批操作       | 批准/拒绝命令执行                  |
| `operator.pairing`   | 设备配对管理   | 批准/拒绝新设备连接                |

### 7.3 方法与权限的映射

```typescript
// src/gateway/server-methods.ts (L93-162) — 简化版
function authorizeGatewayMethod(method, client) {
  const role = client.connect.role; // "operator" 或 "node"
  const scopes = client.connect.scopes; // ["operator.admin"] 等

  // node 角色只能调 node.* 方法
  if (NODE_ROLE_METHODS.has(method)) {
    return role === 'node' ? null : 'unauthorized role';
  }

  // admin scope 可以调任何方法
  if (scopes.includes('operator.admin')) return null;

  // 按 scope 检查具体方法
  if (READ_METHODS.has(method)) {
    return scopes.includes('operator.read') ? null : 'missing scope: operator.read';
  }
  if (WRITE_METHODS.has(method)) {
    return scopes.includes('operator.write') ? null : 'missing scope: operator.write';
  }
  // ...
}
```

---

## 8. 消息从外部到 Agent 的完整路径

以一个 **Telegram 用户发消息给 Bot** 为例，完整路径是：

```
1. Telegram 用户发送 "帮我看看文件"
   │
   ▼
2. Telegram 渠道收到消息
   │  (Telegram Bot API → 渠道适配器)
   │
   ▼
3. 归一化为 FinalizedMsgContext
   │  {
   │    From: "telegram:user123",
   │    To: "telegram:bot456",
   │    Body: "帮我看看文件",
   │    Surface: "telegram",
   │    SessionKey: "main",
   │    SenderId: "12345",
   │    ...
   │  }
   │
   ▼
4. dispatchReplyFromConfig()
   │  ├── 去重检查
   │  ├── [钩子] message_received → 通知插件
   │  │
   │  ▼
5. getReplyFromConfig()
   │  ├── 解析 sessionKey，确定 agentId
   │  ├── 加载 Agent 配置（模型、工作区等）
   │  ├── 确保工作区目录存在
   │  ├── 解析命令（/new, /help 等）
   │  │    └── 如果是命令 → 直接处理，不进 Agent
   │  ├── 初始化会话状态（新/续/重置）
   │  │
   │  ▼
6. runEmbeddedPiAgent()
   │  ├── 排队（同一会话串行）
   │  │
   │  ▼
7. runEmbeddedAttempt()
   │  ├── 创建 SessionManager + AgentSession
   │  ├── 加载工具集（OpenClaw 工具 + 插件工具）
   │  ├── [钩子] before_agent_start → 插件注入上下文
   │  ├── 调用大模型（streamSimple）
   │  │    ├── 大模型思考...
   │  │    ├── 大模型调用工具
   │  │    │    ├── [钩子] before_tool_call
   │  │    │    ├── 工具执行（可能触发 HITL 审批）
   │  │    │    ├── [钩子] tool_result_persist
   │  │    │    └── 继续思考...
   │  │    └── 大模型输出回复
   │  ├── [钩子] agent_end → 通知插件
   │  └── 返回回复文本
   │
   ▼
8. 回复路由
   │  ├── TTS 处理（如果启用语音）
   │  ├── 通过 Telegram 渠道发送回复
   │  └── 用户在 Telegram 看到回复
```

以一个 **Web UI 用户发消息** 为例，路径略有不同：

```
1. Web UI 通过 WebSocket 发送
   │  { method: "chat.send", params: { message: "帮我看看文件" } }
   │
   ▼
2. Gateway WebSocket handler
   │  ├── 权限检查（operator.write scope）
   │  ├── chatHandlers["chat.send"]
   │
   ▼
3. 从这里开始走同一条路径
   │  dispatchReplyFromConfig() → getReplyFromConfig() → runEmbeddedPiAgent()
   │  （和 Telegram 一样）
   │
   ▼
4. 回复通过 WebSocket event 推送回客户端
   │  { type: "event", event: "agent.delta", payload: { text: "..." } }
```

**核心结论**：不管消息从哪个入口进来（Telegram、Web UI、HTTP API、Webhook），最终都会汇聚到 `getReplyFromConfig()` → `runEmbeddedPiAgent()` 这条路径。

---

## 9. Gateway 的附属服务

Gateway 除了处理消息，还管理一些附属服务：

| 服务                 | 作用                                     |
| -------------------- | ---------------------------------------- |
| **定时任务 (Cron)**  | 按计划自动触发 Agent，如每天早上发摘要   |
| **心跳 (Heartbeat)** | 定期检查系统事件队列，处理唤醒请求       |
| **健康监控**         | 定期刷新各渠道/服务的健康状态            |
| **网络发现 (mDNS)**  | 让同一局域网的设备自动发现 Gateway       |
| **Tailscale 暴露**   | 通过 Tailscale Serve/Funnel 远程访问     |
| **浏览器控制**       | 管理 Puppeteer 浏览器实例                |
| **Canvas Host**      | 为 A2UI（富 UI）提供服务                 |
| **配置热重载**       | 监听配置文件变化，动态更新（不需要重启） |
| **Gmail 监控**       | 监听邮箱新邮件，触发 Hook                |
| **插件服务**         | 插件注册的后台服务                       |

这些服务都在 `startGatewaySidecars()` 中启动，生命周期由 Gateway 统一管理。

---

## 10. 关键代码索引

| 文件                                                  | 职责                                                  |
| ----------------------------------------------------- | ----------------------------------------------------- |
| `src/gateway/server.impl.ts`                          | Gateway 主入口：`startGatewayServer`，编排所有服务    |
| `src/gateway/server-http.ts`                          | HTTP 服务器：路由分发，端点注册                       |
| `src/gateway/server-ws-runtime.ts`                    | WebSocket 绑定                                        |
| `src/gateway/server/ws-connection.ts`                 | WS 连接处理：握手、认证                               |
| `src/gateway/server/ws-connection/message-handler.ts` | WS 消息分发                                           |
| `src/gateway/auth.ts`                                 | 认证：`resolveGatewayAuth`、`authorizeGatewayConnect` |
| `src/gateway/server-methods.ts`                       | RPC 方法注册、权限检查、请求分发                      |
| `src/gateway/server-channels.ts`                      | 渠道管理器：启动/停止渠道                             |
| `src/gateway/openai-http.ts`                          | OpenAI 兼容 API                                       |
| `src/gateway/openresponses-http.ts`                   | OpenResponses API                                     |
| `src/gateway/hooks.ts`                                | HTTP Webhook 配置与解析                               |
| `src/gateway/hooks-mapping.ts`                        | Webhook 映射规则                                      |
| `src/gateway/server/hooks.ts`                         | Webhook 分发                                          |
| `src/gateway/server-startup.ts`                       | 附属服务启动                                          |
| `src/gateway/server-close.ts`                         | 优雅关闭                                              |
| `src/gateway/server-discovery-runtime.ts`             | mDNS 网络发现                                         |
| `src/gateway/server-tailscale.ts`                     | Tailscale 暴露                                        |
| `src/gateway/config-reload.ts`                        | 配置热重载                                            |
| `src/auto-reply/reply/dispatch-from-config.ts`        | 消息分发入口                                          |
| `src/auto-reply/reply/get-reply.ts`                   | 会话管理 + Agent 调用入口                             |

---

> **总结**：Gateway 是 OpenClaw 与外部世界的唯一接口。它通过 WebSocket RPC 服务"智能客户端"（Web UI、App），通过 HTTP 服务"哑客户端"（Webhook、REST API），通过消息渠道服务"IM 用户"（Telegram、Discord 等）。三种入口最终汇聚到同一条消息处理路径，经过归一化、命令解析、会话管理后进入 Agent 核心。认证和权限确保只有授权的外部系统能连进来，并且只能做被允许的操作。
