# OpenClaw vs Coobee-AI 架构深度对比与改进方案

## 文档概述

本文档对比分析 **OpenClaw** 和 **Coobee-AI** 的扩展机制、插件系统和事件架构，并结合**酒馆任务系统**的外部服务对接需求，提出完整的架构改进方案。

**分析范围**：

1. 扩展机制对比（SDK Extension vs Plugin）
2. 插件加载生命周期
3. Channel 模式架构
4. Gateway 与工具系统
5. 事件系统与生命周期管理
6. 酒馆任务系统的外部服务对接

**参考文档**：

- OpenClaw: `37-extension-vs-plugin-mechanisms.md`
- OpenClaw: `38-plugin-loading-lifecycle.md`
- OpenClaw: `39-channel-modes-architecture.md`
- Coobee-AI: `tavern-agent-integration-architecture.md`

---

## 目录

1. [架构对比总览](#1-架构对比总览)
2. [当前 Coobee-AI 架构分析](#2-当前-coobee-ai-架构分析)
3. [OpenClaw 核心设计优势](#3-openclaw-核心设计优势)
4. [改进方案：双层扩展架构](#4-改进方案双层扩展架构)
5. [改进方案：外部服务对接](#5-改进方案外部服务对接)
6. [改进方案：Gateway Client 架构](#6-改进方案gateway-client-架构)
7. [详细实施计划](#7-详细实施计划)
8. [风险评估与缓解](#8-风险评估与缓解)

---

## 1. 架构对比总览

### 1.1 扩展机制对比

| 维度              | OpenClaw                                      | Coobee-AI（当前）                  | 差距                   |
| ----------------- | --------------------------------------------- | ---------------------------------- | ---------------------- |
| **扩展系统层级**  | 双层（SDK Extension + Plugin）                | 单层（Extension = Plugin）         | ⚠️ 缺少 SDK 层优化能力 |
| **扩展路径**      | 4 级（config → workspace → global → bundled） | 3 级（workspace → user → builtin） | ✅ 基本覆盖            |
| **加载器**        | jiti + alias（openclaw/plugin-sdk）           | jiti（基础版）                     | ⚠️ 无 alias 映射       |
| **Manifest**      | `openclaw.plugin.json` + package.json         | `extension.json`                   | ✅ 类似设计            |
| **工具注册**      | ✅ 支持                                       | ✅ 支持                            | ✅ 一致                |
| **Gateway 方法**  | ✅ 支持                                       | ⚠️ 已实现但未生效                  | ⚠️ 需修复              |
| **通道注册**      | ✅ registerChannel                            | ❌ 无                              | ❌ 缺失核心能力        |
| **HTTP 路由**     | ✅ registerHttpRoute                          | ❌ 无                              | ❌ 缺失                |
| **后台服务**      | ✅ registerService                            | ❌ 无                              | ❌ 缺失                |
| **CLI 命令**      | ✅ registerCli                                | ❌ 无                              | ❌ 缺失                |
| **Provider 注册** | ✅ registerProvider                           | ❌ 无                              | ❌ 缺失                |
| **热插拔**        | ✅ 支持                                       | ✅ 支持                            | ✅ 一致                |
| **配置热重载**    | ✅ 细粒度规则                                 | ✅ 基础支持                        | ⚠️ 规则不够细          |

### 1.2 生命周期 Hooks 对比

| Hook 类型                | OpenClaw Plugin | Coobee-AI Extension | 说明        |
| ------------------------ | --------------- | ------------------- | ----------- |
| before_agent_start       | ✅              | ✅                  | 一致        |
| agent_end                | ✅              | ✅                  | 一致        |
| before_tool_call         | ✅              | ✅                  | 一致        |
| after_tool_call          | ✅              | ✅                  | 一致        |
| tool_result_persist      | ✅              | ✅                  | 一致        |
| session_start            | ✅              | ✅                  | 一致        |
| session_end              | ✅              | ✅                  | 一致        |
| turn_start               | ✅              | ✅                  | 一致        |
| turn_end                 | ✅              | ✅                  | 一致        |
| before_compaction        | ✅              | ✅                  | 一致        |
| after_compaction         | ✅              | ✅                  | 一致        |
| message_received         | ✅              | ✅                  | 一致        |
| message_queued           | ✅              | ✅                  | 一致        |
| message_dequeued         | ✅              | ✅                  | 一致        |
| queue_drain_start        | ✅              | ✅                  | 一致        |
| model_resolved           | ✅              | ✅                  | 一致        |
| model_fallback           | ✅              | ✅                  | 一致        |
| **gateway_start**        | ✅              | ❌                  | Coobee 缺失 |
| **gateway_stop**         | ✅              | ❌                  | Coobee 缺失 |
| **before_model_resolve** | ✅              | ❌                  | Coobee 缺失 |
| **before_prompt_build**  | ✅              | ❌                  | Coobee 缺失 |
| **llm_input**            | ✅              | ❌                  | Coobee 缺失 |
| **llm_output**           | ✅              | ❌                  | Coobee 缺失 |
| **message_sending**      | ✅              | ❌                  | Coobee 缺失 |
| **message_sent**         | ✅              | ❌                  | Coobee 缺失 |
| **before_message_write** | ✅              | ❌                  | Coobee 缺失 |
| **before_reset**         | ✅              | ❌                  | Coobee 缺失 |

**总结**：

- ✅ Coobee-AI 的 17 个 Hooks 与 OpenClaw 的部分 Hooks 对齐
- ⚠️ OpenClaw 有 10 个额外的 Hooks，覆盖更多生命周期阶段

### 1.3 Channel 对接能力对比

| 能力           | OpenClaw                     | Coobee-AI | 说明               |
| -------------- | ---------------------------- | --------- | ------------------ |
| **通道抽象**   | ✅ ChannelPlugin             | ❌ 无     | OpenClaw 核心特性  |
| **投递模式**   | ✅ direct/gateway/hybrid     | ❌ 无     | 支持多种投递策略   |
| **连接模式**   | ✅ websocket/webhook/polling | ❌ 无     | 灵活的入站消息接收 |
| **多账号**     | ✅ accounts.\*               | ❌ 无     | 支持单通道多账号   |
| **健康检查**   | ✅ channelHealthCheckMinutes | ❌ 无     | 自动重启           |
| **配置热重载** | ✅ restart-channel           | ❌ 无     | 通道级热重载       |

**总结**：

- ❌ Coobee-AI 无 Channel 概念，所有对接都通过 HTTP API 或手动集成
- ⚠️ 缺少外部服务对接的通用抽象

---

## 2. 当前 Coobee-AI 架构分析

### 2.1 当前架构图

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Coobee-AI 当前架构                                  │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐    │
│  │                          应用层 (Electron App)                          │    │
│  │                                                                          │    │
│  │  ┌──────────────┐       ┌──────────────┐       ┌──────────────┐       │    │
│  │  │   Vue 3 前端  │◄─────►│  Gateway     │◄─────►│  Extension   │       │    │
│  │  │              │  WS   │  WebSocket   │       │  System      │       │    │
│  │  └──────────────┘       └──────┬───────┘       └──────┬───────┘       │    │
│  │                                 │                       │               │    │
│  │                                 │                       │               │    │
│  └─────────────────────────────────┼───────────────────────┼───────────────┘    │
│                                    │                       │                     │
│  ┌─────────────────────────────────┼───────────────────────┼───────────────┐    │
│  │                          AI 层 (Agent Executor)          │               │    │
│  │                                 │                       │               │    │
│  │  ┌──────────────┐       ┌───────▼───────┐       ┌──────▼───────┐       │    │
│  │  │ AgentExecutor│◄─────►│  ToolRegistry │◄─────►│  Extension   │       │    │
│  │  │              │       │               │       │  Tools       │       │    │
│  │  └──────┬───────┘       └───────────────┘       └──────────────┘       │    │
│  │         │                                                                │    │
│  │         │                                                                │    │
│  │  ┌──────▼───────┐                                                       │    │
│  │  │  PiMono /    │                                                       │    │
│  │  │  OpenAI      │                                                       │    │
│  │  │  Runtime     │                                                       │    │
│  │  └──────────────┘                                                       │    │
│  │                                                                          │    │
│  └──────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │                        基础设施层 (Infrastructure)                        │    │
│  │                                                                          │    │
│  │  ┌──────────────┐       ┌──────────────┐       ┌──────────────┐       │    │
│  │  │   EventBus   │       │  ConfigStore │       │  LifecycleHook│       │    │
│  │  │              │       │              │       │               │       │    │
│  │  └──────────────┘       └──────────────┘       └──────────────┘       │    │
│  │                                                                          │    │
│  └──────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

外部服务（酒馆、第三方平台）
        │
        │ 手动集成（HTTP API）
        ▼
    Coobee-AI
    （无通用对接层）
```

### 2.2 核心特点

**优势**：

- ✅ **17 个生命周期 Hooks**：覆盖 Agent 执行的主要阶段
- ✅ **Extension 热插拔**：支持动态加载/卸载扩展
- ✅ **工具注册机制**：Extension 可注册工具，注入 ToolRegistry
- ✅ **配置热重载**：ConfigWatcher + 热重载规则
- ✅ **统一 Agent 架构**：所有 LLM 交互通过 Agent
- ✅ **多级配置系统**：builtin + user + workspace

**劣势**：

- ❌ **单一扩展层级**：无 SDK 层和应用层的分离
- ❌ **Extension Gateway 方法未生效**：已实现但未集成
- ❌ **无 Channel 抽象**：外部服务对接需要手动实现
- ❌ **无通用外部服务客户端**：每个外部服务都要重复实现
- ❌ **缺少系统级扩展能力**：无 HTTP 路由、后台服务、CLI 命令、Provider 注册
- ❌ **酒馆系统孤立**：无事件集成，无 Agent 自动接取

### 2.3 Extension 工作流程

```
应用启动
  ↓
ReadyExtensionHook (priority 50)
  ↓
1. ExtensionLoader.loadAll([builtinDir, userDir])
   ├── 扫描目录，查找 extension.json
   ├── jiti.import(index.ts)
   ├── register(api)
   └── registry.registerTool / registry.registerHook
  ↓
2. 注入 ToolRegistry
   └── ToolRegistry.getInstance().register(tool)
  ↓
3. loader.watch(searchPaths)
   └── fs.watch 监听新增/删除
  ↓
Agent 执行时
  ↓
4. loadWorkspaceExtensions(workspace/extensions)
   └── 任务级 Extension
  ↓
5. runExtensionHooks('before_agent_start', ...)
   └── 修改 prompt/systemPrompt
  ↓
6. runtime.stream(message)
   └── tool call → ToolExecutionPipeline
       ├── before_tool_call Hook
       ├── tool.execute()
       └── after_tool_call Hook
  ↓
7. runExtensionEndHooks('agent_end', ...)
  ↓
8. unloadWorkspaceExtensions()
```

---

## 3. OpenClaw 核心设计优势

### 3.1 双层扩展架构

#### 3.1.1 设计理念

```
┌───────────────────────────────────────────────────────────────────┐
│                      OpenClaw 双层扩展架构                         │
└───────────────────────────────────────────────────────────────────┘

应用层 Plugin（OpenClawPluginApi）
  ├── 职责：系统级功能扩展、第三方集成
  ├── 能力：通道、HTTP、Gateway、服务、Provider、CLI
  ├── 位置：extensions/
  ├── 加载：loadOpenClawPlugins()
  └── 示例：feishu、msteams、memory-lancedb、voice-call
             ↓ 选择性传递工具
──────────────────────────────────────────────────────────────────
SDK 层 Extension（ExtensionAPI）
  ├── 职责：Agent Session 内部优化
  ├── 能力：工具、命令、标志、快捷键、事件钩子
  ├── 位置：.pi/extensions/ 或 src/agents/pi-extensions/
  ├── 加载：SDK DefaultResourceLoader
  └── 示例：compaction-safeguard、context-pruning
```

#### 3.1.2 优势说明

1. **职责分离**
   - SDK 层：Agent 内部优化（压缩、修剪、Token 估算）
   - 应用层：系统集成（通道、服务、工具）

2. **独立部署**
   - SDK 扩展：随 Agent 加载，轻量级
   - 应用插件：独立 npm 包，有自己的依赖

3. **灵活组合**
   - Plugin 可以贡献 SDK 扩展给特定 Agent
   - Plugin 可以注册工具，SDK 扩展可以使用这些工具

### 3.2 四级插件搜索路径

```
优先级 1 (最高): plugins.loadPaths（配置显式指定）
  └── 用户完全控制，可加载任意路径的插件

优先级 2: 工作区/.openclaw/extensions/
  └── 项目级插件，与工作区绑定

优先级 3: ~/.openclaw/extensions/
  └── 全局用户插件，跨项目共享

优先级 4 (最低): OpenClaw/extensions/
  └── 内置插件（37 个），随软件分发
```

**优势**：

- ✅ 用户可以通过配置覆盖任意内置插件
- ✅ 项目级插件不影响其他项目
- ✅ 全局插件跨项目复用
- ✅ 内置插件作为兜底，开箱即用

**Coobee-AI 对比**：

- ✅ 已有 3 级路径：`workspace → user → builtin`
- ⚠️ 缺少配置显式指定路径（`loadPaths`）

### 3.3 插件能力矩阵

| 能力                        | OpenClaw Plugin | Coobee-AI Extension | 用途                        |
| --------------------------- | --------------- | ------------------- | --------------------------- |
| **registerTool**            | ✅              | ✅                  | 注册工具                    |
| **registerCommand**         | ✅              | ❌                  | 注册聊天命令                |
| **on (生命周期 Hook)**      | ✅              | ✅                  | 注册生命周期钩子            |
| **registerHook (Internal)** | ✅              | ❌                  | 注册内部事件钩子            |
| **registerChannel**         | ✅              | ❌                  | 注册通道（核心能力）        |
| **registerHttpRoute**       | ✅              | ❌                  | 注册 HTTP 路由              |
| **registerGatewayMethod**   | ✅              | ⚠️ 已实现未生效     | 注册 RPC 方法               |
| **registerService**         | ✅              | ❌                  | 注册后台服务                |
| **registerProvider**        | ✅              | ❌                  | 注册 AI Provider            |
| **registerCli**             | ✅              | ❌                  | 注册 CLI 命令               |
| **resolvePath**             | ✅              | ❌                  | 解析相对路径                |
| **logger**                  | ✅              | ✅                  | 日志记录器                  |
| **config**                  | ✅              | ✅                  | 全局配置                    |
| **pluginConfig**            | ✅              | ❌                  | 插件独立配置                |
| **runtime**                 | ✅              | ❌                  | 运行时环境                  |
| **services**                | ❌              | ✅                  | 核心服务接口（Coobee 独有） |
| **eventBus**                | ❌              | ✅                  | 事件总线接口（Coobee 独有） |

**关键差异**：

- OpenClaw Plugin 能力更丰富（特别是通道、服务、Provider）
- Coobee-AI Extension 提供了 `services` 和 `eventBus` 接口（更易用）

### 3.4 Channel 模式架构

#### 3.4.1 投递模式（Delivery Mode）

| 模式        | 执行位置     | 连接类型      | 典型应用                 | 状态共享 |
| ----------- | ------------ | ------------- | ------------------------ | -------- |
| **direct**  | Agent 进程内 | 短连接 HTTP   | Telegram, Slack, Discord | ❌       |
| **gateway** | Gateway 进程 | 长连接/有状态 | WhatsApp (Baileys)       | ✅       |
| **hybrid**  | 动态选择     | 混合          | 预留扩展                 | 部分     |

#### 3.4.2 连接模式（Connection Mode）

| 模式             | 特点              | 典型应用                  | 实时性 | 复杂度 |
| ---------------- | ----------------- | ------------------------- | ------ | ------ |
| **websocket**    | 长连接，事件推送  | Feishu, Telegram, Discord | 高     | 中     |
| **webhook**      | HTTP POST，无状态 | Feishu, Slack             | 高     | 中     |
| **polling**      | 定期拉取          | iMessage, Signal          | 低     | 低     |
| **event-driven** | Baileys/Puppeteer | WhatsApp                  | 高     | 高     |

#### 3.4.3 通道生命周期

```
ChannelManager.startChannel(channelId, accountId)
  ↓
检查状态（enabled、configured、running）
  ↓
plugin.gateway.startAccount(ctx)
  ├── WebSocket 模式：创建 WS 客户端 + 监听事件
  ├── Webhook 模式：注册 HTTP 路由 + 等待 POST
  └── Event 模式：启动 Baileys/Puppeteer
  ↓
监听 AbortSignal（停止时触发）
  ↓
异常时自动重启（指数退避，最多 10 次）
  ↓
plugin.gateway.stopAccount(ctx)
  └── 清理资源（关闭连接、注销路由）
```

**健康检查**：

- 每 5 分钟检查一次所有通道状态
- 发现 `enabled && configured && !running && !manuallyStopped` 时自动重启

---

## 3. OpenClaw 核心设计优势（续）

### 3.5 插件配置系统

#### 3.5.1 配置 Schema

OpenClaw Plugin 可以声明 `configSchema`（JSON Schema）：

```json
{
  "id": "feishu",
  "configSchema": {
    "type": "object",
    "properties": {
      "appId": { "type": "string" },
      "appSecret": { "type": "string" },
      "connectionMode": {
        "type": "string",
        "enum": ["websocket", "webhook"]
      }
    },
    "required": ["appId", "appSecret"]
  }
}
```

**加载时验证**：

- `validatePluginConfig()` 验证 `plugins.<id>.*` 配置
- 验证失败 → 插件标记为 `status: "error"`，不加载

**Coobee-AI 对比**：

- ⚠️ Extension 无配置验证机制
- ⚠️ Extension 无独立配置命名空间

#### 3.5.2 配置热重载细粒度控制

**OpenClaw 规则**：

```typescript
{ prefix: "channels.feishu", kind: "hot", actions: ["restart-channel:feishu"] },
{ prefix: "plugins", kind: "restart" },  // 插件启用/禁用需重启
```

**Coobee-AI 规则**：

```typescript
{ prefix: 'ui.theme', kind: 'hot' },
{ prefix: 'models', kind: 'none' },
// 无 Extension 级热重载规则
```

**差距**：

- ⚠️ Coobee-AI 无法针对不同 Extension 声明不同的热重载策略
- ⚠️ Coobee-AI 的 Extension 配置变更无明确处理规则

### 3.6 插件安装与卸载

#### 3.6.1 OpenClaw 安装流程

```bash
# 方式 1：CLI 自动安装
openclaw plugins install @openclaw/feishu

# 方式 2：手动安装
cd ~/.openclaw/extensions/
npm install @openclaw/feishu
openclaw config set plugins.enabled feishu
```

**CLI 自动完成**：

1. npm install 到 `~/.openclaw/extensions/`
2. 记录到 `plugins.installs.<id>`
3. 添加到 `plugins.enabled`
4. 提示重启 Gateway

#### 3.6.2 OpenClaw 卸载流程

```bash
openclaw plugins uninstall feishu
```

**自动完成**：

1. 从 `plugins.entries` 移除
2. 从 `plugins.installs` 移除
3. 从 `plugins.allow` 移除
4. 从 `plugins.loadPaths` 移除
5. 从 `plugins.slots.memory` 移除
6. 删除安装目录（仅 npm 安装的）

**安全措施**：

- ✅ 不删除从本地路径加载的插件
- ✅ 不信任配置中的 `installPath`（防止误删）
- ✅ 严格验证路径是否为插件默认安装目录

#### 3.6.3 Coobee-AI 现状

- ❌ 无 Extension 安装/卸载 CLI 命令
- ⚠️ 只能手动放置文件，依赖热插拔自动加载
- ⚠️ 卸载需要手动删除目录，无配置清理

---

## 4. 改进方案：双层扩展架构

### 4.1 架构设计

参考 OpenClaw 的分层设计，将 Coobee-AI 的扩展系统重构为**双层架构**：

```
┌───────────────────────────────────────────────────────────────────┐
│                    Coobee-AI 双层扩展架构                          │
└───────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│ 应用层 Plugin（系统级扩展）                                        │
│                                                                    │
│  位置：extensions/                                                 │
│  加载：PluginLoader.loadAll()                                      │
│  API：PluginApi (丰富的系统能力)                                   │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ 应用层专属能力                                            │    │
│  │ • registerChannel()        ← 外部服务对接（酒馆、IM）      │    │
│  │ • registerHttpRoute()      ← HTTP API 扩展               │    │
│  │ • registerGatewayMethod()  ← Gateway RPC 方法            │    │
│  │ • registerService()        ← 后台长运行任务               │    │
│  │ • registerProvider()       ← AI Provider 扩展            │    │
│  │ • registerCli()            ← CLI 命令扩展                │    │
│  │ • registerTool()           ← Agent 工具                  │    │
│  │ • on()                     ← 生命周期钩子（25+ 种）       │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                    │
│  示例插件：                                                        │
│  • tavern-integration：酒馆任务系统对接                            │
│  • memory-lancedb：向量记忆系统                                    │
│  • voice-call：语音通话集成                                        │
│  • external-services：通用外部服务客户端                           │
└───────────────────────────────────────────────────────────────────┘
                                ↓
                    选择性传递工具和 SDK 扩展
                                ↓
┌───────────────────────────────────────────────────────────────────┐
│ Agent 层 Extension（Agent 内部优化）                               │
│                                                                    │
│  位置：.coobee/extensions/ 或 src/main/ai/extensions/              │
│  加载：AgentExecutor 传给 PiMono SDK                               │
│  API：AgentExtensionApi (基础能力)                                 │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Agent 层专属能力                                          │    │
│  │ • api.on()           ← SDK 事件钩子                      │    │
│  │ • registerTool()     ← Agent Session 级工具              │    │
│  │ • registerCommand()  ← 命令注册                          │    │
│  │ • registerFlag()     ← 标志注册                          │    │
│  │ • registerShortcut() ← 快捷键注册                        │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                    │
│  示例扩展：                                                        │
│  • compaction-safeguard：会话压缩优化                              │
│  • context-pruning：上下文修剪                                     │
└───────────────────────────────────────────────────────────────────┘
                                ↓
                    在 Agent Session 内部工作
                                ↓
                    PiMono SDK createAgentSession()
```

### 4.2 职责划分表

| 扩展类型               | 职责范围         | 典型用途                 | 加载时机     | 生命周期        |
| ---------------------- | ---------------- | ------------------------ | ------------ | --------------- |
| **应用层 Plugin**      | 系统级           | 外部服务、通道、后台任务 | 应用启动时   | 随应用存在      |
| **Agent 层 Extension** | Agent Session 级 | 内部优化、性能调优       | Agent 启动前 | 随 Session 存在 |

### 4.3 实施细节

#### 4.3.1 保留现有 Extension 系统

**决策**：保留当前的 `Extension` 系统作为**应用层 Plugin**

**理由**：

- ✅ Coobee-AI 的 Extension 本质上就是应用层扩展
- ✅ 已有完整的加载、注册、热插拔机制
- ✅ 避免大规模重构，渐进式演进

**调整**：

1. 重命名概念：`Extension` → `Plugin`（对外 API 和文档）
2. 保持代码兼容：内部类名和文件名可以不变（仅 alias）
3. 增强能力：添加 `registerChannel`、`registerHttpRoute`、`registerService` 等

#### 4.3.2 新增 Agent 层 Extension

**目标**：支持 PiMono SDK 的 Agent 内部扩展

**实现路径**：

1. 在 `PiMonoAgentRuntime` 中添加 `additionalExtensionPaths` 参数
2. 从 Plugin 中提取需要传递给 SDK 的扩展路径
3. 传递给 `createAgentSession({ additionalExtensionPaths })`

**示例**：

```typescript
// Plugin 贡献 SDK 扩展
const tavernPlugin = {
  id: 'tavern-integration',
  register(api: PluginApi) {
    // 1. 注册应用层能力（通道、工具）
    api.registerChannel({ ... });
    api.registerTool({ ... });

    // 2. 贡献 SDK 扩展（可选）
    api.contributeAgentExtension({
      path: path.join(__dirname, 'agent-extension.ts'),
      enabledByDefault: false,
    });
  },
};
```

---

## 5. 改进方案：外部服务对接

### 5.1 问题分析

**当前酒馆系统的问题**：

1. ❌ 酒馆 HTTP API（`/gateway/tavern/*`）与主系统耦合，不是独立服务
2. ❌ 无事件推送，Agent 无法监听新任务
3. ❌ 无通用的外部服务对接层，每个服务都要重复实现
4. ❌ 无 Agent 工具封装，Agent 无法主动查询和操作任务

### 5.2 改进目标

**将酒馆视为独立外部服务**，通过 **Channel 抽象** 实现通用对接：

```
酒馆系统（独立服务 localhost:9900）
    ├── WebSocket Server (/events)     → 推送任务事件
    └── HTTP API (/api/*)               → 任务 CRUD
            │
            ▼
Coobee-AI Plugin: external-services
    ├── ExternalChannel（通道抽象）
    ├── ExternalGatewayClient（WS 客户端）
    └── ExternalTools（工具生成器）
            │
            ▼
主系统
    ├── EventBus：接收 external.tavern.* 事件
    ├── ToolRegistry：注册 external_tavern_* 工具
    └── TaskAcceptanceService：订阅事件并执行
```

### 5.3 Channel 抽象设计

#### 5.3.1 ExternalChannel 接口

```typescript
// src/main/channels/types.ts

/** 外部服务通道配置 */
export interface ExternalChannelConfig {
  id: string; // 服务 ID（如 'tavern'）
  name: string; // 服务名称
  wsUrl?: string; // WebSocket 事件推送地址
  apiUrl?: string; // HTTP API 地址
  authToken?: string; // 认证令牌
  enabled: boolean; // 是否启用
  reconnect?: boolean; // 是否自动重连
  heartbeat?: number; // 心跳间隔（ms）
}

/** 外部服务通道插件 */
export interface ExternalChannelPlugin {
  id: string;
  name: string;
  config: ExternalChannelConfig;

  /** 入站适配器：外部事件 → 系统事件 */
  inbound: {
    /** 事件类型映射 */
    eventMapping: Record<string, string>;
    /** 事件转换器 */
    transformEvent?: (rawEvent: unknown) => ExternalEvent;
  };

  /** 出站适配器：系统调用 → 外部 API */
  outbound: {
    /** 生成工具定义 */
    generateTools: () => ToolDefinition[];
  };

  /** Gateway 生命周期钩子 */
  gateway?: {
    /** 启动通道监听 */
    start?: (ctx: ChannelContext) => Promise<void>;
    /** 停止通道监听 */
    stop?: (ctx: ChannelContext) => Promise<void>;
  };
}
```

#### 5.3.2 酒馆 Channel 实现

```typescript
// extensions/tavern-integration/src/TavernChannel.ts

export const tavernChannel: ExternalChannelPlugin = {
  id: 'tavern',
  name: '酒馆任务系统',
  config: {
    id: 'tavern',
    name: '酒馆任务系统',
    wsUrl: 'ws://localhost:9900/events',
    apiUrl: 'http://localhost:9900/api',
    enabled: true,
    reconnect: true,
    heartbeat: 30000
  },

  // 入站：酒馆事件 → 系统事件
  inbound: {
    eventMapping: {
      'task.created': 'external.tavern.task.created',
      'task.updated': 'external.tavern.task.updated',
      'task.completed': 'external.tavern.task.completed'
    },
    transformEvent: (rawEvent) => {
      // 标准化事件格式
      return {
        type: rawEvent.type,
        data: rawEvent.data,
        timestamp: rawEvent.timestamp || Date.now(),
        serviceId: 'tavern'
      };
    }
  },

  // 出站：生成 Agent 工具
  outbound: {
    generateTools: () => [
      {
        name: 'external_tavern_list_tasks',
        description: 'List tasks from Tavern system',
        parameters: z.object({
          status: z.enum(['pending', 'accepted', 'in-progress', 'completed', 'cancelled']).optional()
        }),
        execute: async (params) => {
          const url = new URL(`${tavernChannel.config.apiUrl}/tasks`);
          if (params.status) url.searchParams.set('status', params.status);
          const response = await fetch(url.toString());
          return await response.json();
        }
      },
      {
        name: 'external_tavern_accept_task',
        description: 'Accept a task from Tavern',
        parameters: z.object({
          taskId: z.string(),
          agentId: z.string()
        }),
        execute: async (params) => {
          const response = await fetch(`${tavernChannel.config.apiUrl}/tasks/${params.taskId}/accept`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: params.agentId })
          });
          return await response.json();
        }
      },
      {
        name: 'external_tavern_submit_result',
        description: 'Submit task result to Tavern',
        parameters: z.object({
          taskId: z.string(),
          textResult: z.string(),
          fileResults: z.array(z.string()).optional()
        }),
        execute: async (params) => {
          const response = await fetch(`${tavernChannel.config.apiUrl}/tasks/${params.taskId}/result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
          });
          return await response.json();
        }
      }
    ]
  },

  // Gateway 生命周期
  gateway: {
    start: async (ctx) => {
      const { log, abortSignal } = ctx;
      log.info('[TavernChannel] Starting WebSocket client...');

      // 创建 WebSocket 客户端
      const client = new ExternalGatewayClient(tavernChannel.config);
      await client.connect();

      // 监听停止信号
      abortSignal.addEventListener('abort', () => {
        client.disconnect();
        log.info('[TavernChannel] Stopped');
      });
    },

    stop: async (ctx) => {
      // 清理资源
    }
  }
};
```

### 5.4 ExternalGatewayClient（通用 WS 客户端）

```typescript
// src/main/channels/ExternalGatewayClient.ts

export class ExternalGatewayClient {
  private ws: WebSocket | null = null;
  private status: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private config: ExternalChannelConfig) {}

  async connect(): Promise<void> {
    this.status = 'connecting';

    this.ws = new WebSocket(this.config.wsUrl!, {
      headers: this.config.authToken ? { Authorization: `Bearer ${this.config.authToken}` } : {}
    });

    this.setupEventHandlers();

    await new Promise<void>((resolve, reject) => {
      this.ws!.once('open', () => {
        this.status = 'connected';
        resolve();
      });
      this.ws!.once('error', reject);
    });

    if (this.config.heartbeat) {
      this.startHeartbeat();
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.status = 'disconnected';
  }

  private setupEventHandlers(): void {
    this.ws!.on('message', (data) => {
      const event = JSON.parse(data.toString());
      this.forwardEvent(event);
    });

    this.ws!.on('close', () => {
      this.status = 'disconnected';
      if (this.config.reconnect) {
        this.scheduleReconnect();
      }
    });

    this.ws!.on('error', (err) => {
      log.error(`[${this.config.id}] WebSocket error:`, err);
      this.status = 'error';
    });
  }

  private forwardEvent(event: unknown): void {
    // 统一事件格式：external.{serviceId}.{eventType}
    const eventName = `external.${this.config.id}.${event.type}`;
    eventBus.emit(eventName, event.data);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.ws?.ping();
    }, this.config.heartbeat!);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    setTimeout(() => {
      this.connect().catch((err) => {
        log.error(`[${this.config.id}] Reconnect failed:`, err);
      });
    }, 5000);
  }
}
```

### 5.5 ChannelManager（通道生命周期管理）

```typescript
// src/main/channels/ChannelManager.ts

export class ChannelManager {
  private channels: Map<string, ExternalChannelPlugin> = new Map();
  private clients: Map<string, ExternalGatewayClient> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();

  /**
   * 注册通道
   */
  registerChannel(channel: ExternalChannelPlugin): void {
    this.channels.set(channel.id, channel);
  }

  /**
   * 启动所有通道
   */
  async startAll(): Promise<void> {
    for (const [id, channel] of this.channels.entries()) {
      if (!channel.config.enabled) {
        continue;
      }
      await this.startChannel(id);
    }
  }

  /**
   * 启动单个通道
   */
  async startChannel(channelId: string): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // 创建 AbortController
    const abort = new AbortController();
    this.abortControllers.set(channelId, abort);

    // 调用插件的 gateway.start
    if (channel.gateway?.start) {
      const ctx: ChannelContext = {
        config: channel.config,
        log: log.child({ channel: channelId }),
        abortSignal: abort.signal,
      };

      await channel.gateway.start(ctx);
    }
  }

  /**
   * 停止通道
   */
  async stopChannel(channelId: string): Promise<void> {
    const abort = this.abortControllers.get(channelId);
    abort?.abort();

    const channel = this.channels.get(channelId);
    if (channel?.gateway?.stop) {
      await channel.gateway.stop({ ... });
    }

    this.abortControllers.delete(channelId);
    this.clients.delete(channelId);
  }

  /**
   * 获取通道状态
   */
  getStatus(): Record<string, { enabled: boolean; connected: boolean }> {
    const status: Record<string, any> = {};
    for (const [id, client] of this.clients.entries()) {
      status[id] = {
        enabled: this.channels.get(id)?.config.enabled ?? false,
        connected: client.getStatus() === 'connected',
      };
    }
    return status;
  }
}
```

---

## 6. 改进方案：Gateway Client 架构

### 6.1 架构设计

**核心思路**：将外部服务抽象为 **Channel**，通过 **ChannelManager** 统一管理。

```
┌─────────────────────────────────────────────────────────────────┐
│                   改进后的外部服务对接架构                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 应用层（Plugin）                                                 │
│                                                                  │
│  extensions/tavern-integration/                                  │
│  ├── index.ts                                                    │
│  ├── TavernChannel.ts      ← 实现 ExternalChannelPlugin         │
│  ├── TavernTools.ts         ← 生成 external_tavern_* 工具       │
│  └── extension.json                                              │
│                                                                  │
│  Plugin 注册：                                                   │
│  • api.registerChannel(tavernChannel)                            │
│  • api.registerTool(...) 或 channel.outbound.generateTools()     │
│  • api.registerService(TaskAcceptanceService)                    │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│ Channel 层（通道管理）                                           │
│                                                                  │
│  ChannelManager                                                  │
│  ├── registerChannel(channel)                                    │
│  ├── startAll()                                                  │
│  ├── startChannel(id)                                            │
│  └── stopChannel(id)                                             │
│                                                                  │
│  ExternalGatewayClient (WS 客户端)                               │
│  ├── connect()          ← 连接外部服务 WebSocket                │
│  ├── disconnect()                                                │
│  ├── forwardEvent()     ← 转发事件到 EventBus                   │
│  └── scheduleReconnect() ← 断线自动重连                          │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│ 事件与工具层                                                     │
│                                                                  │
│  EventBus                                                        │
│  └── external.tavern.task.created                               │
│  └── external.tavern.task.updated                               │
│                                                                  │
│  ToolRegistry                                                    │
│  └── external_tavern_list_tasks                                 │
│  └── external_tavern_accept_task                                │
│  └── external_tavern_submit_result                              │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│ Agent 执行层                                                     │
│                                                                  │
│  TaskAcceptanceService (后台服务)                                │
│  ├── 订阅：external.tavern.task.created                         │
│  ├── 分析：任务类型、复杂度、技能要求                            │
│  ├── 匹配：Agent 能力模型                                        │
│  ├── 接取：调用 external_tavern_accept_task                     │
│  └── 执行：创建 Thread 并启动 Agent                              │
│                                                                  │
│  Agent                                                           │
│  ├── 使用工具：external_tavern_*                                │
│  └── 执行任务：完成后 submit_result                             │
└─────────────────────────────────────────────────────────────────┘
                                ↓
                         外部酒馆服务
                         (localhost:9900)
```

### 6.2 配置格式

```json5
// ~/.coobee-ai/config/coobee.json5
{
  // 外部服务通道配置
  channels: {
    tavern: {
      enabled: true,
      wsUrl: 'ws://localhost:9900/events',
      apiUrl: 'http://localhost:9900/api',
      reconnect: true,
      heartbeat: 30000,
      authToken: 'optional-token'
    },

    // 可扩展：其他外部服务
    monitoring: {
      enabled: false,
      wsUrl: 'ws://localhost:9901/events',
      apiUrl: 'http://localhost:9901/api'
    }
  },

  // 任务自动接取配置
  taskAcceptance: {
    enabled: true,
    maxConcurrent: 3,
    minAmount: 100,
    defaultAgent: 'app-copilot'
  }
}
```

---

## 7. 详细实施计划

### 7.1 Phase 1：修复 Extension Gateway 方法集成（Week 1）

#### 目标

修复 Extension 注册的 Gateway 方法未生效的问题。

#### 任务清单

- [ ] 在 `ReadyExtensionHook` 中获取 `Gateway` 实例
- [ ] 遍历 `registry.getGatewayMethods()`，调用 `Gateway.registerMethod()`
- [ ] 在 `ExtensionLoader.unload()` 中调用 `Gateway.unregisterMethod()`
- [ ] 编写测试：Extension 注册 RPC 方法，前端调用成功
- [ ] 文档：更新 Extension API 文档

#### 涉及文件

- `src/main/lifecycle/ReadyExtensionHook.ts`
- `src/main/common/extension/ExtensionLoader.ts`
- `src/main/gateway/Gateway.ts`

#### 验收标准

- ✅ Extension 注册的 Gateway 方法可通过 WebSocket RPC 调用
- ✅ Extension 热插拔时，方法正确注册/注销
- ✅ 测试覆盖率 > 80%

---

### 7.2 Phase 2：增强 Plugin API 能力（Week 2-3）

#### 目标

为 Extension（重命名为 Plugin）添加系统级扩展能力。

#### 2.1 registerChannel（通道注册）

**接口设计**：

```typescript
// src/main/common/extension/types.ts

export interface ChannelConfig {
  id: string;
  name: string;
  wsUrl?: string;
  apiUrl?: string;
  enabled: boolean;
  // ... 其他配置
}

export interface ExtensionApi {
  // ... 现有方法

  /**
   * 注册外部服务通道
   */
  registerChannel(config: ChannelConfig): void;
}
```

**实现位置**：`src/main/common/extension/ExtensionApi.ts`

**集成点**：

- ExtensionRegistry 存储 `channels: Map<string, ChannelConfig>`
- ReadyExtensionHook 中初始化 `ChannelManager`
- ChannelManager.registerChannel() 注册通道

#### 2.2 registerHttpRoute（HTTP 路由）

**接口设计**：

```typescript
export interface HttpRouteConfig {
  path: string; // 如 '/webhook/tavern'
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  handler: (req: Request, res: Response) => Promise<void>;
}

export interface ExtensionApi {
  registerHttpRoute(config: HttpRouteConfig): void;
}
```

**实现**：

- ExtensionRegistry 存储 `httpRoutes: HttpRouteConfig[]`
- GatewayServer 在启动时注册这些路由到 Koa Router

#### 2.3 registerService（后台服务）

**接口设计**：

```typescript
export interface BackgroundService {
  id: string;
  start: () => Promise<void> | void;
  stop: () => Promise<void> | void;
}

export interface ExtensionApi {
  registerService(service: BackgroundService): void;
}
```

**实现**：

- ExtensionRegistry 存储 `services: Map<string, BackgroundService>`
- ReadyExtensionHook 中启动所有服务
- BeforeQuitExtensionHook 中停止所有服务

#### 2.4 registerProvider（AI Provider）

**接口设计**：

```typescript
export interface ProviderConfig {
  id: string;
  name: string;
  auth?: {
    type: 'oauth' | 'apikey';
    clientId?: string;
    clientSecret?: string;
    // ... OAuth 配置
  };
  models: string[]; // 支持的模型列表
}

export interface ExtensionApi {
  registerProvider(config: ProviderConfig): void;
}
```

**实现**：

- ExtensionRegistry 存储 `providers: Map<string, ProviderConfig>`
- ProviderRegistry 集成这些 Provider

#### 任务清单

- [ ] 实现 `registerChannel` API + ChannelManager
- [ ] 实现 `registerHttpRoute` API + 路由注册
- [ ] 实现 `registerService` API + 服务生命周期
- [ ] 实现 `registerProvider` API + Provider 集成
- [ ] 更新 ExtensionApi 类型定义
- [ ] 编写单元测试
- [ ] 文档：Plugin API 完整说明

#### 涉及文件

- `src/main/common/extension/types.ts`
- `src/main/common/extension/ExtensionApi.ts`
- `src/main/common/extension/ExtensionRegistry.ts`
- `src/main/channels/ChannelManager.ts`（新建）
- `src/main/channels/types.ts`（新建）
- `src/main/lifecycle/ReadyExtensionHook.ts`

#### 验收标准

- ✅ Plugin 可以注册通道、HTTP 路由、后台服务、Provider
- ✅ ChannelManager 正确启动/停止通道
- ✅ 后台服务随应用启动/退出
- ✅ 测试覆盖率 > 80%

---

### 7.3 Phase 3：实现 Tavern Integration Plugin（Week 4-5）

#### 目标

创建 `tavern-integration` 插件，实现酒馆任务系统的完整对接。

#### 3.1 目录结构

```
extensions/tavern-integration/
├── extension.json              # 插件元数据
├── index.ts                   # 入口文件
├── src/
│   ├── TavernChannel.ts       # Channel 定义
│   ├── TavernTools.ts         # 工具生成器
│   ├── TaskAcceptanceService.ts  # 自动接取服务
│   ├── TaskAnalyzer.ts        # 任务分析器
│   ├── AgentMatcher.ts        # Agent 匹配器
│   └── types.ts               # 类型定义
└── __tests__/
    └── tavern-integration.test.ts
```

#### 3.2 extension.json

```json
{
  "id": "tavern-integration",
  "name": "Tavern Integration",
  "version": "1.0.0",
  "description": "Integrate external Tavern task system with Agent auto-acceptance",
  "main": "index.ts",
  "contributes": {
    "channels": ["tavern"],
    "tools": [
      "external_tavern_list_tasks",
      "external_tavern_get_task",
      "external_tavern_accept_task",
      "external_tavern_update_status",
      "external_tavern_submit_result"
    ],
    "services": ["task-acceptance"],
    "settings": {
      "tavern.wsUrl": "ws://localhost:9900/events",
      "tavern.apiUrl": "http://localhost:9900/api",
      "taskAcceptance.enabled": true,
      "taskAcceptance.maxConcurrent": 3
    }
  }
}
```

#### 3.3 index.ts（插件入口）

```typescript
import type { PluginApi } from '@main/common/extension/types';
import { tavernChannel } from './src/TavernChannel';
import { TaskAcceptanceService } from './src/TaskAcceptanceService';

export default {
  id: 'tavern-integration',
  name: 'Tavern Integration',

  register(api: PluginApi) {
    api.logger.info('Activating Tavern Integration Plugin...');

    // 1. 注册通道
    api.registerChannel(tavernChannel);

    // 2. 注册工具（通过通道自动生成）
    const tools = tavernChannel.outbound.generateTools();
    tools.forEach((tool) => api.registerTool(tool));

    // 3. 注册后台服务
    api.registerService({
      id: 'task-acceptance',
      start: async () => {
        const service = TaskAcceptanceService.getInstance();
        await service.start();
      },
      stop: async () => {
        const service = TaskAcceptanceService.getInstance();
        service.stop();
      }
    });

    // 4. 注册 Gateway 方法（前端调用）
    api.registerGatewayMethod('tavern.getTasks', async (params) => {
      const response = await fetch(`${tavernChannel.config.apiUrl}/tasks`);
      return await response.json();
    });

    api.logger.info('Tavern Integration Plugin activated');
  }
};
```

#### 任务清单

- [ ] 实现 `TavernChannel`（ExternalChannelPlugin）
- [ ] 实现 `TavernTools`（工具生成器）
- [ ] 实现 `TaskAcceptanceService`（自动接取服务）
- [ ] 实现 `TaskAnalyzer`（任务分析：类型、复杂度、技能）
- [ ] 实现 `AgentMatcher`（能力模型匹配）
- [ ] 集成 `ChannelManager`，启动酒馆通道
- [ ] 编写单元测试和集成测试
- [ ] 文档：酒馆对接完整使用指南

#### 涉及文件

- `extensions/tavern-integration/`（新建）
- `src/main/channels/ChannelManager.ts`
- `src/main/lifecycle/ReadyExtensionHook.ts`

#### 验收标准

- ✅ 酒馆服务启动后，Coobee-AI 自动连接 WebSocket
- ✅ 酒馆发布任务时，Coobee-AI 收到 `external.tavern.task.created` 事件
- ✅ Agent 自动分析任务并决策是否接取
- ✅ 接取后创建 Thread，Agent 自动执行
- ✅ 完成后自动提交结果
- ✅ 端到端测试通过

---

### 7.4 Phase 4：酒馆系统 WebSocket Server（Week 6）

#### 目标

为酒馆系统添加 WebSocket Server，支持事件实时推送。

#### 4.1 酒馆系统改造

**当前**：

```
src/main/gateway/http/tavern.ts
  └── HTTP API (GET/POST/PATCH/DELETE /gateway/tavern/tasks)
```

**改造后**：

```
src/main/tavern/
├── http/
│   └── routes.ts          # HTTP API（保留）
├── ws/
│   ├── server.ts          # WebSocket Server（新增）
│   └── broadcaster.ts     # 事件广播器（新增）
└── storage/
    └── store.ts           # 任务存储（重构）
```

#### 4.2 WebSocket Server 实现

```typescript
// src/main/tavern/ws/server.ts

import WebSocket, { WebSocketServer } from 'ws';
import { createLogger } from '@main/common/logger';

const log = createLogger('tavern-ws');

export class TavernWSServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  start(port: number): void {
    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws) => {
      log.info('New client connected');
      this.clients.add(ws);

      ws.on('close', () => {
        this.clients.delete(ws);
        log.info('Client disconnected');
      });

      ws.on('error', (err) => {
        log.error('WebSocket error:', err);
      });

      // 发送欢迎消息
      ws.send(
        JSON.stringify({
          type: 'connected',
          timestamp: Date.now()
        })
      );
    });

    log.info(`Tavern WebSocket Server started on port ${port}`);
  }

  stop(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    this.wss?.close();
    log.info('Tavern WebSocket Server stopped');
  }

  /**
   * 广播事件到所有客户端
   */
  broadcast(event: { type: string; data: unknown }): void {
    const message = JSON.stringify({
      ...event,
      timestamp: Date.now()
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }

    log.info(`Broadcasted event: ${event.type}`);
  }
}
```

#### 4.3 事件广播器

```typescript
// src/main/tavern/ws/broadcaster.ts

import { TavernWSServer } from './server';
import type { Task } from '../http/routes';

export class TavernEventBroadcaster {
  constructor(private wsServer: TavernWSServer) {}

  /**
   * 任务创建时广播
   */
  taskCreated(task: Task): void {
    this.wsServer.broadcast({
      type: 'task.created',
      data: task
    });
  }

  /**
   * 任务更新时广播
   */
  taskUpdated(task: Task): void {
    this.wsServer.broadcast({
      type: 'task.updated',
      data: task
    });
  }

  /**
   * 任务完成时广播
   */
  taskCompleted(task: Task): void {
    this.wsServer.broadcast({
      type: 'task.completed',
      data: task
    });
  }
}
```

#### 4.4 集成到 HTTP API

```typescript
// src/main/gateway/http/tavern.ts

// 创建广播器实例
const wsServer = new TavernWSServer();
const broadcaster = new TavernEventBroadcaster(wsServer);

// 在应用启动时启动 WebSocket Server
wsServer.start(9900);

// POST /gateway/tavern/tasks（发布任务）
router.post('/tasks', async (ctx) => {
  // ... 创建任务逻辑

  // 广播任务创建事件
  broadcaster.taskCreated(task);

  ctx.status = 201;
  ctx.body = { task };
});

// PATCH /gateway/tavern/tasks/:id（更新任务）
router.patch('/tasks/:id', async (ctx) => {
  // ... 更新任务逻辑

  // 广播任务更新事件
  broadcaster.taskUpdated(task);

  ctx.body = { task };
});
```

#### 任务清单

- [ ] 实现 `TavernWSServer`（WebSocket Server）
- [ ] 实现 `TavernEventBroadcaster`（事件广播器）
- [ ] 重构 `tavern.ts`，集成事件广播
- [ ] 在 `ReadyGatewayHook` 中启动 WebSocket Server
- [ ] 在 `BeforeQuitGatewayHook` 中停止 WebSocket Server
- [ ] 编写测试：WebSocket 连接、事件接收
- [ ] 文档：酒馆 WebSocket API 文档

#### 涉及文件

- `src/main/tavern/ws/`（新建）
- `src/main/gateway/http/tavern.ts`（重构）
- `src/main/lifecycle/ReadyGatewayHook.ts`

#### 验收标准

- ✅ WebSocket Server 在端口 9900 启动
- ✅ 客户端可以连接并接收事件
- ✅ 任务创建/更新时，所有客户端收到事件
- ✅ 支持心跳和自动重连

---

### 7.5 Phase 5：Agent 能力模型与匹配（Week 7）

#### 目标

实现 Agent 能力模型，支持智能任务匹配。

#### 5.1 Agent 能力模型

**扩展 AgentDefinition**：

```typescript
// src/main/ai/agents/types.ts

export interface AgentCapability {
  type: 'data-analysis' | 'coding' | 'writing' | 'research' | 'general';
  level: number; // 1-5，能力等级
  description: string;
}

export interface AgentDefinition {
  // ... 现有字段

  /** 能力模型（用于任务匹配） */
  capabilities?: AgentCapability[];
}
```

**示例配置**：

```json
{
  "id": "data-analyst",
  "name": "数据分析专家",
  "instructions": "...",
  "tools": ["read", "write", "search", "external_tavern_submit_result"],
  "capabilities": [
    {
      "type": "data-analysis",
      "level": 5,
      "description": "擅长数据清洗、统计分析和可视化"
    },
    {
      "type": "research",
      "level": 4,
      "description": "能够进行资料收集和信息整理"
    }
  ]
}
```

#### 5.2 AgentMatcher 实现

```typescript
// extensions/tavern-integration/src/AgentMatcher.ts

export interface TaskAnalysis {
  type: 'data-analysis' | 'coding' | 'writing' | 'research' | 'general';
  complexity: 'low' | 'medium' | 'high';
  requiredSkills: string[];
}

export class AgentMatcher {
  /**
   * 根据任务分析结果匹配最合适的 Agent
   */
  async matchAgent(task: Task, analysis: TaskAnalysis): Promise<string | null> {
    const agentStore = await AgentStore.getInstance();
    const allAgents = await agentStore.list();

    // 1. 筛选具备相应能力的 Agent
    const candidates = allAgents.filter((agent) => {
      const capabilities = agent.capabilities ?? [];
      return capabilities.some((cap) => cap.type === analysis.type && cap.level >= 3);
    });

    if (candidates.length === 0) {
      // 降级：使用默认 Agent
      return this.getDefaultAgent();
    }

    // 2. 选择能力等级最高的 Agent
    const best = candidates.reduce((prev, curr) => {
      const prevCap = prev.capabilities?.find((c) => c.type === analysis.type);
      const currCap = curr.capabilities?.find((c) => c.type === analysis.type);
      return (currCap?.level ?? 0) > (prevCap?.level ?? 0) ? curr : prev;
    });

    return best.id;
  }

  private getDefaultAgent(): string {
    // 从配置读取默认 Agent
    return 'app-copilot';
  }
}
```

#### 任务清单

- [ ] 扩展 `AgentDefinition` 添加 `capabilities` 字段
- [ ] 更新 `manage_agent` 工具支持 capabilities
- [ ] 实现 `TaskAnalyzer`（任务分析）
- [ ] 实现 `AgentMatcher`（能力匹配）
- [ ] 更新内置 Agent 配置，添加 capabilities
- [ ] 编写测试：任务分析、Agent 匹配
- [ ] 文档：Agent 能力模型使用指南

#### 涉及文件

- `src/main/ai/agents/types.ts`
- `src/main/ai/tools/builtin/manage-agent.ts`
- `extensions/tavern-integration/src/AgentMatcher.ts`（新建）
- `extensions/tavern-integration/src/TaskAnalyzer.ts`（新建）
- `agents/*.json`（更新）

#### 验收标准

- ✅ Agent 可以配置 capabilities
- ✅ TaskAnalyzer 正确分析任务类型和复杂度
- ✅ AgentMatcher 根据能力模型匹配 Agent
- ✅ 无匹配时降级到默认 Agent

---

### 7.6 Phase 6：双层扩展架构（Week 8-10，可选）

#### 目标

实现双层扩展架构，支持 Agent 层 Extension。

#### 6.1 设计方案

**方案 A：完全兼容 PiMono SDK**

- 利用 PiMono SDK 的 `additionalExtensionPaths` 参数
- Plugin 可以贡献 SDK 扩展路径
- SDK 扩展文件放在 `src/main/ai/extensions/` 或 Plugin 内部

**方案 B：自定义 Agent Extension API**

- 自己实现 `AgentExtensionApi`（不依赖 SDK）
- 在 AgentExecutor 中调用 Extension Hooks
- 更灵活，但需要维护兼容性

**推荐**：**方案 A**（利用 SDK，避免重复造轮子）

#### 6.2 实现步骤

**步骤 1：Plugin 贡献 SDK 扩展**

```typescript
// ExtensionApi 增加新方法
export interface PluginApi {
  // ... 现有方法

  /**
   * 贡献 Agent 层 SDK 扩展
   */
  contributeAgentExtension(config: {
    path: string; // 扩展文件绝对路径
    enabledByDefault: boolean;
  }): void;
}
```

**步骤 2：PiMonoBuilder 接收扩展路径**

```typescript
// src/main/ai/runtime/pimono/PiMonoBuilder.ts

export class PiMonoBuilder {
  private _agentExtensionPaths: string[] = [];

  /**
   * 设置 Agent 层扩展路径
   */
  agentExtensionPaths(paths: string[]): this {
    this._agentExtensionPaths = paths;
    return this;
  }

  async build(): Promise<AgentRuntime> {
    // ... 现有逻辑

    // 传递给 PiMono SDK
    const options = {
      // ... 其他参数
      additionalExtensionPaths: this._agentExtensionPaths
    };

    return new PiMonoAgentRuntime(options);
  }
}
```

**步骤 3：AgentExecutor 集成**

```typescript
// src/main/ai/AgentExecutor.ts

async execute() {
  // 1. 加载 Plugin 贡献的 SDK 扩展路径
  const registry = ExtensionManager.getRegistry();
  const agentExtensionPaths = registry?.getAgentExtensionPaths() ?? [];

  // 2. 传递给 Builder
  if (agentExtensionPaths.length > 0 && builder instanceof PiMonoBuilder) {
    builder.agentExtensionPaths(agentExtensionPaths);
  }

  // 3. 构建 Runtime
  const runtime = await builder.build();

  // ...
}
```

#### 任务清单

- [ ] 扩展 `PluginApi` 添加 `contributeAgentExtension` 方法
- [ ] ExtensionRegistry 存储 `agentExtensionPaths`
- [ ] PiMonoBuilder 添加 `agentExtensionPaths()` 方法
- [ ] PiMonoAgentRuntime 传递给 SDK
- [ ] 实现示例 Agent Extension（如 `context-pruning`）
- [ ] 编写测试：SDK 扩展加载和执行
- [ ] 文档：双层扩展架构说明

#### 涉及文件

- `src/main/common/extension/types.ts`
- `src/main/common/extension/ExtensionApi.ts`
- `src/main/common/extension/ExtensionRegistry.ts`
- `src/main/ai/runtime/pimono/PiMonoBuilder.ts`
- `src/main/ai/runtime/pimono/PiMonoAgentRuntime.ts`
- `src/main/ai/AgentExecutor.ts`

#### 验收标准

- ✅ Plugin 可以贡献 Agent 层 SDK 扩展
- ✅ SDK 扩展在 Agent Session 内生效
- ✅ 双层扩展互不干扰，职责清晰
- ✅ 测试覆盖率 > 80%

**注意**：此阶段为**可选**，优先级低于前 5 个阶段。

---

### 7.7 Phase 7：通用化与扩展（Week 11+，持续）

#### 目标

将酒馆对接方案通用化，支持接入其他外部服务。

#### 7.1 通用外部服务插件模板

```typescript
// extensions/external-service-template/

export function createExternalServicePlugin(config: ExternalServiceConfig): Plugin {
  return {
    id: config.id,
    name: config.name,

    register(api: PluginApi) {
      // 1. 注册通道
      api.registerChannel({
        id: config.id,
        name: config.name,
        wsUrl: config.wsUrl,
        apiUrl: config.apiUrl
        // ... 通用配置
      });

      // 2. 动态生成工具
      const tools = config.toolDefinitions.map((def) => generateExternalTool(config.id, config.apiUrl, def));
      tools.forEach((tool) => api.registerTool(tool));

      // 3. 事件映射
      if (config.eventMapping) {
        // 注册事件转换逻辑
      }
    }
  };
}
```

#### 7.2 支持的外部服务类型

| 类型           | 示例                            | 特点                      |
| -------------- | ------------------------------- | ------------------------- |
| **任务平台**   | 酒馆、Upwork、Freelancer        | WebSocket 事件 + HTTP API |
| **监控系统**   | Prometheus、Grafana             | Webhook 告警 + HTTP Query |
| **IM 平台**    | Telegram、Slack、Discord        | Bot API + Webhook         |
| **数据源**     | Notion、Airtable、Google Sheets | REST API + Webhook        |
| **其他 Agent** | OpenClaw、AutoGPT               | WebSocket 或 HTTP         |

#### 任务清单

- [ ] 创建外部服务插件模板
- [ ] 编写插件开发文档
- [ ] 实现 2-3 个示例插件
- [ ] 建立插件生态（Plugin Marketplace）
- [ ] 社区贡献指南

---

## 8. 风险评估与缓解

### 8.1 技术风险

| 风险                     | 级别 | 缓解措施                          |
| ------------------------ | ---- | --------------------------------- |
| **双层架构复杂度增加**   | 中   | 渐进式迁移，保持向后兼容          |
| **SDK 扩展与应用层冲突** | 低   | 清晰的职责划分，命名空间隔离      |
| **WebSocket 连接不稳定** | 中   | 自动重连、健康检查、降级策略      |
| **任务匹配算法准确性**   | 中   | 基于规则 + LLM 双重分析，逐步优化 |
| **插件安全性**           | 高   | 沙箱执行、权限控制、代码审查      |

### 8.2 性能风险

| 风险                       | 级别 | 缓解措施           |
| -------------------------- | ---- | ------------------ |
| **Plugin 加载时间增加**    | 低   | 懒加载、并行加载   |
| **WebSocket 连接占用资源** | 低   | 连接池、心跳优化   |
| **事件处理延迟**           | 低   | 异步处理、队列缓冲 |

### 8.3 兼容性风险

| 风险                        | 级别 | 缓解措施                   |
| --------------------------- | ---- | -------------------------- |
| **现有 Extension 需要迁移** | 低   | 提供兼容层，逐步迁移       |
| **配置格式变更**            | 低   | 自动迁移脚本               |
| **API 不兼容**              | 中   | 提供 Adapter，保持向后兼容 |

### 8.4 运维风险

| 风险             | 级别 | 缓解措施               |
| ---------------- | ---- | ---------------------- |
| **酒馆服务宕机** | 中   | 降级策略，缓存任务列表 |
| **网络分区**     | 中   | 重连机制、离线队列     |
| **配置错误**     | 低   | Schema 验证、错误提示  |

---

## 9. 架构改进总结

### 9.1 改进前后对比

| 维度             | 改进前            | 改进后                                       |
| ---------------- | ----------------- | -------------------------------------------- |
| **扩展层级**     | 单层（Extension） | 双层（Plugin + Agent Extension）             |
| **外部服务对接** | 手动实现          | Channel 抽象 + 通用客户端                    |
| **Gateway 方法** | 未生效            | 已修复并生效                                 |
| **通道管理**     | 无                | ChannelManager + 生命周期                    |
| **事件推送**     | 无                | WebSocket + EventBus                         |
| **任务自动接取** | 无                | TaskAcceptanceService                        |
| **Agent 匹配**   | 无                | 能力模型 + 智能匹配                          |
| **插件能力**     | 工具 + Hooks      | 工具 + Hooks + 通道 + 服务 + HTTP + Provider |

### 9.2 核心改进点

1. **双层扩展架构**：分离应用层和 Agent 层扩展
2. **Channel 抽象**：通用的外部服务对接模式
3. **ChannelManager**：统一的通道生命周期管理
4. **ExternalGatewayClient**：通用 WebSocket 客户端
5. **TaskAcceptanceService**：智能任务接取与分发
6. **Agent 能力模型**：基于能力的任务匹配
7. **Plugin API 增强**：支持通道、服务、HTTP 路由、Provider

### 9.3 架构优势

**灵活性**：

- ✅ 外部服务即插即用，无需修改核心代码
- ✅ 配置驱动，动态生成工具和事件映射

**扩展性**：

- ✅ 支持任意外部服务接入（不限于酒馆）
- ✅ Plugin 可以注册通道、服务、HTTP 路由、Provider

**实时性**：

- ✅ WebSocket 推送，无需轮询
- ✅ 事件驱动，Agent 自动响应

**自主性**：

- ✅ Agent 自动监听、分析、决策、执行
- ✅ 基于能力模型的智能匹配

**安全性**：

- ✅ 通道级权限控制
- ✅ 工具执行沙箱
- ✅ 配置验证和热重载

---

## 10. 实施优先级与时间表

### 10.1 优先级

| 阶段                           | 优先级 | 关键性 | 依赖    |
| ------------------------------ | ------ | ------ | ------- |
| **Phase 1：修复 Gateway 方法** | P0     | 高     | 无      |
| **Phase 2：增强 Plugin API**   | P0     | 高     | Phase 1 |
| **Phase 3：Tavern Plugin**     | P0     | 高     | Phase 2 |
| **Phase 4：酒馆 WS Server**    | P0     | 高     | Phase 3 |
| **Phase 5：Agent 能力模型**    | P1     | 中     | Phase 3 |
| **Phase 6：双层扩展**          | P2     | 低     | Phase 2 |
| **Phase 7：通用化**            | P3     | 低     | Phase 3 |

### 10.2 时间表

```
Week 1:    Phase 1（修复 Gateway 方法集成）
Week 2-3:  Phase 2（增强 Plugin API 能力）
Week 4-5:  Phase 3（Tavern Integration Plugin）
Week 6:    Phase 4（酒馆 WebSocket Server）
Week 7:    Phase 5（Agent 能力模型）
Week 8-10: Phase 6（双层扩展，可选）
Week 11+:  Phase 7（通用化与扩展，持续）
```

**关键里程碑**：

- ✅ Week 1 结束：Extension Gateway 方法可用
- ✅ Week 3 结束：Plugin API 增强完成
- ✅ Week 5 结束：酒馆任务自动接取和执行
- ✅ Week 6 结束：完整闭环（发布 → 推送 → 接取 → 执行 → 提交）
- ✅ Week 7 结束：智能 Agent 匹配

---

## 11. 总结与建议

### 11.1 核心改进

本方案通过以下改进，显著提升 Coobee-AI 的扩展能力和外部服务对接能力：

1. **修复 Extension Gateway 方法集成**：让 Extension 能够扩展 RPC 接口
2. **增强 Plugin API**：添加通道、服务、HTTP 路由、Provider 等系统级能力
3. **Channel 抽象**：通用的外部服务对接模式
4. **ChannelManager**：统一的通道生命周期管理
5. **TaskAcceptanceService**：智能任务接取与分发
6. **Agent 能力模型**：基于能力的任务匹配
7. **双层扩展架构**（可选）：分离应用层和 Agent 层扩展

### 11.2 与 OpenClaw 的对比

改进后，Coobee-AI 将具备与 OpenClaw 类似的核心能力：

| 能力             | OpenClaw | Coobee-AI（改进后） | 说明                       |
| ---------------- | -------- | ------------------- | -------------------------- |
| **双层扩展**     | ✅       | ✅（Phase 6）       | 分离应用层和 Agent 层      |
| **通道抽象**     | ✅       | ✅（Phase 2）       | 统一的外部服务对接         |
| **插件能力**     | ✅       | ✅（Phase 2）       | 通道、服务、HTTP、Provider |
| **生命周期管理** | ✅       | ✅（Phase 2）       | ChannelManager + 健康检查  |
| **配置热重载**   | ✅       | ✅（增强）          | 插件级热重载规则           |
| **任务自动化**   | ❌       | ✅（Phase 3-5）     | Agent 自动接取和执行       |

**Coobee-AI 的独特优势**：

- ✅ **统一 Agent 架构**：所有 LLM 交互通过 Agent
- ✅ **轻量级设计**：无需 CLI，Electron 原生集成
- ✅ **更易用的 API**：services、eventBus 直接暴露

### 11.3 建议

**优先实施**：

1. Phase 1-4（6 周）：完成酒馆任务自动对接的完整闭环
2. Phase 5（1 周）：增加智能 Agent 匹配

**可选实施**：3. Phase 6（3 周）：双层扩展架构（仅在需要 Agent 内部优化时）4. Phase 7（持续）：通用化外部服务对接，建立插件生态

**技术债务**：

- 统一 Extension 和 Plugin 的命名（代码 vs 文档）
- 完善配置 Schema 验证
- 增加更多生命周期 Hooks（对齐 OpenClaw 的 27 个）

**架构演进方向**：

- 短期：完成酒馆对接，验证 Channel 抽象的可行性
- 中期：通用化 Channel，支持 2-3 个外部服务
- 长期：建立插件生态，社区贡献

---

## 12. 附录：架构图详细版

### 12.1 当前架构（存在的问题）

```
┌─────────────────────────────────────────────────────────────────┐
│                     Coobee-AI 当前架构                           │
│                                                                  │
│  前端 Vue 3                                                      │
│    ↕ WebSocket                                                   │
│  Gateway (RPC + SSE)                                             │
│    ├── HTTP API (/gateway/agents, /gateway/tavern)              │
│    └── WebSocket (stream.*, system.*)                            │
│    ↕                                                             │
│  Extension System (单层)                                          │
│    ├── 工具注册 ✅                                               │
│    ├── Hook 注册 ✅                                              │
│    ├── Gateway 方法 ⚠️ (已实现未生效)                            │
│    ├── 通道注册 ❌                                               │
│    ├── HTTP 路由 ❌                                              │
│    └── 后台服务 ❌                                               │
│    ↕                                                             │
│  Agent Executor                                                  │
│    └── PiMono / OpenAI Runtime                                   │
│                                                                  │
│  酒馆系统（耦合）                                                │
│    ├── HTTP API (/gateway/tavern/*)                              │
│    ├── 无事件推送 ❌                                             │
│    └── 无 Agent 自动接取 ❌                                      │
└─────────────────────────────────────────────────────────────────┘

问题：
1. Extension Gateway 方法未生效
2. 无通道抽象，外部服务对接困难
3. 酒馆系统与主系统耦合
4. 无事件驱动的任务分发
```

### 12.2 改进后架构（目标状态）

```
┌─────────────────────────────────────────────────────────────────┐
│                  Coobee-AI 改进后架构                            │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 前端 Vue 3                                                │  │
│  │   ↕ WebSocket                                             │  │
│  │ Gateway (RPC + SSE)                                       │  │
│  │   ├── HTTP API (/gateway/agents, /gateway/threads)       │  │
│  │   ├── WebSocket (stream.*, system.*, external.*)         │  │
│  │   └── Extension RPC ✅ (已修复)                           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                ↕                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Plugin System (应用层)                                    │  │
│  │   • 位置：extensions/                                     │  │
│  │   • 能力：通道 + 工具 + Hooks + 服务 + HTTP + Provider    │  │
│  │                                                           │  │
│  │   tavern-integration Plugin:                              │  │
│  │   ├── TavernChannel (ExternalChannelPlugin)              │  │
│  │   ├── TavernTools (external_tavern_*)                    │  │
│  │   └── TaskAcceptanceService (后台服务)                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                ↕                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Channel Manager                                           │  │
│  │   • registerChannel() ← 注册外部服务通道                  │  │
│  │   • startAll() / stopChannel()                            │  │
│  │   • ExternalGatewayClient ← WebSocket 客户端              │  │
│  │   • 自动重连 + 健康检查                                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                ↕                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 事件与工具层                                              │  │
│  │   EventBus:                                               │  │
│  │   └── external.tavern.task.created ✅                     │  │
│  │   └── external.tavern.task.updated                        │  │
│  │                                                           │  │
│  │   ToolRegistry:                                           │  │
│  │   └── external_tavern_list_tasks ✅                       │  │
│  │   └── external_tavern_accept_task                         │  │
│  │   └── external_tavern_submit_result                       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                ↕                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Agent 执行层                                              │  │
│  │   TaskAcceptanceService:                                  │  │
│  │   ├── 订阅 external.tavern.* 事件                         │  │
│  │   ├── TaskAnalyzer ← 分析任务类型和复杂度                 │  │
│  │   ├── AgentMatcher ← 基于能力模型匹配 Agent               │  │
│  │   └── 创建 Thread + 启动执行                              │  │
│  │                                                           │  │
│  │   Agent Executor:                                         │  │
│  │   ├── PiMono / OpenAI Runtime                             │  │
│  │   ├── 使用 external_tavern_* 工具                         │  │
│  │   └── 完成后自动 submit_result                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                ↕                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Agent Extension (可选，Phase 6)                           │  │
│  │   • 位置：.coobee/extensions/                             │  │
│  │   • 能力：SDK 扩展（compaction、pruning）                 │  │
│  │   • 传递给 PiMono SDK                                     │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                ↕
                      WebSocket + HTTP API
                                ↕
┌─────────────────────────────────────────────────────────────────┐
│             酒馆任务系统 (独立服务 localhost:9900)                │
│                                                                  │
│  ┌──────────────┐      ┌──────────────┐                         │
│  │  WS Server   │      │  HTTP Server │                         │
│  │  /events     │      │  /api/*      │                         │
│  └──────────────┘      └──────────────┘                         │
│                                                                  │
│  • Task Storage (JSONL)                                          │
│  • Event Broadcasting (task.created, task.updated)               │
│  • File Management                                               │
└─────────────────────────────────────────────────────────────────┘

优势：
1. ✅ 酒馆独立部署，松耦合
2. ✅ WebSocket 实时推送，无需轮询
3. ✅ Channel 抽象，通用外部服务对接
4. ✅ Agent 自动接取和执行
5. ✅ 智能任务匹配
```

### 12.3 数据流详解

```
┌────────────────────────────────────────────────────────────────┐
│                       完整数据流                                │
└────────────────────────────────────────────────────────────────┘

1. 用户在酒馆前端发布任务
   └─▶ POST /gateway/tavern/tasks

2. 酒馆系统存储任务
   └─▶ tasks.jsonl + tasks/{id}/meta.json

3. 酒馆 WebSocket Server 广播事件
   └─▶ { type: 'task.created', data: task }

4. Coobee-AI ExternalGatewayClient 接收事件
   └─▶ forwardEvent() → eventBus.emit('external.tavern.task.created', task)

5. TaskAcceptanceService 监听事件
   ├─▶ TaskAnalyzer.analyze(task) → { type, complexity, skills }
   ├─▶ AgentMatcher.match(task, analysis) → agentId
   ├─▶ 调用工具：external_tavern_accept_task({ taskId, agentId })
   └─▶ 创建 Thread + 启动 Agent

6. Agent 执行任务
   ├─▶ 使用 read、write、search 等工具
   ├─▶ 生成结果（文本 + 文件）
   └─▶ 调用工具：external_tavern_submit_result({ taskId, textResult, fileResults })

7. 酒馆系统接收结果
   └─▶ PATCH /api/tasks/:id/result → 更新 Task.result

8. 酒馆 WebSocket Server 广播完成事件
   └─▶ { type: 'task.completed', data: task }

9. Coobee-AI 收到完成事件
   └─▶ eventBus.emit('external.tavern.task.completed', task)
   └─▶ 前端更新任务列表
```

---

## 13. 下一步行动

### 13.1 立即执行（P0）

1. **Review 本文档**：确认改进方案是否符合预期
2. **Phase 1 实施**：修复 Extension Gateway 方法集成（1 周）
3. **Phase 2 实施**：增强 Plugin API 能力（2 周）

### 13.2 短期规划（P0-P1）

4. **Phase 3 实施**：Tavern Integration Plugin（2 周）
5. **Phase 4 实施**：酒馆 WebSocket Server（1 周）
6. **Phase 5 实施**：Agent 能力模型（1 周）

### 13.3 长期规划（P2-P3）

7. **Phase 6 实施**：双层扩展架构（可选，3 周）
8. **Phase 7 实施**：通用化与扩展（持续）

### 13.4 决策点

**需要确认的问题**：

1. **是否采用双层扩展架构**（Phase 6）？
   - 优势：职责清晰，与 OpenClaw 对齐
   - 劣势：复杂度增加，需要维护两套 API
   - 建议：先完成 Phase 1-5，根据实际需求决定

2. **酒馆系统是否独立部署**？
   - 方案 A：独立服务（localhost:9900），与主系统解耦
   - 方案 B：集成在主系统内，通过 EventBus 通信
   - 建议：方案 A（符合长期架构演进方向）

3. **Channel 抽象是否通用化**？
   - 当前：仅针对酒馆设计
   - 未来：支持任意外部服务（监控、IM、数据源）
   - 建议：以酒馆为试点，逐步通用化

---

**文档版本**：v1.0  
**创建日期**：2026-02-20  
**作者**：Coobee-AI Architecture Team  
**审阅状态**：待审阅
