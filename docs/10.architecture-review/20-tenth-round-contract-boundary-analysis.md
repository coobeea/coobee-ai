# 第十轮架构分析 — 契约、边界、时序、可观测性

> 日期: 2026-02-12
> 维度: 接口契约一致性 / 模块边界与依赖 / 并发与时序正确性 / 可观测性与调试
> 方法: 4 Agent 并行分析

---

## 一、分析维度说明

| 维度             | 分析目标                                | 之前是否覆盖        |
| ---------------- | --------------------------------------- | ------------------- |
| 接口契约一致性   | Gateway/IPC/Tool/Runtime 的输入输出契约 | 部分（第8轮）       |
| 模块边界与依赖   | 循环依赖、分层违反、全局单例            | 未覆盖              |
| 并发与时序正确性 | 异步竞态、事件顺序、Promise 泄漏        | 部分（第7轮 Abort） |
| 可观测性与调试   | 日志覆盖率、错误链路、调试工具          | 未覆盖              |

---

## 二、发现汇总

| 维度             | P0    | P1     | P2     | 合计   |
| ---------------- | ----- | ------ | ------ | ------ |
| 接口契约一致性   | 0     | 4      | 11     | 15     |
| 模块边界与依赖   | 3     | 4      | 8      | 15     |
| 并发与时序正确性 | 3     | 3      | 4      | 10     |
| 可观测性与调试   | 1     | 8      | 12     | 21     |
| **合计**         | **7** | **19** | **35** | **61** |

---

## 三、重点发现

### 3.1 并发时序 — MessagePipeline Interrupt 竞态（P0 × 3）

这是本轮最有价值的发现。MessagePipeline 的 interrupt 流程存在严重竞态：

**问题 1: doExecute cleanup 与 isAborted 顺序错误**

- `finally` 中先 `cleanup(sessionId)`（清除 abortedSessions），再检查 `isAborted(sessionId)`
- abort 后 isAborted 返回 false，仍会执行 drainQueue

**问题 2: 旧 run 的 cleanup 删除新 run 的 controller**

- interrupt 时新 run 已通过 `create()` 创建了 controller B
- 旧 run 的 `finally` 调用 `cleanup(sessionId)` 删除了 B
- 新 run 无法被 abort

**问题 3: 旧 run 的 finally 覆盖 queue.isRunning**

- 新 run 设置 `queue.isRunning = true`
- 旧 run 后完成时将其覆盖为 `false`
- submit 认为 session 空闲，启动第三个并发 run

**修复方案**: 引入 runId，每个 run 持有自己的 runId，cleanup/isRunning 更新时校验 runId 一致性。

### 3.2 模块边界 — common 层反向依赖 ai/gateway（P0 × 3）

- `common/extension/types.ts` import `ai/tools/types.ToolDefinition`
- `common/extension/types.ts` import `gateway/protocol/types.MethodHandler`
- `common/extension/ExtensionApi.ts` dynamic import `ai/hitl/` 和 `ai/streaming/`

违反了 common → ai → gateway 的分层原则。

### 3.3 可观测性 — 错误日志丢失 stack trace（P0 × 1）

- `AgentExecutor` 的 catch 块传了 `error.message` 字符串而非 `error` 对象
- electron-log 无法输出 stack trace

### 3.4 接口契约 — Gateway 方法无运行时校验（P1）

所有 Gateway 方法都用 `params as { ... }` 强转，无 Zod 校验。非法参数在运行时被静默忽略。

---

## 四、与历轮对比

| 轮次   | 维度                      | P0    | P1     | P2     | 特征                             |
| ------ | ------------------------- | ----- | ------ | ------ | -------------------------------- |
| 5      | 子系统纵向                | 5     | 8      | 6      | 基础设施缺失                     |
| 6      | 子系统纵向                | 2     | 5      | 4      | 内存泄漏、死代码                 |
| 7      | 子系统纵向                | 1     | 4      | 3      | Abort 信号                       |
| 8      | 子系统深度                | 6     | 12     | 6      | 深层安全+一致性                  |
| 9      | 横切面                    | 3     | 7      | 5      | 隐藏 Bug、性能                   |
| **10** | **契约/边界/时序/可观测** | **7** | **19** | **35** | **竞态条件、分层违反、日志缺失** |

**趋势分析**：

- P0 数量振荡（5→2→1→6→3→7），说明每次切换分析维度都能发现新的深层问题
- P2 数量显著增加（35），反映工程质量债务的长尾分布
- 本轮最关键发现是 **MessagePipeline 的 interrupt 竞态**，是真实的并发 Bug，在多用户快速操作场景下必现
- **模块边界违反** 是架构层面的结构性问题，影响长期可维护性
