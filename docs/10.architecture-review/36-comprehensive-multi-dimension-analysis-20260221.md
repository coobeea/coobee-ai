# 第三十六轮 — 全面多维度代码质量与架构分析报告

> 编号：36 | 日期：2026-02-21 | 类型：八维度深度分析
> 方法：SemanticSearch + Grep 代码走查 + 交叉验证
> 参考：34-four-dimension-architecture-analysis.md、35-next-improvement-roadmap.md

---

## 1. 执行摘要（Executive Summary）

本报告对 coobee-ai 项目进行了 8 个维度的深度分析，覆盖架构设计、并发安全、内存管理、错误处理、Extension 系统、测试覆盖、性能优化和安全性。结合第三十四轮已有发现，本次分析新增发现若干问题，并验证了部分历史问题的修复状态。

**核心发现：**

- **Extension 系统**：任务级加载机制设计合理，但 `loadWorkspaceExtensions` 与全局 Extension 共享 `loadedExtensions` Map，存在 workspace Extension 覆盖 builtin 的同 ID 冲突风险。
- **并发安全**：`ThreadWaker` 存在 **P0 级** EventBus 监听器泄漏（`bind(this)` 导致 `removeListener` 失效）；`SessionQueue` 和 `ToolExecutionPipeline` 的 ID 生成器已引入互斥锁，竞态问题已缓解。
- **内存管理**：`StreamBridge`、`ThreadBridge`、`eventBroadcaster` 等 EventBridge 在 Gateway 关闭时**未清理** EventBus 监听器，存在泄漏。
- **安全性**：`files.ts` 的 `isPathSafe` 在 Windows 下存在**路径前缀绕过**风险（`C:\workspace`.startsWith(`C:\workspace`) 为 true，但 `C:\workspaces-evil` 也可能通过）。
- **测试覆盖**：94 个测试文件通过，62 个测试跳过（多为集成测试），核心模块覆盖率尚可，但 `AgentEnvInjector`、`ToolExecutionPipeline` 核心路径、`HitlApprovalManager` 清理逻辑等仍有缺口。

**问题统计：** P0 级 4 个 | P1 级 12 个 | P2 级 10 个

---

## 2. 各维度详细分析

### 2.1 架构设计维度

#### 2.1.1 模块职责

| 模块                                          | 职责                                                | 评价                    |
| --------------------------------------------- | --------------------------------------------------- | ----------------------- |
| ExtensionLoader                               | 扫描、加载、热重载 Extension                        | ✅ 清晰                 |
| ExtensionRegistry                             | 管理 hooks、tools、gatewayMethods、skillDirs        | ✅ 清晰                 |
| ExtensionManager                              | 全局单例，提供 Registry/HookRunner/Loader 访问      | ✅ 清晰                 |
| AgentExecutor                                 | 执行调度、busy 锁、Builder 工厂、Extension 生命周期 | ⚠️ 职责较多，但边界清晰 |
| MessagePipeline                               | 排队、合并、中断、runId 竞态防护                    | ✅ 清晰                 |
| ThreadStore / CheckpointManager / ThreadWaker | 状态持久化、检查点、唤醒恢复                        | ✅ 职责分离合理         |

#### 2.1.2 依赖关系

- **Extension 系统**：`ExtensionLoader` → `ExtensionRegistry`，`ExtensionManager` 持有两者，无循环依赖。
- **AgentExecutor**：依赖 `ExtensionManager`（动态 import），`MessagePipeline`，`CheckpointManager`，`ThreadStore`（动态 import），依赖方向合理。
- **潜在问题**：`AgentExecutor` 在 `execute()` 和 `stream()` 中重复导入 `ExtensionManager`，可考虑在构造函数或初始化阶段注入，减少运行时依赖。

#### 2.1.3 接口设计

- **Extension API**：`createExtensionApi()` 提供 `on`、`registerTool`、`registerGatewayMethod` 等，接口稳定。
- **Hook 执行**：`ExtensionHookRunner.runVoidHook` / `runModifyingHook` 区分旁听型与拦截型，设计合理。
- **Gateway 协议**：`stream.subscribe`、`chat.send` 等 RPC 方法命名清晰，`PROTECTED_NAMESPACES` 防止 Extension 覆盖核心命名空间。

#### 2.1.4 扩展机制

- **任务级 Extension**：`loadWorkspaceExtensions(threadId)` / `unloadWorkspaceExtensions(threadId)` 在任务开始/结束时调用，实现任务级隔离。
- **风险**：workspace Extension 与 builtin/user Extension 共享 `loadedExtensions` Map。若 workspace 下存在与 builtin 同 ID 的 Extension，会先 `unload` 再 `load`，可能导致 builtin 能力被临时替换，需在文档中明确「workspace Extension ID 不应与 builtin 冲突」。

---

### 2.2 并发安全维度

#### 2.2.1 已修复/缓解的问题

| 问题                                  | 状态      | 说明                                                  |
| ------------------------------------- | --------- | ----------------------------------------------------- |
| SessionQueue Message ID 竞态          | ✅ 已修复 | `generateMessageId()` 使用 `messageCounterMutex` 互斥 |
| ToolExecutionPipeline approvalId 竞态 | ✅ 已修复 | `getNextApprovalIndex()` 使用 `approvalCounterMutex`  |
| MessagePipeline runId 竞态            | ✅ 已修复 | `allocateRunId()` 使用 `runIdMutex`                   |
| WorkerCoordinator error 状态泄漏      | ✅ 已修复 | catch 中重置为 `idle`，便于回收                       |

#### 2.2.2 仍存在的问题

**P0-1: ThreadWaker EventBus 监听器无法移除（内存泄漏 + 重复执行）**

- **位置**：`src/main/ai/threads/ThreadWaker.ts:70, 80`
- **问题**：`eventBus.on('thread:wake', this.handleWake.bind(this))` 与 `eventBus.removeListener('thread:wake', this.handleWake.bind(this))` 中，`bind(this)` 每次调用产生**新函数引用**，`removeListener` 无法匹配，导致监听器永远无法移除。
- **影响**：`ThreadWaker.stop()` 无效；若多次 `start()`/`stop()`，会累积多个监听器；应用退出时可能重复处理唤醒事件。
- **修复建议**：保存 bound 引用，与 `WorkspaceFileWatcher` 模式一致：

```typescript
private boundHandleWake = this.handleWake.bind(this);

start(): void {
  if (this.listening) return;
  eventBus.on('thread:wake', this.boundHandleWake);
  this.listening = true;
}

stop(): void {
  if (!this.listening) return;
  eventBus.removeListener('thread:wake', this.boundHandleWake);
  this.listening = false;
}
```

**P1-1: ConcurrencyManager runningCount 异常路径漏减**

- **位置**：`src/main/ai/swarm/ConcurrencyManager.ts:159-166`
- **问题**：`executePhase` 中 `executeSingleTask` 通过 `.then().then()` 链式调用，若 `results.push(result)` 或 `executing.splice` 抛错，`finally` 中的 `runningCount--` 仍会执行，但若 `runtime.run(input)` 在 `try` 内抛出且未被正确传播，需确认 `finally` 覆盖所有路径。经检查，`executeSingleTask` 的 `finally` 会执行，`runningCount` 会减。但 `executePhase` 中 `Promise.race(executing)` 若 reject 且未 catch，可能导致 `executePhase` 提前退出而部分任务未完成，此时 `runningCount` 可能不一致。
- **建议**：为 `executePhase` 的 `promise` 链增加 `.catch()`，确保异常时也能正确清理。

**P1-2: HitlApprovalManager 遍历中变异 Map**

- **位置**：`src/main/ai/hitl/HitlApprovalManager.ts:282-287`
- **问题**：`cleanupBySessionPrefix` 中 `for (const [approvalId, entry] of this.singlePending)` 遍历时调用 `this.singlePending.delete(approvalId)`，在部分 JS 引擎中可能引发未定义行为。
- **建议**：先收集要删除的 key，再批量 delete：`const toDelete = [...]; toDelete.forEach(k => this.singlePending.delete(k));`

---

### 2.3 内存管理维度

#### 2.3.1 资源清理

| 组件                 | 清理机制                                                      | 评价                          |
| -------------------- | ------------------------------------------------------------- | ----------------------------- |
| ExtensionLoader      | `stopWatch()` 关闭 watchers、清除 debounceTimers              | ✅ 完整                       |
| WorkspaceFileWatcher | `stop()` 移除 EventBus 监听，`stopAll()` 关闭所有 watcher     | ✅ 完整（使用 boundHandlers） |
| GatewayServer        | `close()` 清理 heartbeat、terminate 客户端、关闭 wss          | ✅ 完整                       |
| AgentEventWriter     | `unregister(sessionId)` 在 `finally` 中调用                   | ✅ 完整                       |
| AgentExecutor        | `destroyRuntime`、`unloadWorkspaceExtensions` 在 `finally` 中 | ✅ 完整                       |

#### 2.3.2 泄漏风险点

**P0-2: EventBridge 监听器在 Gateway 关闭时未清理**

- **位置**：`src/main/gateway/events/StreamBridge.ts`、`ThreadBridge.ts`、`src/main/common/ipc/eventBroadcaster.ts`
- **问题**：`initStreamBridge`、`initThreadBridge` 等向 `eventBus` 注册 `on()` 监听器，但 Gateway 关闭时**没有**对应的 `removeListener` 调用。EventBus 是单例，应用生命周期内不会销毁，但 Gateway 可能重启或热更新，导致重复注册。
- **影响**：每次 Gateway 初始化都会叠加监听器，造成重复推送、内存增长。
- **修复建议**：为每个 EventBridge 提供 `destroy()` 方法，在 Gateway `close()` 时调用，移除所有监听器。

**P1-3: StreamStore / StreamMonitor 监听器未暴露清理接口**

- **位置**：`src/main/ai/streaming/consumers/StreamStore.ts:104`、`StreamMonitor.ts:50+`
- **问题**：直接 `eventBus.on(...)` 注册，无 `off` 或 `destroy` 方法，若模块被重新加载会累积监听器。
- **建议**：提供 `destroy()` 并在应用退出时调用。

**P1-4: App.vue workerCleanup 已修复**

- **说明**：第三十四轮提到的 F-P1-1 已修复，`App.vue` 的 `onUnmounted` 中已调用 `workerCleanup()`。

---

### 2.4 错误处理维度

#### 2.4.1 try-catch 覆盖

- **AgentExecutor**：`execute()`、`stream()` 的 `catch` 和 `finally` 覆盖主要路径，Extension 加载失败时 `catch` 并 `log.warn`，不阻断执行。
- **ExtensionLoader**：`load()` 中 JSON 解析、jiti 加载、`register()` 均有 try-catch，失败时 `return` 并记录日志。
- **ExtensionHookRunner**：`runVoidHook` 使用 `Promise.allSettled`，单个 hook 失败不影响其他；`runModifyingHook` 中 `catch` 后 `continue`，不中断合并流程。

#### 2.4.2 边界条件

- **CheckpointManager**：`findPending()` 中 `JSON.parse` 失败时静默跳过，避免单个损坏的 checkpoint 影响整体扫描。
- **SessionQueue**：`enqueue` 时容量检查，`applyDropPolicy` 处理满队列情况。
- **path-guard**：`realpath` 失败时 catch 并允许通过，由后续 IO 报错，避免 broken symlink 导致误拦。

#### 2.4.3 待改进

**P2-1: ExtensionLoader handleWatchEvent 中 async 回调未 catch**

- **位置**：`ExtensionLoader.ts:368-388`
- **问题**：`setTimeout` 的回调是 `async`，内部 `await this.unload/load` 若抛错，会产生未处理的 Promise rejection。
- **建议**：在回调末尾加 `.catch(err => log.error(...))` 或使用 `void` 包装并内部 try-catch。

---

### 2.5 Extension 系统维度（重点）

#### 2.5.1 加载/卸载机制

- **loadAll**：按 searchPaths 顺序加载，同 ID 后加载覆盖先加载（先 `unload` 再 `load`）。
- **load**：校验 manifest、信任模型、skills 路径穿越检查、jiti 加载、`register()`、同步到 ToolRegistry。
- **unload**：调用 `mod.unregister()`、`registry.unregisterToolsByExtension`、清理 hooks/gatewayMethods/skillDirs、同步 ToolRegistry、清理本地 Map。
- **任务级**：`loadWorkspaceExtensions(threadId)` 扫描 `{workspace}/extensions`，记录到 `workspaceExtensions` Map；`unloadWorkspaceExtensions(threadId)` 按记录逐个 unload。

#### 2.5.2 Hook 执行流程

- **void 型**：`Promise.allSettled` 并行，独立 try-catch，互不影响。
- **modifying 型**：按优先级顺序执行，结果合并（`mergeResult`），单个失败跳过该 hook 继续下一个。
- **fire-and-forget**：`fireChunkHooks`、`fireMessageQueued` 等使用 `fire().catch(...)` 或 `.catch(() => {})`，不阻塞主流程。

#### 2.5.3 任务级 Extension 隔离

- **隔离方式**：通过 `workspaceExtensions` Map 记录每个 threadId 加载的 Extension ID，任务结束时只卸载这些 ID。
- **共享状态**：`loadedExtensions`、`loadedModules`、`registry` 均为全局共享，workspace Extension 与 builtin 共用同一 Registry。若 workspace 与 builtin 有同 ID Extension，会互相覆盖。
- **建议**：在 `loadWorkspaceExtensions` 中校验，若 manifest.id 与已加载的 builtin 冲突，拒绝加载并 log.warn。

#### 2.5.4 热重载安全性

- **防抖**：`handleWatchEvent` 使用 300ms 防抖，避免频繁 reload。
- **顺序**：先 `unload` 再 `load`，确保旧资源释放。
- **ToolRegistry**：unload 时同步从 ToolRegistry 移除，load 时同步注册，避免残留或重复。

#### 2.5.5 待改进

**P2-2: ExtensionHookRunner 使用 console.error 而非项目 logger**

- **位置**：`ExtensionHookRunner.ts:49, 86`
- **建议**：改用 `createLogger('extension-hook')` 统一日志。

---

### 2.6 测试覆盖维度

#### 2.6.1 当前状态

- **通过**：94 个测试文件，1430 个测试通过。
- **跳过**：62 个测试（多为集成测试，依赖真实 API、网络等）。
- **核心模块**：ExtensionLoader、MessagePipeline、SessionQueue、ToolExecutionPipeline、HitlApprovalManager、path-guard、exec-policy 等有较完整单元测试。

#### 2.6.2 覆盖缺口

| 模块                              | 缺口                                                  | 优先级 |
| --------------------------------- | ----------------------------------------------------- | ------ |
| AgentEnvInjector                  | 复杂 workspace 注入逻辑                               | P2     |
| ToolExecutionPipeline             | Phase 2-4 的 sandbox policy、execute、after_tool_call | P2     |
| ConcurrencyManager                | 异常路径、runningCount 边界                           | P2     |
| ThreadWaker                       | handleWake 各分支、stop 后无监听器                    | P1     |
| StreamBridge / ThreadBridge       | 监听器清理、重复注册                                  | P2     |
| Extension loadWorkspaceExtensions | 与 builtin 同 ID 冲突场景                             | P2     |

#### 2.6.3 建议

- 为 `ThreadWaker` 增加「stop 后 emit 不触发」的测试，验证监听器正确移除。
- 为 `EventBridge` 增加「重复 init 不重复推送」或「destroy 后不再推送」的测试。

---

### 2.7 性能优化维度

#### 2.7.1 已实现的优化

- **MessagePipeline**：TTL 清理空闲队列（30 分钟），`cleanupIdleQueues` 每 5 分钟执行。
- **SessionQueue**：`lastAccessTime` 用于 TTL，避免长期空闲 session 占用内存。
- **ExtensionLoader**：防抖 300ms，减少热重载频率。
- **WorkspaceFileWatcher**：去抖 300ms 批量推送，keepalive 60s 自动停止。

#### 2.7.2 潜在瓶颈

**P2-3: CheckpointManager.updateStatus 每次读写文件**

- **位置**：`CheckpointManager.ts:99-112`
- **问题**：`updateStatus` 先 `load` 再 `save`，高并发下可能产生大量 IO。
- **建议**：对同一 threadId 的短时间多次更新做合并或节流。

**P2-4: ThreadStore.rebuildIndex 全量同步扫描**

- **位置**：`ThreadStore.ts:80-96`
- **问题**：`rebuildIndex` 同步读取所有 JSON 文件，thread 数量大时可能阻塞。
- **建议**：考虑异步加载或增量更新（需权衡一致性）。

---

### 2.8 安全性维度

#### 2.8.1 路径安全

**P0-3: files.ts isPathSafe 路径前缀绕过**

- **位置**：`src/main/gateway/http/files.ts:34-47`
- **问题**：`resolved.startsWith(resolvedRoot)` 在 Windows 下存在前缀绕过。例如 `resolvedRoot = "C:\\workspace"`，`resolved = "C:\\workspaces-evil\\file.txt"` 时，`startsWith` 为 true，可能越权访问。
- **修复建议**：使用 `path.relative` 或确保 `resolved` 在 `resolvedRoot` 下且不以 `..` 开头，或使用 `path.resolve` + 规范化后严格比较：

```typescript
const rel = path.relative(resolvedRoot, resolved);
if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
```

**P1-5: path-guard Windows 驱动器与 UNC 路径**

- **说明**：第三十四轮 S-P1-1 指出 path-guard 对 Windows 驱动器和 UNC 路径的检测可能不完整，需结合 `path-guard.test.ts` 中的 win32 测试验证。

#### 2.8.2 其他

- **exec-policy**：`getAllowlistPath` 已使用 `require('../../common/env')`，S-P0-1 已修复；`sed` 已从 SAFE_BINS 移除，S-P0-2 已修复。
- **skills import**：`allowedRoots` 限制在 workspaces、downloads、desktop、documents，路径校验较严格。
- **Extension 信任**：`verifyExtensionTrust` 对 user/workspace 发出警告，builtin 免检，逻辑合理。

---

## 3. 问题清单（按优先级）

### P0 级（严重 / 安全 / 阻塞）

| ID   | 描述                                                                  | 位置                                         | 维度      |
| ---- | --------------------------------------------------------------------- | -------------------------------------------- | --------- |
| P0-1 | ThreadWaker EventBus 监听器无法移除                                   | ThreadWaker.ts:70,80                         | 并发/内存 |
| P0-2 | EventBridge 监听器在 Gateway 关闭时未清理                             | StreamBridge, ThreadBridge, eventBroadcaster | 内存      |
| P0-3 | files.ts isPathSafe 路径前缀绕过                                      | gateway/http/files.ts:34-47                  | 安全      |
| P0-4 | （历史）Gateway Files API 任意文件读取、Skills 路径穿越、Tab IPC 越权 | 见 doc 34                                    | 安全      |

### P1 级（高优 / 功能缺失）

| ID    | 描述                                     | 位置                             | 维度 |
| ----- | ---------------------------------------- | -------------------------------- | ---- |
| P1-1  | ConcurrencyManager executePhase 异常路径 | ConcurrencyManager.ts:159-166    | 并发 |
| P1-2  | HitlApprovalManager 遍历中变异 Map       | HitlApprovalManager.ts:282-287   | 并发 |
| P1-3  | StreamStore / StreamMonitor 无清理接口   | StreamStore.ts, StreamMonitor.ts | 内存 |
| P1-4  | （已修复）workerCleanup 未调用           | App.vue                          | 内存 |
| P1-5  | path-guard Windows/UNC 路径检测          | path-guard.ts                    | 安全 |
| P1-6  | ThreadView loadHistory 竞态（历史错乱）  | 见 doc 34 F-P0-1                 | 前端 |
| P1-7  | Chat 与 Copilot 流式订阅冲突             | 见 doc 34 F-P0-2                 | 前端 |
| P1-8  | LayerManager ESC keydown 监听泄漏        | 见 doc 34 F-P1-2                 | 前端 |
| P1-9  | EventBus once 包装导致 off 失效          | 见 doc 34 F-P1-4                 | 前端 |
| P1-10 | HttpServer 退出时未 close                | 见 doc 34 M-P1-1                 | 资源 |
| P1-11 | GatewayServer wss.close 未等待活动连接   | 见 doc 34 M-P1-3                 | 资源 |
| P1-12 | ThreadWaker 缺少「stop 后无监听」测试    | **tests**/ThreadWaker.test.ts    | 测试 |

### P2 级（中低优 / 边界）

| ID    | 描述                                            | 位置                         | 维度     |
| ----- | ----------------------------------------------- | ---------------------------- | -------- |
| P2-1  | ExtensionLoader handleWatchEvent async 未 catch | ExtensionLoader.ts:368       | 错误处理 |
| P2-2  | ExtensionHookRunner 使用 console 而非 logger    | ExtensionHookRunner.ts:49,86 | 规范     |
| P2-3  | CheckpointManager 高频 IO                       | CheckpointManager.ts         | 性能     |
| P2-4  | ThreadStore rebuildIndex 同步阻塞               | ThreadStore.ts               | 性能     |
| P2-5  | workspace Extension 与 builtin 同 ID 冲突       | ExtensionLoader.ts           | 架构     |
| P2-6  | AgentExecutor 重复 import ExtensionManager      | AgentExecutor.ts             | 架构     |
| P2-7  | 核心模块测试缺口                                | 见 2.6.2                     | 测试     |
| P2-8  | Store 状态被外部直接修改                        | 见 doc 34 F-P1-3             | 前端     |
| P2-9  | 配置 config.set 任意 key 注入风险               | 见 doc 34 M-P1-2             | 安全     |
| P2-10 | path-guard root 不存在时跳过 symlink 检查       | 见 doc 34 S-P1-2             | 安全     |

---

## 4. 修复建议（具体到文件和代码行）

### 4.1 P0-1: ThreadWaker 监听器泄漏

**文件**：`src/main/ai/threads/ThreadWaker.ts`

```diff
 export class ThreadWaker {
   private static instance: ThreadWaker | null = null;
   private listening = false;

+  private boundHandleWake = this.handleWake.bind(this);

   start(): void {
     if (this.listening) return;
-    eventBus.on('thread:wake', this.handleWake.bind(this));
+    eventBus.on('thread:wake', this.boundHandleWake);
     this.listening = true;
   }

   stop(): void {
     if (!this.listening) return;
-    eventBus.removeListener('thread:wake', this.handleWake.bind(this));
+    eventBus.removeListener('thread:wake', this.boundHandleWake);
     this.listening = false;
   }
 }
```

### 4.2 P0-2: EventBridge 监听器清理

**方案**：为 `EventBridgeInit` 增加返回的 `destroy` 函数，在 Gateway `close()` 时调用。

**文件**：`src/main/gateway/events/StreamBridge.ts`（及 ThreadBridge、eventBroadcaster 类似）

```typescript
export const initStreamBridge: EventBridgeInit = (gateway) => {
  const handlers = [
    [StreamEventType.MESSAGE, (event: StreamEvent) => { ... }],
    [StreamEventType.START, ...],
    ...
  ];
  handlers.forEach(([evt, fn]) => eventBus.on(evt, fn));
  return () => handlers.forEach(([evt, fn]) => eventBus.off(evt, fn));
};
```

在 Gateway 关闭流程中调用返回的 destroy。

### 4.3 P0-3: files.ts isPathSafe 修复

**文件**：`src/main/gateway/http/files.ts`

```typescript
function isPathSafe(targetPath: string, rootDir?: string): boolean {
  const normalized = path.normalize(targetPath);
  if (normalized.includes('..')) return false;

  if (rootDir) {
    const resolved = path.resolve(targetPath);
    const resolvedRoot = path.resolve(rootDir);
    // 使用 relative 避免前缀绕过（如 C:\workspace vs C:\workspaces-evil）
    const rel = path.relative(resolvedRoot, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  }
  return true;
}
```

### 4.4 P1-2: HitlApprovalManager 遍历变异

**文件**：`src/main/ai/hitl/HitlApprovalManager.ts`

```diff
   cleanupBySessionPrefix(sessionId: string): void {
     const prefix = `${sessionId}:`;
-    for (const [approvalId, entry] of this.singlePending) {
-      if (approvalId.startsWith(prefix)) {
-        clearTimeout(entry.timer);
-        this.singlePending.delete(approvalId);
-        ...
-      }
-    }
+    const toDelete = [...this.singlePending.entries()]
+      .filter(([id]) => id.startsWith(prefix))
+      .map(([id]) => id);
+    toDelete.forEach((id) => {
+      const entry = this.singlePending.get(id);
+      if (entry) clearTimeout(entry.timer);
+      this.singlePending.delete(id);
+    });
   }
```

---

## 5. 改进路线图（按修复优先级排序）

### 阶段一：P0 修复（1–2 周）

1. **P0-1** ThreadWaker 监听器泄漏 — 立即修复，影响所有使用 ThreadWaker 的场景。
2. **P0-3** files.ts isPathSafe — 安全修复，防止路径穿越。
3. **P0-2** EventBridge 监听器清理 — 与 Gateway 生命周期协同设计。
4. **P0-4** 历史安全项（doc 34 中 M-P0-1/2/3）— 若尚未修复，优先处理。

### 阶段二：P1 修复（2–4 周）

5. **P1-2** HitlApprovalManager 遍历变异。
6. **P1-1** ConcurrencyManager 异常路径。
7. **P1-3** StreamStore / StreamMonitor 清理接口。
8. **P1-6、P1-7** 前端 ThreadView、Chat/Copilot 竞态。
9. **P1-8、P1-9** LayerManager、EventBus once。
10. **P1-10、P1-11** HttpServer、GatewayServer 关闭流程。
11. **P1-12** ThreadWaker 测试补充。

### 阶段三：P2 与持续改进（按需）

12. **P2-1** ExtensionLoader async catch。
13. **P2-2** ExtensionHookRunner logger。
14. **P2-5** workspace Extension ID 冲突校验。
15. **P2-3、P2-4** 性能优化（CheckpointManager、ThreadStore）。
16. **P2-7** 测试覆盖率提升。

---

## 6. 附录：关键文件索引

| 模块           | 路径                                                        |
| -------------- | ----------------------------------------------------------- |
| Extension 加载 | `src/main/common/extension/ExtensionLoader.ts`              |
| Extension 注册 | `src/main/common/extension/ExtensionRegistry.ts`            |
| Extension Hook | `src/main/common/extension/ExtensionHookRunner.ts`          |
| Agent 执行     | `src/main/ai/AgentExecutor.ts`                              |
| 消息管线       | `src/main/ai/pipeline/MessagePipeline.ts`                   |
| 会话队列       | `src/main/ai/pipeline/SessionQueue.ts`                      |
| 并发管理       | `src/main/ai/swarm/ConcurrencyManager.ts`                   |
| Worker 协调    | `src/main/ai/orchestration/WorkerCoordinator.ts`            |
| Thread 存储    | `src/main/ai/threads/ThreadStore.ts`                        |
| 检查点         | `src/main/ai/threads/CheckpointManager.ts`                  |
| Thread 唤醒    | `src/main/ai/threads/ThreadWaker.ts`                        |
| Gateway        | `src/main/gateway/GatewayServer.ts`                         |
| 文件路由       | `src/main/gateway/http/files.ts`                            |
| 技能路由       | `src/main/gateway/http/skills.ts`                           |
| 文件监控       | `extensions/workspace-file-watcher/WorkspaceFileWatcher.ts` |
| 路径守卫       | `src/main/ai/sandbox/path-guard.ts`                         |
| 执行策略       | `src/main/ai/sandbox/exec-policy.ts`                        |
