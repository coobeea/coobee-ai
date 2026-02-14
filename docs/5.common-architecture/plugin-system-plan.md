# Extension 系统实现计划

> 统一命名：**Extension**。磁盘目录 `extensions/`，代码模块 `src/main/extension/`，所有公开类型/文件统一 `Extension` 前缀。

---

## 0. 范围与设计决策

### 0.1 本次实现范围

| 能力                       | 说明                                               |
| -------------------------- | -------------------------------------------------- |
| Agent 生命周期钩子（8 种） | before_agent_start、before_tool_call、agent_end 等 |
| 工具注册                   | Extension 可注册 ToolDefinition（Zod 参数）        |
| Gateway 方法注册           | Extension 可注册 RPC 方法                          |
| 热插拔                     | fs.watch 监听目录变化，运行时加载/卸载             |
| jiti 加载                  | 支持 .ts / .js Extension，运行时编译               |
| 三级目录                   | builtin + user + workspace，与 Skill 同构          |

### 0.2 已确认的设计决策

| 决策       | 结论                                      |
| ---------- | ----------------------------------------- |
| 命名       | 统一 `Extension`，不用 Plugin/Hook 混用   |
| 目录来源   | Env 中定义，与 Skill 同构三级目录         |
| 文件监听   | 原生 `fs.watch`，只监听一层（子目录增删） |
| .ts 加载   | 使用 `jiti` 运行时编译（需安装）          |
| 运行中卸载 | 立即移除注册，已绑定的 Agent 不受影响     |
| 容错       | 任何 Extension 错误不影响 Agent 运行      |

### 0.3 设计原则

1. **统一命名**：所有公开类型/文件/函数使用 `Extension` 前缀
2. **与 Skill 同构**：目录发现、三级合并、Env 集成方式与 Skill 保持一致
3. **最小侵入**：AgentExecutor 和 convertTools 只在关键节点插入调用
4. **容错隔离**：Extension 的任何错误不影响核心 Agent 运行
5. **类型安全**：每种 Hook 有独立的 Event 和 Result 类型

---

## 1. 目录结构

### 1.1 代码模块

```
src/main/extension/                     # 唯一模块
├── types.ts                            # 全部类型定义
├── ExtensionRegistry.ts                # 注册中心（hooks + tools + gatewayMethods）
├── ExtensionLoader.ts                  # jiti 加载 + fs.watch 热插拔
├── ExtensionApi.ts                     # 构建传给 Extension 的 api 对象
├── ExtensionHookRunner.ts              # 生命周期钩子执行引擎（void / modifying）
├── ExtensionManager.ts                 # 全局管理器（初始化 / 获取 / 重置）
├── index.ts                            # 统一导出
└── __tests__/
    ├── ExtensionRegistry.test.ts
    ├── ExtensionHookRunner.test.ts
    ├── ExtensionLoader.test.ts
    └── ExtensionIntegration.test.ts
```

### 1.2 磁盘目录（三级，与 Skill 同构）

```
extensions 搜索路径（优先级从低到高，同 ID 后者覆盖前者）：

1. builtinExtensionsDir              内置（随应用分发，只读）
   开发: <项目>/extensions
   生产: resources/extensions

2. userExtensionsDir                 用户级（可读写）
   开发: <项目>/.home/extensions
   生产: ~/.coobee-ai/extensions

3. {workspace}/extensions            工作空间级（仅当前 Agent 可见，最高优先级）
```

每个 Extension 是一个子目录：

```
extensions/
└── memory-lancedb/
    ├── extension.json               # 清单：{ id, name, version }
    └── index.ts                     # 入口：export default { register(api) {...} }
```

### 1.3 修改的现有文件

| 文件                                               | 修改内容                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/main/common/env.ts`                           | 新增 `builtinExtensionsDir` + `userExtensionsDir` + `getExtensionSearchPaths()` |
| `src/main/ai/common/AgentEnv.ts`                   | 新增 `extensionPaths: string[]`                                                 |
| `src/main/ai/AgentExecutor.ts`                     | 注入 ExtensionHookRunner 调用                                                   |
| `src/main/ai/runtime/openai/OpenAIAgentRuntime.ts` | convertTools 中注入工具级 hook                                                  |
| `src/main/ai/runtime/pimono/PiMonoAgentRuntime.ts` | 同上                                                                            |
| `src/main/ai/tools/registry.ts`                    | 新增 `unregister()` 方法                                                        |
| `src/main/gateway/Gateway.ts`                      | 新增 `registerMethod()` / `unregisterMethod()`                                  |
| `src/main/lifecycle/`                              | 新增 `ReadyExtensionHook.ts`                                                    |

---

## 2. Phase 1 — 类型定义 + ExtensionRegistry

### 2.1 `types.ts` — 全部类型

```typescript
import type { ToolDefinition } from '../ai/tools/types'
import type { MethodHandler } from '../gateway/protocol/types'

// ==================== Extension 模块 ====================

/** Extension 清单（extension.json） */
export interface ExtensionManifest {
  id: string
  name: string
  version: string
  description?: string
}

/** Extension 来源 */
export type ExtensionOrigin = 'builtin' | 'user' | 'workspace'

/** Extension 模块导出格式 */
export interface ExtensionModule {
  id: string
  name: string
  register: (api: ExtensionApi) => void
}

/** Extension 日志 */
export interface ExtensionLogger {
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
}

// ==================== ExtensionApi ====================

/** Extension 与系统交互的唯一接口 */
export interface ExtensionApi {
  /** Extension ID */
  id: string
  /** Extension 名称 */
  name: string
  /** 来源 */
  origin: ExtensionOrigin
  /** 日志 */
  logger: ExtensionLogger

  /** 注册工具 */
  registerTool(tool: ToolDefinition): void
  /** 注册 Agent 生命周期钩子 */
  on<K extends ExtensionHookName>(
    hookName: K,
    handler: ExtensionHookHandler<K>,
    opts?: { priority?: number }
  ): void
  /** 注册 Gateway RPC 方法 */
  registerGatewayMethod(method: string, handler: MethodHandler): void
}

// ==================== Extension Hook ====================

/** 8 种 Agent 生命周期钩子 */
export type ExtensionHookName =
  | 'before_agent_start' // modifying：注入上下文 / 替换提示词
  | 'agent_end' // void：Agent 执行完成
  | 'before_tool_call' // modifying：修改参数 / 阻止调用
  | 'after_tool_call' // void：工具执行后
  | 'tool_result_persist' // modifying：修改持久化结果
  | 'message_received' // void：收到用户消息
  | 'session_start' // void：会话开始
  | 'session_end' // void：会话结束

/** 执行模式 */
export type ExtensionHookMode = 'void' | 'modifying'

export const EXTENSION_HOOK_MODE: Record<ExtensionHookName, ExtensionHookMode> = {
  before_agent_start: 'modifying',
  agent_end: 'void',
  before_tool_call: 'modifying',
  after_tool_call: 'void',
  tool_result_persist: 'modifying',
  message_received: 'void',
  session_start: 'void',
  session_end: 'void'
}

// ---- 各 Hook 的 Event / Result ----

export interface BeforeAgentStartEvent {
  sessionId: string
  prompt: string
  systemPrompt?: string
}
export interface BeforeAgentStartResult {
  prependContext?: string
  replaceSystemPrompt?: string
}

export interface BeforeToolCallEvent {
  sessionId: string
  toolName: string
  params: Record<string, unknown>
}
export interface BeforeToolCallResult {
  block?: boolean
  blockReason?: string
  params?: Record<string, unknown>
}

export interface ToolResultPersistEvent {
  sessionId: string
  toolName: string
  result: string
}
export interface ToolResultPersistResult {
  result?: string
}

export interface AgentEndEvent {
  sessionId: string
  success: boolean
  output: string
  durationMs: number
}

export interface AfterToolCallEvent {
  sessionId: string
  toolName: string
  params: Record<string, unknown>
  result: string
  durationMs: number
}

export interface MessageReceivedEvent {
  sessionId: string
  message: string
}

export interface SessionEvent {
  sessionId: string
}

/** Event 映射 */
export type ExtensionHookEventMap = {
  before_agent_start: BeforeAgentStartEvent
  agent_end: AgentEndEvent
  before_tool_call: BeforeToolCallEvent
  after_tool_call: AfterToolCallEvent
  tool_result_persist: ToolResultPersistEvent
  message_received: MessageReceivedEvent
  session_start: SessionEvent
  session_end: SessionEvent
}

/** Result 映射 */
export type ExtensionHookResultMap = {
  before_agent_start: BeforeAgentStartResult | void
  agent_end: void
  before_tool_call: BeforeToolCallResult | void
  after_tool_call: void
  tool_result_persist: ToolResultPersistResult | void
  message_received: void
  session_start: void
  session_end: void
}

/** Handler 签名 */
export type ExtensionHookHandler<K extends ExtensionHookName> = (
  event: ExtensionHookEventMap[K]
) => Promise<ExtensionHookResultMap[K]>

/** 已注册的 Hook */
export interface RegisteredExtensionHook<K extends ExtensionHookName = ExtensionHookName> {
  extensionId: string
  hookName: K
  handler: ExtensionHookHandler<K>
  priority: number
}

// ==================== 注册记录 ====================

export interface RegisteredExtensionTool {
  extensionId: string
  tool: ToolDefinition
}

export interface RegisteredExtensionMethod {
  extensionId: string
  method: string
  handler: MethodHandler
}
```

### 2.2 `ExtensionRegistry.ts`

```typescript
class ExtensionRegistry {
  // --- 工具 ---
  registerTool(extensionId: string, tool: ToolDefinition): void
  unregisterToolsByExtension(extensionId: string): string[] // 返回被移除的工具名
  getTools(): RegisteredExtensionTool[]

  // --- Hook ---
  registerHook(hook: RegisteredExtensionHook): void
  unregisterHooksByExtension(extensionId: string): void
  getHooks<K extends ExtensionHookName>(name: K): RegisteredExtensionHook<K>[]

  // --- Gateway 方法 ---
  registerGatewayMethod(extensionId: string, method: string, handler: MethodHandler): void
  unregisterGatewayMethodsByExtension(extensionId: string): string[] // 返回被移除的方法名

  // --- 整体 ---
  unregisterAll(extensionId: string): void // 一键卸载某 Extension 的所有注册
  getExtensionIds(): string[]
  clear(): void
}
```

### 2.3 测试清单

| #   | 测试                       | 验证                                                 |
| --- | -------------------------- | ---------------------------------------------------- |
| 1   | registerTool + getTools    | 正常注册、按 extensionId 查询                        |
| 2   | 工具名重复拒绝             | 同名工具注册抛错                                     |
| 3   | registerHook + getHooks    | 正常注册、按 hookName 过滤                           |
| 4   | Hook 优先级排序            | 高优先级先返回                                       |
| 5   | registerGatewayMethod      | 正常注册                                             |
| 6   | Gateway 方法名冲突         | 核心方法名（chat._, stream._, worker._, hitl._）拒绝 |
| 7   | unregisterAll              | 一键移除指定 extensionId 的所有注册                  |
| 8   | unregisterToolsByExtension | 只移除该 Extension 的工具                            |
| 9   | unregisterHooksByExtension | 只移除该 Extension 的 hook                           |
| 10  | clear                      | 清空全部                                             |

---

## 3. Phase 2 — ExtensionHookRunner

### 3.1 两种执行模式

**旁听型（void）**：`Promise.allSettled` 并行，每个 handler 独立 try-catch

**拦截型（modifying）**：按优先级顺序执行，结果合并

合并规则：

- `prependContext`：多个拼接
- `replaceSystemPrompt`：后者覆盖前者
- `block`：任一为 true 则 true
- `params`：后者浅合并前者
- `result`：后者覆盖前者

```typescript
class ExtensionHookRunner {
  constructor(registry: ExtensionRegistry)

  async runVoidHook<K>(name: K, event: ExtensionHookEventMap[K]): Promise<void>
  async runModifyingHook<K>(
    name: K,
    event: ExtensionHookEventMap[K]
  ): Promise<ExtensionHookResultMap[K]>
}
```

### 3.2 测试清单

| #   | 测试                                      | 验证                  |
| --- | ----------------------------------------- | --------------------- |
| 1   | void hook 并行执行                        | 多个 handler 都被调用 |
| 2   | void hook 错误隔离                        | 一个抛错，其他正常    |
| 3   | void hook 空列表                          | 无注册时正常返回      |
| 4   | modifying hook 顺序执行                   | 高优先级先            |
| 5   | modifying hook 合并 — prependContext      | 多个拼接              |
| 6   | modifying hook 合并 — block               | 任一为 true           |
| 7   | modifying hook 合并 — params              | 浅合并                |
| 8   | modifying hook 合并 — replaceSystemPrompt | 后覆盖前              |
| 9   | modifying hook 合并 — result              | 后覆盖前              |
| 10  | modifying hook 错误跳过                   | handler 失败跳过继续  |
| 11  | modifying hook 空列表                     | 返回 undefined        |
| 12  | modifying hook 全返回 void                | 返回 undefined        |

---

## 4. Phase 3 — ExtensionManager

全局管理器，替代散落的全局函数：

```typescript
class ExtensionManager {
  /** 初始化（应用启动时调用一次） */
  static initialize(registry: ExtensionRegistry): void

  /** 获取注册中心 */
  static getRegistry(): ExtensionRegistry | null

  /** 获取 Hook 执行引擎 */
  static getHookRunner(): ExtensionHookRunner | null

  /** 重置（测试用） */
  static reset(): void
}
```

调用方式：

```typescript
import { ExtensionManager } from '../extension'

// 注入 hook 调用
ExtensionManager.getHookRunner()?.runVoidHook('agent_end', event)
```

### 测试清单

| #   | 测试                                              |
| --- | ------------------------------------------------- |
| 1   | initialize → getRegistry / getHookRunner 返回实例 |
| 2   | 未初始化 → 返回 null                              |
| 3   | reset → 回到未初始化状态                          |

---

## 5. Phase 4 — ExtensionLoader（jiti + fs.watch）

### 5.1 jiti 加载

```typescript
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)

async function loadExtensionModule(entryPath: string): Promise<ExtensionModule> {
  const mod = await jiti.import(entryPath)
  return (mod as { default: ExtensionModule }).default || mod
}
```

### 5.2 发现与加载流程

```typescript
class ExtensionLoader {
  constructor(private registry: ExtensionRegistry)

  /** 扫描多级目录，加载所有 Extension */
  async loadAll(searchPaths: string[]): Promise<void>

  /** 加载单个 Extension */
  async load(dir: string, origin: ExtensionOrigin): Promise<void>

  /** 卸载单个 Extension（移除所有注册） */
  unload(extensionId: string): void

  /** 启动 fs.watch 监听所有搜索路径 */
  watch(searchPaths: string[]): void

  /** 停止监听 */
  stopWatch(): void
}
```

### 5.3 fs.watch 行为

```
新增子目录 → load(dir, origin)
删除子目录 → unload(extensionId)
修改（子目录内文件变化） → unload + load（热重载）
```

防抖：文件变化后 300ms 内的多次事件合并为一次操作。

### 5.4 ExtensionApi 构建

```typescript
function createExtensionApi(
  extensionId: string,
  name: string,
  origin: ExtensionOrigin,
  registry: ExtensionRegistry
): ExtensionApi {
  return {
    id: extensionId,
    name,
    origin,
    logger: createExtensionLogger(extensionId),
    registerTool(tool) {
      registry.registerTool(extensionId, tool)
    },
    on(hookName, handler, opts) {
      registry.registerHook({
        extensionId,
        hookName,
        handler,
        priority: opts?.priority ?? 0
      })
    },
    registerGatewayMethod(method, handler) {
      registry.registerGatewayMethod(extensionId, method, handler)
    }
  }
}
```

### 5.5 测试清单

| #   | 测试                   | 验证                                     |
| --- | ---------------------- | ---------------------------------------- |
| 1   | loadAll 空目录         | 正常返回，无注册                         |
| 2   | loadAll 单个 Extension | 读取 extension.json + jiti 加载 index.ts |
| 3   | loadAll 多目录合并     | 同 ID 高优先级覆盖                       |
| 4   | load 无 extension.json | 跳过并 warn                              |
| 5   | load register 抛错     | 该 Extension 跳过，其他正常              |
| 6   | unload                 | 移除该 extensionId 的所有注册            |
| 7   | watch — 新增子目录     | 触发 load                                |
| 8   | watch — 删除子目录     | 触发 unload                              |
| 9   | watch — 修改           | 触发 unload + load                       |
| 10  | watch — 防抖           | 300ms 内多次变化只触发一次               |

---

## 6. Phase 5 — Env 集成 + ReadyExtensionHook

### 6.1 `src/main/common/env.ts` 新增

```typescript
// paths 中新增
builtinExtensionsDir: is.dev
  ? path.join(app.getAppPath(), 'extensions')
  : path.join(process.resourcesPath, 'extensions'),

userExtensionsDir: path.join(_userHome, 'extensions'),

// 新增方法
async getExtensionSearchPaths(workspace?: string): Promise<string[]> {
  const extensionPaths = [this.paths.builtinExtensionsDir, this.paths.userExtensionsDir]
  if (workspace) {
    extensionPaths.push(path.join(workspace, 'extensions'))
  }
  for (const dir of extensionPaths) {
    if (!fs.existsSync(dir)) {
      await mkdirp(dir)
    }
  }
  return extensionPaths
}
```

### 6.2 `src/main/ai/common/AgentEnv.ts` 新增

```typescript
export interface AgentEnv {
  // ...现有字段...
  extensionPaths: string[]
}
```

### 6.3 `src/main/lifecycle/ReadyExtensionHook.ts`

```
优先级排序：
  ReadyGatewayHook        (45)
  ReadyExtensionHook      (50) ← 新增
  ReadyIpcRegistrationHook (50)
  ReadyWorkerHook          (80)
```

```typescript
export const ReadyExtensionHook: LifecycleHook = {
  name: 'ReadyExtensionHook',
  phase: LifecyclePhase.READY,
  priority: 50,
  critical: false, // Extension 加载失败不阻止应用启动
  async execute() {
    const searchPaths = await Env.getExtensionSearchPaths()
    const registry = new ExtensionRegistry()
    const loader = new ExtensionLoader(registry)

    // 1. 加载所有 Extension
    await loader.loadAll(searchPaths)

    // 2. 将 Extension 工具注入 ToolRegistry
    for (const { tool } of registry.getTools()) {
      ToolRegistry.getInstance().register(tool)
    }

    // 3. 将 Extension Gateway 方法注入 Gateway
    // （通过 gateway.registerMethod）

    // 4. 初始化全局管理器
    ExtensionManager.initialize(registry)

    // 5. 启动 fs.watch 热插拔
    loader.watch(searchPaths)
  }
}
```

---

## 7. Phase 6 — AgentExecutor + convertTools 集成

### 7.1 Hook 调用点

```
① message_received ← void
② session_start ← void
③ before_agent_start ← modifying（注入上下文）
    ↓
  runtime.stream(message)
    ├── ④ before_tool_call ← modifying（修改参数/阻止）
    ├──    工具执行
    ├── ⑤ after_tool_call ← void
    ├── ⑥ tool_result_persist ← modifying（修改结果）
    ↓
⑦ agent_end ← void
⑧ session_end ← void
```

### 7.2 修改文件

**AgentExecutor.ts**：execute() 开头注入 ①②③，结尾注入 ⑦⑧

**OpenAIAgentRuntime.ts / PiMonoAgentRuntime.ts**：convertTools() 中注入 ④⑤⑥

### 7.3 测试清单

| #   | 测试                                    | 验证                           |
| --- | --------------------------------------- | ------------------------------ |
| 1   | before_agent_start：prependContext      | 上下文追加                     |
| 2   | before_agent_start：replaceSystemPrompt | 替换生效                       |
| 3   | before_agent_start：无注册              | 正常不报错                     |
| 4   | before_tool_call：block                 | 工具不执行                     |
| 5   | before_tool_call：修改 params           | 修改后参数传给工具             |
| 6   | after_tool_call：触发                   | 参数正确                       |
| 7   | tool_result_persist：修改结果           | 修改后发给 LLM                 |
| 8   | agent_end：触发                         | success/output/durationMs 正确 |
| 9   | 多 Extension 组合                       | 按优先级执行                   |
| 10  | hook 报错不影响 Agent                   | try-catch 隔离                 |
| 11  | ExtensionManager 未初始化               | 安全跳过                       |

---

## 8. Phase 7 — 热插拔支持（unregister）

### 8.1 ToolRegistry 新增

```typescript
// src/main/ai/tools/registry.ts
unregister(name: string): boolean  // 返回是否存在并移除
```

### 8.2 Gateway 新增

```typescript
// src/main/gateway/Gateway.ts
registerMethod(fullName: string, handler: MethodHandler): void
unregisterMethod(fullName: string): boolean
```

核心方法保护：`chat.*`、`stream.*`、`worker.*`、`hitl.*` 不可覆盖。

### 8.3 ExtensionLoader.unload 联动

```typescript
unload(extensionId: string): void {
  // 1. 从 ExtensionRegistry 获取该 Extension 的所有注册
  const toolNames = this.registry.unregisterToolsByExtension(extensionId)
  const methodNames = this.registry.unregisterGatewayMethodsByExtension(extensionId)
  this.registry.unregisterHooksByExtension(extensionId)

  // 2. 同步移除 ToolRegistry 和 Gateway 的注册
  for (const name of toolNames) {
    ToolRegistry.getInstance().unregister(name)
  }
  for (const name of methodNames) {
    this.gateway?.unregisterMethod(name)
  }
}
```

### 8.3 测试清单

| #   | 测试                            | 验证                                |
| --- | ------------------------------- | ----------------------------------- |
| 1   | ToolRegistry.unregister         | 移除后 get 返回 undefined           |
| 2   | ToolRegistry.unregister 不存在  | 返回 false                          |
| 3   | Gateway.registerMethod 动态注册 | 注册后可调用                        |
| 4   | Gateway.unregisterMethod        | 移除后调用返回 method not found     |
| 5   | Gateway 核心方法保护            | chat.send 等不可覆盖                |
| 6   | 热插拔完整流程                  | load → 注册生效 → unload → 注册移除 |

---

## 9. 实施顺序

| Phase    | 内容                                       | 新建  | 修改  | 测试数  |
| -------- | ------------------------------------------ | ----- | ----- | ------- |
| **P1**   | types.ts + ExtensionRegistry               | 2     | 0     | ~10     |
| **P2**   | ExtensionHookRunner                        | 1     | 0     | ~12     |
| **P3**   | ExtensionManager                           | 1     | 0     | ~3      |
| **P4**   | ExtensionLoader + ExtensionApi + 安装 jiti | 2     | 0     | ~10     |
| **P5**   | Env 集成 + ReadyExtensionHook              | 1     | 2     | ~3      |
| **P6**   | AgentExecutor + convertTools 集成          | 0     | 3     | ~11     |
| **P7**   | ToolRegistry.unregister + Gateway 动态方法 | 0     | 2     | ~6      |
| **合计** |                                            | **7** | **7** | **~55** |

---

## 10. 验证与自我修复流程

### 10.1 每阶段验证

```
每完成一个 Phase：
  1. npx tsc --noEmit             → TypeScript 编译通过
  2. ReadLints                    → 无 lint 错误
  3. npx vitest run src/main/extension/__tests__/  → 新增测试通过
  4. npx vitest run               → 全量 724+ 测试不回归
```

### 10.2 测试分层

```
L1 — 单元测试
├── ExtensionRegistry.test.ts       → 注册/卸载/查询
├── ExtensionHookRunner.test.ts     → void/modifying/容错/合并
└── ExtensionLoader.test.ts         → jiti加载/fs.watch/热插拔

L2 — 集成测试
└── ExtensionIntegration.test.ts
    ├── Extension 工具注入 ToolRegistry → convertTools
    ├── Extension Hook 在 AgentExecutor 中触发
    ├── 热插拔：load → 生效 → unload → 移除
    └── 多 Extension 组合 + 错误隔离
```

### 10.3 自我修复流程

```
测试失败时：
  1. 分析原因（类型 / 逻辑 / 回归）
  2. 修复代码
  3. 重新全量测试
  4. 循环至全部通过
```

### 10.4 风险与缓解

| 风险                   | 缓解                                |
| ---------------------- | ----------------------------------- |
| Extension 加载导致崩溃 | `critical: false` + try-catch       |
| Hook handler 阻塞过久  | 后续可加 timeout，V1 先不加         |
| jiti 编译报错          | catch 并 log，跳过该 Extension      |
| fs.watch 跨平台差异    | 只监听一层 + 防抖 300ms             |
| 热插拔时工具名冲突     | unload 先清理旧注册，再 load 新版本 |

---

## 11. 依赖安装

```bash
pnpm add jiti
```
