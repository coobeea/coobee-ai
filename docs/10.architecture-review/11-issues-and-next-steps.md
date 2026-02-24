# 11 — 问题清单与改进方向

> 基于第五轮全面架构分析发现的问题、风险和改进建议
>
> 分析日期：2026-02-12
> 更新日期：2026-02-16（Phase 1 修复完成）

---

## 0. 问题分级

| 级别          | 含义                        | 影响                 |
| ------------- | --------------------------- | -------------------- |
| **P0 — 关键** | 功能不可用 / 代码实际未接入 | 新基础设施等于死代码 |
| **P1 — 高**   | 架构缺陷 / 安全风险         | 影响可靠性或安全性   |
| **P2 — 中**   | 功能不完整 / 体验较差       | 影响可用性           |
| **P3 — 低**   | 技术债 / 代码质量           | 影响可维护性         |

---

## 1. P0 — 关键问题

### 1.1 ~~MessagePipeline 未接入生命周期（死代码）~~ ✅ 已修复

**现象**：`AgentExecutor.initPipeline()` 从未在任何生命周期 Hook 中被调用。`pipeline` 属性始终为 `null`，`submitViaPipeline()` 永远返回 `null`，系统始终走旧的 `busySessions` 逻辑。

**影响**：整个消息管线（SessionQueue / DrainStrategy / AbortManager / 四种排队模式）完全不生效。`chat.abort` 可调用但实际走的是旧逻辑。

**涉及文件**：

- `src/main/ai/AgentExecutor.ts` — `initPipeline()` 未调用
- `src/main/lifecycle/` — 缺少初始化 Hook

**修复方案**：

```
方案 A：在 ReadyGatewayHook 或新 ReadyPipelineHook 中调用 agentExecutor.initPipeline()
方案 B：在 AgentExecutor 构造函数中自动初始化（但需要 QueueSettings 来源）
推荐 A：创建 ReadyInfraHook（优先级 55），统一初始化 ConfigStore + Provider + Pipeline
```

---

### 1.2 ~~ProviderSystem 未接入生命周期（死代码）~~ ✅ 已修复

**现象**：`AgentExecutor.setProviderSystem()` 从未被调用。`getProviderSystem()` 始终返回 `null`。`chat.ts` 中的 `applyProviderConfig()` 的 try-catch 静默回退到 `.env`，新的模型选择体系完全未激活。

**影响**：ModelSelector 四级优先级、ModelFallback、CostTracker 全部不生效。系统仍然使用 `.env` 中硬编码的单个 Provider。

**涉及文件**：

- `src/main/ai/AgentExecutor.ts` — `setProviderSystem()` 未调用
- `src/main/gateway/methods/chat.ts` — `applyProviderConfig()` 静默失败

**修复方案**：

```
在 ReadyInfraHook 中：
1. ConfigLoader.load() 获取配置
2. ProviderRegistry.loadFromConfig(config)
3. new ModelSelector(config)
4. agentExecutor.setProviderSystem({ registry, selector })
```

---

### 1.3 ~~ConfigStore 未接入生命周期（Gateway 方法失败）~~ ✅ 已修复

**现象**：`setConfigStoreInstance()` 从未被调用。Gateway 的 `config.get/set/patch/getAll` 方法访问 `configStoreInstance` 得到 `null`，所有配置 RPC 调用会抛异常。前端 SettingsView 加载配置必然失败。

**影响**：统一配置系统的读写接口完全不可用。

**涉及文件**：

- `src/main/common/config/ConfigStore.ts` — `configStoreInstance` 未初始化
- `src/main/gateway/methods/config.ts` — 依赖 `configStoreInstance`

**修复方案**：

```
在 ReadyInfraHook 中：
1. new ConfigLoader(configDir)
2. new ConfigStore(loader)
3. setConfigStoreInstance(store)
4. 可选：new ConfigWatcher(loader) → watcher.start()
```

---

## 2. P1 — 高优先级问题

### 2.1 ~~Extension 工具未传递给 Agent Builder~~ ✅ 已修复

**现象**：`ReadyExtensionHook` 将 Extension 注册的工具复制到 `ToolRegistry`，但 `chat.ts` 的 `createBuilder()` 只使用 `builtinTools`，不使用 `ToolRegistry.getInstance().getAll()`。Extension 注册的工具无法被 Agent 使用。

**影响**：Extension 的 `api.registerTool()` 注册的工具是死功能。

**修复方案**：

```typescript
// chat.ts createBuilder() 修改为：
import { ToolRegistry } from '@main/ai/tools/registry';
builder.tools(ToolRegistry.getInstance().getAll());
```

---

### 2.2 ~~Exec Policy 仅通过 Extension 执行，无兜底~~ ✅ 已修复

**现象**：`exec` 工具本身不检查命令安全性；安全策略完全依赖 `tool-approval` Extension 的 `before_tool_call` 钩子调用 `checkExecPolicy()`。如果 Extension 系统未加载或加载失败，exec 将不受任何命令级保护。

**影响**：Extension 系统故障时的安全降级风险。

**修复方案**：

```
方案 A：在 exec 工具内部直接集成 checkExecPolicy()（双重保护）
方案 B：在 ToolExecutionPipeline Phase 2 中加入 exec policy 检查
推荐 A：最小侵入，exec 工具自身做一次检查，Extension 钩子做第二次
```

---

### 2.3 Extension 在主进程无沙箱运行

**现象**：Extension 通过 `jiti` 在主进程直接执行 JavaScript/TypeScript 代码，没有 VM 隔离或权限限制。恶意或有 bug 的 Extension 可以访问完整的 Node.js API（文件系统、网络、进程等）。

**影响**：安全风险——用户安装的 Extension 可能造成数据泄露或系统破坏。

**修复方案**：

```
短期：增强信任验证（签名检查、来源白名单）
中期：使用 Node.js worker_threads 隔离执行
长期：使用 vm2 / isolated-vm 提供受限执行环境
```

---

### 2.4 ~~Security Middleware 为空壳~~ ✅ 已修复

**现象**：`src/main/common/middleware/security.ts` 只有日志输出，无实际安全检查。

**影响**：中间件层无请求级安全防护。

**修复方案**：

```
1. 添加请求频率限制
2. 添加 sessionId 验证
3. 添加 Gateway 方法权限检查
```

---

### 2.5 ~~Pipeline 的 executor 是空壳~~ ✅ 已修复

**现象**：`AgentExecutor.initPipeline()` 创建 `MessagePipeline` 时传入的 executor 只打印日志 `Pipeline executing: sessionId=xxx`，不执行任何实际的 Agent 逻辑。即使修复了 1.1，Pipeline 排水时不会真正运行 Agent。

**影响**：Pipeline 的 drain 功能无实际效果。

**修复方案**：

```typescript
// executor 需要实际调用 execute()
this.pipeline = new MessagePipeline(async (sessionId, message, signal) => {
  const builder = this.piMono(); // 或根据配置选择
  // 应用 Provider 配置
  await this.execute({ sessionId, message, builder }, signal);
}, settings);
```

---

## 3. P2 — 中优先级问题

### 3.1 ~~ConfigStore 写入为 JSON 非 JSON5~~ ✅ 已修复

**现象**：`ConfigStore.set()` 和 `patch()` 使用 `JSON.stringify(config, null, 2)` 写入文件。原始 JSON5 中的注释会丢失，输出格式变为标准 JSON。

**影响**：用户手动编辑 `coobee.json5` 时添加的注释会在程序化修改后消失。

**修复方案**：

```
使用 json5.stringify() 或保留原始文件内容仅修改对应路径（AST 级修改）
```

---

### 3.2 前端 ChatView 与 ChatPanel 重复

**现象**：`ChatView.vue` 和 `ChatPanel.vue` 实现了几乎相同的聊天 UI 逻辑（消息列表、工具调用、HITL 审批），但 `ChatView` 是全屏版本，`ChatPanel` 是侧边栏版本。代码大量重复。

**影响**：维护成本高，修改一处需要同步另一处。

**修复方案**：

```
提取共享聊天 UI 组件（MessageList, ToolCallCard, ApprovalCard），
ChatView 和 ChatPanel 只是不同布局的容器。
```

---

### 3.3 dialog:openDirectory IPC 链路不清晰

**现象**：`ProjectPanel.vue` 使用 `window.electron?.ipcRenderer.invoke('dialog:openDirectory')` 打开目录选择对话框，但 preload 中未显式声明该 channel，主进程处理器的注册方式不透明。

**影响**：难以追踪和维护 IPC 通信。

**修复方案**：

```
在 IPC channels 常量中统一声明，在 preload 中显式暴露。
```

---

### 3.4 Gateway 实例无全局引用

**现象**：`ReadyGatewayHook` 创建 `Gateway` 实例后未存储全局引用。其他模块（如 Extension、测试）无法获取 Gateway 实例。

**修复方案**：

```
类似 ExtensionManager 的单例模式，提供 GatewayManager.getInstance()
```

---

### 3.5 StreamStore 初始化时机不明

**现象**：`StreamStore` 在 `initStreamBridge` 中创建并订阅 EventBus，但该函数的调用时机取决于 Gateway 事件桥扫描顺序。如果 Agent 在 StreamStore 就绪前开始执行，流式事件可能丢失。

**修复方案**：

```
在生命周期 Hook 中显式初始化 StreamStore，确保在 Agent 可执行之前就绪。
```

---

### 3.6 ModelSelector.resolve() 中 sessionId 缺失时钩子收到空字符串

**现象**：当调用 `resolve()` 不传 `sessionId` 时，`fireModelResolved` 传递 `sessionId: ''`。Extension 收到空的 sessionId 可能导致逻辑混乱。

**修复方案**：

```
传递 undefined 而非空字符串，或在 Event 类型中将 sessionId 标记为可选。
```

---

## 4. P3 — 低优先级问题

### 4.1 双配置系统共存

**现象**：旧的 `config.ts`（ElectronStore）和新的 `ConfigStore`（coobee.json5）并行存在，UI 偏好在旧系统，LLM/Agent 配置在新系统。

**影响**：增加理解成本，未来可能出现配置不一致。

**修复方案**：

```
Phase 1: 已完成（新系统创建）
Phase 2: 将 .env 配置迁入 coobee.json5
Phase 3: 将 electron-store UI 配置迁入 coobee.json5
Phase 4: 移除旧配置源
```

---

### 4.2 测试覆盖缺口

| 缺失区域                | 重要性 | 说明                 |
| ----------------------- | ------ | -------------------- |
| exec-policy.ts          | 高     | 安全关键模块，零测试 |
| tool-approval Extension | 高     | HITL 审批的核心逻辑  |
| chat.send / chat.abort  | 中     | Gateway 核心方法     |
| config Gateway 方法     | 中     | 配置 RPC 接口        |
| security middleware     | 低     | 当前为空壳           |
| AgentEnvInjector        | 低     | 复杂的注入逻辑       |
| memory-auto Extension   | 低     | 自动内存提取         |

---

### 4.3 HitlApprovalManager 批量 API 已废弃但未移除

**现象**：`waitForDecisions()` 和 `submitDecision()` 标记为 deprecated 但仍存在。

**修复方案**：清理或标记 `@deprecated` JSDoc。

---

### 4.4 AgentEventWriter 静默吞错

**现象**：`append()` 捕获异常后不记录日志，事件可能丢失而无人知晓。

**修复方案**：添加 `logger.warn()` 日志输出。

---

### 4.5 Browser 子窗口未实现

**现象**：`windows/browser/BrowserApp.vue` 仅显示 "Browser 窗口，待实现..."。

---

## 5. 改进路线图

### Phase 1：接通新基础设施（P0 修复）✅ 已完成（2026-02-16）

| 任务                               | 优先级 | 说明                                               | 状态 |
| ---------------------------------- | ------ | -------------------------------------------------- | ---- |
| 创建 ReadyInfraHook                | P0     | 统一初始化 ConfigStore + ProviderSystem + Pipeline | ✅   |
| 修复 Pipeline executor             | P0     | 实际调用 AgentExecutor.execute()                   | ✅   |
| 验证 chat.send → Pipeline 完整链路 | P0     | 端到端测试                                         | ✅   |
| 验证 config.getAll → SettingsView  | P0     | 前端配置加载可用                                   | ✅   |

### Phase 2：安全加固（P1 修复）✅ 已完成（2026-02-16）

| 任务                         | 优先级 | 说明                      | 状态 |
| ---------------------------- | ------ | ------------------------- | ---- |
| Extension 工具传递给 Builder | P1     | chat.ts 使用 ToolRegistry | ✅   |
| Exec Policy 兜底保护         | P1     | exec 工具内置策略检查     | ✅   |
| exec-policy 单元测试         | P1     | 补充安全模块测试（33 条） | ✅   |
| Security Middleware          | P1     | 速率限制 + 参数校验       | ✅   |

### Phase 3：体验优化（P2 修复）🔧 部分完成

| 任务                            | 优先级 | 说明                | 状态 |
| ------------------------------- | ------ | ------------------- | ---- |
| ConfigStore JSON5 写入          | P2     | 保留注释            | ✅   |
| ChatView/ChatPanel 抽取共享组件 | P2     | 消除重复代码        | 待做 |
| Gateway 全局引用                | P2     | GatewayManager 单例 | 待做 |
| StreamStore 显式初始化          | P2     | 保证事件不丢失      | 待做 |

### Phase 4：技术债清理（P3 处理，预计 1-2 天）

| 任务                     | 优先级 | 说明                                         |
| ------------------------ | ------ | -------------------------------------------- |
| 旧配置系统迁移           | P3     | electron-store → coobee.json5                |
| 补充测试覆盖             | P3     | chat methods / config methods / env injector |
| HitlApprovalManager 清理 | P3     | 移除废弃 API                                 |
| AgentEventWriter 日志    | P3     | 失败时输出警告                               |

---

## 6. 总结

### 2026-02-16 更新

Phase 1 和 Phase 2 已全部完成，Phase 3 部分完成。具体修复：

**已修复（8 项）：**

- P0: ReadyInfraHook 统一初始化三大基础设施 → 不再是死代码
- P0: Pipeline executor 接入真实 execute() → 消息排队/合并/中断生效
- P0: ConfigStore 接入生命周期 → config.getAll/set/patch 可用
- P1: Extension 工具合并到 Builder → 扩展工具可被 Agent 使用
- P1: exec 工具内置 ask 兜底 → 无 tool-approval 时阻止未知命令
- P1: Security Middleware → 速率限制 + 写操作参数校验
- P2: ConfigStore JSON5 输出 → 保持配置文件格式一致
- P2: SettingsView maxQueueSize → cap → 匹配 schema

**新增测试（60+ 条）：**

- ReadyInfraHook 8 条, Pipeline 集成 10 条, exec-policy 33 条, exec-security 3 条, security middleware 6 条

**剩余待做：**

- P2: ChatView/ChatPanel 组件抽取、Gateway 全局引用、StreamStore 初始化
- P3: 旧配置迁移、测试覆盖补充、废弃 API 清理

其次是安全加固（Extension 工具传递、Exec Policy 兜底），确保系统在各种故障模式下仍然安全。
