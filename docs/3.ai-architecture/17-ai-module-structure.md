# AI 模块架构全景图

> 本文档描述 `src/main/ai/` 目录的完整结构、模块职责、层次关系和数据流向。

---

## 1. 目录结构总览

```
src/main/ai/
│
├── index.ts                    # 模块统一导出（门面）
├── types.ts                    # 全局类型定义
├── README.md                   # 模块说明文档
│
├── agents/                     # [核心] Agent 创建与预设
│   ├── AgentFactory.ts         #   Agent 工厂（创建、缓存、生命周期管理）
│   ├── presets.ts              #   Agent 预设配置（chat / code / research）
│   ├── index.ts                #   模块导出
│   └── __tests__/
│       ├── AgentFactory.test.ts
│       └── presets.test.ts
│
├── runtime/                    # [核心] 统一运行时接口
│   ├── AgentRuntime.ts         #   单 Agent 运行时（IExecutable 实现）
│   ├── TeamRuntime.ts          #   多 Agent Team 运行时
│   ├── RuntimeFactory.ts       #   运行时工厂（按类型创建 Agent/Team/Swarm）
│   ├── types.ts                #   IExecutable 接口、ExecutionResult 等
│   ├── index.ts
│   └── __tests__/
│       ├── AgentRuntime.test.ts
│       ├── TeamRuntime.test.ts
│       └── RuntimeFactory.test.ts
│
├── memory/                     # [核心] 四类记忆系统
│   ├── SessionMemoryStore.ts   #   会话记忆（完整对话历史，JSONL）
│   ├── ShortTermMemory.ts      #   短期记忆（LLM 上下文窗口管理）
│   ├── WorkingMemoryStore.ts   #   工作记忆（任务状态、变量、检查点）
│   ├── LongTermMemoryStore.ts  #   长期记忆（跨会话知识库，SQLite）
│   ├── SessionAdapter.ts       #   SDK Session 适配器（包装 SessionMemoryStore）
│   ├── types.ts                #   记忆相关类型
│   ├── index.ts
│   └── __tests__/
│       ├── SessionMemoryStore.test.ts
│       ├── ShortTermMemory.test.ts
│       ├── WorkingMemoryStore.test.ts
│       └── LongTermMemoryStore.test.ts
│
├── orchestration/              # [核心] Orchestrator-Worker 编排系统
│   ├── Orchestrator.ts         #   编排器（协调 Planner + Workers）
│   ├── Planner.ts              #   计划 Agent（任务分解，outputType 结构化输出）
│   ├── WorkerCoordinator.ts    #   Worker 池管理（分配任务到 Worker Agent）
│   ├── PlanVersionManager.ts   #   计划版本管理（版本历史、回溯）
│   ├── VerificationGate.ts     #   验证门（质量检查、规则验证）
│   ├── verification-rules.ts   #   内置验证规则
│   ├── types.ts                #   编排相关类型（Plan、SubTask、Stage 等）
│   ├── index.ts
│   └── __tests__/
│       ├── Planner.test.ts
│       ├── WorkerCoordinator.test.ts
│       ├── PlanVersionManager.test.ts
│       └── VerificationGate.test.ts
│
├── swarm/                      # [核心] 群体智能（Swarm Multi-Agent）
│   ├── SwarmCoordinator.ts     #   Swarm 协调器（分诊 → 分解 → 分配 → 执行）
│   ├── SwarmRuntime.ts         #   Swarm 运行时（IExecutable 实现）
│   ├── AgentPool.ts            #   Agent 池（按角色创建和复用 Agent）
│   ├── HandoffRouter.ts        #   Handoff 路由器（Agent 间任务移交）
│   ├── ConcurrencyManager.ts   #   并发管理器（阶段化并行执行 + 信号量）
│   ├── SwarmContext.ts         #   共享上下文（黑板模式，Agent 间共享状态）
│   ├── MessageBus.ts           #   消息总线（Agent 间通信）
│   ├── SwarmMonitor.ts         #   Swarm 监控
│   ├── tools.ts                #   Swarm 通信工具（读写上下文、发消息等）
│   ├── types.ts                #   Swarm 相关类型
│   ├── index.ts
│   ├── roles/
│   │   ├── builtin.ts          #   内置角色（coder / researcher / reviewer / writer / analyst）
│   │   └── index.ts
│   └── __tests__/
│       ├── ConcurrencyManager.test.ts
│       ├── HandoffRouter.test.ts
│       ├── MessageBus.test.ts
│       ├── SwarmContext.test.ts
│       └── tools.test.ts
│
├── streaming/                  # 流式输出系统（EventBus 架构）
│   ├── StreamEmitter.ts        #   流式发射器（生产者，生成流消息）
│   ├── types.ts                #   流消息类型（StreamMessage、StreamEvent）
│   ├── index.ts
│   ├── consumers/
│   │   ├── StreamStore.ts      #   消息持久化消费者（SQLite）
│   │   ├── WebSocketBroadcaster.ts  # WebSocket 广播消费者（推送前端）
│   │   ├── StreamMonitor.ts    #   监控消费者（统计信息收集）
│   │   ├── index.ts
│   │   └── __tests__/
│   │       ├── StreamStore.test.ts
│   │       └── WebSocketBroadcaster.test.ts
│   └── __tests__/
│       ├── StreamEmitter.test.ts
│       └── StreamMonitor.test.ts
│
├── tools/                      # 工具系统
│   ├── registry.ts             #   工具注册中心
│   ├── types.ts                #   工具类型定义
│   ├── index.ts
│   ├── builtin/
│   │   └── index.ts            #   内置工具（read_file / web_search）
│   └── __tests__/
│       ├── builtin.test.ts
│       └── registry.test.ts
│
├── skills/                     # 技能系统
│   ├── SkillManager.ts         #   技能管理器（注册、激活、调用）
│   ├── types.ts                #   技能类型定义
│   ├── index.ts
│   └── builtin/
│       ├── CodeGenerationSkill.ts   # 代码生成技能
│       ├── WebResearchSkill.ts      # 网络研究技能
│       └── index.ts
│
├── guardrails/                 # 安全护栏（SDK Guardrails）
│   ├── inputGuardrails.ts      #   输入护栏（内容安全、注入检测、长度限制）
│   ├── outputGuardrails.ts     #   输出护栏（敏感数据、格式合规）
│   └── index.ts
│
├── storage/                    # 数据持久化
│   ├── AgentConfigStore.ts     #   Agent 配置存储（SQLite CRUD）
│   ├── TeamConfigStore.ts      #   Team 配置存储
│   ├── SessionFileManager.ts   #   会话文件管理（JSONL / JSON）
│   ├── index.ts
│   └── schemas/
│       ├── agent_configs.sql   #   Agent 配置表结构
│       ├── team_configs.sql    #   Team 配置表结构
│       ├── long_term_memory.sql #  长期记忆表结构
│       └── stream_messages.sql  #  流消息表结构
│
├── monitoring/                 # 监控与追踪
│   ├── MonitoringService.ts    #   监控服务（指标收集）
│   ├── PerformanceMonitor.ts   #   性能监控
│   └── index.ts
│
├── gateway/                    # WebSocket 网关
│   ├── AgentGateway.ts         #   Agent 网关（WebSocket 协议处理）
│   ├── index.ts
│   └── protocol/
│       └── messages.ts         #   协议消息定义
│
├── teams/                      # Team 配置类型
│   ├── types.ts                #   TeamConfig / TeamMember 类型
│   └── index.ts
│
├── common/                     # AI 模块通用工具
│   ├── errors.ts               #   错误类型定义
│   └── index.ts
│
└── __tests__/                  # 共享测试辅助
    └── helpers/
        ├── mock-agent.ts       #   Agent mock 工厂
        ├── mock-database.ts    #   数据库 mock
        └── mock-eventbus.ts    #   EventBus mock
```

**统计**：15 个模块 / 100 个文件 / 28 个测试文件 / 4 个 SQL Schema

---

## 2. 架构层次图

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Gateway / API 层                              │
│                                                                      │
│   ┌────────────────┐   ┌──────────────────┐   ┌──────────────────┐  │
│   │  AgentGateway   │   │  WebSocket       │   │  IPC (Electron)  │  │
│   │  (WebSocket)    │   │  Broadcaster     │   │                  │  │
│   └───────┬────────┘   └────────┬─────────┘   └────────┬─────────┘  │
│           │                     │                       │            │
└───────────┼─────────────────────┼───────────────────────┼────────────┘
            │                     │                       │
            ▼                     ▼                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       统一运行时接口层                                │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │                    RuntimeFactory                            │   │
│   │           createRuntime(type, id, sessionId)                 │   │
│   └──────────┬──────────────────┬───────────────────┬────────────┘   │
│              │                  │                   │                │
│   ┌──────────▼──────┐ ┌────────▼────────┐ ┌────────▼────────┐      │
│   │  AgentRuntime   │ │  TeamRuntime    │ │  SwarmRuntime   │      │
│   │  (单 Agent)     │ │  (Agent Team)   │ │  (群体智能)     │      │
│   │                 │ │  sequential /   │ │  triage →       │      │
│   │  run()          │ │  parallel       │ │  decompose →    │      │
│   │  runStream()    │ │                 │ │  dispatch →     │      │
│   └──────┬──────────┘ └────────┬────────┘ │  execute        │      │
│          │                     │          └────────┬────────┘      │
│          │                     │                   │                │
└──────────┼─────────────────────┼───────────────────┼────────────────┘
           │                     │                   │
           ▼                     ▼                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        Agent 核心层                                   │
│                                                                      │
│   ┌──────────────────┐   ┌────────────────────────────────────────┐  │
│   │   AgentFactory   │   │  @openai/agents SDK                   │  │
│   │                  │   │  ┌────────┐ ┌─────┐ ┌──────────────┐  │  │
│   │  presets:        │   │  │ Agent  │ │ run │ │ tool / handoff│  │  │
│   │  - chat          │──▶│  └────────┘ └─────┘ └──────────────┘  │  │
│   │  - code          │   │  ┌──────────┐ ┌──────────┐            │  │
│   │  - research      │   │  │outputType│ │maxTurns  │            │  │
│   │                  │   │  └──────────┘ └──────────┘            │  │
│   │  modelSettings   │   │  ┌────────────────┐ ┌──────────────┐  │  │
│   └──────────────────┘   │  │modelSettings   │ │previousResId │  │  │
│                          │  └────────────────┘ └──────────────┘  │  │
│                          └────────────────────────────────────────┘  │
│                                                                      │
│   ┌──────────────────┐   ┌──────────────────┐                       │
│   │   Guardrails     │   │   Tools          │                       │
│   │  - input safety  │   │  - read_file     │                       │
│   │  - injection det │   │  - web_search    │                       │
│   │  - output check  │   │  - ToolRegistry  │                       │
│   └──────────────────┘   └──────────────────┘                       │
└──────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    编排与协作层                                       │
│                                                                      │
│   ┌─────────────────────────────────┐   ┌────────────────────────┐  │
│   │      Orchestrator-Worker        │   │      Swarm 群体智能     │  │
│   │                                 │   │                        │  │
│   │  ┌──────────┐ ┌──────────────┐  │   │  ┌──────────────────┐  │  │
│   │  │ Planner  │ │ WorkerCoord  │  │   │  │ SwarmCoordinator │  │  │
│   │  │ (计划)   │ │ (分配执行)   │  │   │  │  Triage Agent    │  │  │
│   │  └──────────┘ └──────────────┘  │   │  │  Decomposer      │  │  │
│   │                                 │   │  └──────────────────┘  │  │
│   │  ┌──────────────────────────┐   │   │                        │  │
│   │  │ PlanVersionManager      │   │   │  ┌─────────┐ ┌──────┐  │  │
│   │  │ (版本管理 + 回溯)       │   │   │  │AgentPool│ │Conc. │  │  │
│   │  └──────────────────────────┘   │   │  │(角色池) │ │Mgr.  │  │  │
│   │                                 │   │  └─────────┘ └──────┘  │  │
│   │  ┌──────────────────────────┐   │   │                        │  │
│   │  │ VerificationGate        │   │   │  ┌─────────┐ ┌──────┐  │  │
│   │  │ (质量验证)              │   │   │  │Handoff  │ │Msg   │  │  │
│   │  └──────────────────────────┘   │   │  │Router   │ │Bus   │  │  │
│   │                                 │   │  └─────────┘ └──────┘  │  │
│   └─────────────────────────────────┘   │                        │  │
│                                         │  ┌──────────────────┐  │  │
│                                         │  │ SwarmContext      │  │  │
│                                         │  │ (共享黑板)        │  │  │
│                                         │  └──────────────────┘  │  │
│                                         └────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    记忆与存储层                                       │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │                     四类记忆系统                              │   │
│   │                                                              │   │
│   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │   │
│   │  │ Session      │  │ Short-Term   │  │ Working Memory   │   │   │
│   │  │ Memory       │  │ Memory       │  │ Store            │   │   │
│   │  │              │  │              │  │                  │   │   │
│   │  │ 完整对话历史 │  │ LLM 上下文   │  │ 任务状态/变量    │   │   │
│   │  │ (JSONL)      │  │ 窗口管理     │  │ 检查点 (JSON)   │   │   │
│   │  │              │  │ Trimming /   │  │                  │   │   │
│   │  │ SessionAdapt │  │ Summarizing  │  │                  │   │   │
│   │  └──────────────┘  └──────────────┘  └──────────────────┘   │   │
│   │                                                              │   │
│   │  ┌────────────────────────────────────────────────────────┐  │   │
│   │  │ Long-Term Memory Store                                │  │   │
│   │  │ 跨会话知识库（SQLite）                                 │  │   │
│   │  │ SEMANTIC | EPISODIC | PROCEDURAL | PREFERENCE | LESSON │  │   │
│   │  └────────────────────────────────────────────────────────┘  │   │
│   └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│   │ AgentConfigStore│  │ TeamConfigStore  │  │ SessionFile      │   │
│   │ (Agent 配置)    │  │ (Team 配置)      │  │ Manager          │   │
│   │ (SQLite)        │  │ (SQLite)         │  │ (JSONL/JSON)     │   │
│   └─────────────────┘  └──────────────────┘  └──────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    流式输出与监控层                                    │
│                                                                      │
│          StreamEmitter (生产者)                                       │
│               │                                                      │
│               ▼                                                      │
│          ┌─────────┐                                                 │
│          │EventBus │  (publish/subscribe)                            │
│          └────┬────┘                                                 │
│               │                                                      │
│        ┌──────┼──────────────┐                                       │
│        ▼      ▼              ▼                                       │
│   ┌─────────┐ ┌───────────┐ ┌──────────────┐                        │
│   │ Stream  │ │ WebSocket │ │ Stream       │                        │
│   │ Store   │ │ Broadcast │ │ Monitor      │                        │
│   │(SQLite) │ │ (→前端)   │ │(统计/告警)   │                        │
│   └─────────┘ └───────────┘ └──────────────┘                        │
│                                                                      │
│   ┌──────────────────┐  ┌──────────────────┐                        │
│   │MonitoringService │  │PerformanceMonitor│                        │
│   │(执行指标收集)     │  │(性能追踪)        │                        │
│   └──────────────────┘  └──────────────────┘                        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. 模块职责说明

| 模块           | 目录             | 核心职责                                                 | 关键文件                                                                                                              |
| -------------- | ---------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Agent 工厂** | `agents/`        | 从配置/预设创建 Agent 实例，管理 modelSettings           | `AgentFactory.ts`, `presets.ts`                                                                                       |
| **统一运行时** | `runtime/`       | IExecutable 接口，统一 Agent/Team/Swarm 的 run/runStream | `AgentRuntime.ts`, `TeamRuntime.ts`, `RuntimeFactory.ts`                                                              |
| **记忆系统**   | `memory/`        | 四类记忆（会话/短期/工作/长期），SDK Session 适配        | `SessionMemoryStore.ts`, `ShortTermMemory.ts`, `WorkingMemoryStore.ts`, `LongTermMemoryStore.ts`, `SessionAdapter.ts` |
| **编排系统**   | `orchestration/` | Orchestrator-Worker 模式，计划生成+分配+验证             | `Orchestrator.ts`, `Planner.ts`, `WorkerCoordinator.ts`, `VerificationGate.ts`                                        |
| **群体智能**   | `swarm/`         | 多 Agent 并行协作（分诊/分解/分配/执行），共享上下文     | `SwarmCoordinator.ts`, `ConcurrencyManager.ts`, `AgentPool.ts`, `HandoffRouter.ts`                                    |
| **流式输出**   | `streaming/`     | EventBus 架构的可靠流式消息（持久化+广播+监控）          | `StreamEmitter.ts`, `StreamStore.ts`, `WebSocketBroadcaster.ts`                                                       |
| **工具系统**   | `tools/`         | 工具注册和内置工具（read_file, web_search）              | `registry.ts`, `builtin/index.ts`                                                                                     |
| **技能系统**   | `skills/`        | Agent 能力扩展（代码生成、网络研究）                     | `SkillManager.ts`, `builtin/`                                                                                         |
| **安全护栏**   | `guardrails/`    | SDK Guardrails（输入安全/注入检测/输出检查）             | `inputGuardrails.ts`, `outputGuardrails.ts`                                                                           |
| **数据存储**   | `storage/`       | SQLite 持久化（Agent/Team 配置、记忆、流消息）           | `AgentConfigStore.ts`, `TeamConfigStore.ts`, `schemas/`                                                               |
| **监控**       | `monitoring/`    | 执行指标收集、性能追踪                                   | `MonitoringService.ts`, `PerformanceMonitor.ts`                                                                       |
| **网关**       | `gateway/`       | WebSocket 协议处理                                       | `AgentGateway.ts`                                                                                                     |
| **Team 配置**  | `teams/`         | Team 配置类型定义                                        | `types.ts`                                                                                                            |
| **通用**       | `common/`        | 错误类型等通用工具                                       | `errors.ts`                                                                                                           |

---

## 4. 数据流向图

### 4.1 单 Agent 执行流

```
用户输入
  │
  ▼
RuntimeFactory.createRuntime({ type: 'agent' })
  │
  ▼
AgentRuntime.run(input)
  │
  ├──▶ AgentFactory.createAgent()
  │       │
  │       ├── 加载 presets (chat/code/research)
  │       ├── 合并 modelSettings
  │       └── new Agent({ name, instructions, model, tools, outputType })
  │
  ├──▶ SDK run(agent, input, { maxTurns, previousResponseId })
  │       │
  │       ├── InputGuardrails 检查
  │       ├── LLM 调用
  │       ├── Tool 调用（如有）
  │       ├── OutputGuardrails 检查
  │       └── 返回 RunResult { finalOutput, lastResponseId }
  │
  ├──▶ SessionMemoryStore.appendMessage()  (保存对话)
  │
  └──▶ 返回 ExecutionResult { output, duration, metadata }
```

### 4.2 流式执行流

```
用户输入
  │
  ▼
AgentRuntime.runStream(input, config, onChunk)
  │
  ├──▶ StreamEmitter.emitStart()
  │
  ├──▶ SDK run(agent, input, { stream: true, maxTurns, previousResponseId })
  │       │
  │       └── 返回 StreamedRunResult (AsyncIterable<RunStreamEvent>)
  │
  ├──▶ for await (event of streamResult)
  │       │
  │       ├── raw_model_stream_event (output_text_delta)
  │       │     └── StreamEmitter.emitText(delta) → EventBus
  │       │           ├── StreamStore (持久化)
  │       │           ├── WebSocketBroadcaster (推送前端)
  │       │           └── StreamMonitor (统计)
  │       │
  │       ├── run_item_stream_event (tool_called)
  │       │     └── StreamEmitter.emitToolCall(name, args)
  │       │
  │       └── agent_updated_stream_event (handoff)
  │             └── StreamEmitter.emitThinking(message)
  │
  ├──▶ await streamResult.completed
  │
  └──▶ StreamEmitter.emitDone()
```

### 4.3 Orchestrator-Worker 执行流

```
复杂任务
  │
  ▼
Orchestrator.executeTask(task)
  │
  ├──1──▶ Planner.plan(task)
  │         │
  │         ├── Agent({ outputType: PlanOutputSchema })
  │         ├── run(plannerAgent, prompt, { maxTurns: 5 })
  │         └── 返回结构化 ExecutionPlan { stages, subTasks }
  │
  ├──2──▶ PlanVersionManager.createPlanVersion(plan, reason)
  │
  ├──3──▶ for each stage in plan.stages
  │         │
  │         └── WorkerCoordinator.executeStage(stage)
  │               │
  │               ├── 为每个 subTask 创建 Worker Agent
  │               ├── run(workerAgent, subTaskInput, { maxTurns: 25 })
  │               └── 收集结果
  │
  ├──4──▶ VerificationGate.verify(taskId, output, rules)
  │         │
  │         ├── 执行验证规则
  │         └── 通过 → 完成 / 失败 → Planner.replan()
  │
  └──5──▶ 聚合结果，返回 TaskExecutionResult
```

### 4.4 Swarm 群体智能执行流

```
用户请求
  │
  ▼
SwarmCoordinator.coordinate(input)
  │
  ├──1──▶ Triage Agent  (分诊：判断是否需要多 Agent 协作)
  │         run(triageAgent, input, { maxTurns: 25 })
  │
  ├──2──▶ Decomposer Agent  (分解：拆分为子任务)
  │         run(decomposerAgent, input, { maxTurns: 10 })
  │
  ├──3──▶ ConcurrencyManager.buildExecutionPhases(tasks)
  │         │
  │         └── 按依赖关系分为多个阶段
  │             Phase 1: [t1, t2]  (无依赖，并行)
  │             Phase 2: [t3]      (依赖 t1)
  │             Phase 3: [t4]      (依赖 t2, t3)
  │
  ├──4──▶ for each phase
  │         │
  │         └── executePhase(tasks)
  │               │
  │               ├── AgentPool.getAgent(roleId)  (按角色获取 Agent)
  │               ├── run(agent, input, { maxTurns: 25 })  (并行执行)
  │               │
  │               ├── SwarmContext  (共享状态)
  │               │     Agent A ──write──▶ 黑板 ◀──read── Agent B
  │               │
  │               ├── MessageBus  (Agent 间通信)
  │               │     Agent A ──send──▶ 消息队列 ──recv──▶ Agent B
  │               │
  │               └── HandoffRouter  (任务移交)
  │                     Agent A ──handoff──▶ Agent B
  │
  └──5──▶ 聚合结果，返回 CoordinationResult
```

---

## 5. 模块依赖关系

```
                    ┌─────────┐
                    │ gateway │
                    └────┬────┘
                         │ uses
                         ▼
┌──────────┐      ┌──────────┐      ┌───────────┐
│streaming │◀─────│ runtime  │─────▶│  agents   │
└──────────┘      └────┬─────┘      └─────┬─────┘
     │                 │                   │
     │            ┌────┼────┐              │ uses
     │            │    │    │              ▼
     │            ▼    ▼    ▼        ┌──────────┐
     │      ┌────────┐│┌────────┐   │ presets   │
     │      │ orchest ││ swarm  │   │modelSetng │
     │      │ ration  ││        │   └──────────┘
     │      └───┬─────┘└───┬────┘
     │          │          │
     │          ▼          ▼
     │    ┌──────────┐ ┌──────────┐
     │    │ memory   │ │  tools   │
     │    └────┬─────┘ └──────────┘
     │         │
     │         ▼
     │    ┌──────────┐  ┌────────────┐
     └───▶│ storage  │  │ monitoring │
          └──────────┘  └────────────┘
               │
               ▼
          ┌──────────┐
          │  SQLite   │
          │  (common) │
          └──────────┘
```

---

## 6. 技术栈与 SDK 集成

| 技术                                 | 用途                                  | 位置                                              |
| ------------------------------------ | ------------------------------------- | ------------------------------------------------- |
| `@openai/agents` SDK                 | Agent 创建、run/stream、tool、handoff | `agents/`, `runtime/`, `orchestration/`, `swarm/` |
| `outputType` (Zod Schema)            | Planner 结构化输出                    | `orchestration/Planner.ts`                        |
| `maxTurns`                           | 所有 `run()` 调用的循环保护           | 全部运行时                                        |
| `previousResponseId`                 | 多轮对话延续                          | `runtime/AgentRuntime.ts`                         |
| `modelSettings`                      | Agent 模型参数（temperature 等）      | `agents/presets.ts`, `AgentFactory.ts`            |
| `stream: true`                       | 原生流式 API（AsyncIterable）         | `runtime/AgentRuntime.ts`                         |
| `InputGuardrail` / `OutputGuardrail` | 输入/输出安全检查                     | `guardrails/`                                     |
| `Session` interface                  | 会话记忆适配                          | `memory/SessionAdapter.ts`                        |
| `Zod 4`                              | Schema 定义和验证                     | `tools/`, `orchestration/`                        |
| `SQLite`                             | 数据持久化                            | `storage/schemas/`                                |
| `EventBus`                           | 流式消息发布/订阅                     | `streaming/`                                      |
| `Vitest`                             | 单元测试（311 tests）                 | `**/__tests__/`                                   |

---

## 7. 测试覆盖

```
__tests__/helpers/          3 个共享 mock 辅助
agents/__tests__/           2 个测试文件 (AgentFactory, presets)
runtime/__tests__/          3 个测试文件 (AgentRuntime, TeamRuntime, RuntimeFactory)
memory/__tests__/           4 个测试文件 (Session, ShortTerm, Working, LongTerm)
orchestration/__tests__/    4 个测试文件 (Planner, WorkerCoord, PlanVersion, Verification)
swarm/__tests__/            5 个测试文件 (Concurrency, Handoff, MsgBus, Context, tools)
streaming/__tests__/        2 个测试文件 (Emitter, Monitor)
streaming/consumers/__tests__/ 2 个测试文件 (Store, WebSocket)
tools/__tests__/            2 个测试文件 (builtin, registry)
────────────────────────────────────────────────────
总计                        28 个测试文件 / 311 个测试用例 / 全部通过
```
