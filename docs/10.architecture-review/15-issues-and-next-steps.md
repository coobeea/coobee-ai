# 15 — 问题清单与改进方向（第七轮）

> 基于第七轮全新独立源码分析
>
> 分析日期：2026-02-16
> 更新日期：2026-02-16（P0/P1 修复完成）

---

## 0. 问题分级

| 级别   | 含义                  | 处理方式 |
| ------ | --------------------- | -------- |
| **P0** | 功能失效 / 安全缺陷   | 立即修   |
| **P1** | 功能缺陷 / 可靠性风险 | 尽快修   |
| **P2** | 体验 / 质量问题       | 择机修   |
| **P3** | 技术债 / 代码气味     | 积压     |

---

## 1. P0 — 关键问题

### 1.1 ✅ Abort Signal 未传递到 Runtime

- **位置**：`AgentExecutor.ts:125`
- **修复**：`ExecuteRequest` 增加 `signal?: AbortSignal`；Pipeline executor 传入 signal；`consumeAndForward` 在每次循环检测 `signal.aborted`，提前退出并调用 `gen.return()`

### 1.2 ⏬ Builtin Providers 从未加载（降级为 P2）

- **位置**：`ReadyInfraHook.ts:60`，`ProviderRegistry.ts`
- **说明**：`.env` 回退正常工作，app 功能不受影响。仅缺少模型元数据（cost/context window），属锦上添花
- **修复**：需要时在 `loadFromConfig` 中 merge builtin

### 1.3 ⏬ Extension Gateway 方法未注册到 Gateway（降级为 P3）

- **位置**：`ReadyExtensionHook.ts`
- **说明**：目前内置 Extension（memory-thread、tool-approval）均未使用 `registerGatewayMethod`，无实际消费者
- **修复**：需要时在 `ReadyExtensionHook` 中获取 Gateway 实例注册

---

## 2. P1 — 高优先级问题

### 2.1 Extension 热卸载不清理 ToolRegistry

- **位置**：`ExtensionLoader.ts:169`
- **修复**：`unload()` 中同步调用 `ToolRegistry.getInstance().unregister(toolName)`

### 2.2 ✅ ConfigStore 写入无 Schema 校验

- **位置**：`ConfigStore.ts:41-47`
- **修复**：`writeRawConfig` 写入前用 `CoobeeConfigSchema.safeParse()` 校验，失败抛异常

### 2.3 ✅ ConfigStore 解析失败返回空对象

- **位置**：`ConfigStore.ts:63-68`
- **修复**：移除 try-catch，解析失败直接抛出 `JSON5.parse` 异常

### 2.4 ✅ builderFactory 为空时前端无响应

- **位置**：`AgentExecutor.ts:128`
- **修复**：emit `run:error` 事件到 EventBus，前端可显示错误信息

### 2.5 前端 stream 监听器泄漏

- **位置**：`useStreamWs.ts`
- **修复**：在 app unmount 或组件 `onUnmounted` 时调用 `streamCleanup()`

### 2.6 Rate Limit Key 可被客户端伪造

- **位置**：`security.ts:74`
- **修复**：使用服务端生成的标识（如 WebSocket 连接 ID）代替 `clientId`

---

## 3. P2 — 中优先级问题

### 3.1 ToolExecutionPipeline 未校验 ToolResult

- **位置**：`ToolExecutionPipeline.ts:130`
- **修复**：添加 `if (!toolResult || typeof toolResult !== 'object')` 防御

### 3.2 handleSteer 缺 queuePosition

- **位置**：`MessagePipeline.ts:120`
- **修复**：返回值添加 `queuePosition: queue.length`

### 3.3 `sed` 在 SAFE_BINS 中

- **位置**：`exec-policy.ts:69`
- **修复**：将 `sed` 从 SAFE_BINS 移除（或仅允许无 `-i` 的 sed）

### 3.4 ModelFallback 重复候选检测 Bug

- **位置**：`ModelFallback.ts:95`
- **修复**：用索引比较 `i === candidates.length - 1` 代替 `indexOf`

### 3.5 前端 chat store result 为空无处理

- **位置**：`stores/chat.ts:256`
- **修复**：添加 `else` 分支，设置错误消息

### 3.6 HITL 决策失败无 UI 反馈

- **位置**：`stores/chat.ts:330`
- **修复**：catch 中更新 approval 状态为错误

### 3.7 ExtensionApi submitSingleDecision 使用 require

- **位置**：`ExtensionApi.ts:80`
- **修复**：改为 `await import()` 保持一致

### 3.8 baseUrl/wsUrl 主机名不一致

- **位置**：`renderer/config.ts:19-22`
- **修复**：统一为 `127.0.0.1` 或 `localhost`

---

## 4. P3 — 低优先级 / 技术债

### 4.1 StreamEmitter sequenceCounters 泄漏

- **位置**：`StreamEmitter.ts:84`
- **修复**：`run:done` 时清理 counter

### 4.2 ConfigWatcher.stop() 未 await close()

- **位置**：`ConfigWatcher.ts`
- **修复**：`await this.watcher.close()`

### 4.3 ExtensionHookRunner 使用 console 而非 logger

- **位置**：`ExtensionHookRunner.ts`
- **修复**：替换为 `createLogger`

### 4.4 Pipeline 测试依赖 sleep（Flaky）

- **位置**：`MessagePipeline.test.ts`
- **修复**：使用事件或 Promise 替代 sleep

### 4.5 Exec 测试包含平台特定路径

- **位置**：`builtin.test.ts:738`
- **修复**：使用 `os.tmpdir()` 构建期望值

### 4.6 memory-index 不索引子目录

- **位置**：`memory-index.ts:99`
- **修复**：使用递归扫描与 memory.ts 保持一致

### 4.7 前端完全无测试

- **建议**：优先补 chat store 和 GatewayClient 测试

---

## 5. 改进路线图

### Phase 1：关键修复（P0，预计半天）

| 任务                   | 复杂度 | 说明                                         |
| ---------------------- | ------ | -------------------------------------------- |
| Abort signal 传递      | 中     | ExecuteRequest 加 signal，forward 到 runtime |
| Builtin providers 加载 | 低     | loadFromConfig 先 merge builtinProviders     |
| Extension 方法注册     | 中     | ReadyExtensionHook 获取 Gateway 实例         |

### Phase 2：可靠性加固（P1，预计 1 天）

| 任务                        | 复杂度 | 说明                 |
| --------------------------- | ------ | -------------------- |
| ToolRegistry 热卸载清理     | 低     | unload 时 unregister |
| ConfigStore 校验 + 错误处理 | 低     | safeParse + throw    |
| builderFactory 空值处理     | 低     | emit run:error       |
| stream 监听器清理           | 低     | onUnmounted cleanup  |
| Rate limit key 修复         | 低     | 用 WebSocket conn ID |

### Phase 3：体验优化（P2，择机）

| 任务                   | 复杂度 | 说明            |
| ---------------------- | ------ | --------------- |
| ToolResult 校验        | 低     | 防御性检查      |
| steer queuePosition    | 低     | 返回值补字段    |
| sed 安全处理           | 低     | 移出 SAFE_BINS  |
| ModelFallback 索引修复 | 低     | indexOf → index |
| 前端错误处理完善       | 中     | chat store 多处 |

---

## 6. 本轮分析特点

本轮分析完全从源码出发，不参考任何历史分析文档。发现了 3 个之前遗漏的关键问题：

1. **Abort signal 完全不传递** — 之前的分析关注了 Pipeline 是否正确 abort，但忽略了 signal 从 Pipeline → Executor → Runtime 的传递链断裂
2. **Builtin providers 从未加载** — ProviderRegistry 有 `loadFromConfig` 但没有合并 builtin；之前关注的是"Provider 系统是否初始化"而非"初始化后内容是否正确"
3. **Extension gateway 方法死路** — `registerGatewayMethod` API 存在但注册的方法到不了 Gateway

这些问题的共同特点是：**接口存在且类型正确，但数据流未打通**。说明之前的分析侧重于"是否有代码"而非"代码是否被正确调用"。
