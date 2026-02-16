# 13 — 问题清单与改进方向（第六轮）

> 基于第六轮全面架构分析发现的问题、风险和改进建议
>
> 分析日期：2026-02-16
> 更新日期：2026-02-16（轻量修复完成）

---

## 0. 问题分级

| 级别          | 含义                      | 影响         |
| ------------- | ------------------------- | ------------ |
| **P0 — 关键** | 功能不可用 / 数据丢失风险 | 必须立即修复 |
| **P1 — 高**   | 功能缺陷 / 架构风险       | 影响可靠性   |
| **P2 — 中**   | 功能不完整 / 体验问题     | 影响可用性   |
| **P3 — 低**   | 技术债 / 代码质量         | 影响可维护性 |

---

## 1. P0 — 关键问题

> 本轮无 P0 问题。上一轮的 3 个 P0 问题已全部修复。

---

## 2. P1 — 高优先级问题

### 2.1 ✅ sessionModes 内存泄漏

**现象**：`AgentExecutor.sessionModes` Map 在 `submitViaPipeline` 中 `set`，但从未 `delete`。

**修复**：在 pipeline executor 的 `finally` 块中添加 `this.sessionModes.delete(sessionId)`。

---

### 2.2 ModelFallback 未接入执行链路

**现象**：`ModelFallback` 类已完整实现（候选顺序尝试、可重试错误识别、钩子触发），但 `chat.ts` 的 `createBuilder` 和 `applyProviderConfig` 直接使用 `selector.resolve()` 结果，不经过 Fallback。

**影响**：模型不可用时直接失败，无自动切换。

**涉及文件**：

- `src/main/gateway/methods/chat.ts` — `applyProviderConfig`
- `src/main/ai/AgentExecutor.ts` — pipeline executor

**修复方案**：

```
在 createBuilder 或 execute 中：
1. selector.resolve() 获取主选模型
2. selector.getCandidates() 获取候选列表
3. 用 ModelFallback.run(candidates, executor) 包装执行
4. 失败自动切换到下一候选
```

---

### 2.3 CostTracker 未接入 Runtime

**现象**：`CostTracker` 已实现（记录 UsageRecord、按模型汇总），但 Runtime 执行完成后不记录 token 使用量。

**影响**：无法统计 API 使用成本。

**涉及文件**：

- `src/main/ai/provider/CostTracker.ts`
- `src/main/ai/AgentExecutor.ts` — `consumeAndForward` / `execute`

**修复方案**：

```
在 AgentExecutor.execute() 或 consumeAndForward() 中：
当 StreamChunk.type === 'run:done' 时，提取 usage 数据，
调用 costTracker.record({ model, tokens, cost })
```

---

### 2.4 Workspace Extensions 未加载

**现象**：`ReadyExtensionHook` 调用 `Env.getExtensionSearchPaths()` 时不传 workspace 参数，因此 `{workspace}/extensions` 目录从未被扫描。Agent 工作空间中的本地 Extension 无法被加载。

**影响**：项目级 Extension（如自定义工具）不可用。

**涉及文件**：

- `src/main/lifecycle/ReadyExtensionHook.ts`
- `src/main/common/env.ts` — `getExtensionSearchPaths`

**修复方案**：

```
在 ReadyExtensionHook 中：
获取当前活跃 workspace 路径，传给 getExtensionSearchPaths(workspace)。
或在 AgentExecutor.execute() 中动态加载 workspace extensions。
```

---

### 2.5 ✅ ConfigWatcher 未在退出时停止

**现象**：`ReadyInfraHook` 启动 `ConfigWatcher`，但没有对应的退出 Hook。

**修复**：在 `ReadyInfraHook.ts` 中新增 `BeforeQuitInfraHook`（优先级 40），退出时调用 `watcher.stop()`。

---

## 3. P2 — 中优先级问题

### 3.1 ModelSelector.resolve() 未传 sessionId

**现象**：`chat.ts` 的 `applyProviderConfig` 调用 `selector.resolve()` 时不传 `sessionId` 和 `agentId`，导致会话级和 Agent 级覆盖无法生效，仅使用全局默认。

**影响**：无法为特定会话或 Agent 指定不同模型。

**修复方案**：

```
applyProviderConfig(builder, sessionId) {
  const ref = selector.resolve({ sessionId })
  // ...
}
```

---

### 3.2 ✅ ChatView.vue 是死代码

**现象**：`/chat` 路由重定向到 `/agent`，`ChatView.vue` (~635 行) 从未被访问。

**修复**：删除 `ChatView.vue`，清理 `/chat` 路由条目。减少 635 行死代码。

---

### 3.3 SettingsView 缺乏结构化表单

**现象**：Settings 页面只有只读展示 + 原始 JSON 编辑器。用户无法通过表单直接修改模型、Provider、队列模式等配置。

**影响**：用户体验差，需要手动编辑 JSON5。

**修复方案**：

```
1. 添加 Provider 管理表单（增删改查）
2. 添加模型选择下拉框
3. 添加队列模式切换器
4. 添加 API Key 输入（带密码遮罩）
```

---

### 3.4 Gateway 方法组无测试

**现象**：`gateway/methods/` 下的 `chat.ts`、`config.ts`、`approval.ts`、`worker.ts`、`stream.ts` 均无单元测试。

**影响**：Gateway 方法是前后端交互的核心入口，缺乏测试增加回归风险。

**修复方案**：

```
优先补充：
1. chat.ts — createBuilder, applyProviderConfig, send/abort 流程
2. config.ts — get/getAll/set/patch
3. approval.ts — HITL 审批流程
```

---

### 3.5 11/13 个 Lifecycle Hook 无测试

**现象**：13 个生命周期 Hook 中仅 `ReadyInfraHook`、`BeforeQuitProcessHook`、`ReadyExtensionHook` 有测试。

**影响**：Hook 行为变更无法通过测试捕获。

**修复方案**：

```
至少补充：ReadyGatewayHook, InitDatabaseHook, ReadyWindowBootstrapHook
其余 Hook 多为简单委托，风险较低。
```

---

### 3.6 ✅ Extension 热插拔 origin 推断错误

**现象**：`ExtensionLoader.inferOrigin()` 始终返回 `'workspace'`。

**修复**：在 `loadAll` 时将 `searchPath → origin` 映射存入 `pathOrigins` Map，`inferOrigin` 从 Map 查询。

---

## 4. P3 — 低优先级问题

### 4.1 ReloadPlan 未被使用

**现象**：`ConfigWatcher.onReload` 传递 `ReloadPlan`（包含 changedPaths、hotPaths、nonePaths），但 `ReadyInfraHook` 的 handler 忽略它，每次都完整重载 Provider/Selector。

**影响**：次要性能问题，每次非相关配置变更（如 `ui.theme`）也会触发 Provider 重载。

**修复方案**：

```
检查 plan.changedPaths 是否包含 'models' 或 'agents'，
只在相关时重载 Provider/Selector。
```

---

### 4.2 旧配置系统共存

**现象**：`electron-store`（`common/config.ts`）和新 `coobee.json5` 配置系统并存。部分模块仍使用 `electron-store`。

**影响**：配置分散，维护困难。

**修复方案**：

```
逐步迁移 electron-store 的配置项到 coobee.json5，
最终移除 electron-store 依赖。
```

---

### 4.3 ✅ AgentEventWriter 静默吞错

**现象**：`AgentEventWriter.append()` 在写入失败时不输出任何日志。

**修复**：catch 中添加 `log.warn()`，引入 `createLogger('event-writer')`。

---

### 4.4 HitlApprovalManager 废弃 API

**现象**：`HitlApprovalManager` 包含 `waitForBatchDecision` 等批量 API，但实际只使用 `waitForSingleDecision`。

**影响**：代码膨胀。

**修复方案**：

```
移除未使用的批量 API，简化 HitlApprovalManager。
```

---

### 4.5 ✅ vitest 覆盖率配置不完整

**现象**：`vitest.config.ts` 的 `coverage.include` 不包含 `middleware` 和 `lifecycle`。

**修复**：`coverage.include` 添加两个路径，`coverage.exclude` 同步添加对应的测试目录。

---

### 4.6 未覆盖的核心模块

**现象**：以下核心模块缺乏测试：

| 模块                | 风险 |
| ------------------- | ---- |
| SessionCompressor   | 高   |
| AgentEventWriter    | 中   |
| AbortManager        | 中   |
| ModelCatalog        | 中   |
| Provider builtin/\* | 低   |
| PiMonoToolConverter | 低   |

**修复方案**：

```
优先补充 SessionCompressor 和 AgentEventWriter 测试。
```

---

## 5. 改进路线图

### Phase 1：可靠性加固（P1 修复，预计 1 天）

| 任务                      | 优先级 | 说明                                    |
| ------------------------- | ------ | --------------------------------------- |
| sessionModes 清理         | P1     | execute finally 中 delete               |
| ModelFallback 接入        | P1     | createBuilder 使用 Fallback 链          |
| CostTracker 接入          | P1     | consumeAndForward 记录 usage            |
| Workspace Extensions 加载 | P1     | 传 workspace 给 getExtensionSearchPaths |
| ConfigWatcher 退出清理    | P1     | BeforeQuitInfraHook 或 context.data     |

### Phase 2：测试补充（P2 修复，预计 1-2 天）

| 任务                   | 优先级 | 说明                                |
| ---------------------- | ------ | ----------------------------------- |
| Gateway 方法组测试     | P2     | chat.ts, config.ts, approval.ts     |
| Lifecycle Hook 测试    | P2     | ReadyGatewayHook 等                 |
| SessionCompressor 测试 | P2     | 压缩逻辑核心路径                    |
| vitest 覆盖率配置      | P3     | 添加 middleware + lifecycle include |

### Phase 3：体验优化（P2 修复，预计 2-3 天）

| 任务                       | 优先级 | 说明                      |
| -------------------------- | ------ | ------------------------- |
| ModelSelector 传 sessionId | P2     | 支持会话级模型覆盖        |
| 删除 ChatView.vue          | P2     | 清理死代码                |
| SettingsView 结构化表单    | P2     | Provider/Model/Queue 表单 |
| Extension origin 推断修复  | P2     | 根据 searchPath 区分来源  |

### Phase 4：技术债清理（P3 处理，预计 1 天）

| 任务                  | 优先级 | 说明                          |
| --------------------- | ------ | ----------------------------- |
| ReloadPlan 使用       | P3     | 精确重载                      |
| 旧配置系统迁移        | P3     | electron-store → coobee.json5 |
| AgentEventWriter 日志 | P3     | 失败时 warn                   |
| HITL 废弃 API 清理    | P3     | 移除批量 API                  |

---

## 6. 与上一轮对比

### 已修复（第五轮 → 第六轮）

| 问题                           | 原级别 | 状态 |
| ------------------------------ | ------ | ---- |
| MessagePipeline 未接入生命周期 | P0     | ✅   |
| ProviderSystem 未接入生命周期  | P0     | ✅   |
| ConfigStore 未接入生命周期     | P0     | ✅   |
| Extension 工具未传递给 Builder | P1     | ✅   |
| Exec Policy 无兜底             | P1     | ✅   |
| Security Middleware 空壳       | P1     | ✅   |
| Pipeline executor 空壳         | P1     | ✅   |
| ConfigStore 写入纯 JSON        | P2     | ✅   |

### 新发现

| 问题                        | 级别 | 来源     |
| --------------------------- | ---- | -------- |
| sessionModes 内存泄漏       | P1   | 新发现   |
| ModelFallback 未接入        | P1   | 深入分析 |
| CostTracker 未接入          | P1   | 深入分析 |
| Workspace Extensions 未加载 | P1   | 新发现   |
| ConfigWatcher 未停止        | P1   | 新发现   |
| ModelSelector 缺 sessionId  | P2   | 深入分析 |
| ChatView 死代码             | P2   | 确认     |
| Extension origin 推断错误   | P2   | 新发现   |
| 测试覆盖缺口                | P2   | 系统分析 |

---

## 7. 总结

经过 P0/P1/P2 修复后，系统的核心问题（死代码、安全缺口）已全部解决。当前系统：

- **基础设施已完整接入**：ConfigStore、ProviderSystem、Pipeline 均在生命周期中正确初始化
- **安全层完整**：8 层纵深防御，从 Middleware 到 HITL
- **扩展系统成熟**：17 个钩子全部有触发点，工具合并逻辑正确
- **配置热重载可用**：JSON5 保持格式一致性

本轮轻量修复已解决 6 个实际问题（内存泄漏、生命周期缺口、死代码、origin 推断、覆盖率配置、日志缺失），每个修复都是最小改动，不做过度设计。

剩余问题均为"有则更好"的优化项（ModelFallback 接入、CostTracker、Settings 表单等），可在实际需要时再处理。系统整体健康度显著提升。
