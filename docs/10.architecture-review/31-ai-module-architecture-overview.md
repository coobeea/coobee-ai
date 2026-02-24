# 第三十一轮 — AI 模块架构总览

> 编号：31 | 日期：2026-02-20 | 类型：AI 模块架构分析
> 方法：代码走查 + 多智能体并行分析
> 覆盖范围：Backend AI 全栈（AgentExecutor、Runtime、Pipeline、HITL、Multi-Agent）

---

## 一、系统分层架构

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Frontend (Renderer)                              │
│  Vue 3 + Pinia + Router + Monaco + GatewayClient (WebSocket)           │
│  ├─ 视图：AgentView, ThreadView, SkillsView, SettingsView              │
│  ├─ 组件：Sidebar, ProjectPanel, WorkbenchPanel, ChatPanel             │
│  ├─ 状态：chat, copilot, threads, agents, worker, openFiles            │
│  └─ 通信：GatewayClient (RPC + 事件订阅)                                │
├────────────────────────────────────────────────────────────────────────┤
│                        Gateway (RPC + Events)                           │
│  ├─ GatewayServer: WebSocket + 心跳 (30s 默认)                          │
│  ├─ Gateway: 方法路由 + 事件分发                                        │
│  └─ Methods: chat, stream, hitl, threads, agents, skills, files        │
├────────────────────────────────────────────────────────────────────────┤
│                        AI 执行层                                        │
│  ├─ MessagePipeline: 队列 + 中断 + runId 竞态防护                       │
│  ├─ AgentExecutor: Builder + injectEnv + consumeAndForward              │
│  ├─ ToolExecutionPipeline: Hook 系统 + HITL 审批                        │
│  └─ CheckpointManager + ThreadWaker: 异步恢复                           │
├────────────────────────────────────────────────────────────────────────┤
│                        AI Runtime 层                                    │
│  ├─ PiMono Runtime (活跃) — 基于 @mariozechner/pi-coding-agent          │
│  ├─ OpenAI Runtime (休眠) — 基于 @openai/agents                         │
│  └─ AbstractAgentRuntime: 统一接口抽象                                  │
├────────────────────────────────────────────────────────────────────────┤
│                        Multi-Agent 系统                                 │
│  ├─ Delegate: delegate_to_agent 工具 (活跃)                             │
│  ├─ Orchestrator: Planner → Worker 程序化编排 (休眠)                    │
│  └─ Swarm: Triage → Handoff 循环 (休眠)                                 │
├────────────────────────────────────────────────────────────────────────┤
│                        基础设施层                                       │
│  ├─ Extension: Loader + Registry + HookRunner                           │
│  ├─ Config: ConfigStore + ConfigWatcher + Schema                        │
│  ├─ Provider: ModelSelector + ProviderRegistry + Fallback               │
│  ├─ Skills: SkillManager + SkillRegistry                                │
│  └─ Lifecycle: Hook 系统 (BEFORE_QUIT, APP_READY, ...)                  │
├────────────────────────────────────────────────────────────────────────┤
│                        Electron 主进程                                  │
│  ├─ IPC + Window Manager                                                │
│  ├─ Worker Manager                                                      │
│  └─ Database (SQLite + DuckDB)                                          │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 二、核心数据流

### 2.1 完整执行流程

```
用户输入 → ChatPanel/CopilotBubble
    │
    └─► chatStore.sendMessage() / copilotStore.sendMessage()
            │
            └─► gateway.request('chat.send', { message, mode, agentId })
                    │
                    └─► WebSocket RPC
                            │
                            └─► Backend: chat.send (Gateway Method)
                                    │
                                    ├─ mode 分发
                                    │   ├─ agent → agentExecutor.submitViaPipeline
                                    │   ├─ orchestrator → OrchestratorRuntime
                                    │   └─ swarm → SwarmRuntime
                                    │
                                    └─► MessagePipeline.submit
                                            │
                                            ├─ SessionQueue 排队
                                            ├─ runId 竞态防护
                                            │
                                            └─► AgentExecutor.execute
                                                    │
                                                    ├─ injectEnv (workspace/skills/tools)
                                                    ├─ session_start / before_agent_start Hooks
                                                    ├─ runtime = builder.build()
                                                    │
                                                    └─► runtime.stream(message)
                                                            │
                                                            └─► LLM API
                                                                    │
                                                                    └─► StreamChunk
                                                                            │
                                                                            ├─ AgentEventWriter → events.jsonl
                                                                            ├─ CheckpointManager.update
                                                                            ├─ fireChunkHooks
                                                                            │
                                                                            └─► StreamEmitter → EventBus
                                                                                    │
                                                                                    └─► StreamBridge → Gateway
                                                                                            │
                                                                                            └─► WebSocket → Frontend
                                                                                                    │
                                                                                                    └─ useStreamWs → chatStore
                                                                                                            └─ handleStreamMessage
                                                                                                                    └─ UI 渲染
```

### 2.2 关键节点说明

| 节点             | 文件位置                         | 职责                               |
| ---------------- | -------------------------------- | ---------------------------------- |
| chat.send        | `gateway/methods/chat.ts:198`    | Gateway 入口，mode 分发            |
| MessagePipeline  | `ai/pipeline/MessagePipeline.ts` | 队列、中断、runId 竞态防护         |
| AgentExecutor    | `ai/AgentExecutor.ts`            | Builder 工厂、执行调度、生命周期   |
| injectEnv        | `ai/AgentEnvInjector.ts`         | 环境注入（workspace/skills/tools） |
| runtime.stream   | `ai/runtime/*/`                  | LLM API 调用、流式输出             |
| AgentEventWriter | `ai/AgentEventWriter.ts`         | 事件持久化 + 前端推送              |
| StreamEmitter    | `ai/streaming/StreamEmitter.ts`  | EventBus 广播                      |
| StreamBridge     | `gateway/StreamBridge.ts`        | EventBus → WebSocket               |

---

## 三、AgentExecutor 执行流程

### 3.1 核心职责

AgentExecutor 是所有 Agent 执行的统一入口，位于 API 层和 Runtime 层之间：

1. **并发控制** — 同一 session 串行执行（busySessions 锁）
2. **无状态生命周期** — 每次请求创建 Runtime → 执行 → 销毁
3. **Builder 工厂** — `piMono()` / `openai()` 创建 Builder

### 3.2 执行流程图

```
AgentExecutor.execute(request)
    │
    ├─ 1. 检查 busySessions（并发控制）
    │
    ├─ 2. injectEnv(sessionId, builder)
    │      ├─ 创建 workspace 目录
    │      ├─ 注入执行协议
    │      ├─ 发现并注入 Skills
    │      └─ 配置 Sandbox
    │
    ├─ 3. Extension Hooks
    │      ├─ message_received
    │      ├─ session_start
    │      └─ before_agent_start
    │
    ├─ 4. runtime = builder.sessionId(sessionId).build()
    │
    ├─ 5. consumeAndForward(runtime.stream(message))
    │      ├─ 检测 abort signal
    │      ├─ eventWriter.dispatch(chunk)
    │      ├─ updateCheckpoint(chunk)
    │      └─ fireChunkHooks(chunk)
    │
    ├─ 6. Extension Hooks
    │      ├─ agent_end
    │      └─ session_end
    │
    └─ 7. finally: destroyRuntime(runtime)
```

### 3.3 关键方法

| 方法                  | 行号 | 职责                                                     |
| --------------------- | ---- | -------------------------------------------------------- |
| `piMono()`            | 268  | 创建 PiMono Builder（自动注入 Provider + thinkingLevel） |
| `openai()`            | 276  | 创建 OpenAI Builder                                      |
| `submit()`            | 288  | 非阻塞提交（立即返回）                                   |
| `submitViaPipeline()` | 239  | 通过 MessagePipeline 提交（推荐）                        |
| `execute()`           | 749  | 核心执行流程                                             |
| `consumeAndForward()` | 454  | 消费 AsyncGenerator + 事件分发                           |
| `updateCheckpoint()`  | 531  | 检查点状态更新                                           |
| `fireChunkHooks()`    | 662  | Extension Hook 触发                                      |

---

## 四、Runtime 层设计

### 4.1 抽象接口

```typescript
// ai/runtime/AgentRuntime.ts
interface AgentRuntime {
  readonly type: string; // 'pimono' | 'openai'
  readonly id: string; // 唯一标识
  readonly name: string; // 显示名称

  stream(message: string, opts?: StreamOptions): AsyncGenerator<StreamChunk>;
  destroy(): Promise<void>;
}
```

### 4.2 PiMono Runtime

**文件**: `ai/runtime/pimono/`

**特点**:

- 基于 `@mariozechner/pi-coding-agent` SDK
- 文件会话模式（JSONL 持久化）
- 内置上下文压缩
- 支持 thinking level 配置

**核心组件**:
| 组件 | 文件 | 职责 |
|------|------|------|
| PiMonoBuilder | `PiMonoBuilder.ts` | Builder 模式构建 Runtime |
| PiMonoAgentRuntime | `PiMonoAgentRuntime.ts` | Runtime 实现 |
| PiMonoStreamAdapter | `PiMonoStreamAdapter.ts` | SDK 事件 → StreamChunk 转换 |

### 4.3 OpenAI Runtime

**文件**: `ai/runtime/openai/`

**特点**:

- 基于 `@openai/agents` SDK
- 支持 Swarm 模式
- 手动上下文压缩
- 支持 handoff 机制

**核心组件**:
| 组件 | 文件 | 职责 |
|------|------|------|
| OpenAIBuilder | `OpenAIBuilder.ts` | Builder 模式构建 Runtime |
| OpenAIAgentRuntime | `OpenAIAgentRuntime.ts` | Runtime 实现 |

### 4.4 Runtime 对比

| 特性           | PiMono                        | OpenAI         |
| -------------- | ----------------------------- | -------------- |
| SDK            | @mariozechner/pi-coding-agent | @openai/agents |
| 会话模式       | 文件（JSONL）                 | 内存           |
| 上下文压缩     | SDK 内置                      | 手动实现       |
| Thinking Level | 支持                          | 不支持         |
| Handoff        | 不支持                        | 支持           |
| 产品状态       | **活跃**                      | 休眠           |

---

## 五、工具执行管道

### 5.1 ToolExecutionPipeline

**文件**: `ai/runtime/shared/ToolExecutionPipeline.ts`

**职责**: 将 OpenAI 和 PiMono 两个 Runtime 中重复的工具执行流程提取到此模块。

### 5.2 执行阶段

```
executeToolPipeline(def, params, opts)
    │
    ├─ Phase 1: 审批判断（仅 exec 工具）
    │      ├─ checkExecPolicy(command)
    │      │   ├─ deny → 返回 blocked
    │      │   ├─ allow → 继续执行
    │      │   └─ ask → requestUserApproval()
    │      │
    │      └─ requestUserApproval()
    │           ├─ 发送 hitl:required 事件
    │           ├─ 启动后台任务（fire-and-forget）
    │           └─ 返回 suspended
    │
    ├─ Phase 1.5: before_tool_call Hook
    │      ├─ Extension 可 block 或修改参数
    │      └─ 返回 hookResult
    │
    ├─ Phase 2: Sandbox toolPolicy 检查
    │      └─ isToolAllowed(def.name, toolPolicy)
    │
    ├─ Phase 3: 执行工具
    │      ├─ gen = def.execute(params, signal, context)
    │      ├─ 消费 AsyncGenerator 增量输出
    │      └─ 获取最终 toolResult
    │
    └─ Phase 4: after_tool_call + tool_result_persist Hooks
           └─ 可修改 resultText
```

### 5.3 工具注册

**内置工具**: `ai/tools/builtin/`

| 工具              | 文件                   | 职责         |
| ----------------- | ---------------------- | ------------ |
| read              | `read.ts`              | 读取文件     |
| write             | `write.ts`             | 写入文件     |
| edit              | `edit.ts`              | 编辑文件     |
| exec              | `exec.ts`              | 执行命令     |
| glob              | `glob.ts`              | 文件搜索     |
| grep              | `grep.ts`              | 内容搜索     |
| process           | `process.ts`           | 进程管理     |
| delegate_to_agent | `delegate-to-agent.ts` | 委托子 Agent |
| task_plan         | `task-plan.ts`         | 任务计划管理 |
| manage_agent      | `manage-agent.ts`      | Agent CRUD   |

**Extension 工具**: 通过 `ToolRegistry` 注册

---

## 六、HITL 审批流程

### 6.1 双模式设计

| 模式         | 触发条件               | 实现方式                 |
| ------------ | ---------------------- | ------------------------ |
| **同步模式** | `needUserConfirm=true` | Promise 阻塞等待         |
| **异步模式** | `ExecPolicy.ask`       | 挂起 → Checkpoint → 唤醒 |

### 6.2 异步审批流程图

```
LLM 调用工具 (e.g. exec)
    │
    └─► ToolExecutionPipeline.executeToolPipeline
            │
            └─► Phase 1: ExecPolicy.check()
                    │
                    └─► action === 'ask'
                            │
                            └─► requestUserApproval()
                                    │
                                    ├─ 1. 发送 hitl:required 事件
                                    │      └─► AgentEventWriter.dispatchForSession
                                    │              └─► 前端显示审批卡片
                                    │
                                    ├─ 2. 启动后台任务（fire-and-forget）
                                    │      └─► hitlApprovalManager.waitForSingleDecision
                                    │              └─── 等待用户审批 ───
                                    │
                                    └─ 3. 返回 suspended
                                            │
                                            └─► AgentExecutor.updateCheckpoint
                                                    │
                                                    ├─ runStatus = 'approval-pending'
                                                    ├─ pendingOperation = { approvalId, toolName }
                                                    └─► CheckpointManager.save()

                                    ─── 用户点击 "允许" 或 "拒绝" ───

                                    │
                                    └─► gateway.request('hitl.decide', { approvalId, decision })
                                            │
                                            └─► hitlApprovalManager.submitSingleDecision
                                                    │
                                                    └─► 后台任务被唤醒
                                                            │
                                                            ├─ approve → executeToolCore()
                                                            │      └─► 发送 hitl:approved
                                                            │
                                                            └─ reject → 发送 hitl:rejected
                                                                    │
                                                                    └─► eventBus.emit('thread:wake')
                                                                            │
                                                                            └─► ThreadWaker.handleWake
                                                                                    │
                                                                                    └─► submitViaPipeline(resumeMessage)
```

### 6.3 关键组件

| 组件                | 文件                              | 职责                    |
| ------------------- | --------------------------------- | ----------------------- |
| HitlApprovalManager | `ai/hitl/HitlApprovalManager.ts`  | Promise 等待 + 决策提交 |
| CheckpointManager   | `ai/threads/CheckpointManager.ts` | 检查点持久化            |
| ThreadWaker         | `ai/threads/ThreadWaker.ts`       | 监听唤醒事件 + 恢复执行 |
| approval.ts         | `gateway/methods/approval.ts`     | 前端审批 API            |

---

## 七、Multi-Agent 系统

### 7.1 三种模式对比

| 维度         | Delegate               | Orchestrator                 | Swarm                        |
| ------------ | ---------------------- | ---------------------------- | ---------------------------- |
| **控制权**   | 主 Agent（LLM）        | 程序（代码）                 | Agent 间自主                 |
| **决策者**   | 主 Agent 自行决定      | Planner（LLM）→ 程序执行     | 各 Agent 自主判断            |
| **控制流**   | 不确定                 | 确定（ExecutionPlan）        | 动态（Handoff 链）           |
| **信息共享** | 文件（`experiences/`） | SubTask 依赖                 | SwarmContext + MessageBus    |
| **产品接入** | **活跃**               | 休眠（API 支持，前端无入口） | 休眠（API 支持，前端无入口） |

### 7.2 Delegate 模式

**工具**: `delegate_to_agent`

**流程**:

```
主 Agent 调用 delegate_to_agent(agentId, task)
    │
    └─► 创建子 Agent Builder
            │
            ├─ sessionId = `{threadId}:delegate:{agentId}`
            ├─ workspace = `{workspace}/tasks/{taskId}/agents/{agentId}/`
            └─ 过滤工具（禁用 delegate_to_agent、manage_agent、task_plan）
                    │
                    └─► 子 Agent 执行
                            │
                            └─► 结果写入 `experiences/` 目录
                                    │
                                    └─► 主 Agent 读取结果
```

### 7.3 Orchestrator 模式

**文件**: `ai/orchestration/`

**流程**:

```
OrchestratorRuntime.stream(message)
    │
    ├─ 1. Planner.plan(message)
    │      └─► LLM 生成 ExecutionPlan
    │              ├─ stages: Stage[]
    │              └─ subtasks: SubTask[]
    │
    ├─ 2. WorkerCoordinator.execute(plan)
    │      └─► 按 Stage 顺序执行
    │              ├─ 同 Stage 内并行
    │              └─ 跨 Stage 串行
    │
    └─ 3. Aggregator.aggregate(results)
           └─► 汇总子任务结果
```

**核心组件**:
| 组件 | 文件 | 职责 |
|------|------|------|
| OrchestratorRuntime | `OrchestratorRuntime.ts` | 编排入口 |
| Planner | `Planner.ts` | LLM 生成执行计划 |
| WorkerCoordinator | `WorkerCoordinator.ts` | 子任务调度 |
| Aggregator | `Aggregator.ts` | 结果汇总 |

### 7.4 Swarm 模式

**文件**: `ai/swarm/`

**流程**:

```
SwarmRuntime.stream(message)
    │
    ├─ 1. Triage Agent 分析任务
    │      └─► 决定直接回答 or handoff
    │
    ├─ 2. Handoff 链
    │      └─► Agent A → Agent B → Agent C
    │              └─► 每个 Agent 可决定继续 handoff 或返回
    │
    └─ 3. 最终 Agent 返回结果
```

**核心组件**:
| 组件 | 文件 | 职责 |
|------|------|------|
| SwarmRuntime | `SwarmRuntime.ts` | Swarm 入口 |
| SwarmCoordinator | `SwarmCoordinator.ts` | Handoff 协调 |
| AgentPool | `AgentPool.ts` | Agent 池管理 |
| HandoffRouter | `HandoffRouter.ts` | Handoff 路由 |

### 7.5 SessionId 命名体系

| 类型         | 格式                            | 示例                                        |
| ------------ | ------------------------------- | ------------------------------------------- |
| 主 Thread    | `{threadId}`                    | `300000000000000001`                        |
| Delegate     | `{threadId}:delegate:{agentId}` | `300000000000000001:delegate:code-reviewer` |
| Worker       | `{threadId}:worker:{subtaskId}` | `300000000000000001:worker:subtask-1`       |
| Planner      | `{threadId}:planner`            | `300000000000000001:planner`                |
| Swarm Role   | `{threadId}:swarm:{roleId}`     | `300000000000000001:swarm:researcher`       |
| Swarm Triage | `{threadId}:triage`             | `300000000000000001:triage`                 |

---

## 八、关键代码路径索引

### 8.1 AI 执行层

| 关注点       | 文件路径                                              |
| ------------ | ----------------------------------------------------- |
| Agent 执行器 | `src/main/ai/AgentExecutor.ts`                        |
| 消息管道     | `src/main/ai/pipeline/MessagePipeline.ts`             |
| 工具执行管道 | `src/main/ai/runtime/shared/ToolExecutionPipeline.ts` |
| 环境注入     | `src/main/ai/AgentEnvInjector.ts`                     |
| 事件写入     | `src/main/ai/AgentEventWriter.ts`                     |
| 流式发射     | `src/main/ai/streaming/StreamEmitter.ts`              |

### 8.2 Runtime 层

| 关注点         | 文件路径                                           |
| -------------- | -------------------------------------------------- |
| Runtime 接口   | `src/main/ai/runtime/AgentRuntime.ts`              |
| PiMono Builder | `src/main/ai/runtime/pimono/PiMonoBuilder.ts`      |
| PiMono Runtime | `src/main/ai/runtime/pimono/PiMonoAgentRuntime.ts` |
| OpenAI Builder | `src/main/ai/runtime/openai/OpenAIBuilder.ts`      |
| OpenAI Runtime | `src/main/ai/runtime/openai/OpenAIAgentRuntime.ts` |

### 8.3 HITL 系统

| 关注点      | 文件路径                                   |
| ----------- | ------------------------------------------ |
| 审批管理器  | `src/main/ai/hitl/HitlApprovalManager.ts`  |
| 检查点管理  | `src/main/ai/threads/CheckpointManager.ts` |
| Thread 唤醒 | `src/main/ai/threads/ThreadWaker.ts`       |
| 审批 API    | `src/main/gateway/methods/approval.ts`     |

### 8.4 Multi-Agent 系统

| 关注点       | 文件路径                                         |
| ------------ | ------------------------------------------------ |
| 委托工具     | `src/main/ai/tools/builtin/delegate-to-agent.ts` |
| 编排器       | `src/main/ai/orchestration/Orchestrator.ts`      |
| 计划器       | `src/main/ai/orchestration/Planner.ts`           |
| Worker 协调  | `src/main/ai/orchestration/WorkerCoordinator.ts` |
| Swarm 协调器 | `src/main/ai/swarm/SwarmCoordinator.ts`          |
| Agent 池     | `src/main/ai/swarm/AgentPool.ts`                 |

### 8.5 Gateway

| 关注点           | 文件路径                             |
| ---------------- | ------------------------------------ |
| Gateway 核心     | `src/main/gateway/Gateway.ts`        |
| WebSocket 服务器 | `src/main/gateway/GatewayServer.ts`  |
| chat 方法        | `src/main/gateway/methods/chat.ts`   |
| stream 方法      | `src/main/gateway/methods/stream.ts` |

---

## 九、架构优势

1. **统一的 AgentRuntime 接口** — PiMono/OpenAI 共享抽象，切换成本低
2. **ToolExecutionPipeline** — 集中管理 Hook、策略、审批，单一职责清晰
3. **StreamChunk 事件模型** — 30+ 事件类型，足够表达所有运行时行为
4. **MessagePipeline** — runId 机制修复竞态，支持队列、中断、合并
5. **HITL 双模式** — 同步（Promise 阻塞）+ 异步（Checkpoint 恢复）
6. **Sandbox 多层防护** — path-guard + tool-policy + exec-policy
7. **Extension Hook 系统** — 完整的生命周期钩子，支持插件化扩展
8. **文件系统即共享状态** — 多 Agent 协作通过目录约定，简单透明

---

## 十、活跃度评估

| 模块/组件          | 状态     | 说明                                             |
| ------------------ | -------- | ------------------------------------------------ |
| PiMono Runtime     | **活跃** | 唯一正在使用的 Runtime                           |
| OpenAI Runtime     | 休眠     | 实现完整、测试通过，但无产品入口                 |
| Delegate           | **活跃** | 工具已接入，有集成测试                           |
| Orchestrator       | 休眠     | `chat.send` 支持 `mode=orchestrator`，前端无入口 |
| Swarm              | 休眠     | `chat.send` 支持 `mode=swarm`，前端无入口        |
| MessagePipeline    | **活跃** | T-1/T-2/T-3 竞态已修复                           |
| HITL 异步模式      | **活跃** | 审批流程完整                                     |
| Teams Runtime      | 死代码   | 标注 `@deprecated`，无产品入口                   |
| PlanVersionManager | 死代码   | 实现完整，Orchestrator 未调用                    |
| Memory 高级存储    | 设计储备 | 标注 `@experimental`，未集成                     |
