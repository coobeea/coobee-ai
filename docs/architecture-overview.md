# Coobee AI — 系统架构全景

> 最后更新：2026-02-22

---

## 一、全局架构分层

```mermaid
graph TB
    subgraph 渲染进程["🖥️ 渲染进程 (Renderer)"]
        direction TB
        Views["Views<br/>Agent / Employee / Thread / Settings / Tavern / Brain / ..."]
        Components["Components<br/>ChatPanel / WorkbenchPanel / TerminalPanel / VoicePanel / ..."]
        Stores["Pinia Stores<br/>chat / agents / threads / worker / copilot / skills / ..."]
        Composables["Composables<br/>useAgentStream / useStreamWs / useThreadWs / useTerminal / ..."]
        GatewayClient["GatewayClient<br/>WebSocket RPC + 事件订阅"]
    end

    subgraph Preload["🔗 Preload"]
        IpcBridge["window.api / window.electron<br/>IPC 桥接"]
    end

    subgraph 主进程["⚙️ 主进程 (Main)"]
        direction TB
        Gateway["Gateway 层"]
        AI["AI Runtime 层"]
        Infra["基础设施层"]
    end

    Views --> Components
    Components --> Stores
    Components --> Composables
    Composables --> GatewayClient
    GatewayClient -->|"WebSocket RPC"| Gateway
    Views --> IpcBridge
    IpcBridge -->|"IPC"| Infra

    Gateway --> AI
    AI --> Infra
```

---

## 二、主进程架构详解

### 2.1 三层架构

```mermaid
graph TB
    subgraph GatewayLayer["🌐 Gateway 层 — 通信入口"]
        direction LR
        GW["Gateway<br/>方法路由 + 事件广播"]
        GWS["GatewayServer<br/>WebSocket 服务"]
        Methods["方法组<br/>chat / config / worker / brain / approval / system"]
        EventBridges["事件桥接<br/>Stream / Thread / Agent / Worker / Process / Terminal"]
        HttpRoutes["HTTP 路由<br/>agents / threads / files / skills / tavern / cron / metrics"]
    end

    subgraph AILayer["🧠 AI Runtime 层 — 核心业务"]
        direction LR
        Executor["AgentExecutor<br/>统一执行调度"]
        Pipeline["MessagePipeline<br/>消息排队 / 中断 / 追问"]
        RuntimeEngines["运行时引擎<br/>PiMono / OpenAI"]
        MultiAgent["多智能体<br/>Swarm / Orchestrator"]
        Quality["质量闭环<br/>Aggregator / Validator / Repairer"]
        Tools["工具系统<br/>内置 + 扩展"]
        Skills["技能系统<br/>SkillManager + CoreSkills"]
        Memory["记忆系统<br/>Session / Short / Long / Structured"]
        Provider["模型层<br/>ProviderRegistry / ModelSelector"]
        Sandbox["沙箱安全<br/>PathGuard / ExecPolicy / ToolPolicy"]
    end

    subgraph InfraLayer["🏗️ 基础设施层 — 底座"]
        direction LR
        Config["ConfigStore<br/>JSON5 配置 + 热更新"]
        DB["数据库<br/>SQLite(OLTP) + DuckDB(OLAP)"]
        Workers["WorkerManager<br/>子进程管理"]
        Extensions["ExtensionManager<br/>扩展系统"]
        Lifecycle["LifecycleManager<br/>生命周期 Hook"]
        IPC["IPC Handlers<br/>Shell / Window / Tab"]
        EventBus["EventBus<br/>内部事件总线"]
        Logger["Logger<br/>日志系统"]
    end

    GW --> Executor
    GW --> Pipeline
    Methods --> Executor
    HttpRoutes --> Executor

    Executor --> RuntimeEngines
    Executor --> MultiAgent
    Executor --> Provider
    Pipeline --> Executor
    RuntimeEngines --> Tools
    RuntimeEngines --> Skills
    RuntimeEngines --> Memory
    RuntimeEngines --> Sandbox
    MultiAgent --> Quality
    MultiAgent --> Executor

    Executor --> Config
    Provider --> Config
    Tools --> DB
    Memory --> DB
    Workers --> DB
```

---

### 2.2 应用启动流程

```mermaid
sequenceDiagram
    participant M as main/index.ts
    participant AM as AppManager
    participant LC as LifecycleManager
    participant Init as INIT Phase
    participant Ready as READY Phase

    M->>AM: getAppManager().initialize()
    AM->>LC: executePhase(INIT)
    LC->>Init: InitEnvHook (Env路径)
    LC->>Init: InitDatabaseHook (SQLite+DuckDB)
    AM->>AM: app.whenReady()
    AM->>LC: executePhase(READY)

    Note over Ready: 按 priority 顺序执行
    LC->>Ready: ReadyIpcRegistrationHook (IPC)
    LC->>Ready: ReadyApiRegistrationHook [35] → HttpServer
    LC->>Ready: ReadyGatewayHook [45] → Gateway.start()
    LC->>Ready: ReadyExtensionHook [50] → Extensions
    LC->>Ready: ReadyInfraHook [55] → ConfigStore + Provider + Pipeline
    LC->>Ready: ReadyWorkerHook [80] → WorkerManager
    LC->>Ready: ReadyAppBootstrapHook [90] → Tray + ThreadWaker
    LC->>Ready: ReadyThreadRecoveryHook [200] → 恢复线程
    LC->>Ready: ReadyWindowBootstrapHook [400] → 主窗口

    Note over AM: 应用就绪, Backend Ready 事件 → 前端连接
```

---

## 三、核心执行流——从用户消息到响应

### 3.1 聊天主流程

```mermaid
flowchart TD
    User["👤 用户发送消息"]
    GW["Gateway RPC: chat.send"]
    Validate["验证参数<br/>sessionId / agentId / mode"]
    Thread["ThreadStore<br/>创建或获取会话线程"]

    subgraph ModeSwitch["根据 mode 分发"]
        Normal["agent / chat 模式"]
        Swarm["swarm / discussion 模式"]
        Orchestrator["orchestrator 模式"]
    end

    NormalBuild["createBuilder()<br/>→ PiMonoBuilder / OpenAIBuilder"]
    SwarmBuild["new SwarmRuntime(config)"]
    OrcBuild["new OrchestratorRuntime(config)"]

    Submit["AgentExecutor.submit()"]
    Pipeline["MessagePipeline<br/>排队 + 并发控制"]

    subgraph Execution["执行阶段"]
        InjectEnv["AgentEnvInjector<br/>注入技能 / 工具发现 / 执行协议"]
        Build["builder.build()<br/>→ AgentRuntime"]
        Stream["runtime.stream(message)<br/>AsyncGenerator<StreamChunk>"]
    end

    ToolLoop["工具调用循环<br/>ToolExecutionPipeline"]
    EventWriter["AgentEventWriter<br/>写入 events.jsonl"]
    StreamEmitter["StreamEmitter<br/>→ EventBus → StreamBridge"]
    WS["WebSocket → 前端"]

    User --> GW --> Validate --> Thread --> ModeSwitch
    Normal --> NormalBuild --> Submit
    Swarm --> SwarmBuild --> Submit
    Orchestrator --> OrcBuild --> Submit

    Submit --> Pipeline --> InjectEnv --> Build --> Stream
    Stream --> ToolLoop
    ToolLoop -->|"工具结果"| Stream
    Stream -->|"text:delta / tool:start / ..."| EventWriter
    EventWriter --> StreamEmitter --> WS

    style ModeSwitch fill:#f0f4ff,stroke:#4a6fa5
    style Execution fill:#f0fff4,stroke:#4a9f5a
```

### 3.2 多智能体流程 — Swarm (蜂群)

```mermaid
flowchart TD
    SwarmRT["SwarmRuntime.doStream()"]
    Coordinator["SwarmCoordinator.coordinate()"]

    subgraph HandoffLoop["🔄 Handoff 链式执行"]
        Role1["角色1: 需求分析<br/>PiMonoBuilder → stream()"]
        Handoff1["handoff → 下一个角色"]
        Role2["角色2: 详细设计<br/>PiMonoBuilder → stream()"]
        Handoff2["handoff → 下一个角色"]
        RoleN["角色N: 最终输出"]
    end

    RoleOutputs["收集所有角色输出<br/>roleOutputs[]"]

    subgraph QualityLoop["🔍 质量闭环"]
        Aggregate["Aggregator.aggregate()<br/>汇总多角色输出"]
        Validate["Validator.validate()<br/>评分 + 评审"]
        Check{"score >= 70?"}
        Repair["Repairer.suggest()<br/>修复建议"]
        Rerun["重新执行修复"]
    end

    SwarmRT --> Coordinator --> Role1
    Role1 --> Handoff1 --> Role2 --> Handoff2 --> RoleN
    RoleN --> RoleOutputs --> Aggregate
    Aggregate --> Validate --> Check
    Check -->|"✅ 通过"| Done["输出最终结果"]
    Check -->|"❌ 不通过"| Repair --> Rerun --> Validate

    style HandoffLoop fill:#fff8f0,stroke:#c07030
    style QualityLoop fill:#f0f0ff,stroke:#6060c0
```

### 3.3 多智能体流程 — Orchestrator (编排)

```mermaid
flowchart TD
    OrcRT["OrchestratorRuntime.doStream()"]
    Planner["Planner.plan()<br/>任务分解"]

    subgraph ParallelExec["⚡ 并行执行"]
        Task1["子任务1<br/>AgentExecutor.stream()"]
        Task2["子任务2<br/>AgentExecutor.stream()"]
        TaskN["子任务N<br/>AgentExecutor.stream()"]
    end

    Collect["收集所有子任务结果"]

    subgraph QualityLoop2["🔍 质量闭环"]
        Agg2["Aggregator.aggregate()"]
        Val2["Validator.validate()"]
        Check2{"score >= 70?"}
        Rep2["Repairer.suggest()"]
    end

    OrcRT --> Planner --> ParallelExec
    Task1 & Task2 & TaskN --> Collect
    Collect --> Agg2 --> Val2 --> Check2
    Check2 -->|"✅ 通过"| Done2["输出最终结果"]
    Check2 -->|"❌ 不通过"| Rep2 --> Planner

    style ParallelExec fill:#f0fff8,stroke:#30a060
    style QualityLoop2 fill:#f0f0ff,stroke:#6060c0
```

---

## 四、模型调用链

```mermaid
flowchart LR
    Builder["PiMonoBuilder<br/>/ OpenAIBuilder"]
    ApplyConfig["AgentExecutor<br/>.applyProviderConfig()"]
    Selector["ModelSelector<br/>session > agent > group > global"]
    Registry["ProviderRegistry<br/>openai / anthropic / aliyun / minimax"]
    Fallback["ModelFallback<br/>故障转移"]
    API["LLM API 调用"]

    Builder --> ApplyConfig --> Selector --> Registry --> API
    API -->|"失败"| Fallback --> Registry

    style Selector fill:#fff0f0,stroke:#c04040
```

---

## 五、工具系统

```mermaid
flowchart TD
    subgraph ToolRegistry["🔧 ToolRegistry"]
        Builtin["内置工具"]
        ExtTools["扩展工具<br/>(Extension)"]
    end

    subgraph BuiltinTools["内置工具清单"]
        direction LR
        read["read"]
        write["write"]
        edit["edit"]
        exec["exec"]
        search["search"]
        glob["glob"]
        memory["memory"]
        skill_list["skill_list"]
        delegate["delegate_to_agent"]
        task_plan["task_plan"]
        todo_write["todo_write"]
        process["process"]
        file_backup["file-backup"]
    end

    Pipeline2["ToolExecutionPipeline"]

    subgraph PipelineSteps["执行步骤"]
        BeforeHook["before_tool_call<br/>(Extension Hook)"]
        PolicyCheck["ToolPolicy 检查"]
        SandboxResolve["PathGuard 路径解析"]
        ExecPolicyCheck["ExecPolicy<br/>(exec 命令审批)"]
        Execute["执行工具"]
        AfterHook["after_tool_call<br/>(Extension Hook)"]
    end

    ToolRegistry --> Pipeline2
    Pipeline2 --> BeforeHook --> PolicyCheck --> SandboxResolve --> ExecPolicyCheck --> Execute --> AfterHook
    Builtin --> BuiltinTools

    style ToolRegistry fill:#f8f0ff,stroke:#8040c0
    style PipelineSteps fill:#f0f8f0,stroke:#408040
```

---

## 六、技能系统

```mermaid
flowchart TD
    SkillManager["SkillManager<br/>扫描 .cursor/skills/"]
    CoreSkills["CoreSkills<br/>5 个常驻技能"]

    subgraph CoreList["常驻技能"]
        EP["execution-protocol<br/>任务分解执行协议"]
        SR["self-reflection<br/>自我评估修复"]
        ERL["eval-refine-loop<br/>评估优化闭环"]
        Brain["brain<br/>大脑记忆"]
        DA["dimension-architect<br/>维度量化"]
    end

    AgentStore["AgentStore<br/>创建 Agent 时注入"]
    EnvInjector["AgentEnvInjector<br/>运行时注入"]
    Builder2["PiMonoBuilder.skills()"]

    SkillManager --> CoreSkills --> CoreList
    CoreSkills --> AgentStore
    CoreSkills --> EnvInjector
    AgentStore -->|"ensureCoreSkills()"| Builder2
    EnvInjector -->|"builder.skills()"| Builder2

    style CoreList fill:#fffff0,stroke:#a0a030
```

---

## 七、记忆系统

```mermaid
flowchart TD
    subgraph MemoryLayers["记忆分层"]
        Session["SessionMemoryStore<br/>当前会话上下文"]
        Short["ShortTermMemory<br/>裁剪 / 摘要压缩"]
        Working["WorkingMemoryStore<br/>工作记忆"]
        Long["LongTermMemoryStore<br/>长期记忆"]
    end

    subgraph Structured["结构化记忆"]
        Embedding["EmbeddingService"]
        VectorStore["VectorStore"]
        Retrieval["RetrievalService"]
        Memorize["MemorizePipeline"]
    end

    Session --> Short
    Short --> Working
    Working --> Long
    Long --> Structured
    Memorize --> Embedding --> VectorStore
    Retrieval --> VectorStore

    style MemoryLayers fill:#f0f8ff,stroke:#4080c0
    style Structured fill:#fff0f8,stroke:#c04080
```

---

## 八、扩展系统 (Extension)

```mermaid
flowchart LR
    ExtManager["ExtensionManager"]
    ExtLoader["ExtensionLoader<br/>加载 extensions/ 目录"]
    ExtRegistry["ExtensionRegistry<br/>注册工具 + Hook"]
    HookRunner["ExtensionHookRunner"]
    ExtApi["ExtensionApi<br/>暴露给扩展的 API"]

    ExtManager --> ExtLoader --> ExtRegistry
    ExtRegistry --> HookRunner
    ExtManager --> ExtApi

    subgraph Hooks["可用 Hook 点"]
        BTool["before_tool_call"]
        ATool["after_tool_call"]
        BMsg["before_message"]
        AMsg["after_message"]
    end

    HookRunner --> Hooks
```

---

## 九、前端渲染进程架构

```mermaid
graph TB
    subgraph Pages["📄 路由页面"]
        Agent["/agent — AgentView"]
        Employee["/employee — EmployeeView"]
        EmployeeChat["/employee/:id/chat"]
        Thread["/thread/:id — ThreadView"]
        Skills["/skills — SkillsView"]
        Tavern["/tavern — TavernView"]
        Brain["/brain — BrainView"]
        BrainMonitor["/brain-monitor"]
        Cron["/cron — CronView"]
        Logs["/logs — LogViewer"]
        Settings["/settings — SettingsView"]
        Observability["/observability"]
    end

    subgraph SettingsTabs["设置子页面"]
        Basic["基本配置"]
        Models["模型设置"]
        ModelGroups["模型分组"]
        WorkersSetting["内置服务"]
        MemSetting["记忆管理"]
        Remote["远程访问 (QR)"]
        About["关于我们"]
    end

    subgraph Communication["📡 通信层"]
        GC["GatewayClient<br/>WebSocket RPC"]
        IPC2["window.api<br/>IPC 桥接"]
        SSE["SSE 连接"]
    end

    subgraph StateLayer["🗂️ 状态管理"]
        PiniaStores["Pinia Stores<br/>chat / agents / threads / worker / copilot / skills"]
    end

    Pages --> Communication
    Settings --> SettingsTabs
    Communication --> PiniaStores
```

---

## 十、重点文件索引

### 10.1 核心入口

| 文件                           | 职责                             | 重要度 |
| ------------------------------ | -------------------------------- | ------ |
| `src/main/index.ts`            | 应用入口                         | ⭐⭐⭐ |
| `src/main/common/app/index.ts` | AppManager — 生命周期编排        | ⭐⭐⭐ |
| `src/main/common/Lifecycle.ts` | LifecycleManager — Hook 执行引擎 | ⭐⭐⭐ |

### 10.2 Gateway 层

| 文件                                 | 职责                                      | 重要度 |
| ------------------------------------ | ----------------------------------------- | ------ |
| `src/main/gateway/Gateway.ts`        | Gateway 核心 — 方法发现 + 路由 + 事件广播 | ⭐⭐⭐ |
| `src/main/gateway/GatewayServer.ts`  | WebSocket + HTTP 服务                     | ⭐⭐⭐ |
| `src/main/gateway/methods/chat.ts`   | 聊天入口 — 最关键的方法组                 | ⭐⭐⭐ |
| `src/main/gateway/methods/config.ts` | 配置方法组                                | ⭐⭐   |
| `src/main/gateway/methods/system.ts` | 系统方法组 (网络信息/QR码)                | ⭐     |

### 10.3 AI Runtime 层

| 文件                                                  | 职责                              | 重要度   |
| ----------------------------------------------------- | --------------------------------- | -------- |
| `src/main/ai/AgentExecutor.ts`                        | **统一执行调度器** — 最核心的文件 | ⭐⭐⭐⭐ |
| `src/main/ai/AgentEnvInjector.ts`                     | 环境注入 (技能/协议/工具发现)     | ⭐⭐⭐   |
| `src/main/ai/pipeline/MessagePipeline.ts`             | 消息管线 — 排队/中断/追问         | ⭐⭐⭐   |
| `src/main/ai/runtime/pimono/PiMonoBuilder.ts`         | PiMono 构建器 — Builder 模式核心  | ⭐⭐⭐   |
| `src/main/ai/runtime/pimono/PiMonoAgentRuntime.ts`    | PiMono 运行时实现                 | ⭐⭐⭐   |
| `src/main/ai/runtime/openai/OpenAIBuilder.ts`         | OpenAI 构建器                     | ⭐⭐⭐   |
| `src/main/ai/runtime/openai/OpenAIAgentRuntime.ts`    | OpenAI 运行时实现                 | ⭐⭐⭐   |
| `src/main/ai/runtime/AgentRuntime.ts`                 | 运行时接口定义                    | ⭐⭐⭐   |
| `src/main/ai/runtime/shared/ToolExecutionPipeline.ts` | 工具执行管线                      | ⭐⭐⭐   |

### 10.4 多智能体

| 文件                                               | 职责                                       | 重要度 |
| -------------------------------------------------- | ------------------------------------------ | ------ |
| `src/main/ai/swarm/SwarmRuntime.ts`                | Swarm 运行时 — Handoff/Parallel/Discussion | ⭐⭐⭐ |
| `src/main/ai/swarm/SwarmCoordinator.ts`            | Swarm 协调器 — 角色编排                    | ⭐⭐⭐ |
| `src/main/ai/orchestration/OrchestratorRuntime.ts` | 编排运行时 — 并行子任务                    | ⭐⭐⭐ |
| `src/main/ai/orchestration/Planner.ts`             | 任务分解计划器                             | ⭐⭐   |
| `src/main/ai/quality-loop/Validator.ts`            | 输出质量验证                               | ⭐⭐⭐ |
| `src/main/ai/quality-loop/Aggregator.ts`           | 多输出汇总                                 | ⭐⭐   |
| `src/main/ai/quality-loop/Repairer.ts`             | 修复建议                                   | ⭐⭐   |

### 10.5 工具 & 技能 & 安全

| 文件                                 | 职责             | 重要度 |
| ------------------------------------ | ---------------- | ------ |
| `src/main/ai/tools/registry.ts`      | 工具注册表       | ⭐⭐⭐ |
| `src/main/ai/tools/builtin/`         | 内置工具实现目录 | ⭐⭐⭐ |
| `src/main/ai/skills/SkillManager.ts` | 技能管理器       | ⭐⭐⭐ |
| `src/main/ai/skills/CoreSkills.ts`   | 核心技能定义     | ⭐⭐   |
| `src/main/ai/sandbox/path-guard.ts`  | 路径安全守卫     | ⭐⭐⭐ |
| `src/main/ai/sandbox/exec-policy.ts` | 命令执行策略     | ⭐⭐   |

### 10.6 模型 & 记忆

| 文件                                       | 职责              | 重要度 |
| ------------------------------------------ | ----------------- | ------ |
| `src/main/ai/provider/ProviderRegistry.ts` | 模型提供者注册    | ⭐⭐⭐ |
| `src/main/ai/provider/ModelSelector.ts`    | 模型选择策略      | ⭐⭐⭐ |
| `src/main/ai/provider/LLMService.ts`       | 统一 LLM 调用服务 | ⭐⭐   |
| `src/main/ai/memory/SessionMemoryStore.ts` | 会话记忆          | ⭐⭐   |
| `src/main/ai/agents/AgentStore.ts`         | Agent 定义存储    | ⭐⭐⭐ |

### 10.7 基础设施

| 文件                                            | 职责          | 重要度 |
| ----------------------------------------------- | ------------- | ------ |
| `src/main/common/config/ConfigStore.ts`         | 配置中心      | ⭐⭐⭐ |
| `src/main/common/database/SQLiteService.ts`     | SQLite 数据库 | ⭐⭐⭐ |
| `src/main/common/server/httpServer.ts`          | HTTP 服务器   | ⭐⭐⭐ |
| `src/main/common/worker/WorkerManager.ts`       | Worker 子进程 | ⭐⭐   |
| `src/main/common/extension/ExtensionManager.ts` | 扩展系统      | ⭐⭐   |

### 10.8 前端核心

| 文件                                              | 职责             | 重要度 |
| ------------------------------------------------- | ---------------- | ------ |
| `src/renderer/src/services/GatewayClient.ts`      | 前端 RPC 客户端  | ⭐⭐⭐ |
| `src/renderer/src/plugins/gatewaySetup.ts`        | Gateway 连接管理 | ⭐⭐⭐ |
| `src/renderer/src/composables/useAgentStream.ts`  | Agent 流式响应   | ⭐⭐⭐ |
| `src/renderer/src/components/agent/ChatPanel.vue` | 聊天面板         | ⭐⭐⭐ |
| `src/renderer/src/router/index.ts`                | 路由配置         | ⭐⭐   |

---

## 十一、代码目录树

```
src/
├── main/                           # 主进程
│   ├── index.ts                    # 入口
│   ├── ai/                         # 🧠 AI Runtime 核心
│   │   ├── AgentExecutor.ts        #   统一执行调度器
│   │   ├── AgentEnvInjector.ts     #   环境注入
│   │   ├── AgentEventWriter.ts     #   事件写入
│   │   ├── agents/                 #   Agent 定义存储
│   │   │   ├── AgentStore.ts
│   │   │   └── types.ts
│   │   ├── cron/                   #   定时任务
│   │   ├── hitl/                   #   人在回路审批
│   │   ├── memory/                 #   记忆系统
│   │   │   ├── SessionMemoryStore.ts
│   │   │   ├── ShortTermMemory.ts
│   │   │   ├── WorkingMemoryStore.ts
│   │   │   ├── LongTermMemoryStore.ts
│   │   │   └── structured/        #   结构化向量记忆
│   │   ├── metrics/                #   指标
│   │   ├── orchestration/          #   编排器 (并行子任务)
│   │   │   ├── OrchestratorRuntime.ts
│   │   │   ├── Planner.ts
│   │   │   └── WorkerCoordinator.ts
│   │   ├── pipeline/               #   消息管线
│   │   │   ├── MessagePipeline.ts
│   │   │   ├── SessionQueue.ts
│   │   │   └── AbortManager.ts
│   │   ├── process/                #   进程管理
│   │   ├── provider/               #   模型提供者
│   │   │   ├── ProviderRegistry.ts
│   │   │   ├── ModelSelector.ts
│   │   │   ├── LLMService.ts
│   │   │   └── builtin/           #   openai / anthropic / aliyun / minimax
│   │   ├── quality-loop/           #   质量闭环
│   │   │   ├── Aggregator.ts
│   │   │   ├── Validator.ts
│   │   │   └── Repairer.ts
│   │   ├── runtime/                #   运行时引擎
│   │   │   ├── AgentRuntime.ts     #   接口定义
│   │   │   ├── AbstractAgentRuntime.ts
│   │   │   ├── pimono/            #   PiMono 引擎
│   │   │   │   ├── PiMonoBuilder.ts
│   │   │   │   └── PiMonoAgentRuntime.ts
│   │   │   ├── openai/            #   OpenAI 引擎
│   │   │   │   ├── OpenAIBuilder.ts
│   │   │   │   └── OpenAIAgentRuntime.ts
│   │   │   ├── shared/            #   共享管线
│   │   │   │   └── ToolExecutionPipeline.ts
│   │   │   └── services/          #   运行时服务
│   │   ├── sandbox/                #   沙箱安全
│   │   │   ├── path-guard.ts
│   │   │   ├── exec-policy.ts
│   │   │   └── tool-policy.ts
│   │   ├── services/               #   AI 服务
│   │   ├── skills/                 #   技能系统
│   │   │   ├── SkillManager.ts
│   │   │   └── CoreSkills.ts
│   │   ├── storage/                #   存储管理
│   │   ├── streaming/              #   流式输出
│   │   │   ├── StreamEmitter.ts
│   │   │   └── consumers/
│   │   ├── swarm/                  #   蜂群多智能体
│   │   │   ├── SwarmRuntime.ts
│   │   │   ├── SwarmCoordinator.ts
│   │   │   ├── SwarmContext.ts
│   │   │   ├── HandoffRouter.ts
│   │   │   └── roles/
│   │   ├── tavern/                 #   酒馆任务调度
│   │   ├── threads/                #   会话线程
│   │   └── tools/                  #   工具系统
│   │       ├── registry.ts
│   │       ├── builtin/           #   内置工具实现
│   │       └── security/          #   安全检查
│   ├── common/                     # 🏗️ 基础设施
│   │   ├── app/                    #   AppManager
│   │   ├── config/                 #   配置系统
│   │   ├── database/               #   数据库
│   │   ├── extension/              #   扩展系统
│   │   ├── ipc/                    #   IPC 通信
│   │   ├── job/                    #   CronJob
│   │   ├── server/                 #   HTTP 服务器
│   │   ├── worker/                 #   Worker 管理
│   │   └── window/                 #   窗口管理
│   ├── events/                     #   事件处理器
│   ├── gateway/                    # 🌐 Gateway 通信层
│   │   ├── Gateway.ts
│   │   ├── GatewayServer.ts
│   │   ├── methods/               #   RPC 方法组
│   │   ├── events/                #   事件桥接
│   │   ├── http/                  #   REST 路由
│   │   ├── protocol/              #   协议定义
│   │   └── unified/               #   统一网关
│   ├── lifecycle/                  #   生命周期 Hook
│   ├── metrics/                    #   指标收集
│   ├── terminal/                   #   终端 PTY
│   └── utils/                      #   工具函数
├── renderer/                       # 🖥️ 渲染进程
│   └── src/
│       ├── api/                    #   API 层
│       ├── components/             #   Vue 组件
│       ├── composables/            #   组合式函数
│       ├── layout/                 #   布局
│       ├── plugins/                #   插件 (gateway/ipc/eventbus)
│       ├── router/                 #   路由
│       ├── services/               #   GatewayClient
│       ├── stores/                 #   Pinia 状态
│       ├── views/                  #   页面视图
│       └── windows/                #   子窗口 (shell/browser)
├── shared/                         # 🔗 共享类型
│   ├── api.ts
│   ├── constants.ts
│   ├── gateway-protocol.ts
│   ├── stream-protocol.ts
│   └── ipc/
└── preload/                        # 🔗 Preload 桥接
    └── index.ts
```

---

## 十二、架构设计原则总结

| 原则             | 体现                                                               |
| ---------------- | ------------------------------------------------------------------ |
| **分层隔离**     | Gateway → AI Runtime → 基础设施，各层职责清晰                      |
| **Builder 模式** | `PiMonoBuilder` / `OpenAIBuilder` 统一构建流程                     |
| **策略模式**     | 模型选择 (`ModelSelector`)、沙箱策略 (`ToolPolicy` / `ExecPolicy`) |
| **观察者模式**   | `EventBus` + `StreamEmitter` + `EventBridge` 事件驱动              |
| **管线模式**     | `MessagePipeline`、`ToolExecutionPipeline`、`MemorizePipeline`     |
| **生命周期钩子** | `LifecycleManager` + Hook 优先级排序                               |
| **自动发现**     | Gateway 方法、事件桥接、生命周期 Hook 均自动扫描注册               |
| **扩展系统**     | Extension 可注入工具和 Hook，不侵入核心代码                        |
| **质量闭环**     | `Aggregator → Validator → Repairer` 多轮迭代保证输出质量           |
