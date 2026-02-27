# Coobee AI — 架构优化计划

> 基于全面代码分析的优化方案
> 创建时间：2026-02-22

---

## 一、分析总览

| 模块                    | 文件数 | 总行数 | 健康度 | 核心问题                                |
| ----------------------- | ------ | ------ | ------ | --------------------------------------- |
| AgentExecutor           | 1      | 1,244  | 🔴 差  | God Class，12+ 职责混杂                 |
| 质量闭环 (quality-loop) | 3+测试 | 1,960  | 🔴 差  | 与技能包重复，代码侵入 3 个运行时       |
| LLMService              | 1      | 88     | 🔴 差  | 不必要的抽象，质量闭环的副产品          |
| SwarmRuntime            | 1      | 459    | 🟡 中  | 28% 代码是质量闭环                      |
| OrchestratorRuntime     | 1      | 384    | 🟡 中  | 36% 代码是质量闭环                      |
| SwarmCoordinator        | 1      | 768    | 🟡 中  | 质量闭环 + console.log + 动态导入       |
| chat.ts (Gateway)       | 1      | 406    | 🟡 中  | 5 种模式分支、工具合并重复              |
| Builder 体系            | 2      | 562    | 🟡 中  | PiMono/OpenAI Builder 大量重复逻辑      |
| 工作空间                | 4      | 1,050  | 🟡 中  | 两套会话存储路径、缺少用户空间概念      |
| 记忆系统                | 10+    | 2,000+ | 🟡 中  | LongTermMemory 和 StructuredMemory 重叠 |
| 工具系统                | 17     | ~4,000 | 🟢 好  | 结构清晰，个别小问题                    |
| 技能系统                | 2+18个 | ~400   | 🟢 好  | 结构合理                                |
| 沙箱安全                | 5      | ~750   | 🟢 好  | 分层设计得当                            |
| 线程管理                | 3      | ~530   | 🟢 好  | 职责清晰                                |

---

## 二、优化项目清单

### 🔴 P0 — 架构性问题（必须修复）

#### P0-1: 删除程序化质量闭环，回归技能包驱动

**问题：** Aggregator / Validator / Repairer 用硬编码方式重复了 `execution-protocol` + `self-reflection` + `eval-refine-loop` 三个技能包已经提供的能力。导致 SwarmRuntime（28%）和 OrchestratorRuntime（36%）的代码被质量闭环侵入，每新增一个运行模式就要复制一遍。

**方案：**

- 删除 `src/main/ai/quality-loop/` 整个目录（669 行 + 804 行测试）
- 清理 SwarmRuntime（~130 行）、OrchestratorRuntime（~140 行）、SwarmCoordinator（~120 行）中的质量闭环代码
- 运行时只负责调度和流式输出，质量保证完全由常驻技能包负责
- 多智能体汇总：由主 Agent 通过系统提示词引导完成（而不是程序调 LLM）

**预计清理：~1,960 行代码**

---

#### P0-2: 删除 LLMService

**问题：** `LLMService` 是质量闭环的副产品，将 `agentExecutor.piMono().lightweight(true)` 包装成 `chat(messages)` 接口。删除质量闭环后，6 个调用方消失，仅剩 `cron-jobs.ts` 和 `memorize.ts` 两处需要辅助 LLM 调用。

**方案：**

- 删除 `src/main/ai/provider/LLMService.ts`（88 行）
- `cron-jobs.ts`：直接内联 `agentExecutor.piMono().lightweight(true).instructions(...).stream(...)` 几行代码
- `memorize.ts`：同上，直接用 Builder 链路
- 删除所有相关测试中的 LLMService mock

**预计清理：~200 行代码**

---

#### P0-3: 拆分 AgentExecutor（God Class）

**问题：** AgentExecutor 有 1,244 行、32 个方法、12+ 职责。包括：执行调度、Provider 配置、消息管线、会话状态、HITL 审批、指标统计、扩展 Hook、工作空间扩展加载、模型故障转移等。

**方案：** 逐步拆分为 5 个聚焦组件：

| 组件                      | 从 AgentExecutor 提取的方法                                                                             | 预计行数 |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | -------- |
| `SessionStatusManager`    | updateSessionStatus, updateCheckpoint, syncThreadRunStatus, parseSuspendReason, pendingApprovalSessions | ~200     |
| `ChunkProcessor`          | consumeAndForward, recordChunkMetrics, fireChunkHooks, runExtensionHooks, runExtensionEndHooks          | ~150     |
| `ProviderInjector`        | applyProviderConfig, applyThinkingLevel                                                                 | ~80      |
| `ExecutionPreparer`       | prepareExecution（统一 stream/execute 的前置步骤：工作空间、扩展、eventWriter）                         | ~100     |
| `AgentExecutor`（瘦身后） | piMono, openai, submit, stream, abort                                                                   | ~500     |

**预计：AgentExecutor 从 1,244 行减至 ~500 行**

---

#### P0-4: 工作空间重构——用户空间 vs 系统空间

**问题：**

1. 当前工作空间结构面向系统设计，用户看到的都是 `sessions/`、`contexts/`、`events/` 等系统目录
2. 两套会话存储路径：`~/.coobee-ai/sessions/`（SessionFileManager）和 `~/.coobee-ai/workspaces/`（ThreadStore），同一会话数据分散两处
3. 用户的数据文件、技能包、产出物没有统一的可见空间
4. 运行时激活的技能不在工作空间中可见、不可修改

**方案：**

```
workspaces/{threadId}/
├── user/                    ← 用户空间（前端默认展示）
│   ├── data/                ←   用户输入文件、参考资料
│   ├── output/              ←   Agent 产出
│   ├── skills/              ←   软链接：当前激活的技能（可查看、可修改）
│   └── knowledge/           ←   知识库文档
│
├── .runtime/                ← 系统空间（隐藏，用户不需关注）
│   ├── sessions/
│   ├── contexts/
│   ├── events/
│   ├── logs/
│   ├── tasks/
│   └── checkpoint.json
│
└── GOAL.md
```

需要修改：

- `Env.ts` — 目录创建逻辑
- `AgentEnvInjector.ts` — 系统提示词告知路径
- `WorkspaceManager.ts` — 子 Agent 工作空间
- `SessionFileManager.ts` — 统一到工作空间下
- 前端目录树组件 — 默认打开 `user/` 目录
- `SkillManager.ts` — 支持工作空间 `user/skills/` 软链接
- `path-guard.ts` — 更新沙箱边界

---

### 🟡 P1 — 重要优化（应该修复）

#### P1-1: Builder 基类提取

**问题：** `PiMonoBuilder`（350 行）和 `OpenAIBuilder`（212 行）有大量重复方法：`name()`、`mode()`、`instructions()`、`appendInstructions()`、`tools()`、`skills()`、`model()` 等。

**方案：**

- 创建 `BaseAgentBuilder` 抽象类，包含所有共享字段和方法
- `PiMonoBuilder` 和 `OpenAIBuilder` 继承基类，只实现差异化的 `build()` 方法

**预计减少：~100 行重复代码**

---

#### P1-2: chat.ts 入口简化

**问题：** `chat.ts` 406 行，5 种模式分支，`createBuilder` 和 `createBuilderFromDefinition` 中工具合并逻辑重复。

**方案：**

- 提取 `mergeTools(builtinTools, extensionTools, agentTools)` 工具函数
- 提取 `createAgentBuilder(executor, agentDef, tools, skills)` 统一构建函数
- 模式分发改为策略映射 `{ orchestrator: createOrchestratorRuntime, swarm: ... }`

---

#### P1-3: 统一日志——消灭 console.log

**问题：** 以下模块使用 `console.log/console.error` 而非项目统一的 `createLogger`：

- SwarmMonitor（4 处）
- FileSwarmContext（6 处）
- KnowledgeBase（1 处）
- RoleRegistry（2 处）
- ShortTermMemory
- LongTermMemoryStore

**方案：** 全部替换为 `createLogger`。

---

#### P1-4: 记忆系统整合

**问题：** `LongTermMemoryStore`（302 行）和 `structured/storage.ts`（497 行）都在 SQLite 中存储长期记忆，功能重叠但互不关联。

**方案：**

- 评估是否合并为单一长期记忆存储
- 或明确分工：`LongTermMemoryStore` 负责关键词搜索，`StructuredMemory` 负责向量搜索
- 统一 API，消除混淆

---

#### P1-5: 消除动态导入 (await import)

**问题：** `SwarmCoordinator`、`Planner`、`ThreadWaker`、`ToolExecutionPipeline` 使用 `await import('../AgentExecutor')` 规避循环依赖。这使测试困难、隐藏依赖关系。

**方案：** 通过构造函数注入或工厂函数传入 `AgentExecutor` 引用，消除循环依赖。

---

### 🟢 P2 — 改进项（锦上添花）

#### P2-1: 有界集合——防止内存泄漏

以下数据结构无限增长：

- `SwarmContext.changeHistory` — 无上限
- `HandoffRouter.history` — 跨任务累积
- `MessageBus.messages` — 无 TTL 或最大数量
- `SessionFileManagerFactory` — 无淘汰策略

**方案：** 添加 LRU / TTL / 最大条目限制。

---

#### P2-2: FileMessageBus 封装修复

**问题：** `FileMessageBus.restoreMessage` 使用 `(this as any)` 访问父类私有字段 `messages` 和 `messageCounter`。

**方案：** 在 `MessageBus` 中添加 `protected restoreMessage()` 方法。

---

#### P2-3: OpenAIAgentRuntime 方法拆分

**问题：** `generateStreamEvents` 约 200 行，包含大型 switch 语句。

**方案：** 拆分为 `handleRawModelEvent`、`handleRunItemEvent` 等小方法。

---

#### P2-4: Cron 系统完善

**问题：**

- `AgentExecutor` 注入时机不明确
- 执行历史查询 O(n) 无索引
- `initializeCronSystem()` 未启动调度器

**方案：** 在生命周期 Hook 中正确注入和启动。

---

#### P2-5: 清理死代码

- `RoleRegistry.matchByCapabilities` — 无调用方
- `FileSwarmContext.emitArtifactCreated` — 空方法
- `MessageBus` 的 topic 订阅系统 — 未被使用
- `HitlApprovalManager` 的批量审批 API — 已标记 deprecated
- `ShortTermMemory.SummarizingSession` — 使用旧版 OpenAI 客户端，可能失效

---

## 三、实施优先级和排期建议

```
Phase 1 — 清理多余抽象（预计 1 天）
├── P0-1: 删除程序化质量闭环
├── P0-2: 删除 LLMService
└── P1-3: 统一日志

Phase 2 — 工作空间重构（预计 1-2 天）
└── P0-4: 用户空间 vs 系统空间

Phase 3 — AgentExecutor 拆分（预计 1-2 天）
├── P0-3: 拆分 God Class
├── P1-1: Builder 基类提取
└── P1-5: 消除动态导入

Phase 4 — 入口简化 + 记忆整合（预计 1 天）
├── P1-2: chat.ts 入口简化
└── P1-4: 记忆系统整合

Phase 5 — 细节改进（按需）
├── P2-1: 有界集合
├── P2-2: 封装修复
├── P2-3: 方法拆分
├── P2-4: Cron 完善
└── P2-5: 清理死代码
```

---

## 四、预期收益

| 指标                             | 当前                 | 优化后             |
| -------------------------------- | -------------------- | ------------------ |
| 质量闭环代码                     | ~1,960 行            | 0 行               |
| LLMService                       | 88 行 + 大量 mock    | 0 行               |
| AgentExecutor                    | 1,244 行             | ~500 行            |
| SwarmRuntime 质量闭环占比        | 28%                  | 0%                 |
| OrchestratorRuntime 质量闭环占比 | 36%                  | 0%                 |
| Builder 重复代码                 | ~100 行              | 0 行               |
| console.log 残留                 | 13+ 处               | 0 处               |
| 工作空间对用户透明度             | 低                   | 高                 |
| 技能包可见可改                   | 否                   | 是                 |
| 新增运行模式成本                 | 高（需复制质量闭环） | 低（只需调度逻辑） |

---

## 五、风险和注意事项

1. **质量闭环删除后的质量保证** — 完全依赖技能包意味着 LLM 自行决定何时评估、何时修复。需要确保 `execution-protocol` 和 `self-reflection` 的提示词足够强，能引导 Agent 真正执行自评。可能需要在实际使用中迭代优化技能包内容。

2. **AgentExecutor 拆分的兼容性** — 外部调用方（chat.ts、ThreadWaker、cron 等）通过 AgentExecutor 访问 submit/stream/abort。拆分内部实现时需保持这些公共 API 不变。

3. **工作空间迁移** — 已有的工作空间目录需要迁移。建议：新创建的工作空间用新结构，已有的在首次访问时惰性迁移。

4. **软链接安全** — `user/skills/` 中的技能软链接需要确保 `path-guard` 允许对链接目标的读写访问。
