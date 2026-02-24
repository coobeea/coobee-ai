# 第二十九轮 — 多维度全面架构分析

> 编号：29 | 日期：2026-02-19 | 类型：多维度全面审查  
> 方法：并行子任务探索 + 测试回归 + 代码走查  
> 覆盖范围：Frontend 全栈 + Backend AI 执行层 + Multi-Agent 系统 + 测试体系 + 心跳机制  
> 测试状态：**84 个测试文件、1359 个用例全部通过**

---

## 执行摘要

本轮分析在第 28 轮基础上，从 4 个并行维度深入分析系统现状：

1. **Frontend 架构**：组件层次、状态管理、Gateway 客户端、Composables 复用
2. **Backend AI 执行层**：AgentExecutor、MessagePipeline、ToolExecutionPipeline、HITL 系统
3. **Multi-Agent 系统**：Delegate、Swarm、Orchestrator 三种模式对比与活跃度评估
4. **测试体系**：覆盖度热力图、高风险未测路径、测试质量评分

**关键发现**：

- **11 个 P0 级问题**（阻塞/严重）
- **16 个 P1 级问题**（重要）
- **8 个 P2 级问题**（次要）

**本轮已修复**：

- ✅ Vue 3 reactivity bug（useOpenFiles 首次点击不显示内容）
- ✅ HITL 审批流历史回放问题（hitl:approved/rejected 事件缺失）
- ✅ 蜂群 Agent 命名错误（'群组' → '蜂群'）
- ✅ 新增测试：approval-async-event、SwarmCoordinator、Orchestrator、GatewayServer.heartbeat
- ✅ 测试全部通过（84 文件、1359 用例、0 失败）

---

## 一、架构全景更新

### 1.1 系统分层（最新版）

```
┌────────────────────────────────────────────────────────────────────┐
│                     Frontend (Renderer)                             │
│  Vue 3 + Pinia + Router + Monaco + GatewayClient (WebSocket)       │
│  ├─ 视图：AgentView, ThreadView, SkillsView, SettingsView          │
│  ├─ 组件：Sidebar, ProjectPanel, WorkbenchPanel, ChatPanel         │
│  ├─ 状态：chat, copilot, threads, agents, worker, openFiles        │
│  └─ 通信：GatewayClient (RPC + 事件订阅)                             │
├────────────────────────────────────────────────────────────────────┤
│                     Gateway (RPC + Events)                          │
│  ├─ GatewayServer: WebSocket + 心跳 (30s 默认)                      │
│  ├─ Gateway: 方法路由 + 事件分发                                     │
│  └─ Methods: chat, stream, hitl, threads, agents, skills, files    │
├────────────────────────────────────────────────────────────────────┤
│                     AI 执行层                                        │
│  ├─ MessagePipeline: 队列 + 中断 + runId 竞态防护                   │
│  ├─ AgentExecutor: Builder + injectEnv + consumeAndForward          │
│  ├─ ToolExecutionPipeline: Hook 系统 + HITL 审批                    │
│  └─ CheckpointManager + ThreadWaker: 异步恢复                       │
├────────────────────────────────────────────────────────────────────┤
│                     AI Runtime 层                                   │
│  ├─ PiMono (活跃)                                                   │
│  ├─ OpenAI (休眠)                                                   │
│  └─ Delegate / Orchestrator / Swarm (部分活跃)                      │
├────────────────────────────────────────────────────────────────────┤
│                     Multi-Agent 系统                                │
│  ├─ Delegate: delegate_to_agent 工具 (活跃)                        │
│  ├─ Orchestrator: Planner → Worker 程序化编排 (休眠)                │
│  └─ Swarm: Triage → Handoff 循环 (休眠)                             │
├────────────────────────────────────────────────────────────────────┤
│                     基础设施层                                       │
│  ├─ Extension: Loader + Registry + HookRunner                       │
│  ├─ Config: ConfigStore + ConfigWatcher + Schema                    │
│  ├─ Provider: ModelSelector + ProviderRegistry + Fallback           │
│  ├─ Skills: SkillManager + SkillRegistry                            │
│  └─ Lifecycle: Hook 系统 (BEFORE_QUIT, APP_READY, ...)              │
├────────────────────────────────────────────────────────────────────┤
│                     Electron 主进程                                 │
│  ├─ IPC + Window Manager                                            │
│  ├─ Worker Manager                                                  │
│  └─ Database (SQLite)                                               │
└────────────────────────────────────────────────────────────────────┘
```

### 1.2 核心数据流（完整版）

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
                                                                            ├─ CheckpointManager.update (tool:start/done, [SUSPENDED])
                                                                            ├─ fireChunkHooks (after_chunk, before_stream_write)
                                                                            │
                                                                            └─► StreamEmitter → EventBus
                                                                                    │
                                                                                    └─► StreamBridge → Gateway
                                                                                            │
                                                                                            └─► WebSocket → Frontend
                                                                                                    │
                                                                                                    ├─ useStreamWs → chatStore
                                                                                                    │       └─ handleStreamMessage
                                                                                                    │               └─ UI 渲染
                                                                                                    │
                                                                                                    └─ copilotStore 独立订阅
```

### 1.3 HITL 审批流（异步完整版）

```
LLM 调用工具 (e.g. exec)
    │
    └─► ToolExecutionPipeline.executeToolPipeline
            │
            └─► before_tool_call Hook
                    │
                    └─► tool-approval Extension
                            │
                            ├─ ExecPolicy.check() → allow/deny/ask
                            │
                            └─ needUserConfirm=true + asyncMode
                                    │
                                    ├─ sessionCounters.set(sessionId, 0++)
                                    ├─ eventWriter.dispatch({ type: 'hitl:required', data: {index, toolName} })
                                    │
                                    └─ return { suspend: true, suspendReason: 'tool execution requires approval' }
                                            │
                                            └─► AgentExecutor 收到 [SUSPENDED]
                                                    │
                                                    ├─ eventWriter.dispatch({ type: '[SUSPENDED]', content: reason })
                                                    │
                                                    └─► updateCheckpoint
                                                            │
                                                            ├─ runStatus = 'approval-pending'
                                                            ├─ pendingOperation = { type: 'approval', approvalId, toolName, ... }
                                                            │
                                                            └─► CheckpointManager.save()
                                                                    │
                                                                    └─── 等待用户审批 ───
                                                                            │
                                                            (用户点击 "允许" 或 "拒绝")
                                                                            │
                                                                            ├─► gateway.request('hitl.decide', {sessionId, index, decision})
                                                                            │
                                                                            └─► Backend: approval.ts
                                                                                    │
                                                                                    ├─ hitlApprovalManager.hasSinglePending? → sync mode resolve
                                                                                    │
                                                                                    └─ CheckpointManager.load(threadId)
                                                                                            │
                                                                                            └─ runStatus === 'approval-pending'
                                                                                                    │
                                                                                                    ├─ **AgentEventWriter.dispatchForSession** ← 🆕
                                                                                                    │   └─► hitl:approved / hitl:rejected → events.jsonl + 推送前端
                                                                                                    │
                                                                                                    └─ eventBus.emit('thread:wake', {reason: 'approval-done', ...})
                                                                                                            │
                                                                                                            └─► ThreadWaker.handleWake
                                                                                                                    │
                                                                                                                    ├─ handleApprovalResume
                                                                                                                    │   ├─ reject → 发送拒绝消息
                                                                                                                    │   └─ approve → executeApprovedTool
                                                                                                                    │
                                                                                                                    └─► agentExecutor.submit() ⚠️ 注意：绕过 pipeline
                                                                                                                            │
                                                                                                                            └─► 继续执行
```

**本轮修复点**：

- ✅ `approval.ts` 异步路径增加 `AgentEventWriter.dispatchForSession`（第 28 轮遗留）
- ✅ `chat.ts` 的 `loadHistory` 增加 `hitl:approved` / `hitl:rejected` 事件处理
- ✅ 测试覆盖：`approval-async-event.test.ts`（6 个用例）

---

## 二、问题分级汇总（P0/P1/P2）

### 2.1 P0 — 阻塞/严重（必须修复）

#### Frontend

| ID         | 问题                             | 位置                             | 影响                                                                                                                 |
| ---------- | -------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **F-P0-1** | **Copilot onConnect 监听器泄漏** | `stores/copilot.ts:63-68`        | 每次 `sendMessage` 可能调用 `initStreamListener`，`gateway.onConnect()` 返回的取消函数未保存，重连时累积重复 handler |
| **F-P0-2** | **streamCleanup 从未调用**       | `composables/useStreamWs.ts:171` | 应用销毁时 `unregisterMessage/Batch/Connect` 不会清理，EventBus 监听器和 Gateway 回调泄漏                            |
| **F-P0-3** | **GatewayClient 完全无测试**     | `src/renderer/`                  | WebSocket 连接、重连、RPC、事件订阅等核心逻辑无测试，第 26/28 轮 P0-3 指出的 `stream.resend` 未补发历史消息无法验证  |

#### Backend AI 执行层

| ID         | 问题                                                      | 位置                        | 影响                                                                                      |
| ---------- | --------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| **B-P0-1** | **ThreadWaker 恢复使用 submit 而非 submitViaPipeline**    | `ThreadWaker.ts:234`        | 审批后恢复时绕过 pipeline，可能与 pipeline 的排队/中断状态冲突，且无法享受 runId 竞态防护 |
| **B-P0-2** | **OpenAI Runtime 未将 signal 传入 ToolExecutionPipeline** | `OpenAIAgentRuntime.ts:631` | `executeToolPipeline` 未传 `signal`，工具执行期间无法响应 abort                           |
| **B-P0-3** | **consumeAndForward 仅在 chunk 间检查 abort**             | `AgentExecutor.ts:348`      | `gen.next()` 阻塞时（如工具执行）无法及时 abort，用户点击停止无响应                       |

#### Multi-Agent 系统

| ID         | 问题                               | 位置                                     | 影响                                                                                  |
| ---------- | ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| **M-P0-1** | **前端无 Orchestrator/Swarm 入口** | `chat.ts:51-76`, `AgentView.vue`         | `chat.send` 未传 `mode`，始终为 `agent`，用户无法通过 UI 使用 Orchestrator/Swarm 模式 |
| **M-P0-2** | **子 Agent 审批无法在 UI 中处理**  | `delegate-to-agent.ts`, `useStreamWs.ts` | 子 Agent 审批事件按子 sessionId 分发，前端只订阅主 thread，子 Agent 审批会阻塞        |

#### 测试体系

| ID         | 问题                               | 位置                        | 影响                                                                      |
| ---------- | ---------------------------------- | --------------------------- | ------------------------------------------------------------------------- |
| **T-P0-1** | **tool-approval Extension 无测试** | `extensions/tool-approval/` | HITL 核心逻辑所在，多处架构文档要求在此覆盖，但完全无测试                 |
| **T-P0-2** | **renderer 无测试**                | `src/renderer/`             | Vitest 未包含 `src/renderer`，前端组件、Composables、GatewayClient 无测试 |

### 2.2 P1 — 重要（影响质量或未来扩展）

#### Frontend

| ID         | 问题                               | 位置                            | 影响                                                                                                        |
| ---------- | ---------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **F-P1-1** | **Thread 无 workspacePath 时卡住** | `ThreadView.vue:40-47`          | `enterWorkspaceForThread` 中 `thread.workspacePath` 为空时，`workspaceReady` 恒为 false，用户无法进入工作区 |
| **F-P1-2** | **cleanupThreadWs 从未调用**       | `composables/useThreadWs.ts:70` | 应用销毁时 thread 事件监听器不会清理                                                                        |
| **F-P1-3** | **Store 状态直接外部修改**         | `ThreadView.vue:72,86`          | `copilotStore.bubbleHidden = true/false` 直接改 store，未通过 action，不利于调试和维护                      |
| **F-P1-4** | **useThreadWs 直接改 store**       | `useThreadWs.ts:40,49`          | 直接操作 `store.threads`，应通过 store actions 封装                                                         |

#### Backend AI 执行层

| ID         | 问题                                        | 位置                               | 影响                                                               |
| ---------- | ------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| **B-P1-1** | **MessagePipeline.queues 无 TTL**           | `MessagePipeline.ts`               | 长期无活动的 session 可能长期占用 Map                              |
| **B-P1-2** | **sessionCounters 永不清理**                | `tool-approval/index.ts:28`        | 仅 `session_end` 时 `resetSessionCounter`，异常路径可能泄漏        |
| **B-P1-3** | **ToolExecutionPipeline 未校验 toolResult** | `ToolExecutionPipeline.ts:144-146` | `iterResult.value` 直接使用，若工具返回非法结构可能抛错            |
| **B-P1-4** | **HitlApprovalManager 批量 API 未移除**     | `HitlApprovalManager.ts:60-140`    | `waitForDecisions` / `submitDecision` 已废弃，仍保留，增加维护成本 |

#### Multi-Agent 系统

| ID         | 问题                                 | 位置                    | 影响                                                                        |
| ---------- | ------------------------------------ | ----------------------- | --------------------------------------------------------------------------- |
| **M-P1-1** | **PlanVersionManager 未集成**        | `Orchestrator.ts`       | Orchestrator 未调用 PlanVersionManager，无法做计划版本、回溯、replan 持久化 |
| **M-P1-2** | **Thread 创建 API 不支持 agentType** | `POST /gateway/threads` | 无法在创建 Thread 时指定 orchestrator/swarm 类型                            |

#### 测试体系

| ID         | 问题                               | 位置                                                    | 影响                                                   |
| ---------- | ---------------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| **T-P1-1** | **consumeGenerator 重复实现 6 次** | `__tests__/`                                            | 至少 6 个文件各自实现，未抽取公共工具                  |
| **T-P1-2** | **mock helpers 未被使用**          | `mock-database.ts`, `mock-agent.ts`, `mock-eventbus.ts` | 存在但无引用，测试用内联 mock，不统一                  |
| **T-P1-3** | **pre-commit 不跑测试**            | `scripts/pre-commit.mjs`                                | 仅执行 lint-staged + typecheck，无法保证提交前基本回归 |
| **T-P1-4** | **无 CI 流水线**                   | `.github/workflows`                                     | 无 GitHub Actions，PR 时无法自动跑测试                 |

### 2.3 P2 — 次要（可优化）

#### Frontend

| ID         | 问题                          | 位置                  | 说明                                                                           |
| ---------- | ----------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| **F-P2-1** | **ChatPanel 流式 watch 性能** | `ChatPanel.vue:56-66` | watch 依赖 `last.content.length + blockCount * 1000 + lastLen`，流式时频繁触发 |
| **F-P2-2** | **preference watch 深度监听** | `preference.ts:84-88` | `watch(() => preferences, ..., { deep: true })` 对 `Map` 的深度监听可能不可靠  |
| **F-P2-3** | **Gateway 错误 UI 覆盖不足**  | 全局                  | 仅 ChatPanel 展示 `gateway.lastError`，其它页面未展示连接状态                  |
| **F-P2-4** | **useOpenFiles 非 Pinia**     | `useOpenFiles.ts`     | 与其它状态管理方式不一致，不利于 DevTools 和持久化                             |

#### Backend AI 执行层

| ID         | 问题                                  | 位置                                        | 说明                                               |
| ---------- | ------------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| **B-P2-1** | **log.error 传字符串而非 error 对象** | `AgentExecutor.ts`                          | 无法输出 stack trace                               |
| **B-P2-2** | **Extension hook 失败静默**           | `ToolExecutionPipeline.ts:108-110, 170-172` | `catch` 空块，难以排查                             |
| **B-P2-3** | **drainQueue 期间未检查 abort**       | `MessagePipeline.ts:217-231`                | `drainExecutor` 内部长时间阻塞时可能无法及时 abort |

#### Multi-Agent 系统

| ID         | 问题                       | 位置                               | 说明                                                     |
| ---------- | -------------------------- | ---------------------------------- | -------------------------------------------------------- |
| **M-P2-1** | **SessionId 命名文档缺失** | `docs/multi-agent-architecture.md` | Swarm 额外有 `:triage`、`:decompose`，未在文档中统一说明 |

---

## 三、测试体系现状

### 3.1 测试覆盖度热力图

| 模块                         | 单元测试 | 集成测试 | E2E | 覆盖度评估                                                               |
| ---------------------------- | -------- | -------- | --- | ------------------------------------------------------------------------ |
| **ai/tools**                 | ✅       | 部分     | -   | 高                                                                       |
| **ai/hitl**                  | ✅       | ✅       | -   | 高                                                                       |
| **ai/threads**               | ✅       | ✅       | ✅  | 高                                                                       |
| **ai/orchestration**         | ✅ 🆕    | -        | -   | 中（新增 Orchestrator.test.ts）                                          |
| **ai/swarm**                 | ✅ 🆕    | -        | -   | 中（新增 SwarmCoordinator.test.ts）                                      |
| **ai/streaming**             | ✅       | -        | -   | 高                                                                       |
| **ai/runtime**               | ✅       | ✅       | -   | 高                                                                       |
| **ai/sandbox**               | ✅       | -        | -   | 高                                                                       |
| **ai/pipeline**              | ✅       | -        | -   | 高                                                                       |
| **gateway**                  | ✅ 🆕    | -        | -   | 中（新增 GatewayServer.heartbeat.test.ts、approval-async-event.test.ts） |
| **common/extension**         | ✅       | -        | -   | 高                                                                       |
| **common/config**            | ✅       | -        | -   | 高                                                                       |
| **extensions/tool-approval** | ❌       | ❌       | ❌  | **无**                                                                   |
| **renderer**                 | ❌       | ❌       | ❌  | **无**                                                                   |

**新增测试**（本轮）：

- `approval-async-event.test.ts`（6 个用例）：验证异步审批 hitl:approved/rejected 事件发出
- `SwarmCoordinator.test.ts`（6 个用例）：Triage、handoff 链、深度限制、错误处理、共享上下文
- `Orchestrator.test.ts`（9 个用例）：规划→执行→聚合、并行 Stage、失败处理、事件回调
- `GatewayServer.heartbeat.test.ts`（9 个用例）：心跳定时器、pong 响应、超时终止、多客户端独立心跳

**总计**：84 个测试文件、1359 个测试用例、0 失败

### 3.2 高风险未测路径

| 优先级 | 路径                               | 说明                                                     |
| ------ | ---------------------------------- | -------------------------------------------------------- |
| **P0** | **tool-approval Extension**        | HITL 核心逻辑所在，无测试                                |
| **P0** | **GatewayClient**                  | 前端 WebSocket 连接、重连、RPC、事件订阅，无测试         |
| **P0** | **WebSocket 重连 + stream.resend** | 第 26 轮 P0-3：重连后未调用 `stream.resend` 补发历史消息 |
| **P1** | **AgentExecutor 完整端到端**       | 仅片段测试（pipeline、hitl），缺少完整执行路径           |
| **P1** | **MessagePipeline 时序竞态**       | drainQueue、abort、runId 校验未充分覆盖                  |
| **P1** | **StreamBridge / 事件桥接**        | EventBus → WebSocket 推送路径无专门测试                  |
| **P1** | **delegate_to_agent 工具**         | 仅在 real-integration 中顺带覆盖，无独立单元测试         |

### 3.3 测试质量评分

| 维度                        | 评分 | 说明                                                                |
| --------------------------- | ---- | ------------------------------------------------------------------- |
| **Mock 策略一致性**         | 6/10 | mock helpers 存在但未使用，各测试多用内联 mock，不统一              |
| **断言完整性**              | 7/10 | 多数测试有 expect，但部分只断言成功路径                             |
| **边界条件**                | 6/10 | builtin、path-guard 等有边界用例，整体不系统                        |
| **异常路径**                | 5/10 | 部分测试覆盖 reject/timeout，整体不充分                             |
| **测试隔离与清理**          | 8/10 | 多数使用 beforeEach/afterEach、mkdtempSync、resetInstance，隔离较好 |
| **consumeGenerator 统一性** | 4/10 | 至少 6 个文件各自实现，未抽取公共工具                               |
| **CI/CD 集成**              | 2/10 | 无 GitHub Actions；pre-commit 不跑测试                              |

**综合测试质量评分：约 5.5/10**

---

## 四、多 Agent 系统活跃度

### 4.1 三种模式对比

| 维度         | Delegate               | Orchestrator             | Swarm                     |
| ------------ | ---------------------- | ------------------------ | ------------------------- |
| **控制权**   | 主 Agent（LLM）        | 程序（代码）             | Agent 间自主              |
| **决策者**   | 主 Agent 自行决定      | Planner（LLM）→ 程序执行 | 各 Agent 自主判断         |
| **控制流**   | 不确定                 | 确定（ExecutionPlan）    | 动态（Handoff 链）        |
| **信息共享** | 文件（`experiences/`） | SubTask 依赖             | SwarmContext + MessageBus |
| **产品接入** | ✅ 活跃                | ⚠️ API 支持，前端无入口  | ⚠️ API 支持，前端无入口   |
| **测试状态** | ✅ 集成测试            | ✅ 单元测试 🆕           | ✅ 单元测试 🆕            |

### 4.2 SessionId 命名体系（完整版）

| 类型            | 格式                            | 示例                                        | 文件                     |
| --------------- | ------------------------------- | ------------------------------------------- | ------------------------ |
| delegate        | `{threadId}:delegate:{agentId}` | `300000000000000001:delegate:code-reviewer` | delegate-to-agent.ts:340 |
| worker          | `{threadId}:worker:{subtaskId}` | `300000000000000001:worker:subtask-1`       | WorkerCoordinator.ts:227 |
| planner         | `{threadId}:planner`            | `300000000000000001:planner`                | Planner.ts:152           |
| swarm role      | `{threadId}:swarm:{roleId}`     | `300000000000000001:swarm:researcher`       | AgentPool.ts:129         |
| swarm triage    | `{threadId}:triage`             | `300000000000000001:triage`                 | SwarmCoordinator.ts:367  |
| swarm decompose | `{threadId}:decompose`          | `300000000000000001:decompose`              | SwarmCoordinator.ts:491  |

**解析逻辑**：`sessionId.includes(':')` → 子 Agent（`AgentExecutor.ts:614-615`）

### 4.3 活跃度评估

| 模式/组件              | 状态      | 说明                                                               |
| ---------------------- | --------- | ------------------------------------------------------------------ |
| **Delegate**           | 🟢 活跃   | 工具已接入，有集成测试，主 Agent 可正常委托                        |
| **Orchestrator**       | 🟡 休眠   | 代码完整，`chat.send` 支持 `mode=orchestrator`，但前端无 mode 选择 |
| **Swarm**              | 🟡 休眠   | 同上，`chat.send` 支持 `mode=swarm`，前端无入口                    |
| **PlanVersionManager** | 🔴 死代码 | 实现完整，Orchestrator 未调用                                      |

---

## 五、心跳机制现状

### 5.1 WebSocket 连接级心跳

**实现位置**：`GatewayServer.ts:227-238`

**机制**：

- 每个连接启动一个 `setInterval` 定时器（默认 30s）
- 每次 tick：
  - `isAlive === false` → `ws.terminate()` + `cleanupClient()`
  - `isAlive === true` → 设为 `false` + `ws.ping()`
- 收到 `pong` 时 → `isAlive = true`

**测试覆盖**（🆕 本轮新增）：

- ✅ 默认 30s 间隔
- ✅ 自定义间隔
- ✅ pong 响应保持存活
- ✅ 未收到 pong → 超时终止
- ✅ 多轮心跳
- ✅ 客户端断开清理
- ✅ 服务器关闭清理
- ✅ 多客户端独立心跳

**评估**：心跳机制实现正确，测试覆盖充分（9 个用例），无发现 bug。

### 5.2 任务级心跳

经过代码搜索，**项目未实现独立的任务级心跳系统**。当前机制：

1. **WebSocket 连接心跳**：GatewayServer 确保连接存活
2. **StreamMonitor**：统计流式事件（messageCount、toolCallCount 等），但非心跳
3. **Checkpoint**：保存任务状态，支持恢复，但非定期心跳
4. **Pipeline 队列**：`queue.isRunning` 表示任务执行状态，但无定期检查

**缺失**：

- 无长时间运行任务的定期心跳上报（如 Orchestrator 每 30s 上报进度）
- 无任务超时检测（如 Agent 执行超 5 分钟自动中止）
- 无任务 hang 检测（如工具执行卡住无响应）

**建议**：

- 如需任务级心跳，可在 `AgentExecutor.consumeAndForward` 中定期发出 `heartbeat` chunk
- 或在 MessagePipeline 中为每个 session 启动超时定时器

---

## 六、本轮修复记录

### 6.1 代码修复（已提交）

| Commit            | 内容                                                                                             | 测试                                 |
| ----------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `fix(reactivity)` | 修复 `useOpenFiles` Vue 3 reactivity gotcha，首次点击文件内容不显示                              | ✅ 回归验证通过                      |
| `fix(hitl)`       | 异步审批路径增加 `hitl:approved/rejected` 事件发出；`loadHistory` 处理审批决策事件；蜂群命名修正 | ✅ 新增 approval-async-event.test.ts |

### 6.2 测试新增（已提交）

| 测试文件                          | 用例数 | 覆盖内容                                                                       |
| --------------------------------- | ------ | ------------------------------------------------------------------------------ |
| `approval-async-event.test.ts`    | 6      | 异步审批事件发出、同步模式不走异步路径、checkpoint 状态校验                    |
| `SwarmCoordinator.test.ts`        | 6      | Triage 直接回答、单次 handoff、多次 handoff 链、深度限制、错误处理、共享上下文 |
| `Orchestrator.test.ts`            | 9      | 规划→执行→聚合、并行 Stage、子任务失败、事件回调、取消、清理                   |
| `GatewayServer.heartbeat.test.ts` | 9      | 心跳定时器、pong 响应、超时终止、多客户端独立心跳                              |

**测试结果**：84 个文件、1359 个用例、0 失败 ✅

---

## 七、关键代码路径索引

### 7.1 Frontend

| 关注点         | 文件路径                                               |
| -------------- | ------------------------------------------------------ |
| Gateway 客户端 | `src/renderer/src/services/GatewayClient.ts`           |
| 流式订阅       | `src/renderer/src/composables/useStreamWs.ts`          |
| 打开文件管理   | `src/renderer/src/composables/useOpenFiles.ts`         |
| Chat Store     | `src/renderer/src/stores/chat.ts`                      |
| Copilot Store  | `src/renderer/src/stores/copilot.ts`                   |
| Thread Store   | `src/renderer/src/stores/threads.ts`                   |
| Monaco 编辑器  | `src/renderer/src/components/agent/WorkbenchPanel.vue` |

### 7.2 Backend AI 执行层

| 关注点          | 文件路径                                       |
| --------------- | ---------------------------------------------- |
| Agent 执行器    | `src/main/ai/AgentExecutor.ts`                 |
| 消息管道        | `src/main/ai/pipeline/MessagePipeline.ts`      |
| 工具执行管道    | `src/main/ai/runtime/ToolExecutionPipeline.ts` |
| HITL 审批管理   | `src/main/ai/hitl/HitlApprovalManager.ts`      |
| Checkpoint 管理 | `src/main/ai/threads/CheckpointManager.ts`     |
| Thread 唤醒     | `src/main/ai/threads/ThreadWaker.ts`           |
| 事件写入        | `src/main/ai/AgentEventWriter.ts`              |

### 7.3 Multi-Agent 系统

| 关注点       | 文件路径                                         |
| ------------ | ------------------------------------------------ |
| 委托工具     | `src/main/ai/tools/builtin/delegate-to-agent.ts` |
| 蜂群协调器   | `src/main/ai/swarm/SwarmCoordinator.ts`          |
| Handoff 路由 | `src/main/ai/swarm/HandoffRouter.ts`             |
| Agent 池     | `src/main/ai/swarm/AgentPool.ts`                 |
| 编排器       | `src/main/ai/orchestration/Orchestrator.ts`      |
| 计划器       | `src/main/ai/orchestration/Planner.ts`           |
| Worker 协调  | `src/main/ai/orchestration/WorkerCoordinator.ts` |

### 7.4 Gateway

| 关注点           | 文件路径                               |
| ---------------- | -------------------------------------- |
| Gateway 核心     | `src/main/gateway/Gateway.ts`          |
| WebSocket 服务器 | `src/main/gateway/GatewayServer.ts`    |
| chat 方法        | `src/main/gateway/methods/chat.ts`     |
| 审批方法         | `src/main/gateway/methods/approval.ts` |

---

## 八、改进建议（按优先级）

### 8.1 P0 — 立即修复（阻塞/严重）

#### Frontend

1. **修复 Copilot 监听器泄漏**
   - 在 `copilotStore` 中保存 `gateway.onConnect` 返回的取消函数
   - 在 store `$reset` 或应用销毁时调用取消函数
2. **调用 streamCleanup / cleanupThreadWs**
   - 在 `App.vue` 或主进程 IPC 事件（如 `APP_BEFORE_QUIT`）中调用
   - 或在各 store 的 lifecycle hook 中调用

3. **renderer 层测试**
   - 为 GatewayClient 增加单元测试（可 mock WebSocket）
   - 验证 `stream.resend` 调用逻辑（第 26/28 轮 P0-3）
   - 为关键 Composables（useStreamWs、useOpenFiles）增加测试

#### Backend

4. **ThreadWaker 改用 submitViaPipeline**
   - 或提供与 pipeline 一致的恢复路径
   - 确保 runId 竞态防护在恢复场景中生效

5. **OpenAI Runtime 传入 signal**
   - `convertTools` 中将 `signal` 传入 `executeToolPipeline`
   - 确保工具执行可被 abort

6. **consumeAndForward abort 检查优化**
   - 在工具执行或长时间阻塞处增加 abort 检查
   - 或确保 signal 能传递到工具实现内部

#### Multi-Agent

7. **前端增加 mode 选择**
   - 在 ChatPanel 或 Thread 创建时增加 mode 选择 UI（agent / orchestrator / swarm）
   - 将 `mode` 传入 `chat.send`
   - 新建 Thread 时按 mode 设置 `agentType`

8. **Thread 创建 API 扩展**
   - `POST /gateway/threads` 增加 `agentType` 参数（可选）

#### 测试

9. **tool-approval Extension 测试**
   - 在 `extensions/tool-approval/__tests__/` 增加测试
   - 覆盖 `before_tool_call`、allow/ask/deny、async 审批流程

### 8.2 P1 — 重要（影响质量或未来扩展）

#### Frontend

10. **Thread 无 workspacePath fallback**
    - 在 `ThreadView` 中检测 `workspacePath` 为空时弹窗选目录

11. **Store actions 封装**
    - `copilotStore.setBubbleHidden()` 替代直接改属性
    - `threadsStore.updateThread()`, `removeThread()` 封装，避免在 useThreadWs 中直接操作

#### Backend

12. **MessagePipeline.queues TTL**
    - 为长期无活动的 session 增加 TTL，自动清理

13. **sessionCounters 清理**
    - 在 tool-approval 的 Extension 析构中清理
    - 或在异常路径中确保 `resetSessionCounter`

14. **ToolResult 校验**
    - 在 `ToolExecutionPipeline` 中校验工具返回值结构

15. **移除 HitlApprovalManager 批量 API**
    - 废弃 `waitForDecisions` / `submitDecision`
    - 统一使用 `waitForSingleDecision` / `submitSingleDecision`

#### Multi-Agent

16. **PlanVersionManager 集成**
    - 在 Orchestrator 中接入 PlanVersionManager
    - 在 replan 时保存计划版本

17. **子 Agent 审批方案**
    - 方案 A：前端订阅主 thread 时，同时订阅子 sessionId（`threadId:delegate:*`）
    - 方案 B：子 Agent 审批事件按主 thread 转发
    - 方案 C：子 Agent 审批改为自动通过，由主 Agent 负责确认

#### 测试

18. **抽取 consumeGenerator 公共工具**
    - 在 `src/main/ai/__tests__/helpers/` 中统一实现

19. **推动使用 mock helpers**
    - 逐步迁移测试使用 mock-database、mock-eventbus、mock-agent
    - 或明确废弃并删除

20. **pre-commit 增加测试**
    - 在 `scripts/pre-commit.mjs` 中增加 `pnpm test`（或限定关键测试）

21. **建立 CI 流水线**
    - 增加 GitHub Actions，在 push/PR 时执行 `pnpm test` 和 `pnpm test:coverage`

### 8.3 P2 — 次要（可优化）

22. **ChatPanel watch 防抖**
23. **preference Map 监听改进**
24. **Gateway 错误 UI 全局展示**
25. **useOpenFiles 迁入 Pinia**
26. **log.error 传 error 对象**
27. **Extension hook 失败日志**
28. **SessionId 命名统一文档**

---

## 九、数据流与状态管理评估

### 9.1 Frontend 数据流

```
GatewayClient (单例)
    │
    ├─ RPC: chat.send, stream.subscribe, hitl.decide, ...
    │   └─► request(method, params) → Promise<result>
    │
    └─ Events: stream.message, thread.*, worker.status
        │
        ├─► useStreamWs → chatStore (主对话)
        ├─► copilotStore 独立订阅 (管家)
        ├─► useThreadWs → threadsStore (Thread 列表)
        └─► useWorkerWs → workerStore (Worker 状态)
```

**评估**：

- ✅ 职责划分清晰（chat/copilot/threads/agents 边界明确）
- ✅ `useStreamHandler` 在 chat/copilot 间复用
- ⚠️ `useOpenFiles` 非 Pinia，风格不统一
- ⚠️ 多处 `console.warn`，缺少统一错误上报和 UI 反馈
- ⚠️ 无持久化（仅 preference 手动 localStorage），threads/agents 每次重新拉取

### 9.2 Backend 执行流

**正常路径**：`chat.send → MessagePipeline → AgentExecutor → Runtime.stream → consumeAndForward → EventWriter → Frontend`

**审批路径**：`ToolExecutionPipeline → tool-approval → hitl:required → [SUSPENDED] → Checkpoint → 用户审批 → hitl:approved → ThreadWaker → 恢复执行`

**中断路径**：`chat.abort → MessagePipeline.abort → AbortManager → signal.abort() → gen.return() 提前退出`

**评估**：

- ✅ Builder 模式职责清晰
- ✅ runId 机制修复 interrupt 竞态
- ✅ HITL 双模式（sync/async）并存
- ✅ 事件持久化完整（hitl:approved/rejected 已修复）
- ⚠️ ThreadWaker 绕过 pipeline（P0-1）
- ⚠️ OpenAI signal 未传入工具（P0-2）
- ⚠️ abort 检查不及时（P0-3）

---

## 十、内存泄漏风险矩阵

| 来源                        | 风险等级 | 清理方式                                         | 评估                          |
| --------------------------- | -------- | ------------------------------------------------ | ----------------------------- |
| **GatewayClient**           | 🔴 高    | `on` / `onConnect` 返回取消函数                  | Copilot 未正确使用            |
| **useStreamWs**             | 🔴 高    | `streamCleanup()`                                | 从未调用                      |
| **useThreadWs**             | 🔴 高    | `cleanupThreadWs()`                              | 从未调用                      |
| **EventBus**                | 🟡 中    | `once` 自动取消，`on` 需手动 `off`               | 部分组件未在 onUnmounted 清理 |
| **AbortController**         | 🟢 低    | `AbortManager.cleanup()` 在 run 结束时调用       | 正常，runId 校验避免误删      |
| **Runtime**                 | 🟢 低    | `destroyRuntime()` 在 finally 中调用             | 正常                          |
| **Monaco Editor**           | 🟢 低    | WorkbenchPanel 在 onBeforeUnmount 中 `dispose()` | 正常                          |
| **sessionCounters**         | 🟡 中    | `session_end` hook 调用 `resetSessionCounter`    | 异常退出时可能泄漏            |
| **ExtensionLoader watcher** | 🟢 低    | `stopWatch()` 在 BeforeQuitExtensionHook 中调用  | 已修复（第 28 轮）            |
| **GatewayServer**           | 🟢 低    | `close()` 在 BeforeQuitGatewayHook 中调用        | 已修复（第 28 轮）            |

---

## 十一、并发控制机制

### 11.1 MessagePipeline

- **机制**：`SessionQueue` + `isRunning` + `runId` + `AbortManager`
- **竞态防护**：T-1/T-2/T-3 已通过 runId 机制修复
- **中断处理**：`handleInterrupt` 先 abort 旧 run，再立即启动新 run
- **cleanup 校验**：`currentRunIds.get(sessionId) === runId` 才执行清理

**评估**：✅ 竞态已修复，但 drainQueue 期间 abort 检查不充分（P2-3）

### 11.2 busySessions 与 pipeline 并存

- **问题**：ThreadWaker 使用 `submit()`（走 busySessions），而正常流程用 `submitViaPipeline()`
- **风险**：同一 session 可能同时有 pipeline 排队和 busySessions 执行
- **建议**：统一使用 submitViaPipeline，或提供统一的恢复入口

### 11.3 HitlApprovalManager

- **sync 模式**：`waitForSingleDecision` + Promise，前端用户审批后 resolve
- **async 模式**：Agent 挂起 → Checkpoint → ThreadWaker 恢复
- **评估**：✅ 双模式正确，事件持久化已修复

---

## 十二、组件渲染性能

### 12.1 ChatPanel 流式渲染

- **watch 依赖**：`last.content.length + blockCount * 1000 + lastLen`
- **触发频率**：流式时每个 delta 触发一次
- **性能影响**：中等（P2-1），单会话消息量大时可能卡顿
- **建议**：防抖或更精确的依赖（如仅监听 `messages.length`）

### 12.2 Monaco Editor 布局

- **问题（已修复）**：首次点击文件时，编辑器容器 `v-show="false"` 隐藏，Monaco 布局异常
- **修复**：在 `useOpenFiles` 中更新 reactive 对象，触发 `v-show` 更新
- **当前状态**：✅ 正常

---

## 十三、死代码与设计储备

### 13.1 死代码

| 模块                   | 状态   | 说明                           |
| ---------------------- | ------ | ------------------------------ |
| **Teams Runtime**      | 死代码 | 标注 `@deprecated`，无产品入口 |
| **PlanVersionManager** | 死代码 | 实现完整，Orchestrator 未调用  |

### 13.2 休眠代码

| 模块               | 状态 | 说明                                                             |
| ------------------ | ---- | ---------------------------------------------------------------- |
| **OpenAI Runtime** | 休眠 | 实现完整、测试通过，但无产品入口（UI 未提供 provider 选择）      |
| **Orchestrator**   | 休眠 | 代码完整，`chat.send` 支持 `mode=orchestrator`，前端无 mode 选择 |
| **Swarm**          | 休眠 | 同上，`chat.send` 支持 `mode=swarm`，前端无入口                  |

### 13.3 设计储备

| 模块                | 状态     | 说明                                                            |
| ------------------- | -------- | --------------------------------------------------------------- |
| **Memory 高级存储** | 设计储备 | 标注 `@experimental`，SessionMemory、WorkingMemory 实现但未集成 |

---

## 十四、测试策略建议

### 14.1 短期（补齐高风险缺失）

1. **tool-approval Extension 测试**（P0）
   - 覆盖 before_tool_call、ExecPolicy、needUserConfirm、async 审批流程
   - 目标：20+ 用例

2. **GatewayClient 测试**（P0）
   - Mock WebSocket，测试连接、重连、RPC、事件订阅
   - 验证 `stream.resend` 调用时机和参数
   - 目标：15+ 用例

3. **renderer 关键 Composables 测试**（P0）
   - useStreamWs、useOpenFiles、useStreamHandler
   - 目标：10+ 用例

### 14.2 中期（提升质量）

4. **抽取公共 test helpers**
   - `consumeGenerator` 统一实现
   - mock helpers（database、eventbus、agent）推广使用

5. **pre-commit 增加测试**
   - 跑关键测试子集（如 `pnpm test -- src/main/ai/hitl/ src/main/gateway/`）

6. **建立 CI 流水线**
   - GitHub Actions：push/PR 时跑全量测试和覆盖率

### 14.3 长期（系统化）

7. **E2E 测试拆分**
   - 将 real-integration 拆成可 mock 的集成测试 + 可选 E2E
   - CI 只跑前者，手动跑后者

8. **覆盖率目标**
   - 核心路径（AgentExecutor、MessagePipeline、HITL）达到 80%+
   - 整体覆盖率达到 60%+

---

## 十五、架构债务与技术方向

### 15.1 当前债务

| 债务                              | 来源               | 影响                                      |
| --------------------------------- | ------------------ | ----------------------------------------- |
| **busySessions 与 pipeline 并存** | 历史代码演进       | ThreadWaker 绕过 pipeline，状态不一致风险 |
| **useOpenFiles 非 Pinia**         | 早期实现           | 与其它状态管理方式不统一                  |
| **mock helpers 未使用**           | 测试基础设施不完善 | 各测试重复构造 mock，维护成本高           |
| **Orchestrator/Swarm 前端无入口** | 产品迭代优先级     | 完整实现无法被用户使用                    |
| **renderer 无测试**               | Vitest 配置遗漏    | 前端逻辑质量无保障                        |

### 15.2 技术方向建议

1. **统一执行入口**
   - 废弃 `agentExecutor.submit`，统一使用 `submitViaPipeline`
   - ThreadWaker、AiAssistService 等改为使用 pipeline

2. **前端测试体系**
   - 为 renderer 建立测试配置（Vitest + @vue/test-utils）
   - 或使用 Playwright 做端到端 UI 测试

3. **Multi-Agent 产品化**
   - 前端增加 mode 选择 UI
   - 设计合适的用户交互（何时用 orchestrator vs swarm）
   - 补充文档和示例

4. **事件系统统一**
   - EventBus + StreamEvent + Gateway Event + IPC Event 四层事件
   - 考虑统一命名和清理策略

---

## 十六、本轮成果总结

### 16.1 代码修复

- ✅ Vue 3 reactivity bug（useOpenFiles）
- ✅ HITL 异步审批事件发出（approval.ts + loadHistory）
- ✅ 蜂群 Agent 命名修正

### 16.2 测试新增

- ✅ 30 个新增测试用例
- ✅ 覆盖审批流、蜂群、编排、心跳
- ✅ 测试全部通过（84 文件、1359 用例、0 失败）

### 16.3 架构洞察

- 🔍 Frontend：Copilot 监听器泄漏、cleanup 函数未调用
- 🔍 Backend：ThreadWaker 绕过 pipeline、abort 检查不及时
- 🔍 Multi-Agent：Orchestrator/Swarm 休眠，前端无入口
- 🔍 测试：tool-approval 无测试、renderer 无测试、覆盖度约 55%

---

## 十七、下一步行动计划

### 立即行动（本周内）

1. [ ] 修复 F-P0-1: Copilot 监听器泄漏
2. [ ] 修复 F-P0-2: 调用 streamCleanup / cleanupThreadWs
3. [ ] 修复 B-P0-1: ThreadWaker 改用 submitViaPipeline
4. [ ] 新增 T-P0-1: tool-approval Extension 测试

### 短期（2 周内）

5. [ ] 新增 T-P0-2: GatewayClient 测试
6. [ ] 修复 B-P0-2: OpenAI signal 传入工具
7. [ ] 修复 M-P0-1: 前端 mode 选择 UI
8. [ ] 抽取 consumeGenerator 公共工具

### 中期（1 个月内）

9. [ ] 建立 CI 流水线
10. [ ] pre-commit 增加测试
11. [ ] Thread 无 workspacePath fallback
12. [ ] 子 Agent 审批方案实施

---

## 十八、指标仪表板

### 18.1 代码健康度

| 指标           | 数值 | 目标  | 状态 |
| -------------- | ---- | ----- | ---- |
| 测试文件数     | 84   | 100+  | 🟡   |
| 测试用例数     | 1359 | 1500+ | 🟡   |
| 测试通过率     | 100% | 100%  | ✅   |
| P0 问题数      | 11   | 0     | 🔴   |
| P1 问题数      | 16   | < 5   | 🟡   |
| P2 问题数      | 8    | < 10  | ✅   |
| 覆盖率（估算） | 55%  | 70%+  | 🟡   |

### 18.2 架构成熟度

| 维度     | 评分 | 说明                                           |
| -------- | ---- | ---------------------------------------------- |
| 模块化   | 8/10 | 分层清晰，边界明确                             |
| 可测试性 | 6/10 | 多数模块有测试，但 tool-approval/renderer 无   |
| 可维护性 | 7/10 | 代码清晰，但有死代码和 mock 不统一             |
| 韧性     | 7/10 | 有 checkpoint/retry/abort，但 abort 检查不及时 |
| 可观测性 | 7/10 | 有日志和事件，但部分 catch 空块                |
| 安全性   | 8/10 | ExecPolicy、Sandbox、HITL 审批完整             |
| 性能     | 7/10 | 有 pipeline/queue，但长会话内存膨胀（已缓解）  |
| 扩展性   | 9/10 | Extension 系统完善，支持 Hook 和方法注册       |

**综合架构成熟度：约 7.4/10**

---

## 十九、参考链接

- 第 26 轮：全维度综合架构审查
- 第 28 轮：资源泄漏与前端状态分析
- 维度清单：`22-analysis-dimensions-catalog.md`
- 多 Agent 架构：`docs/multi-agent-architecture.md`
