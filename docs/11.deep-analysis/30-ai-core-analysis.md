# AI 核心模块深度分析

## 1. Agent 执行引擎

### 1.1 架构与关键类

| 文件                  | 职责                                                       |
| --------------------- | ---------------------------------------------------------- |
| `AgentExecutor.ts`    | 执行调度层：并发控制、Builder 工厂、流式执行、模型故障转移 |
| `AgentEnv.ts`         | Agent 可见的运行时环境（路径、配置、能力清单）             |
| `AgentEnvInjector.ts` | 环境注入：workspace、Skill、执行协议、工具上下文           |

### 1.2 生命周期

```
创建 → 注入环境 → 创建 Runtime → stream() → 消费 chunk → 销毁 Runtime
```

- **Builder 路径**：`piMono()` / `openai()` → `injectEnv()` → `builder.build()` → `runtime.stream()`
- **预构建路径**：`request.runtime` 已存在（Orchestrator/Swarm）时跳过 Builder
- **轻量模式**：`getLightweight()` 为 true 时跳过 workspace、Extension、EventWriter

### 1.3 环境注入机制

- **Agent 模式**：Skill 扫描、执行协议、`<runtime_paths>`、`<skill_discovery>`、`<agent_discovery>`、`sandboxContext`
- **Chat 模式**：仅 workspace、sessionDir、contextDir
- **沙箱**：`path-only`（默认）/ `docker` / `off`，由 ConfigStore 读取

### 1.4 错误恢复

- **模型组故障转移**：`modelSourceRef` + `getGroupCandidates()`，首个 chunk 为 `run:error` 时切换组内下一模型
- **审批 TTL**：`pendingApprovalSessions` 2 小时 TTL，每 5 分钟清理
- **Extension Hook 失败**：`fireChunkHooks` 使用 fire-and-forget，不阻塞流

### 1.5 发现的问题

| 问题                              | 位置                                     | 严重程度 |
| --------------------------------- | ---------------------------------------- | -------- |
| 模型故障转移仅在首个 chunk 时触发 | AgentExecutor.ts stream loop             | 中       |
| 审批 TTL Map 无持久化，重启后丢失 | AgentExecutor.ts pendingApprovalSessions | 低       |
| 轻量模式判断条件散落              | AgentExecutor.ts getLightweight()        | 低       |
| 并发会话无上限控制                | AgentExecutor.ts concurrencyMap          | 中       |

---

## 2. Runtime 系统

### 2.1 OpenAI vs PiMono

| 维度 | OpenAI Runtime                | PiMono Runtime                  |
| ---- | ----------------------------- | ------------------------------- |
| SDK  | `@openai/agents`              | `@mariozechner/pi-coding-agent` |
| 会话 | FileSession（JSONL）          | SessionManager（file/memory）   |
| 压缩 | SessionCompressor（可选）     | SDK 内置 compaction             |
| 思考 | ThinkTagParser 解析 `<think>` | SDK 原生                        |
| 流式 | Run → stream events → chunk   | SDK 内置 stream                 |

### 2.2 工具执行管道 (ToolExecutionPipeline)

```
Agent 调用工具 → Pipeline.execute()
  → 1. Extension hook: tool-approval (allow/deny/ask)
  → 2. needUserConfirm → HITL 审批
  → 3. 实际执行 tool.execute()
  → 4. Extension hook: tool-result (可修改结果)
  → 5. 返回结果给 Agent
```

### 2.3 发现的问题

| 问题                                       | 严重程度           |
| ------------------------------------------ | ------------------ |
| SessionCompressor 仅 OpenAI Runtime 支持   | 中                 |
| ThinkTagParser 跨 chunk 拆分边界可能漏标签 | 低（已有测试覆盖） |
| OpenAI FileSession JSONL 文件无大小限制    | 中                 |
| PiMono Runtime 错误信息不够结构化          | 低                 |

---

## 3. 工具系统

### 3.1 内置工具列表

| 工具              | 分类          | 风险 | 说明                       |
| ----------------- | ------------- | ---- | -------------------------- |
| read              | FileSystem    | 低   | 读文件                     |
| write             | FileSystem    | 中   | 写文件                     |
| edit              | FileSystem    | 中   | 编辑文件                   |
| exec              | Execute       | 高   | 执行命令（前台/后台/终端） |
| process           | Execute       | 中   | 管理后台进程               |
| memory            | Memory        | 低   | 记忆管理                   |
| search            | Search        | 低   | 文件内容搜索               |
| glob              | Search        | 低   | 文件名搜索                 |
| skill_list        | Discovery     | 低   | Skill 发现                 |
| delegate_to_agent | Execute       | 中   | 委托子 Agent               |
| task_plan         | Observability | 低   | 任务计划                   |
| todo_write        | Observability | 低   | TODO 管理                  |
| emit_event        | Observability | 低   | UI 事件                    |

### 3.2 发现的问题

| 问题                                                   | 严重程度 |
| ------------------------------------------------------ | -------- |
| exec 工具前台模式默认超时 30s 偏短                     | 中       |
| process 工具最多 20 个进程，长进程占满后新进程无法创建 | 中       |
| write 工具未做文件大小限制                             | 低       |
| search 工具无结果数量限制参数                          | 低       |

---

## 4. Orchestrator 编排系统

### 4.1 架构

```
Orchestrator
  → Planner (分解任务)
  → SubtaskRunner (并行/串行执行子任务)
  → PlanVersionManager (计划版本管理)
  → VerificationGate (质量验证)
```

### 4.2 发现的问题

| 问题                                          | 严重程度 |
| --------------------------------------------- | -------- |
| 子任务失败时整体状态为 failed，无部分成功模式 | 中       |
| PlanVersionManager 版本无限增长               | 低       |
| 计划更新缺少并发控制                          | 中       |

---

## 5. Swarm 蜂群系统

### 5.1 架构

- **SwarmCoordinator**：多 Agent 并行执行，消息总线通信
- **DiscussionCoordinator**：轮次制讨论，自动判断收敛
- **MessageBus**：Agent 间通信，支持 broadcast/direct

### 5.2 发现的问题

| 问题                                 | 严重程度 |
| ------------------------------------ | -------- |
| MessageBus 无消息大小限制            | 中       |
| DiscussionCoordinator 最大轮次硬编码 | 低       |
| Swarm 完成判定逻辑过于简单           | 中       |

---

## 6. Quality Loop 质量循环

### 6.1 架构

```
Aggregator → 聚合子任务结果
Validator  → 多维度评分（完成度、准确性、一致性）
Repairer   → 根据评分决定修复策略（patch/replan/abort）
```

### 6.2 发现的问题

| 问题                                 | 严重程度 |
| ------------------------------------ | -------- |
| 仅用于 Orchestrator，单 Agent 未接入 | 中       |
| Validator 评分依赖 LLM，无确定性验证 | 中       |
| LLMClient 未接入 ProviderRegistry    | 中       |

---

## 7. Memory 记忆系统

### 7.1 架构

- **WorkingMemoryStore**：基于文件的键值存储
- **memory 工具**：Agent 通过工具存取记忆
- **记忆持久化**：JSON 文件，按 session/agent 隔离

### 7.2 发现的问题

| 问题                      | 严重程度 |
| ------------------------- | -------- |
| 无记忆容量限制            | 中       |
| 无记忆过期/淘汰机制       | 中       |
| 跨 session 记忆查询不支持 | 低       |
