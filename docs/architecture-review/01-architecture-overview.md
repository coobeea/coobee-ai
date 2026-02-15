# coobee-ai AI 模块架构概览

> 生成时间：2026-02-14  
> 目的：为架构评审提供完整的现状描述

---

## 一、目录结构与模块职责

```
src/main/ai/
├── AgentExecutor.ts          # 执行调度层（入口、busy 锁、HITL 循环、Extension Hook）
├── AgentEnv.ts               # 运行时环境构建（buildAgentEnv, formatRuntimePaths）
│
├── runtime/                  # 统一运行时抽象
│   ├── AgentRuntime.ts       # 接口定义（stream, run, HITL, 会话管理）
│   ├── AbstractAgentRuntime.ts # 基类（id 生成、run 默认实现、stripThinkTags）
│   ├── ContextSnapshot.ts    # LLM 上下文快照（调试用）
│   ├── types.ts              # 核心类型（ExecutionResult, StreamChunk, SkillDefinition, ToolDefinition 引用）
│   ├── openai/               # @openai/agents SDK 实现
│   │   ├── OpenAIAgentRuntime.ts
│   │   ├── FileSession.ts    # JSONL 会话持久化
│   │   ├── SessionCompressor.ts # Token 压缩
│   │   ├── ThinkTagParser.ts
│   │   └── tokenCounter.ts
│   ├── pimono/               # pi-coding-agent SDK 实现
│   │   ├── PiMonoAgentRuntime.ts
│   │   ├── ChunkQueue.ts
│   │   └── types.ts
│   └── evaluation/           # [已删除] 硬编码评估器已移除，自我评估由 self-reflection Skill 完成
│
├── tools/                    # 工具系统
│   ├── types.ts              # ToolDefinition, ToolCategory, ToolResult, ToolExecutionContext
│   ├── registry.ts           # ToolRegistry（动态注册表）
│   ├── index.ts              # 统一导出
│   └── builtin/              # 10 个内置工具
│       ├── read.ts, write.ts, edit.ts       # 文件操作
│       ├── exec.ts, process.ts              # 命令执行 + 进程管理
│       ├── memory.ts                        # 记忆管理
│       ├── session_status.ts, session_history.ts, context_inspect.ts  # 可观测性
│       └── skill_list.ts                    # Skill 发现
│
├── process/                  # 后台进程管理
│   └── ProcessRegistry.ts    # 进程注册表（单例）
│
├── skills/                   # Skill 管理
│   ├── SkillManager.ts       # 扫描、注册、查询（文件驱动，SKILL.md）
│   └── index.ts
│
├── sandbox/                  # 沙箱安全
│   ├── types.ts              # SandboxContext, SandboxMode, ToolPolicy
│   ├── context.ts            # resolveSandboxContext()
│   ├── path-guard.ts         # 路径越界检查
│   ├── tool-policy.ts        # 工具策略解析
│   └── docker.ts             # Docker 沙箱（预留）
│
├── hitl/                     # HITL 审批
│   └── HitlApprovalManager.ts # 纯内存 Promise 等待模式
│
├── streaming/                # 流式输出
│   ├── types.ts              # StreamEvent, StreamEventType
│   ├── StreamEmitter.ts      # 生产者（发送到 EventBus）
│   ├── index.ts
│   └── consumers/            # 消费者
│       ├── StreamStore.ts    # SQLite 持久化
│       └── StreamMonitor.ts  # 统计监控
│
├── swarm/                    # 群体智能（Swarm）
│   ├── SwarmRuntime.ts       # AgentRuntime 实现
│   ├── SwarmCoordinator.ts   # 任务分解 + 协调
│   ├── AgentPool.ts          # Agent 池
│   ├── ConcurrencyManager.ts # 并发控制
│   ├── MessageBus.ts         # Agent 间通信
│   ├── HandoffRouter.ts      # 任务路由
│   ├── SwarmContext.ts       # 共享上下文
│   ├── SwarmMonitor.ts       # 监控
│   └── tools.ts              # Swarm 专用工具
│
├── teams/                    # 多 Agent 团队
│   └── TeamRuntime.ts        # 顺序/并行/Planner 三模式
│
├── orchestration/            # Orchestrator-Worker 编排
│   ├── Orchestrator.ts       # 核心编排器
│   ├── Planner.ts            # 计划 Agent
│   ├── WorkerCoordinator.ts  # Worker 池管理
│   ├── PlanVersionManager.ts # 计划版本管理
│   ├── VerificationGate.ts   # 验证门
│   └── verification-rules.ts # 验证规则
│
├── memory/                   # 记忆系统
│   ├── SessionMemoryStore.ts # 会话记忆（JSONL 持久化）
│   ├── ShortTermMemory.ts    # 短期记忆（上下文窗口）
│   ├── WorkingMemoryStore.ts # 工作记忆（任务状态）
│   ├── LongTermMemoryStore.ts# 长期记忆（SQLite）
│   ├── SessionAdapter.ts     # SDK Session 适配器
│   └── types.ts
│
└── storage/                  # 数据持久化
    └── AgentConfigStore.ts   # Agent 配置 CRUD（SQLite）
```

---

## 二、核心执行流程

```
用户消息
  ↓
Gateway (src/main/gateway/) — IPC 路由
  ↓
AgentExecutor.submit() / stream()
  ↓
  ├── busy 锁检查（同一 session 串行）
  ├── injectEnv() — 工作空间、Skill 扫描、路径注入
  ├── Extension Hook: message_received → session_start → before_agent_start
  ├── Builder.build() → 创建 AgentRuntime
  ├── runtime.stream() → AsyncGenerator<StreamChunk>
  │     ├── yield 到 StreamEmitter → EventBus → WebSocket → 前端
  │     └── 写入 events.jsonl
  ├── HITL 循环（while interrupted）
  │     ├── HitlApprovalManager.waitForDecisions() — Promise 阻塞
  │     ├── 前端 API 提交决策
  │     └── runtime.resumeStream()
  ├── Extension Hook: agent_end → session_end
  └── runtime.destroy()
```

---

## 三、AgentRuntime 接口层次

```
AgentRuntime (interface)
  ├── AbstractAgentRuntime (abstract class)
  │     ├── PiMonoAgentRuntime   — pi-coding-agent SDK
  │     ├── OpenAIAgentRuntime   — @openai/agents SDK
  │     ├── SwarmRuntime         — 群体智能
  │     └── TeamRuntime          — 多 Agent 团队
```

### 关键接口方法

| 方法                                 | 用途                        |
| ------------------------------------ | --------------------------- |
| stream(input)                        | 主方法，AsyncGenerator 流式 |
| run(input)                           | 便捷方法，等待完整结果      |
| initialize() / destroy()             | 生命周期                    |
| approveToolCall() / rejectToolCall() | HITL 审批                   |
| resumeStream()                       | HITL 恢复执行               |
| getSessionInfo() / clearSession()    | 会话管理                    |

---

## 四、工具系统

```
ToolDefinition (interface)
  ├── name, description
  ├── category: ToolCategory (enum)
  ├── needUserConfirm: boolean
  ├── parameters: Zod Schema
  └── execute: AsyncGenerator<ToolStreamUpdate, ToolResult>
```

### 内置工具（10 个）

| 工具            | 分类          | 确认 | 用途                  |
| --------------- | ------------- | ---- | --------------------- |
| read            | FileSystem    | 否   | 读文件                |
| write           | FileSystem    | 是   | 写文件                |
| edit            | FileSystem    | 是   | 编辑文件              |
| exec            | Execute       | 是   | 执行命令（前台/后台） |
| process         | Execute       | 否   | 管理后台进程          |
| memory          | Memory        | 否   | 持久化记忆            |
| session_status  | Observability | 否   | 会话状态              |
| session_history | Observability | 否   | 对话历史              |
| context_inspect | Observability | 否   | 上下文快照查看        |
| skill_list      | Discovery     | 否   | Skill 发现            |

### 工具安全

- **SandboxContext** — 路径守卫（限制在工作区内）
- **ToolPolicy** — 策略规则（允许/拒绝/需确认）
- **HITL** — 高风险工具需用户确认
- **Docker**（预留）— 容器化沙箱

---

## 五、Skill 系统

```
SKILL.md (文件驱动)
  ↓
SkillManager.scanSkills(searchPaths[])
  ↓
SkillDefinition { name, description, content, filePath }
  ↓
skill_list 工具按需发现 → read 工具读取 SKILL.md
```

### 扫描路径（优先级低→高）

1. `skills/`（内置）
2. `.home/skills/`（用户）
3. `{workspace}/skills/`（工作空间）
4. Extension 贡献的 Skill 目录

---

## 六、流式输出架构

```
Runtime.stream()
  → StreamChunk (yield)
    → AgentExecutor
      → StreamEmitter.forward()
        → EventBus
          → StreamStore (SQLite 持久化)
          → StreamMonitor (统计)
          → WebSocket Broadcaster → 前端
```

---

## 七、多 Agent 模式

| 模式                | 实现           | 状态                                                      |
| ------------------- | -------------- | --------------------------------------------------------- |
| Team                | TeamRuntime    | 基于 @openai/agents，支持顺序/并行/Planner                |
| Swarm               | SwarmRuntime   | 自研，有完整组件（Coordinator, Pool, MessageBus, Router） |
| Orchestrator-Worker | orchestration/ | 基于 @openai/agents，计划分解 + Worker 执行               |

---

## 八、依赖关系图

```
AgentExecutor
  ├── AgentEnv (buildAgentEnv, formatRuntimePaths)
  ├── SkillManager
  ├── HitlApprovalManager
  ├── StreamEmitter
  ├── Extension (dynamic import)
  └── Builder → AgentRuntime
        ├── PiMonoAgentRuntime → pi-coding-agent SDK
        │     └── tools (ToolDefinition → SDK format)
        └── OpenAIAgentRuntime → @openai/agents SDK
              ├── FileSession
              ├── SessionCompressor
              └── tools (ToolDefinition → SDK format)

ToolDefinition
  ├── sandbox/path-guard (路径检查)
  ├── sandbox/context (沙箱上下文)
  └── ProcessRegistry (exec/process 共用)

memory/ ← @openai/agents SDK (Session 接口)
storage/ ← SQLite

orchestration/ ← @openai/agents SDK (Agent, run)
teams/ ← @openai/agents SDK (Agent, run)
swarm/ ← AbstractAgentRuntime (自研)
```

---

## 九、SDK 依赖情况

| SDK               | 使用方                                          | 用途                                     |
| ----------------- | ----------------------------------------------- | ---------------------------------------- |
| `pi-coding-agent` | PiMonoAgentRuntime                              | 主力运行时（MiniMax 等 OpenAI 兼容模型） |
| `@openai/agents`  | OpenAIAgentRuntime, TeamRuntime, orchestration/ | OpenAI 原生模型 + 多 Agent 编排          |
| `zod`             | 所有工具                                        | 参数 Schema                              |
| `better-sqlite3`  | storage/, streaming/StreamStore                 | 持久化                                   |

---

## 十、README.md 中描述但实际缺失/过时的内容

| README 描述                             | 实际状态                                                     |
| --------------------------------------- | ------------------------------------------------------------ |
| `agents/` 目录（AgentFactory）          | **不存在** — 已由 AgentExecutor + Builder 取代               |
| `monitoring/` 目录（MonitoringService） | **不存在** — 未实现                                          |
| `gateway/` 目录                         | **不存在** — 网关在 src/main/gateway/                        |
| `index.ts` 主导出                       | **不存在** — 无统一导出                                      |
| `runtimeFactory`                        | **不存在** — 由 AgentExecutor.piMono()/openai() Builder 取代 |
| Skill 通过 `Skill` 接口注册             | **过时** — 已改为文件驱动 SKILL.md                           |
| 工具使用 `@openai/agents` 的 `tool()`   | **过时** — 已改为自研 ToolDefinition                         |
