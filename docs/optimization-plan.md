# Coobee AI — 架构优化计划

> 基于全面代码分析的优化方案
> 创建时间：2026-02-22
> 最后更新：2026-02-28

---

## 一、分析总览

| 模块                    | 文件数 | 总行数        | 健康度 | 核心问题                    |
| ----------------------- | ------ | ------------- | ------ | --------------------------- |
| AgentExecutor           | 1      | ~~1,244~~ 987 | 🟡 中  | 已拆分 3 组件，仍有优化空间 |
| 质量闭环 (quality-loop) | 3+测试 | 1,960         | 🟡 中  | 保留，待后续封装            |
| LLMService              | 1      | 125           | 🟢 好  | 已单例化                    |
| SwarmRuntime            | 1      | 459           | 🟡 中  | 28% 代码是质量闭环          |
| OrchestratorRuntime     | 1      | 384           | 🟡 中  | 36% 代码是质量闭环          |
| SwarmCoordinator        | 1      | 768           | 🟢 好  | console.log 已替换          |
| chat.ts (Gateway)       | 1      | 339           | 🟢 好  | 已简化                      |
| Builder 体系            | 3      | 437           | 🟢 好  | BaseAgentBuilder 已提取     |
| 工作空间                | 4      | 1,050         | 🟢 好  | 双空间架构已实现            |
| 记忆系统                | 10+    | 2,000+        | 🟡 中  | 两模块用途不同，均未投产    |
| 工具系统                | 17     | ~4,000        | 🟢 好  | 结构清晰                    |
| 技能系统                | 2+18个 | ~400          | 🟢 好  | 结构合理                    |
| 沙箱安全                | 5      | ~750          | 🟢 好  | 分层设计得当                |
| 线程管理                | 3      | ~530          | 🟢 好  | 职责清晰                    |

---

## 二、优化项目清单

### 🔴 P0 — 架构性问题

#### P0-1: ~~删除程序化质量闭环~~ → 保留，后续封装

**状态：❌ 跳过（用户决定保留 quality-loop 组件用于后续封装）**

质量闭环组件（Aggregator / Validator / Repairer）保留不动，后续会做进一步封装优化。

---

#### P0-2: ~~删除 LLMService~~ → 单例化简化

**状态：✅ 已完成（2026-02-22）**

- 新增 `getLLMService()` 全局单例函数
- SwarmCoordinator / SwarmRuntime / OrchestratorRuntime / cron-jobs 全部改用 `getLLMService()`

---

#### P0-3: 拆分 AgentExecutor（God Class）

**状态：✅ 已完成（2026-02-28）**

从 AgentExecutor 提取了 3 个独立组件：

| 组件                   | 文件                                          | 职责                                  |
| ---------------------- | --------------------------------------------- | ------------------------------------- |
| `ProviderInjector`     | `src/main/ai/provider/ProviderInjector.ts`    | API key / model / baseURL 注入        |
| `SessionStatusManager` | `src/main/ai/runtime/SessionStatusManager.ts` | 会话活跃状态跟踪                      |
| `ChunkProcessor`       | `src/main/ai/runtime/ChunkProcessor.ts`       | 流式块 metrics / hooks / suspend 解析 |

AgentExecutor 从 1,244 行减至 987 行。对外 API 零改动，保持向后兼容。

---

#### P0-4: 工作空间重构——用户空间 vs 系统空间

**状态：✅ 已完成（2026-02-28）**

新的双空间架构：

```
workspaces/{threadId}/
├── GOAL.md
├── user/                    ← 用户空间（前端默认展示）
│   ├── data/                   用户输入文件
│   ├── output/                 Agent 产出
│   ├── skills/                 当前激活的技能
│   └── knowledge/              知识库文档
├── .runtime/                ← 系统空间（隐藏）
│   ├── sessions/
│   ├── contexts/
│   ├── events/
│   ├── logs/
│   └── checkpoint.json
└── tasks/                   多 Agent 任务目录
```

修改了 9 个文件：env.ts、AgentEnvInjector.ts、AgentEnv.ts、AgentEventWriter.ts、WorkspaceManager.ts、CheckpointManager.ts、ToolExecutionPipeline.ts、types.ts、ThreadView.vue。含旧工作空间惰性迁移。

---

#### P0-5: 辩证质量验证

**状态：✅ 已完成（2026-02-28）**

在执行协议的 Quality Assurance 部分新增 Dialectical Verification 章节：

- 复杂任务通过 `delegate_to_agent` 委派子 Agent 做独立验证
- 验证者拥有全新上下文，消除实现偏见
- 多智能体模式下主 Agent 必须聚合验证子 Agent 结果

---

### 🟡 P1 — 重要优化

#### P1-1: Builder 基类提取

**状态：✅ 已完成（2026-02-22）**

- BaseAgentBuilder 抽象基类 188 行
- PiMonoBuilder 350→179 行，OpenAIBuilder 212→70 行

---

#### P1-2: chat.ts 入口简化

**状态：✅ 已完成（2026-02-22）**

- 提取 `mergeTools()`、`filterToolsByMode()`、`createMultiAgentRuntime()`
- 415→339 行

---

#### P1-3: 统一日志

**状态：✅ 已完成（2026-02-22）**

替换 15 个生产文件中的 console.log 为 `createLogger()`。

---

#### P1-4: 记忆系统整合

**状态：✅ 分析完成（2026-02-28）**

结论：`LongTermMemoryStore` 和 `StructuredMemoryStorage` 用途不同、数据模型不同，且均未在生产中使用。暂不合并。

- `LongTermMemoryStore`：简单的关键词搜索 + 重要性评分（5 种类型）
- `StructuredMemoryStorage`：MemU 模式的 Resource→Item→Category + 向量搜索（6 种类型）
- 两者共享同一 SQLite 数据库但使用不同表

---

#### P1-5: 消除动态导入

**状态：🟡 部分完成（2026-02-22）**

- `files.ts` 清理了 6 处冗余 `await import`
- 其余为合理的循环依赖规避，暂不修改

---

### 🟢 P2 — 改进项

#### P2-1: 有界集合

**状态：✅ 已完成（2026-02-28）**

- SwarmContext.changeHistory: max 500
- HandoffRouter.history: max 200
- MessageBus.messages: max 1000
- SessionFileManagerFactory: max 50 (LRU eviction)

---

#### P2-2: FileMessageBus 封装修复

**状态：✅ 已完成（2026-02-28）**

- MessageBus 新增 `protected pushMessage/getMessageCounter/setMessageCounter`
- FileMessageBus 移除所有 `(this as any)` 访问

---

#### P2-3: OpenAIAgentRuntime 方法拆分

**状态：⏳ 待处理**

`generateStreamEvents` 约 200 行，包含大型 switch 语句。

---

#### P2-4: Cron 系统完善

**状态：⏳ 待处理**

---

#### P2-5: 清理死代码

**状态：✅ 已完成（2026-02-28）**

移除：

- `RoleRegistry.matchByCapabilities`
- `FileSwarmContext.emitArtifactCreated`
- `MessageBus` 话题订阅系统
- `HitlApprovalManager` 批量审批 API
- `ShortTermMemory.SummarizingSession`

---

## 三、完成统计

| 指标                     | 改动前         | 改动后           |
| ------------------------ | -------------- | ---------------- |
| AgentExecutor            | 1,244 行       | 987 行           |
| Builder 重复代码         | ~100 行        | 0 行             |
| console.log 残留         | 13+ 处         | 0 处             |
| 无界数据结构             | 4 处           | 0 处             |
| `(this as any)` 封装违规 | 1 处           | 0 处             |
| 死代码                   | 5 处 ~1,000 行 | 已清理           |
| 工作空间对用户透明度     | 低             | 高（双空间架构） |
| 辩证质量验证             | 无             | 系统提示词引导   |

**总计完成：11/15 项，4 项待处理（P1-5 部分、P2-3、P2-4 为低优先级）**

---

## 四、后续方向

1. **质量闭环封装**：将 Aggregator/Validator/Repairer 封装为可复用的 SDK 或工具
2. **技能软链接**：在 `user/skills/` 中为激活的技能创建软链接，实现运行时可编辑
3. **多智能体端到端质量测试**：实际运行 Swarm/Orchestrator 模式验证辩证质量验证效果
4. **记忆系统投产**：选择一个记忆存储方案正式启用
