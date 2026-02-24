# 14 — 第七轮全新架构分析

> 完全从源码出发的独立分析，不参考任何历史文档
>
> 分析日期：2026-02-16

---

## 1. 核心执行流问题

### 1.1 Abort Signal 未传递到 Runtime（关键）

**文件**：`src/main/ai/AgentExecutor.ts` 第 125 行

Pipeline executor 接收 `signal` 参数但标记为 `_signal` 直接忽略：

```typescript
this.pipeline = new MessagePipeline(async (sessionId, message, _signal) => {
```

`ExecuteRequest` 接口中没有 `signal` 字段，`execute()` 不接受它，`runtime.stream()` 也不接收。

**后果**：用户点击中止后，Agent 仍在后台运行并继续输出流式事件。Abort 仅清理了 Pipeline 状态，实际执行没有停止。

---

### 1.2 builderFactory 为空时静默无响应

**文件**：`src/main/ai/AgentExecutor.ts` 第 128-131 行

```typescript
if (!this.builderFactory) {
  log.error(`[AgentExecutor] Pipeline executor: no builderFactory registered`);
  return;
}
```

仅打日志，不发射任何流事件。前端已发送消息、UI 显示了用户消息，但永远收不到响应。

---

### 1.3 ToolExecutionPipeline 未校验 ToolResult

**文件**：`src/main/ai/runtime/shared/ToolExecutionPipeline.ts` 第 130 行

```typescript
const toolResult = iterResult.value
let resultText = toolResult.llmContent || ...
```

如果工具返回 `undefined` 或非标准对象，直接崩溃。缺少防御性检查。

---

### 1.4 StreamEmitter sequenceCounters 泄漏

**文件**：`src/main/ai/streaming/StreamEmitter.ts` 第 84 行

`sequenceCounters` 以 `sessionId` 为键，永不清理。长时间运行累积条目。

---

### 1.5 handleSteer 缺少 queuePosition

**文件**：`src/main/ai/pipeline/MessagePipeline.ts` 第 120-131 行

`handleSteer` 返回 `{ status: 'merged', sessionId }` 没有 `queuePosition`，但前端使用 `result.queuePosition ?? 1` 显示队列位置，导致显示不准确。

---

## 2. 配置系统问题

### 2.1 Builtin Providers 从未加载（关键）

**文件**：`src/main/lifecycle/ReadyInfraHook.ts` 第 60-65 行，`src/main/ai/provider/ProviderRegistry.ts`

`ProviderRegistry.loadFromConfig()` 仅加载 `config.models.providers`。`builtin/` 目录下的 4 个预置 Provider（openai, anthropic, aliyun, minimax）从未被合并。

默认配置 `providers: {}`，所以 Registry 为空。`chat.ts` 的 `applyProviderConfig` 回退到 `.env`，但模型元数据（cost、context window）全部丢失。

---

### 2.2 ConfigStore 写入前无 Schema 校验

**文件**：`src/main/common/config/ConfigStore.ts` 第 41-47 行

`set()` 和 `patch()` 直接写磁盘，不经过 Zod 校验。前端传入畸形数据会破坏配置文件。

---

### 2.3 ConfigStore 解析失败返回空对象

**文件**：`src/main/common/config/ConfigStore.ts` 第 63-68 行

`JSON5.parse(raw)` 失败时 `readRawConfig()` 返回 `{}`，用空对象覆盖原始内容 → 数据丢失。

---

### 2.4 ConfigWatcher.stop() 未 await close()

**文件**：`src/main/common/config/ConfigWatcher.ts`

Chokidar 的 `close()` 返回 Promise，但调用方使用 `void this.watcher.close()` 不等待完成。

---

### 2.5 ModelFallback 重复候选检测 Bug

**文件**：`src/main/ai/provider/ModelFallback.ts` 第 95-97 行

用 `candidates.indexOf(candidate) === candidates.length - 1` 判断是否为最后一个候选。当存在重复时，`indexOf` 总是返回第一个，导致最后一个不被识别，错误被掩盖。

---

## 3. Extension 系统问题

### 3.1 Extension Gateway 方法从未注册到 Gateway（关键）

**文件**：`ReadyExtensionHook.ts`，`ExtensionRegistry.ts`，`Gateway.ts`

`api.registerGatewayMethod()` 将方法存入 `ExtensionRegistry`，但 `ReadyExtensionHook` 只注入了工具到 `ToolRegistry`，从未将 Extension 方法注册到 Gateway。`ReadyGatewayHook` 本地创建 Gateway 且未暴露实例。

**后果**：Extension 的 `registerGatewayMethod` 调用无效，RPC 方法不可调用。

---

### 3.2 Extension 热卸载不清理 ToolRegistry

**文件**：`src/main/common/extension/ExtensionLoader.ts` 第 169-174 行

`unload()` 只调用 `registry.unregisterAll()`（ExtensionRegistry），不调用 `ToolRegistry.unregister()`。

**后果**：Extension 卸载后，其工具仍可被调用，直到应用重启。

---

### 3.3 ExtensionApi.submitSingleDecision 使用 require

**文件**：`src/main/common/extension/ExtensionApi.ts` 第 80-85 行

`waitForSingleDecision` 和 `cleanupSession` 用 `await import()`，但 `submitSingleDecision` 用 `require()`。ESM/CJS 混用可能导致加载不一致。

---

## 4. 安全问题

### 4.1 Rate Limit Key 可被客户端伪造

**文件**：`src/main/common/middleware/security.ts` 第 74-76 行

```typescript
const clientKey = (metadata?.clientId as string) || 'default';
```

`clientId` 来自客户端 metadata，可随意更换绕过限速。

---

### 4.2 `sed` 在 SAFE_BINS 中可修改文件

**文件**：`src/main/ai/sandbox/exec-policy.ts` 第 69-70 行

`sed` 被列为安全命令，但 `sed -i 's/foo/bar/' file` 可以修改文件内容，绕过 HITL 审批。

---

## 5. 前端问题

### 5.1 Stream 事件监听器泄漏

**文件**：`src/renderer/src/composables/useStreamWs.ts`

`gateway.on('stream.message', ...)` 等监听器在模块加载时注册，`streamCleanup()` 存在但从未被调用。应用退出时监听器不会被清理。

---

### 5.2 前端 chat store 结果为空时无处理

**文件**：`src/renderer/src/stores/chat.ts` 第 256-289 行

`gateway.request()` 返回 null/undefined 时，用户消息已添加但 `sessionId`、`queueStatus`、`streamSubscribe` 都不会设置。UI 卡死。

---

### 5.3 HITL 决策失败无 UI 反馈

**文件**：`src/renderer/src/stores/chat.ts` 第 330-334 行

`submitDecision` 捕获错误只 `console.error`，用户看不到失败提示。

---

### 5.4 abort 失败后本地状态不一致

**文件**：`src/renderer/src/stores/chat.ts` 第 354-356 行

`abortSession` 乐观更新 `lastMsg.status` 和 `isStreaming`，但后端 abort 失败时本地状态与服务端不同步。

---

### 5.5 baseUrl 与 wsUrl 主机名不一致

**文件**：`src/renderer/src/config.ts` 第 19-22 行

HTTP 用 `127.0.0.1`，WebSocket 用 `localhost`。在某些环境下解析为不同地址。

---

## 6. 测试质量问题

### 6.1 Pipeline 测试依赖 sleep（Flaky）

**文件**：`src/main/ai/pipeline/__tests__/MessagePipeline.test.ts` 第 85-128 行

使用 `await sleep(500)` 等待异步操作完成，在慢速 CI 上可能不稳定。

---

### 6.2 Exec 测试包含平台特定路径

**文件**：`src/main/ai/tools/__tests__/builtin.test.ts` 第 738-748 行

```typescript
expect(result.llmContent).toMatch(/\/tmp|\/private\/tmp/);
```

macOS 特定，在 Linux/Windows 上会失败。

---

### 6.3 前端完全无测试

`src/renderer/` 下没有任何单元测试。chat store、GatewayClient、ChatPanel 等核心模块无覆盖。

---

### 6.4 过度 Mock 导致测试空心化

- `Gateway.test.ts`：GatewayServer 完全 mock，只测了 Gateway 调用 mock
- `StreamStore.test.ts`：SQLiteService 完全 mock
- `AgentExecutor.test.ts`：多个核心依赖 mock

测试验证的是 mock 的行为而非真实逻辑。
