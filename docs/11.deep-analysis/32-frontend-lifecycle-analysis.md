# 前端 UI 架构与应用生命周期深度分析

## 1. 前端架构概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Shell 主窗口（ShellApp.vue）                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │ AppBar（顶部栏）                                                          │ │
│  │ TabItem × N — 多 Tab 管理（useTabStore）                                  │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│  ┌──────────────┬──────────────────────────────────────────────────────────┐ │
│  │ Sidebar      │  RouterView（主内容区）                                    │ │
│  │ 智能体/技能   │  /agent     → AgentView                                   │ │
│  │ 酒馆/智库    │  /thread/:id → ThreadView                                 │ │
│  │ 定时任务     │  /skills    → SkillsView                                  │ │
│  │ 最近任务列表 │  /tavern    → TavernView                                  │ │
│  │ 日志/设置    │  /brain     → BrainView                                   │ │
│  └──────────────┴──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 组件树

```
App.vue
  └── ShellApp.vue (或 ConsoleApp / BrowserApp)
        ├── AppBar.vue
        ├── Sidebar.vue
        └── RouterView
              ├── AgentView.vue
              ├── ThreadView.vue
              ├── SkillsView.vue
              ├── TavernView.vue
              ├── BrainView.vue
              ├── BrainMonitorView.vue
              ├── CronView.vue
              ├── LogViewer.vue
              ├── SettingsView.vue
              └── ObservabilityView.vue
```

---

## 2. 路由配置表

| 路径             | 名称          | 组件                  | 说明                         |
| ---------------- | ------------- | --------------------- | ---------------------------- |
| `/`              | -             | layout/index.vue      | 布局容器，redirect 到 /agent |
| `/agent`         | agent         | AgentView.vue         | 智能体工作区                 |
| `/thread/:id`    | thread        | ThreadView.vue        | 对话线程详情                 |
| `/skills`        | skills        | SkillsView.vue        | 技能市场                     |
| `/tavern`        | tavern        | TavernView.vue        | 酒馆任务                     |
| `/brain`         | brain         | BrainView.vue         | 知识智库                     |
| `/brain-monitor` | brain-monitor | BrainMonitorView.vue  | 智库监控                     |
| `/cron`          | cron          | CronView.vue          | 定时任务                     |
| `/logs`          | logs          | LogViewer.vue         | 日志查看                     |
| `/settings`      | settings      | SettingsView.vue      | 设置                         |
| `/observability` | observability | ObservabilityView.vue | 可观测性                     |

---

## 3. 核心页面职责与数据来源

| 页面                  | 职责                           | 数据来源                                                        |
| --------------------- | ------------------------------ | --------------------------------------------------------------- |
| **AgentView**         | Agent 列表、创建、运行、工作区 | useAgentsStore, useThreadsStore, useChatStore, Gateway RPC      |
| **ThreadView**        | 对话消息、输入、审批、工作台   | useChatStore, useThreadsStore, useStreamWs, useWorkspaceWatcher |
| **SkillsView**        | Skill 列表、导入、AI 创建      | useSkillsStore, fetch /gateway/skills                           |
| **TavernView**        | Tavern 任务列表与表单          | fetch /gateway/tavern/tasks                                     |
| **BrainView**         | 智库经验包列表                 | Gateway brain.\* RPC                                            |
| **CronView**          | 定时任务 CRUD                  | fetch /gateway/cron-jobs                                        |
| **LogViewer**         | 应用日志                       | useLogStore, IPC                                                |
| **SettingsView**      | 模型、Worker、基础设置         | usePreferenceStore, fetch /gateway/\*                           |
| **ObservabilityView** | 会话状态、上下文检查           | Gateway RPC                                                     |

---

## 4. 核心组件（Agent 工作区）

| 组件               | 职责                           |
| ------------------ | ------------------------------ |
| **AgentsPanel**    | Agent 列表、选择、创建入口     |
| **ContextPanel**   | 当前 Thread 上下文、Agent 信息 |
| **ChatPanel**      | 消息输入、发送、文件附件       |
| **WorkbenchPanel** | 工作台文件树、打开文件         |
| **TerminalPanel**  | 终端列表、输出                 |
| **ProjectPanel**   | 项目文件树                     |
| **VoicePanel**     | 语音输入（依赖 Worker）        |
| **ChatMessages**   | 消息列表渲染                   |
| **MessageQueue**   | 消息队列、流式更新             |
| **BlockTool**      | 工具调用块                     |
| **BlockThinking**  | 思考过程块                     |

---

## 5. 状态管理（Pinia Store 列表）

| Store                  | 职责                            |
| ---------------------- | ------------------------------- |
| **useChatStore**       | sessionId、消息、发送、流式状态 |
| **useCopilotStore**    | Copilot 模式消息、流式处理      |
| **useAgentsStore**     | Agent 列表、CRUD、AI 创建       |
| **useThreadsStore**    | Thread 列表、选中、运行状态     |
| **useWorkerStore**     | Worker 状态、启动/停止          |
| **useSkillsStore**     | Skill 列表、导入、AI 创建       |
| **usePreferenceStore** | 用户偏好、配置                  |
| **useLoadingStore**    | 全局加载状态                    |
| **useWindowStore**     | 窗口信息                        |
| **useLogStore**        | 日志级别、分类                  |
| **useTabStore**        | Shell Tab 管理                  |
| **useWorkspaceStore**  | 工作区文件树                    |
| **useUIStore**         | UI 状态                         |
| **useSkillStore**      | 单 Skill 详情（modules）        |
| **useCoreStore**       | 核心状态                        |
| **useMessageStore**    | Message 组件状态                |
| **useConfirmStore**    | 确认弹窗                        |
| **usePopoverStore**    | Popover 状态                    |
| **useToolTipStore**    | Tooltip 状态                    |

---

## 6. Composables 列表

| Composable              | 职责                                                           |
| ----------------------- | -------------------------------------------------------------- |
| **useStreamWs**         | 订阅 stream、重连恢复、补发消息                                |
| **useStreamHandler**    | 通用流式消息处理（messages, isStreaming, handleStreamMessage） |
| **useThreadWs**         | Thread 事件监听、更新 Store                                    |
| **useWorkerWs**         | Worker 事件监听、启动/停止                                     |
| **useProcessWs**        | 进程输出、状态                                                 |
| **useAgentEvents**      | Agent emit_event 工具事件                                      |
| **useTerminal**         | 终端创建、销毁、attach                                         |
| **useOpenFiles**        | 工作台文件标签页                                               |
| **useWorkspaceWatcher** | 工作区文件变化监听                                             |
| **useQuickChat**        | 轻量级 Agent 对话                                              |
| **useEventBus**         | 前端 EventBus                                                  |
| **useIpc**              | IPC 调用                                                       |
| **useMessage**          | Message 组件 API                                               |
| **useConfirm**          | 确认弹窗 API                                                   |
| **usePlatform**         | 平台检测                                                       |

---

## 7. 服务层

| 服务                   | 职责                                |
| ---------------------- | ----------------------------------- |
| **GatewayClient**      | WebSocket RPC、事件订阅、重连、心跳 |
| **api/request.ts**     | HTTP 请求封装（如需要）             |
| **api/backend-api.ts** | 自动生成（当前为空）                |

---

## 8. Electron 生命周期（Hook 执行顺序表）

### 8.1 INIT 阶段

| 优先级 | Hook             | 职责                 |
| ------ | ---------------- | -------------------- |
| 10     | InitEnvHook      | 环境信息             |
| 100    | InitDatabaseHook | SQLite/DuckDB 初始化 |

### 8.2 READY 阶段

| 优先级 | Hook                          | 职责                                   |
| ------ | ----------------------------- | -------------------------------------- |
| 35     | ReadyApiRegistrationHook      | HttpServer 初始化                      |
| 45     | ReadyGatewayHook              | Gateway 启动                           |
| 50     | ReadyExtensionHook            | Extension 加载                         |
| 50     | ReadyIpcRegistrationHook      | IPC 注册                               |
| 55     | ReadyInfraHook                | ConfigStore、Provider、MessagePipeline |
| 80     | ReadyWorkerHook               | Worker 启动                            |
| 85     | ReadyMediaPermissionHook      | 媒体权限                               |
| 90     | ReadyAppBootstrapHook         | ThreadWaker、Dock 图标                 |
| 100    | ReadyWindowBootstrapHook      | 主窗口创建                             |
| 400    | ReadyShortcutRegistrationHook | 快捷键                                 |
| 1000   | ReadyEventRegistrationHook    | 事件注册                               |
| 24     | MetricsCollectorHook          | 指标收集                               |
| 25     | BrainMetricsInitHook          | Brain 监控                             |

### 8.3 BEFORE_QUIT 阶段

| 优先级 | Hook                       | 职责               |
| ------ | -------------------------- | ------------------ |
| 20     | BeforeQuitGatewayHook      | 关闭 Gateway       |
| 30     | BeforeQuitExtensionHook    | 停止 Extension     |
| 40     | BeforeQuitInfraHook        | 停止 ConfigWatcher |
| 45     | BeforeQuitTerminalHook     | 关闭终端           |
| 50     | BeforeQuitProcessHook      | 清理后台进程       |
| 60     | BeforeQuitStreamStoreHook  | 销毁 StreamStore   |
| 100    | BeforeQuitDatabaseHook     | 关闭数据库         |
| 5      | BeforeQuitAppBootstrapHook | 停止 ThreadWaker   |
| 10     | BeforeQuitWorkerHook       | 关闭 Worker        |

---

## 9. 公共模块

| 模块              | 职责                                                    |
| ----------------- | ------------------------------------------------------- |
| **eventbus**      | 前端事件总线                                            |
| **event_handles** | appEventsHandle, windowEventsHandle, tabEventsHandle    |
| **plugins**       | ipcSetup, gatewaySetup, eventbusSetup                   |
| **directives**    | aiGenerate                                              |
| **utils**         | monaco-setup, fileIcons, formatRelativeTime（分散定义） |

---

## 10. 问题与改进建议

### 10.1 组件与职责

| 问题                                  | 影响     | 建议                                            |
| ------------------------------------- | -------- | ----------------------------------------------- |
| **AgentView 约 1200 行，职责过多**    | 难以维护 | 拆分为 AgentCard、AgentCreateForm、RunDialog 等 |
| **formatRelativeTime 等函数重复定义** | 代码重复 | 抽到 utils/format.ts                            |

### 10.2 数据流

| 问题                                       | 影响         | 建议                             |
| ------------------------------------------ | ------------ | -------------------------------- |
| **前端 fetch 与 GatewayClient 混用**       | 数据流不一致 | 统一为 Gateway RPC 或封装 API 层 |
| **直接改 chatStore.sessionId 绕过 action** | 数据流不规范 | 通过 action 修改                 |
| **Store 分散、职责边界不清**               | 难以理解     | 统一规划 Store 分层和命名        |

### 10.3 路由与导航

| 问题                         | 影响                                                                | 建议                                |
| ---------------------------- | ------------------------------------------------------------------- | ----------------------------------- |
| **Sidebar 与路由入口不一致** | logs/settings 在底部栏，brain-monitor、observability、cron 在菜单中 | 统一 Sidebar 与路由，或增加底部入口 |

### 10.4 错误与连接

| 问题                                 | 影响                 | 建议                            |
| ------------------------------------ | -------------------- | ------------------------------- |
| **无全局错误边界**                   | 组件异常导致白屏     | 增加 Vue Error Boundary         |
| **无离线/断连提示**                  | 用户无感知           | 增加 GatewayClient 连接状态提示 |
| **GatewayClient 重连后无自动重订阅** | 需手动重新 subscribe | onConnect 中自动重订阅当前会话  |

### 10.5 国际化与配置

| 问题                       | 影响                              | 建议               |
| -------------------------- | --------------------------------- | ------------------ |
| **国际化未实现**           | schema 中有 ui.language 但无 i18n | 增加 i18n 基础设施 |
| **快捷键无文档或设置界面** | 用户难发现                        | 增加快捷键配置页   |

### 10.6 可观测性

| 问题                | 影响             | 建议               |
| ------------------- | ---------------- | ------------------ |
| **无 traceId 传递** | 前后端日志难关联 | 请求中携带 traceId |

### 10.7 架构

| 问题                                            | 影响     | 建议               |
| ----------------------------------------------- | -------- | ------------------ |
| **多窗口（Shell/Console/Browser）共享部分逻辑** | 重复代码 | 抽公共 composables |

---

## 11. 架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RENDERER（Vue 3）                                   │
│                                                                              │
│  ┌─ Views ────────────────────────────────────────────────────────────────┐  │
│  │  AgentView │ ThreadView │ SkillsView │ TavernView │ BrainView │ ...   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│  ┌─ Composables ────────────────────────────────────────────────────────┐  │
│  │  useStreamWs │ useThreadWs │ useWorkerWs │ useOpenFiles │ ...        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│  ┌─ Stores (Pinia) ────────────────────────────────────────────────────┐  │
│  │  chat │ threads │ agents │ worker │ skills │ preference │ ...       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│  ┌─ GatewayClient ────────────────────────────────────────────────────┐  │
│  │  WebSocket /gateway/ws │ RPC │ 事件订阅 │ 重连                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│  ┌─ fetch() ──────────────────────────────────────────────────────────┐  │
│  │  HTTP /gateway/agents, /gateway/threads, /gateway/skills, ...       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                 │ IPC + WebSocket
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MAIN（Electron）                                    │
│  Gateway │ HttpServer │ LifecycleManager │ WindowManager │ ...             │
└─────────────────────────────────────────────────────────────────────────────┘
```
