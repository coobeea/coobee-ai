# 第十轮 — 问题清单与下一步

> 日期: 2026-02-12
> 来源: 20-tenth-round-contract-boundary-analysis.md
> 维度: 契约 / 边界 / 时序 / 可观测性

---

## 一、P0 问题（7个）

### T-1: doExecute cleanup 与 isAborted 顺序错误

**位置**: `src/main/ai/pipeline/MessagePipeline.ts` L170-174
**现象**: finally 中先 `cleanup(sessionId)` 清除 abortedSessions，再检查 `isAborted(sessionId)`
**后果**: abort 后 isAborted 返回 false，仍执行 drainQueue
**修复**: 在 cleanup 前保存 `wasAborted = isAborted(sessionId)`

---

### T-2: 旧 run 的 cleanup 删除新 run 的 controller

**位置**: `src/main/ai/pipeline/MessagePipeline.ts` L111-118, L170
**现象**: interrupt 时旧 run 的 finally 调用 cleanup 删除新 run 的 controller
**后果**: 新 run 无法被 abort
**修复**: 引入 runId，cleanup 时校验是否为当前 run

---

### T-3: 旧 run 的 finally 覆盖 queue.isRunning

**位置**: `src/main/ai/pipeline/MessagePipeline.ts` L179-180
**现象**: 旧 run 后完成时覆盖 isRunning=false，新 run 仍在执行
**后果**: 同一 session 出现并发执行
**修复**: 与 T-2 一起修复，仅当前 run 才更新 isRunning

---

### B-1: common/extension 依赖 ai（ToolDefinition）

**位置**: `src/main/common/extension/types.ts` L8
**现象**: common 层 import ai 层的 ToolDefinition
**后果**: 分层违反，common 与 ai 双向耦合
**修复**: 将 ToolDefinition 移到 shared 层

---

### B-2: common/extension 依赖 gateway（MethodHandler）

**位置**: `src/main/common/extension/types.ts` L9
**现象**: common 层 import gateway 层的 MethodHandler
**后果**: 分层违反
**修复**: 将 MethodHandler 类型定义移到 shared 层

---

### B-3: common/extension 运行时依赖 ai（hitl, streaming）

**位置**: `src/main/common/extension/ExtensionApi.ts` L77-88, L94-101
**现象**: dynamic import ai/hitl 和 ai/streaming
**后果**: common 与 ai 强耦合
**修复**: 通过依赖注入，在 lifecycle 初始化时注入实现

---

### O-1: AgentExecutor 错误日志丢失 stack trace

**位置**: `src/main/ai/AgentExecutor.ts` L346-347, L556-558
**现象**: log.error 传了 error.message 字符串而非 error 对象
**后果**: electron-log 无法输出 stack trace
**修复**: 将 error 对象作为第二参数传入 log.error

---

## 二、P1 问题（19个）

| ID  | 维度   | 问题                                            | 修复方案                                                 |
| --- | ------ | ----------------------------------------------- | -------------------------------------------------------- |
| C-1 | 契约   | Gateway params 用 as 强转无校验                 | 为每个方法定义 Zod schema                                |
| C-2 | 契约   | Gateway 错误处理不一致(return vs throw)         | 统一为 throw GatewayMethodError                          |
| C-3 | 契约   | Tool context 类型与 ToolExecutionContext 不符   | 统一使用 ToolExecutionContext                            |
| C-4 | 契约   | Tool params 未做 Zod 运行时校验                 | Runtime 调用前统一 parse                                 |
| B-4 | 边界   | gateway 直接操作 ai/streamStore                 | ai 层提供封装接口                                        |
| B-5 | 边界   | configStoreInstance 可变全局导出                | 封装为 getConfigStore()                                  |
| B-6 | 边界   | cronJobManager 未初始化                         | 在 lifecycle 中显式调用或移除                            |
| B-7 | 边界   | gateway 绕过 streaming/index 直接引用 consumers | 改为从 index 导入                                        |
| T-4 | 时序   | drainQueue 期间不检查 abort                     | 每条消息后检查 isAborted                                 |
| T-5 | 时序   | doExecute catch 未 emit run:error               | catch 中 emit StreamEventType.ERROR                      |
| T-6 | 时序   | EventBus emit 同步，listener 抛错冒泡           | emit 中 try-catch 包裹每个 listener                      |
| O-2 | 可观测 | ConfigWatcher 回调空 catch 无日志               | 增加 log.warn                                            |
| O-3 | 可观测 | Gateway JSON 解析错误未记录详情                 | 增加 log.warn                                            |
| O-4 | 可观测 | ExtensionLoader 用 console 而非 log             | 改为 @main/common/logger                                 |
| O-5 | 可观测 | Runtime 层用 console 而非 log                   | 改为 @main/common/logger                                 |
| O-6 | 可观测 | StreamMonitor 未通过 Gateway 暴露               | 注册 stream.getStats 方法                                |
| O-7 | 可观测 | Tools 错误返回格式不统一                        | 统一为 { success, llmContent, error: { code, message } } |
| O-8 | 可观测 | destroyRuntime catch 丢失 stack trace           | 传 error 对象而非字符串                                  |
| O-9 | 可观测 | stateManager catch 空                           | 增加 log.warn                                            |

---

## 三、P2 问题（35个，按类型聚合）

| 类型               | 数量 | 代表性问题                            |
| ------------------ | ---- | ------------------------------------- |
| 契约返回格式不一致 | 6    | Gateway 成功返回结构不统一            |
| IPC 契约不一致     | 3    | Tab 用 IpcResult，其他返回 null       |
| Tool 错误格式      | 3    | 部分缺 error.code                     |
| Builder 校验不足   | 2    | model 未显式校验                      |
| 全局单例           | 4    | agentExecutor, hitlApprovalManager 等 |
| index.ts 路径      | 3    | 绕过 index 直接引用内部文件           |
| Promise/async      | 3    | fire-and-forget hook, watcher.close   |
| 日志格式/覆盖      | 6    | 无前缀、ConfigLoader 无日志           |
| 其他               | 5    | 队列 TTL、测试边界                    |

---

## 四、建议修复顺序

### 阶段 1: 时序竞态修复（T-1 + T-2 + T-3）

最高优先级。这三个问题互相关联，需一并修复。
**方案**: 在 MessagePipeline 中引入 `currentRunId` 概念，每次 `executeWithLifecycle` 分配新 runId，cleanup/isRunning 更新时校验 runId。

### 阶段 2: 可观测性快速修复（O-1 + O-2 + O-4 + O-5）

改动小、收益大。主要是把 error.message 改为 error 对象、空 catch 加日志、console 改 log。

### 阶段 3: 模块边界（B-1 + B-2）

将 ToolDefinition 和 MethodHandler 类型移到 shared 层，消除 common 对 ai/gateway 的反向依赖。

### 阶段 4: 其余 P1

按优先级逐步处理。

---

## 五、趋势分析（10 轮累计）

| 维度类型                  | 已做轮次 | 特点                          |
| ------------------------- | -------- | ----------------------------- |
| 子系统纵向                | 5-8      | 功能缺失 → 深层一致性         |
| 横切面                    | 9        | 安全/韧性/质量/性能           |
| **契约/边界/时序/可观测** | **10**   | **架构健康度 + 运行时正确性** |

**核心结论**:

- **时序竞态**是最危险的问题类型——它不会在单测中暴露，需要特定并发场景才触发
- **模块边界违反**虽然不是运行时 Bug，但会加速架构腐化
- **可观测性缺失**不会导致功能异常，但会极大增加排查成本
- 建议下一轮分析从「**用户场景端到端**」维度出发，模拟真实操作路径验证完整性
