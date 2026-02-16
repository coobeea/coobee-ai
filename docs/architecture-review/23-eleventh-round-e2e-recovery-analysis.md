# 第十一轮架构分析 — 端到端场景走查 + 错误传播与恢复

> 日期: 2026-02-12
> 维度: D-1 端到端场景走查 / D-5 错误传播与恢复
> 方法: 4 Agent 并行分析

---

## 一、分析覆盖

| Agent | 分析范围                             | 发现             |
| ----- | ------------------------------------ | ---------------- |
| 1     | 首次启动→首次对话                    | P0×1, P1×2, P2×2 |
| 2     | 多轮对话+工具调用+HITL+流式输出      | P0×1, P1×2, P2×4 |
| 3     | LLM API 错误+配置错误+Runtime 错误   | P0×2, P1×0, P2×0 |
| 4     | Extension Hook+生命周期+Gateway+工具 | P0×2, P1×3, P2×5 |

---

## 二、P0 问题汇总（5 个，去重后）

### E-1: HttpServer 端口占用无 error 监听

**位置**: `src/main/common/server/httpServer.ts` L672-682
**现象**: `httpServer.listen()` 只有成功回调，未监听 `error` 事件
**后果**: 端口被占用时 EADDRINUSE 未被捕获，应用闪退无任何提示
**修复**: 添加 `this.httpServer.on('error', handler)`

### E-2: WebSocket 重连后不补发历史消息

**位置**: `src/renderer/src/composables/useStreamWs.ts`
**现象**: 重连后只调用 `stream.subscribe`，未调用 `stream.resend` 补发断连期间的消息
**后果**: 断连期间的流式消息永久丢失，用户看到不完整的回复
**修复**: 重连后根据本地最新 sequence 调用 `stream.resend` 补发

### E-3: Lifecycle Hook 无超时保护

**位置**: `src/main/common/lifecycle.ts` L185-206
**现象**: `executeHook` 直接 `await hook.execute()`，无超时
**后果**: Hook 长时间挂起会导致启动或退出卡住
**修复**: 使用 `Promise.race` 添加超时

### E-4: 运行中删除 coobee.json5 不自动重建

**位置**: `src/main/common/config/ConfigLoader.ts` L71-74
**现象**: 配置文件被删除后返回默认配置，不触发自动重建
**后果**: 用户之前的配置丢失，且无提示
**修复**: ConfigWatcher 检测到文件删除时调用 `ensureConfigFile()`

### E-5: 配置文件权限不足无处理

**位置**: `src/main/common/config/ConfigLoader.ts` L76
**现象**: `readFileSync` 遇到 EACCES 直接抛出，无 catch
**后果**: 可能导致启动失败或功能异常
**修复**: snapshot() 中 catch 权限错误并返回合理降级

---

## 三、P1 问题汇总（7 个）

| ID   | 问题                                               | 位置                                          |
| ---- | -------------------------------------------------- | --------------------------------------------- |
| E-6  | uncaughtException 直接 process.exit(1)，无资源清理 | `src/main/index.ts` L7-18                     |
| E-7  | 工具执行未传 AbortSignal                           | `OpenAIAgentRuntime.convertTools`             |
| E-8  | Extension 注册无效 Hook 名无警告                   | `ExtensionRegistry.registerHook`              |
| E-9  | ReadyInfraHook 失败不阻断启动                      | `src/main/lifecycle/`                         |
| E-10 | streamResend 未处理响应                            | `src/renderer/src/composables/useStreamWs.ts` |
| E-11 | 无 Provider 选择时 fallback 不直观                 | `chat.ts` gateway method                      |
| E-12 | 工具返回非法结果无校验                             | `ToolExecutionPipeline` L130-135              |

---

## 四、恢复能力评估

| 场景                    | 可恢复 | 备注                         |
| ----------------------- | ------ | ---------------------------- |
| LLM API 400/401/429/500 | ✅     | 有错误透传和重试             |
| 网络超时                | ✅     | 有重试策略                   |
| 流式中断                | ✅     | 已输出内容保留               |
| 配置文件损坏            | ⚠️     | 降级为默认配置（非上次有效） |
| 配置文件被删            | ❌     | 不自动重建                   |
| build() 失败            | ✅     | 错误传到前端                 |
| Runtime 执行失败        | ✅     | destroyRuntime 保证清理      |
| Extension Hook 失败     | ✅     | 各 Hook 已隔离               |
| 端口被占用              | ❌     | 可能闪退                     |
| Hook 超时               | ❌     | 可能卡住                     |

---

## 五、与历轮对比

| 轮次   | 维度            | P0    | P1    | P2     | 特征                  |
| ------ | --------------- | ----- | ----- | ------ | --------------------- |
| 9      | 横切面          | 3     | 7     | 5      | 隐藏 Bug              |
| 10     | 契约/边界/时序  | 7     | 19    | 35     | 竞态+结构             |
| **11** | **端到端+恢复** | **5** | **7** | **11** | **链路断裂+恢复缺失** |

**趋势**: 问题从"代码层面"上升到"用户场景层面"，P0 数量收敛但每个都是真实用户可感知的问题。
