# 系统架构深度分析与优化方案

## 一、当前架构全景

### 1.1 分层架构

```
┌─────────────────────────────────────────────────────────┐
│                    Electron 主进程                       │
│  ┌────────────────────────────────────────────────────┐ │
│  │              应用生命周期层 (Lifecycle)             │ │
│  │  - AppLifecycleManager                             │ │
│  │  - Hooks (BeforeQuit, BeforeClose, etc.)           │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │                 网关层 (Gateway)                    │ │
│  │  - GatewayServer (HTTP + WebSocket)                │ │
│  │  - Methods (RPC 方法注册)                           │ │
│  │  - Events (事件广播)                               │ │
│  │  - HTTP Routes (REST API)                          │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │              Agent 执行层 (AI Core)                 │ │
│  │  ┌─────────────────────────────────────────────┐   │ │
│  │  │ AgentExecutor (调度器)                      │   │ │
│  │  │  - 并发控制（busy lock）                    │   │ │
│  │  │  - Builder 工厂（piMono/openai）            │   │ │
│  │  └─────────────────────────────────────────────┘   │ │
│  │  ┌─────────────────────────────────────────────┐   │ │
│  │  │ AgentRuntime (执行引擎)                     │   │ │
│  │  │  - PiMonoAgentRuntime                       │   │ │
│  │  │  - OpenAIAgentRuntime                       │   │ │
│  │  │  - SwarmRuntime                             │   │ │
│  │  │  - OrchestratorRuntime                      │   │ │
│  │  └─────────────────────────────────────────────┘   │ │
│  │  ┌─────────────────────────────────────────────┐   │ │
│  │  │ Tool Execution Pipeline                     │   │ │
│  │  │  - Security Check                           │   │ │
│  │  │  - HITL Approval                            │   │ │
│  │  │  - Sandbox                                  │   │ │
│  │  └─────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │              存储层 (Storage)                       │ │
│  │  - AgentStore (Agent 定义)                         │ │
│  │  - ThreadStore (对话历史)                          │ │
│  │  - ConfigStore (全局配置)                          │ │
│  │  - WorkspaceManager (工作空间)                     │ │
│  │  - CheckpointManager (检查点)                      │ │
│  │  - CronJobStore (定时任务)                         │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │              扩展层 (Extensions)                    │ │
│  │  - ToolRegistry (工具扩展)                         │ │
│  │  - SkillManager (技能扩展)                         │ │
│  │  - Worker (后台服务扩展)                           │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                  Electron 渲染进程                       │
│  ┌────────────────────────────────────────────────────┐ │
│  │                   路由层 (Router)                   │ │
│  │  - Vue Router (Agent/Skills/Tavern/Brain/Cron)    │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │                   视图层 (Views)                    │ │
│  │  - AgentView / ThreadView                          │ │
│  │  - SkillsView / TavernView / BrainView            │ │
│  │  - CronView / SettingsView / LogViewer            │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │                  组件层 (Components)                │ │
│  │  - ChatPanel / WorkbenchPanel / ProjectPanel      │ │
│  │  - FileTreeNode / StatusBar / CopilotBubble       │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │                  状态层 (Stores)                    │ │
│  │  - useThreads / useAgents / useSkills             │ │
│  │  - useWorker / useCopilot / useChat               │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │               通信层 (Gateway Client)               │ │
│  │  - WebSocket RPC                                   │ │
│  │  - HTTP REST (fetch)                               │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 1.2 核心模块职责

| 模块                      | 职责                              | 代码量  | 复杂度     |
| ------------------------- | --------------------------------- | ------- | ---------- |
| **AgentExecutor**         | Agent 执行调度、并发控制          | ~1100行 | ⭐⭐⭐     |
| **AgentRuntime**          | LLM 对接、工具调用、流式输出      | ~3000行 | ⭐⭐⭐⭐⭐ |
| **Gateway**               | 前后端通信枢纽（HTTP + WS）       | ~1500行 | ⭐⭐⭐     |
| **ToolExecutionPipeline** | 工具安全校验、沙箱隔离、HITL 审批 | ~800行  | ⭐⭐⭐⭐   |
| **Store 层**              | 数据持久化（Agent/Thread/Config） | ~2000行 | ⭐⭐       |
| **Swarm/Orchestrator**    | 多 Agent 协作引擎                 | ~2500行 | ⭐⭐⭐⭐⭐ |
| **UI Components**         | Vue 组件（View/Component/Store）  | ~5000行 | ⭐⭐⭐     |

**总代码量**: ~15,000 行（TypeScript + Vue）

---

## 二、结构性问题识别

### 🔴 问题 1：Runtime 层职责过重（单一职责原则违反）

#### 当前状态

`OpenAIAgentRuntime` 和 `PiMonoAgentRuntime` 承担了过多职责：

```typescript
class OpenAIAgentRuntime {
  // 职责 1: LLM 调用
  async call() {
    /* 调用 OpenAI SDK */
  }

  // 职责 2: 工具转换与执行
  convertTools() {
    /* 工具适配 */
  }
  executeToolCall() {
    /* 执行工具 */
  }

  // 职责 3: 会话管理
  loadSession() {
    /* 加载历史 */
  }
  saveSession() {
    /* 保存历史 */
  }

  // 职责 4: 对话压缩
  compressSessionWithChunks() {
    /* 压缩逻辑 */
  }

  // 职责 5: 流式输出
  doStream() {
    /* 流式处理 */
  }

  // 职责 6: HITL 交互
  handleHITL() {
    /* 人工审批 */
  }

  // ... 共 1500+ 行
}
```

**问题**：

- ❌ 单个类 > 1500 行，难以维护
- ❌ 职责混杂，修改一个功能可能影响其他
- ❌ 测试困难（需要 mock 太多依赖）
- ❌ 复用困难（如果想单独用对话压缩）

#### 优化方案：职责分离

```typescript
// 拆分为多个独立模块

// 核心 Runtime（只负责 LLM 调用）
class OpenAIAgentRuntime {
  async call() {
    /* 纯粹的 LLM 调用 */
  }
  async *doStream() {
    /* 纯粹的流式调用 */
  }
}

// 工具执行管理器（已有 ToolExecutionPipeline，但需要增强）
class ToolExecutionManager {
  async execute(toolCall, context) {
    /* 工具执行 + 安全 + 沙箱 */
  }
}

// 会话管理器（从 Runtime 中提取）
class SessionManager {
  async load(sessionId) {
    /* 加载历史 */
  }
  async save(sessionId, messages) {
    /* 保存历史 */
  }
  async compress(sessionId) {
    /* 触发压缩 */
  }
}

// 对话压缩器（已有 SessionCompressor，可独立使用）
class SessionCompressor {
  async compress(messages) {
    /* 压缩逻辑 */
  }
}

// HITL 交互管理器（已有 HitlApprovalManager，继续增强）
class HitlInteractionManager {
  async requestApproval() {
    /* 审批请求 */
  }
  async waitForResponse() {
    /* 等待用户响应 */
  }
}
```

**好处**：

- ✅ 每个类 < 500 行，易维护
- ✅ 单一职责，修改影响面小
- ✅ 独立测试，mock 依赖少
- ✅ 模块可复用（如压缩器可被其他系统调用）

---

### 🔴 问题 2：Gateway 通信协议不统一

#### 当前状态

前后端通信使用了**三种协议**：

```typescript
// 1. WebSocket RPC (通过 gateway.call)
gateway.call('thread.create', { agentId: 'xxx' });

// 2. HTTP REST (通过 fetch)
fetch('/gateway/agents', { method: 'GET' });

// 3. Server-Sent Events (SSE, 用于 AI 创建)
POST /gateway/agents/ai-create (SSE 流式响应)
```

**问题**：

- ❌ 协议选择混乱，开发者不知道该用哪个
- ❌ 有些功能同时暴露 RPC 和 HTTP（如 Agent CRUD）
- ❌ 缺少统一的错误处理
- ❌ 缺少统一的权限控制

#### 优化方案：协议分工明确

**规范**：

| 协议                       | 适用场景                       | 示例                                                  |
| -------------------------- | ------------------------------ | ----------------------------------------------------- |
| **WS RPC**                 | 长时间运行、需要中断、流式输出 | `thread.send_message`, `agent.execute`                |
| **HTTP GET**               | 简单查询、幂等操作             | `GET /gateway/agents`, `GET /gateway/threads`         |
| **HTTP POST/PATCH/DELETE** | CRUD 操作、批量操作            | `POST /gateway/agents`, `DELETE /gateway/threads/:id` |
| **SSE**                    | 单向流式推送（不需要中断）     | AI 创建进度、日志流                                   |

**重构建议**：

```typescript
// 1. 明确协议选择标准
//    → 更新开发文档，添加协议选择决策树

// 2. 统一错误响应格式
interface ApiError {
  error: string;
  code: string; // 错误码（如 AUTH_FAILED, QUOTA_EXCEEDED）
  details?: unknown;
}

// 3. 统一权限控制（Gateway 中间件）
class GatewayAuthMiddleware {
  async check(ctx, next) {
    // 统一鉴权逻辑
  }
}
```

---

### 🔴 问题 3：前端状态管理碎片化

#### 当前状态

前端 Store 分散，部分状态重复：

```typescript
// src/renderer/src/stores/

agents.ts; // Agent 列表、当前 Agent
threads.ts; // Thread 列表、当前 Thread
chat.ts; // 消息列表、发送消息
worker.ts; // Worker 状态
copilot.ts; // Copilot 状态
skills.ts; // Skill 列表
log.ts; // 日志
loading.ts; // 全局 Loading
preference.ts; // 用户偏好
window.ts; // 窗口状态
```

**问题**：

- ❌ 10 个 Store，职责边界模糊
- ❌ `chat.ts` 和 `threads.ts` 有重复（都管理消息）
- ❌ 缺少统一的加载状态管理（每个 Store 都自己实现 loading）
- ❌ 跨 Store 依赖复杂（如 chat 依赖 threads 和 agents）

#### 优化方案：Store 整合与规范

**规范**：

1. **领域驱动**: 按业务领域组织 Store
2. **单一数据源**: 每个数据只有一个 Store 负责
3. **统一加载状态**: 提取 `useAsyncState` composable

**重构建议**：

```typescript
// 整合后的 Store 结构

// 1. 会话领域（整合 threads + chat）
stores/
  ├─ conversation.ts        // 整合 threads.ts + chat.ts
  │   - threadList          // Thread 列表
  │   - currentThread       // 当前 Thread
  │   - messageList         // 消息列表
  │   - sendMessage()       // 发送消息

// 2. Agent 领域（保持不变）
  ├─ agents.ts              // Agent 管理

// 3. 资源领域（整合 skills + worker）
  ├─ resources.ts           // 整合 skills.ts + worker.ts
  │   - skillList
  │   - workerList
  │   - loadSkills()
  │   - toggleWorker()

// 4. 应用状态（整合 loading + window + preference）
  ├─ app.ts                 // 整合 loading.ts + window.ts + preference.ts
  │   - globalLoading
  │   - windowState
  │   - userPreference

// 5. 系统服务（新增）
  ├─ copilot.ts             // 保持不变
  ├─ quota.ts               // 新增（配额管理）
  ├─ compression.ts         // 新增（压缩监控）
  └─ index.ts               // Store 注册
```

**提取 Composable**：

```typescript
// src/renderer/src/composables/useAsyncState.ts

export function useAsyncState<T>(fetcher: () => Promise<T>, initialValue: T) {
  const data = ref<T>(initialValue);
  const loading = ref(false);
  const error = ref<Error | null>(null);

  async function execute() {
    loading.value = true;
    error.value = null;
    try {
      data.value = await fetcher();
    } catch (e) {
      error.value = e instanceof Error ? e : new Error(String(e));
    } finally {
      loading.value = false;
    }
  }

  return { data, loading, error, execute };
}

// 使用示例
const {
  data: agents,
  loading,
  execute: loadAgents
} = useAsyncState(() => fetch('/gateway/agents').then((r) => r.json()), []);
```

---

### 🟡 问题 4：配置分散（多处配置源）

#### 当前状态

配置分散在多个地方：

```typescript
// 1. 全局配置
.home/config/coobee.json5          // 主配置
.home/config/skills.json5          // Skill 配置
.home/secrets/secrets.json5        // 密钥配置

// 2. Agent 配置
.home/agents/{agent-id}.json       // 每个 Agent 独立配置

// 3. Workspace 配置
.home/workspaces/{id}/config.json  // 工作空间配置

// 4. 前端配置
src/renderer/src/config.ts         // 前端静态配置
window.envConfig                   // 环境变量注入
```

**问题**：

- ❌ 配置查找困难（不知道某个配置在哪个文件）
- ❌ 覆盖规则不清晰（全局 vs Agent vs Workspace）
- ❌ 缺少配置校验（手动编辑容易出错）
- ❌ 缺少配置迁移机制（版本升级时）

#### 优化方案：配置层级与优先级

**规范**：

```
配置优先级（从高到低）:
Workspace Config > Agent Config > User Config > Global Config > Default Config

查找规则:
1. 查找 workspace/config.json
2. 查找 agents/{agent-id}.json
3. 查找 .home/config/coobee.json5
4. 使用代码中的默认值
```

**实施**：

```typescript
// src/main/common/config/ConfigResolver.ts

export class ConfigResolver {
  /**
   * 解析配置（按优先级合并）
   */
  static resolve<T>(
    key: string,
    context: {
      workspaceId?: string;
      agentId?: string;
      userId?: string;
    }
  ): T {
    // 1. Workspace 级
    const workspaceConfig = context.workspaceId ? this.loadWorkspaceConfig(context.workspaceId) : null;

    // 2. Agent 级
    const agentConfig = context.agentId ? this.loadAgentConfig(context.agentId) : null;

    // 3. User 级
    const userConfig = ConfigStore.getInstance();

    // 4. Global 级（代码默认值）
    const defaultConfig = DEFAULT_CONFIG;

    // 合并（优先级从高到低）
    return _.merge({}, defaultConfig, userConfig.get(key), agentConfig?.[key], workspaceConfig?.[key]);
  }
}
```

---

### 🟡 问题 5：工具系统缺少统一抽象

#### 当前状态

工具定义分散：

```typescript
// 内置工具
src/main/ai/tools/builtin/
  ├─ read.ts        // 各自实现 execute 函数
  ├─ write.ts
  ├─ exec.ts
  ├─ search.ts
  ├─ memory.ts
  └─ ...

// Extension 工具
.home/extensions/custom-tools/
  └─ my-tool.json   // 不同格式
```

**问题**：

- ❌ 缺少统一的基类（没有 `AbstractTool`）
- ❌ 每个工具重复实现参数校验
- ❌ 错误处理不一致
- ❌ 缺少工具生命周期钩子

#### 优化方案：工具抽象层

```typescript
// src/main/ai/tools/AbstractTool.ts

export abstract class AbstractTool<TParams = unknown, TResult = unknown> {
  /** 工具名称 */
  abstract readonly name: string;

  /** 工具描述 */
  abstract readonly description: string;

  /** 参数 Schema */
  abstract readonly parameters: JSONSchema;

  /** 工具类别（用于分组） */
  readonly category?: 'file' | 'exec' | 'memory' | 'agent' | 'misc';

  /**
   * 参数校验（自动调用，子类无需实现）
   */
  private async validateParams(params: unknown): Promise<TParams> {
    // 使用 ajv 校验参数
    const valid = this.validator.validate(this.parameters, params);
    if (!valid) {
      throw new ToolValidationError(this.validator.errors);
    }
    return params as TParams;
  }

  /**
   * 执行前钩子（可选覆盖）
   */
  protected async beforeExecute(params: TParams, ctx: ToolExecutionContext): Promise<void> {
    // 子类可以覆盖，做预处理
  }

  /**
   * 执行工具（子类必须实现）
   */
  protected abstract doExecute(params: TParams, ctx: ToolExecutionContext): Promise<TResult>;

  /**
   * 执行后钩子（可选覆盖）
   */
  protected async afterExecute(result: TResult, ctx: ToolExecutionContext): Promise<void> {
    // 子类可以覆盖，做后处理（如日志、统计）
  }

  /**
   * 错误处理（统一）
   */
  protected handleError(error: unknown): ToolError {
    if (error instanceof ToolError) return error;
    return new ToolError(`Tool ${this.name} failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  /**
   * 公共执行入口（final，子类不可覆盖）
   */
  async execute(params: unknown, ctx: ToolExecutionContext): Promise<TResult> {
    const validatedParams = await this.validateParams(params);

    await this.beforeExecute(validatedParams, ctx);

    try {
      const result = await this.doExecute(validatedParams, ctx);
      await this.afterExecute(result, ctx);
      return result;
    } catch (error) {
      throw this.handleError(error);
    }
  }
}
```

**使用示例**：

```typescript
// src/main/ai/tools/builtin/read.ts（重构后）

export class ReadTool extends AbstractTool<ReadParams, ReadResult> {
  readonly name = 'read';
  readonly description = '读取文件内容';
  readonly category = 'file';
  readonly parameters = {
    type: 'object',
    properties: {
      path: { type: 'string' },
      encoding: { type: 'string', default: 'utf-8' }
    },
    required: ['path']
  };

  // 只需要实现核心逻辑
  protected async doExecute(params: ReadParams, ctx: ToolExecutionContext): Promise<ReadResult> {
    const content = await fs.promises.readFile(params.path, params.encoding);
    return { content, size: content.length };
  }

  // 可选：添加后处理（如统计）
  protected async afterExecute(result: ReadResult, ctx: ToolExecutionContext): Promise<void> {
    // 记录文件读取统计
    this.metrics.recordFileRead(result.size);
  }
}
```

**好处**：

- ✅ 参数校验自动化
- ✅ 错误处理统一
- ✅ 生命周期钩子可复用
- ✅ 新增工具只需实现 `doExecute`

---

### 🟡 问题 6：事件系统缺少类型安全

#### 当前状态

Gateway 事件是字符串：

```typescript
// 发送事件
gateway.broadcastToSubscribers(
  {
    type: 'event',
    event: 'compression:done', // ❌ 字符串，容易拼错
    data: {
      /* ... */
    }
  },
  sessionId
);

// 监听事件
gateway.on('compression:done', (data) => {
  // ❌ data 类型是 any
  console.log(data.originalTokens);
});
```

**问题**：

- ❌ 事件名拼写错误无法在编译时发现
- ❌ 事件数据类型不明确（any）
- ❌ 难以追踪哪些组件监听了哪些事件
- ❌ 重构时容易漏改

#### 优化方案：类型安全的事件系统

```typescript
// src/shared/events/types.ts

// 定义所有事件类型
export interface EventMap {
  'compression:done': {
    sessionId: string;
    originalTokens: number;
    summaryTokens: number;
    compressionRatio: number;
    duration: number;
  };

  'service:started': {
    url: string;
    title: string;
    sessionId: string;
  };

  'terminal:output': {
    sessionId: string;
    output: string;
  };

  'agent:execution:start': {
    agentId: string;
    sessionId: string;
  };

  'agent:execution:done': {
    agentId: string;
    sessionId: string;
    duration: number;
  };

  // ... 更多事件
}

// 类型安全的事件发送
export class TypedEventEmitter {
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    // 实现
  }

  on<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): void {
    // 实现
  }
}

// 使用示例
gateway.emit('compression:done', {
  sessionId: 'xxx',
  originalTokens: 45000,
  summaryTokens: 5850,
  compressionRatio: 0.13,
  duration: 3200
});
// ✅ TypeScript 会检查 data 类型

gateway.on('compression:done', (data) => {
  console.log(data.originalTokens); // ✅ data 类型已知
});
```

---

### 🟢 问题 7：缺少统一的日志查询接口

#### 当前状态

日志分散：

```typescript
// 1. 控制台日志（createLogger）
log.info('xxx');  // → 输出到 .home/logs/coobee-ai.log

// 2. Agent 执行日志
.home/workspaces/{id}/events/      // Event 日志

// 3. Gateway 日志
// 无单独文件，混在主日志中

// 4. Worker 日志
// 无单独文件，混在主日志中
```

**问题**：

- ❌ 日志混杂，难以过滤
- ❌ 前端查看日志只能读全部文件（LogViewer.vue）
- ❌ 缺少日志搜索/过滤 API
- ❌ 缺少日志级别动态调整

#### 优化方案：日志服务

```typescript
// src/main/common/observability/LogService.ts

export interface LogQuery {
  level?: 'debug' | 'info' | 'warn' | 'error';
  module?: string; // 如 'gateway', 'ai', 'worker'
  timeRange?: { start: Date; end: Date };
  keyword?: string;
  limit?: number;
  offset?: number;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  module: string;
  message: string;
  data?: unknown;
}

export class LogService {
  /**
   * 查询日志（支持过滤）
   */
  async query(query: LogQuery): Promise<LogEntry[]> {
    // 读取日志文件
    // 解析并过滤
    // 返回结果
  }

  /**
   * 实时订阅日志
   */
  subscribe(query: LogQuery, handler: (entry: LogEntry) => void): () => void {
    // 监听日志文件变化
    // 推送匹配的新日志
  }

  /**
   * 动态调整日志级别
   */
  setLevel(module: string, level: string): void {
    // 运行时调整日志级别
  }
}
```

**Gateway API**：

```typescript
// GET /gateway/logs?level=error&module=ai&limit=100
router.get('/logs', async (ctx) => {
  const query = ctx.query as LogQuery;
  const logs = await LogService.query(query);
  ctx.body = { logs };
});

// WebSocket 实时日志流
gateway.on('logs:subscribe', async (params) => {
  const unsubscribe = LogService.subscribe(params.query, (entry) => {
    gateway.emit('logs:entry', entry);
  });
});
```

---

### 🟢 问题 8：缺少统一的错误处理策略

#### 当前状态

错误处理分散：

```typescript
// 各模块各自处理错误
try {
  await someOperation();
} catch (err) {
  console.error('Error:', err); // ❌ 不一致
  throw new Error(String(err)); // ❌ 丢失堆栈
}
```

**问题**：

- ❌ 错误格式不统一
- ❌ 缺少错误码（无法区分错误类型）
- ❌ 缺少错误上报机制
- ❌ 用户看到的错误信息不友好

#### 优化方案：统一错误类型

```typescript
// src/shared/errors/index.ts

export enum ErrorCode {
  // 系统错误 (1000-1999)
  SYSTEM_INTERNAL = 1000,
  SYSTEM_TIMEOUT = 1001,
  SYSTEM_QUOTA_EXCEEDED = 1002,

  // 配置错误 (2000-2999)
  CONFIG_INVALID = 2000,
  CONFIG_MISSING = 2001,

  // Agent 错误 (3000-3999)
  AGENT_NOT_FOUND = 3000,
  AGENT_EXECUTION_FAILED = 3001,

  // 工具错误 (4000-4999)
  TOOL_NOT_FOUND = 4000,
  TOOL_EXECUTION_FAILED = 4001,
  TOOL_PERMISSION_DENIED = 4002,

  // 文件错误 (5000-5999)
  FILE_NOT_FOUND = 5000,
  FILE_PERMISSION_DENIED = 5001,

  // 网络错误 (6000-6999)
  NETWORK_TIMEOUT = 6000,
  NETWORK_CONNECTION_FAILED = 6001
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
    public recoverable: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
  }

  /**
   * 用户友好的错误描述
   */
  getUserMessage(): string {
    const messages: Record<number, string> = {
      [ErrorCode.AGENT_NOT_FOUND]: '未找到指定的 Agent，请检查配置',
      [ErrorCode.SYSTEM_QUOTA_EXCEEDED]: 'API 配额已用完，请稍后再试',
      [ErrorCode.TOOL_PERMISSION_DENIED]: '工具执行被拒绝，请检查权限设置'
      // ...
    };
    return messages[this.code] || this.message;
  }

  /**
   * 转换为 JSON（用于 API 响应）
   */
  toJSON() {
    return {
      error: this.message,
      code: ErrorCode[this.code],
      codeValue: this.code,
      details: this.details,
      recoverable: this.recoverable
    };
  }
}

// 特定错误类
export class AgentNotFoundError extends AppError {
  constructor(agentId: string) {
    super(ErrorCode.AGENT_NOT_FOUND, `Agent "${agentId}" not found`, { agentId }, false);
  }
}

export class QuotaExceededError extends AppError {
  constructor(remaining: number, required: number) {
    super(
      ErrorCode.SYSTEM_QUOTA_EXCEEDED,
      `Quota exceeded: need ${required}, only ${remaining} left`,
      { remaining, required },
      true
    );
  }
}
```

**使用示例**：

```typescript
// Agent 执行中
async function executeAgent(agentId: string) {
  const agent = await AgentStore.get(agentId);
  if (!agent) {
    throw new AgentNotFoundError(agentId);
  }

  // 检查配额
  if (quotaManager.getRemaining() < 10) {
    throw new QuotaExceededError(quotaManager.getRemaining(), 10);
  }

  // ...
}

// Gateway 统一错误处理
router.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    if (err instanceof AppError) {
      ctx.status = getHttpStatus(err.code);
      ctx.body = err.toJSON();
    } else {
      ctx.status = 500;
      ctx.body = { error: 'Internal Server Error' };
    }
  }
});

// 前端统一错误提示
async function handleApiError(error: unknown) {
  if (error instanceof AppError) {
    showToast(error.getUserMessage(), 'error');

    // 可恢复错误 → 提供重试按钮
    if (error.recoverable) {
      showRetryButton();
    }
  }
}
```

---

### 🟢 问题 9：缺少性能监控和追踪

#### 当前状态

没有系统级的性能监控：

```typescript
// 各模块各自计时
const startTime = Date.now();
await doSomething();
const duration = Date.now() - startTime;
log.info(`Took ${duration}ms`); // ❌ 分散、难以汇总
```

**问题**：

- ❌ 缺少统一的性能指标收集
- ❌ 难以定位性能瓶颈
- ❌ 缺少性能趋势分析
- ❌ 缺少告警机制（如某个操作超过 30s）

#### 优化方案：性能追踪系统

```typescript
// src/main/common/observability/PerformanceTracker.ts

export interface PerformanceMetric {
  operation: string; // 操作名称（如 'agent.execute', 'tool.read'）
  duration: number; // 耗时（ms）
  timestamp: number; // 时间戳
  context?: {
    agentId?: string;
    toolName?: string;
    fileSize?: number;
    // ...
  };
  success: boolean;
  error?: string;
}

export class PerformanceTracker {
  private metrics: PerformanceMetric[] = [];

  /**
   * 追踪异步操作
   */
  async trace<T>(operation: string, fn: () => Promise<T>, context?: Record<string, unknown>): Promise<T> {
    const startTime = Date.now();
    let success = true;
    let error: string | undefined;

    try {
      return await fn();
    } catch (e) {
      success = false;
      error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      this.metrics.push({
        operation,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
        context,
        success,
        error
      });

      // 如果超过阈值，记录告警
      const threshold = this.getThreshold(operation);
      if (Date.now() - startTime > threshold) {
        log.warn(`[Performance] ${operation} took ${Date.now() - startTime}ms (threshold: ${threshold}ms)`);
      }
    }
  }

  /**
   * 获取操作的性能统计
   */
  getStats(operation: string): {
    count: number;
    avgDuration: number;
    p50: number;
    p95: number;
    p99: number;
    successRate: number;
  } {
    const filtered = this.metrics.filter((m) => m.operation === operation);
    // 计算统计指标
    // ...
  }

  /**
   * 导出性能报告
   */
  exportReport(): PerformanceReport {
    // 生成报告
  }
}

// 全局单例
export const performanceTracker = new PerformanceTracker();
```

**使用示例**：

```typescript
// Agent 执行中
async function executeAgent(agentId: string, message: string) {
  return performanceTracker.trace(
    'agent.execute',
    async () => {
      // 原有逻辑
      const result = await runtime.run(message);
      return result;
    },
    { agentId, messageLength: message.length }
  );
}

// 工具执行中
async function executeTool(toolName: string, params: unknown) {
  return performanceTracker.trace(
    `tool.${toolName}`,
    async () => {
      // 原有逻辑
      return await tool.execute(params, ctx);
    },
    { toolName, paramsSize: JSON.stringify(params).length }
  );
}
```

**Gateway API**：

```typescript
// GET /gateway/metrics/performance?operation=agent.execute
router.get('/metrics/performance', async (ctx) => {
  const { operation } = ctx.query;
  const stats = performanceTracker.getStats(operation);
  ctx.body = { stats };
});
```

---

## 三、架构优化总体方案

### 3.1 模块重组（大重构）

#### 当前问题

```
src/main/ai/  (所有 AI 相关功能都堆在这里)
  ├─ agents/            (Agent 定义)
  ├─ runtime/           (执行引擎)
  ├─ tools/             (工具)
  ├─ skills/            (技能)
  ├─ swarm/             (Swarm)
  ├─ orchestration/     (Orchestrator)
  ├─ threads/           (Thread)
  ├─ memory/            (Memory)
  ├─ pipeline/          (Pipeline)
  ├─ streaming/         (Streaming)
  ├─ sandbox/           (Sandbox)
  ├─ provider/          (Provider)
  ├─ services/          (Services)
  └─ ...                (16 个子目录，职责混杂)
```

#### 优化后（领域驱动）

```
src/main/
  ├─ core/                          (核心领域)
  │   ├─ agents/                    (Agent 领域)
  │   │   ├─ AgentStore.ts
  │   │   ├─ AgentExecutor.ts
  │   │   ├─ AgentBuilder.ts
  │   │   └─ AgentLifecycle.ts
  │   │
  │   ├─ runtime/                   (运行时引擎)
  │   │   ├─ pimono/
  │   │   ├─ openai/
  │   │   ├─ swarm/
  │   │   ├─ orchestrator/
  │   │   └─ AbstractAgentRuntime.ts
  │   │
  │   ├─ tools/                     (工具系统)
  │   │   ├─ AbstractTool.ts
  │   │   ├─ ToolRegistry.ts
  │   │   ├─ ToolExecutionPipeline.ts
  │   │   └─ builtin/
  │   │
  │   ├─ skills/                    (技能系统)
  │   │   ├─ SkillManager.ts
  │   │   ├─ SkillLoader.ts
  │   │   └─ SkillResolver.ts
  │   │
  │   └─ conversations/             (对话领域)
  │       ├─ ThreadStore.ts
  │       ├─ MessageStore.ts
  │       ├─ SessionCompressor.ts
  │       └─ CheckpointManager.ts
  │
  ├─ infrastructure/                (基础设施)
  │   ├─ storage/                   (存储)
  │   │   ├─ FileSystemStore.ts
  │   │   ├─ WorkspaceManager.ts
  │   │   └─ CronJobStore.ts
  │   │
  │   ├─ communication/             (通信)
  │   │   ├─ Gateway.ts
  │   │   ├─ WebSocketServer.ts
  │   │   ├─ HttpServer.ts
  │   │   └─ IpcBridge.ts
  │   │
  │   ├─ security/                  (安全)
  │   │   ├─ Sandbox.ts
  │   │   ├─ ExecPolicy.ts
  │   │   └─ HitlApprovalManager.ts
  │   │
  │   └─ observability/             (可观测性)
  │       ├─ Logger.ts
  │       ├─ LogService.ts
  │       ├─ PerformanceTracker.ts
  │       └─ EventBus.ts
  │
  ├─ services/                      (应用服务)
  │   ├─ QuotaManager.ts            (配额管理)
  │   ├─ WorkerManager.ts           (Worker 管理)
  │   ├─ ExtensionLoader.ts         (扩展加载)
  │   └─ MigrationService.ts        (数据迁移)
  │
  └─ application/                   (应用层)
      ├─ AppLifecycleManager.ts
      └─ index.ts
```

**好处**：

- ✅ 领域清晰（core/infrastructure/services/application）
- ✅ 依赖方向单向（application → services → core → infrastructure）
- ✅ 便于测试（每个领域独立）
- ✅ 新人快速理解系统结构

---

### 3.2 依赖注入（减少耦合）

#### 当前问题

**硬编码依赖**：

```typescript
// AgentExecutor 直接 import 具体实现
import { AgentStore } from './agents/AgentStore';
import { ThreadStore } from './threads/ThreadStore';
import { ConfigStore } from '@main/common/config/ConfigStore';

class AgentExecutor {
  async execute() {
    const agent = await AgentStore.getInstance().get(agentId); // ❌ 硬编码
    const thread = await ThreadStore.getInstance().get(threadId); // ❌ 硬编码
  }
}
```

**问题**：

- ❌ 单元测试困难（无法 mock Store）
- ❌ 循环依赖风险（Store 之间互相引用）
- ❌ 替换实现困难（如想用数据库替代文件系统）

#### 优化方案

```typescript
// src/main/core/Container.ts（简单的 DI 容器）

export class Container {
  private services = new Map<string, any>();

  register<T>(name: string, factory: () => T): void {
    this.services.set(name, factory);
  }

  resolve<T>(name: string): T {
    const factory = this.services.get(name);
    if (!factory) {
      throw new Error(`Service "${name}" not registered`);
    }
    return factory();
  }
}

// 全局容器
export const container = new Container();

// 注册服务
container.register('agentStore', () => AgentStore.getInstance());
container.register('threadStore', () => ThreadStore.getInstance());
container.register('configStore', () => ConfigStore.getInstance());

// 使用依赖注入
class AgentExecutor {
  constructor(
    private agentStore: AgentStore,
    private threadStore: ThreadStore,
    private configStore: ConfigStore
  ) {}

  async execute() {
    const agent = await this.agentStore.get(agentId); // ✅ 可 mock
    const thread = await this.threadStore.get(threadId);
  }
}

// 创建实例（通过容器）
const executor = new AgentExecutor(
  container.resolve('agentStore'),
  container.resolve('threadStore'),
  container.resolve('configStore')
);
```

---

### 3.3 事件驱动架构增强

#### 当前问题

事件系统不完整：

```typescript
// 当前只有部分事件
gateway.emit('compression:done', { ... });
gateway.emit('service:started', { ... });

// 但很多重要事件缺失
// ❌ Agent 开始执行（agent:execution:start）
// ❌ Agent 执行完成（agent:execution:done）
// ❌ 工具调用开始（tool:call:start）
// ❌ 配额更新（quota:updated）
// ❌ Memory 写入（memory:write）
```

**问题**：

- ❌ 事件不完整，很多操作无法监听
- ❌ 前端无法实时响应后端状态变化
- ❌ 缺少事件历史记录（用于回溯）

#### 优化方案：完整的事件系统

```typescript
// 定义所有关键事件

export interface EventMap {
  // === Agent 生命周期 ===
  'agent:execution:start': { agentId: string; sessionId: string };
  'agent:execution:done': { agentId: string; sessionId: string; duration: number };
  'agent:execution:error': { agentId: string; sessionId: string; error: string };

  // === 工具调用 ===
  'tool:call:start': { toolName: string; callId: string };
  'tool:call:done': { toolName: string; callId: string; duration: number };
  'tool:call:error': { toolName: string; callId: string; error: string };

  // === 多 Agent 协作 ===
  'swarm:handoff': { from: string; to: string; depth: number };
  'orchestrator:subtask:start': { taskId: string; agentId: string };
  'orchestrator:subtask:done': { taskId: string; agentId: string; result: string };

  // === 质量保证 ===
  'quality:aggregate:start': { sessionId: string };
  'quality:aggregate:done': { sessionId: string; summary: unknown };
  'quality:validate:start': { sessionId: string; round: number };
  'quality:validate:done': { sessionId: string; passed: boolean; score: number };
  'quality:repair:start': { sessionId: string; strategy: string };
  'quality:repair:done': { sessionId: string; improved: boolean };

  // === 资源管理 ===
  'quota:updated': { remaining: number; total: number; resetAt: Date };
  'quota:warning': { remaining: number; threshold: number };
  'quota:exhausted': { resetAt: Date };

  // === 系统服务 ===
  'service:started': { url: string; title: string; sessionId: string };
  'service:stopped': { url: string; sessionId: string };
  'worker:status:changed': { name: string; status: string };

  // === 存储 ===
  'memory:write': { scope: string; file: string; size: number };
  'brain:publish': { packageId: string; category: string };
  'compression:done': { sessionId: string; ratio: number; savedTokens: number };

  // === 终端 ===
  'terminal:output': { sessionId: string; output: string };
  'terminal:error': { sessionId: string; error: string };
}
```

**事件历史记录**：

```typescript
// src/main/common/observability/EventHistory.ts

export class EventHistory {
  private events: Array<{
    timestamp: number;
    eventType: keyof EventMap;
    data: unknown;
  }> = [];

  /**
   * 记录事件
   */
  record<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.events.push({
      timestamp: Date.now(),
      eventType: event,
      data
    });

    // 保留最近 1000 条
    if (this.events.length > 1000) {
      this.events.shift();
    }
  }

  /**
   * 查询事件
   */
  query(filter: {
    eventType?: keyof EventMap;
    timeRange?: { start: Date; end: Date };
    sessionId?: string;
  }): typeof this.events {
    // 过滤查询
  }
}
```

---

### 3.4 前端架构优化

#### 问题：组件过度耦合

```vue
<!-- ThreadView.vue（600+ 行，职责混杂） -->
<script setup>
// 职责 1: Thread 管理
const currentThread = ref(null);

// 职责 2: 文件树管理
const fileTree = ref([]);

// 职责 3: 对话管理
const messages = ref([]);

// 职责 4: Workbench 管理
const openFiles = ref([]);

// 职责 5: Agent 选择
const selectedAgent = ref(null);

// ... 600+ 行
</script>
```

**问题**：

- ❌ 单个组件承担太多职责
- ❌ 状态分散在组件内部，难以复用
- ❌ 难以测试（需要 mount 整个组件）

#### 优化方案：Container/Presentational 模式

```vue
<!-- ThreadView.vue（重构后，<100 行） -->
<script setup>
// 只负责布局和数据流转
const threadStore = useThreadStore();
const workspaceStore = useWorkspaceStore();

// 职责清晰：组合子组件
</script>

<template>
  <div class="thread-view">
    <Sidebar />
    <ProjectPanel :thread-id="threadStore.currentThreadId" />
    <ChatPanel :thread-id="threadStore.currentThreadId" />
    <WorkbenchPanel :workspace-id="workspaceStore.currentWorkspaceId" />
  </div>
</template>
```

```vue
<!-- ProjectPanel.vue（重构后，聚焦文件树） -->
<script setup>
const props = defineProps<{ threadId: string }>();

// 只负责文件树相关逻辑
const { fileTree, loading, loadTree } = useFileTree(props.threadId);
const { copyFile, deleteFile, uploadFile } = useFileOperations(props.threadId);
</script>
```

```typescript
// src/renderer/src/composables/useFileTree.ts

export function useFileTree(threadId: string) {
  const tree = ref<FileNode[]>([]);
  const loading = ref(false);

  async function loadTree() {
    // 加载逻辑
  }

  return { tree, loading, loadTree };
}
```

---

## 四、优化优先级与实施计划

### 4.1 结构性问题优先级

| 问题               | 影响范围 | 重构成本 | 优先级 | 建议行动                     |
| ------------------ | -------- | -------- | ------ | ---------------------------- |
| Runtime 职责过重   | 核心     | 高       | P1     | 渐进式重构（提取模块）       |
| Gateway 协议不统一 | 全局     | 中       | P2     | 编写规范 + 逐步对齐          |
| 前端 Store 碎片化  | 前端     | 中       | P2     | 整合 Store（2-3 天）         |
| 配置分散           | 全局     | 低       | P3     | 添加 ConfigResolver          |
| 工具系统缺少抽象   | 工具     | 中       | P2     | 创建 AbstractTool 基类       |
| 事件系统类型不安全 | 全局     | 低       | P3     | 定义 EventMap 类型           |
| 缺少日志查询接口   | 运维     | 低       | P3     | 实现 LogService              |
| 缺少统一错误处理   | 全局     | 中       | P2     | 定义 AppError 体系           |
| 缺少性能监控       | 运维     | 低       | P3     | 实现 PerformanceTracker      |
| 模块重组（大重构） | 全局     | 极高     | P4     | 暂不推荐（风险大，收益延后） |

### 4.2 推荐实施顺序

#### Sprint 1: 快速见效（3-5 天）

**不需要大重构，立即可做的改进：**

```
1. 统一错误处理（1 天）
   ✅ 定义 AppError 类型体系
   ✅ Gateway 统一错误中间件
   ✅ 前端统一错误提示

2. 事件系统类型安全（0.5 天）
   ✅ 定义 EventMap
   ✅ 重构 gateway.emit/on

3. 日志查询接口（1 天）
   ✅ LogService 实现
   ✅ GET /gateway/logs API
   ✅ 前端日志过滤 UI

4. 性能追踪基础（1 天）
   ✅ PerformanceTracker 实现
   ✅ 关键路径埋点
   ✅ GET /gateway/metrics API

5. 前端 Store 整合（1-2 天）
   ✅ 整合 threads + chat → conversation.ts
   ✅ 整合 skills + worker → resources.ts
   ✅ 提取 useAsyncState composable
```

#### Sprint 2: 结构性改进（5-7 天）

**需要一定重构，但收益明显：**

```
1. 工具系统抽象（2-3 天）
   ✅ 创建 AbstractTool 基类
   ✅ 重构现有工具继承 AbstractTool
   ✅ 统一参数校验和错误处理

2. Runtime 职责分离（3-4 天）
   ✅ 提取 SessionManager
   ✅ 提取 ToolExecutionManager
   ✅ Runtime 只负责 LLM 调用

3. 配置解析器（1 天）
   ✅ 实现 ConfigResolver
   ✅ 支持多层级覆盖
   ✅ 配置校验
```

#### Sprint 3: 大重构（按需，2-3 周）

**只有在上述改进完成后，再考虑：**

```
1. 模块重组（领域驱动）
   ⏸ 评估风险和收益
   ⏸ 制定详细迁移计划
   ⏸ 分批迁移（先后端，再前端）

2. 数据库替代文件系统（可选）
   ⏸ 评估性能瓶颈
   ⏸ 如果文件系统足够快，暂不迁移
```

---

## 五、立即可做的快速优化（明天实施）

### 5.1 统一错误处理（1 天）

#### 文件清单

```
1. src/shared/errors/index.ts          (新建，定义错误类型)
2. src/shared/errors/codes.ts          (新建，错误码枚举)
3. src/main/gateway/middleware/errorHandler.ts  (新建，Gateway 错误中间件)
4. src/renderer/src/utils/errorHandler.ts       (新建，前端错误处理)
```

#### 测试验证

```typescript
// 测试 1: 错误码正确性
expect(new AgentNotFoundError('test').code).toBe(ErrorCode.AGENT_NOT_FOUND);

// 测试 2: 用户友好提示
expect(new QuotaExceededError(0, 10).getUserMessage()).toContain('配额已用完');

// 测试 3: Gateway 错误响应
const res = await fetch('/gateway/agents/not-exist');
expect(res.status).toBe(404);
expect(await res.json()).toEqual({
  error: 'Agent "not-exist" not found',
  code: 'AGENT_NOT_FOUND',
  codeValue: 3000
});
```

---

### 5.2 事件系统类型安全（0.5 天）

#### 文件清单

```
1. src/shared/events/types.ts      (新建，定义 EventMap)
2. src/main/gateway/Gateway.ts     (修改，使用类型安全的 emit/on)
3. src/renderer/src/composables/useGateway.ts  (修改，类型安全)
```

#### 测试验证

```typescript
// 测试 1: 编译时类型检查
gateway.emit('compression:done', {
  sessionId: 'xxx',
  originalTokens: 45000 // ✅ TypeScript 检查类型
});

gateway.emit('compression:done', {
  sessionId: 'xxx'
  // ❌ TypeScript 报错：缺少 originalTokens
});

// 测试 2: 监听器类型推断
gateway.on('compression:done', (data) => {
  console.log(data.originalTokens); // ✅ data 类型已知
});
```

---

### 5.3 日志查询接口（1 天）

#### 文件清单

```
1. src/main/common/observability/LogService.ts     (新建，日志服务)
2. src/main/gateway/http/logs.ts                   (新建，HTTP 路由)
3. src/renderer/src/views/LogViewer.vue            (修改，使用新 API)
```

#### API 设计

```typescript
// GET /gateway/logs
// Query: ?level=error&module=ai&keyword=timeout&limit=100

interface LogQuery {
  level?: 'debug' | 'info' | 'warn' | 'error';
  module?: string;
  keyword?: string;
  timeRange?: { start: string; end: string };
  limit?: number;
  offset?: number;
}

// Response:
{
  logs: [
    {
      timestamp: "2026-02-24T10:30:00Z",
      level: "error",
      module: "ai",
      message: "Agent execution failed",
      data: { agentId: "xxx", error: "..." }
    }
  ],
  total: 1234,
  hasMore: true
}
```

---

### 5.4 性能追踪基础（1 天）

#### 埋点策略

```typescript
// 关键路径埋点

// 1. Agent 执行
performanceTracker.trace(
  'agent.execute',
  async () => {
    return await runtime.run(message);
  },
  { agentId, messageLength: message.length }
);

// 2. 工具调用
performanceTracker.trace(
  `tool.${toolName}`,
  async () => {
    return await tool.execute(params, ctx);
  },
  { toolName, paramsSize: JSON.stringify(params).length }
);

// 3. LLM 调用
performanceTracker.trace(
  'llm.call',
  async () => {
    return await client.chat.completions.create(params);
  },
  { model, inputTokens, outputTokens }
);

// 4. 文件操作
performanceTracker.trace(
  'file.read',
  async () => {
    return await fs.promises.readFile(path);
  },
  { path, size }
);
```

#### API 设计

```typescript
// GET /gateway/metrics/performance?operation=agent.execute

{
  operation: "agent.execute",
  stats: {
    count: 145,
    avgDuration: 8520,    // 平均 8.5s
    p50: 6200,            // 中位数 6.2s
    p95: 24500,           // 95分位 24.5s
    p99: 48200,           // 99分位 48.2s
    successRate: 0.96,    // 成功率 96%
    slowestCalls: [
      { duration: 78200, context: { agentId: 'xxx' } }
    ]
  }
}
```

---

### 5.5 前端 Store 整合（1-2 天）

#### 具体操作

```typescript
// 1. 创建 conversation.ts（整合 threads + chat）
export const useConversationStore = defineStore('conversation', {
  state: () => ({
    // 来自 threads.ts
    threadList: [],
    currentThreadId: null,

    // 来自 chat.ts
    messageList: [],
    sending: false
  }),

  actions: {
    // 整合两者的 actions
    async loadThreads() {
      /* ... */
    },
    async sendMessage() {
      /* ... */
    }
  }
});

// 2. 创建 resources.ts（整合 skills + worker）
export const useResourcesStore = defineStore('resources', {
  state: () => ({
    skillList: [],
    workerList: []
  }),

  actions: {
    async loadSkills() {
      /* ... */
    },
    async toggleWorker() {
      /* ... */
    }
  }
});

// 3. 删除旧的 Store
// rm src/renderer/src/stores/threads.ts
// rm src/renderer/src/stores/chat.ts
// rm src/renderer/src/stores/skills.ts
// rm src/renderer/src/stores/worker.ts

// 4. 更新引用
// 查找所有引用 useThreadsStore 的地方
// 替换为 useConversationStore
```

---

## 六、架构优化总览

### 6.1 优化地图

```
立即可做（Sprint 1，3-5 天）
━━━━━━━━━━━━━━━━━━━━━━━━
✅ 统一错误处理 (1天)
✅ 事件系统类型安全 (0.5天)
✅ 日志查询接口 (1天)
✅ 性能追踪基础 (1天)
✅ 前端 Store 整合 (1-2天)

中期优化（Sprint 2，5-7 天）
━━━━━━━━━━━━━━━━━━━━━━━━
✅ 工具系统抽象 (2-3天)
✅ Runtime 职责分离 (3-4天)
✅ 配置解析器 (1天)

长期重构（Sprint 3，按需）
━━━━━━━━━━━━━━━━━━━━━━━━
⏸ 模块重组（领域驱动）
⏸ 依赖注入容器
⏸ 数据库迁移（可选）
```

### 6.2 收益预估

| 优化项             | 代码质量 | 可维护性 | 性能 | 用户体验 | 总收益     |
| ------------------ | -------- | -------- | ---- | -------- | ---------- |
| 统一错误处理       | ⭐⭐⭐   | ⭐⭐⭐   | -    | ⭐⭐⭐   | 高         |
| 事件类型安全       | ⭐⭐⭐   | ⭐⭐⭐   | -    | -        | 中         |
| 日志查询接口       | ⭐       | ⭐⭐     | -    | ⭐⭐⭐   | 中         |
| 性能追踪           | ⭐       | ⭐⭐     | ⭐⭐ | ⭐       | 中         |
| Store 整合         | ⭐⭐     | ⭐⭐⭐   | ⭐   | ⭐       | 中高       |
| 工具抽象           | ⭐⭐⭐   | ⭐⭐⭐⭐ | -    | -        | 中高       |
| Runtime 职责分离   | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐   | -        | 高         |
| 模块重组（大重构） | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | -    | -        | 高但风险大 |

---

## 七、与功能开发的平衡

### 7.1 功能 vs 结构

**你需要在两者之间平衡：**

```
功能开发（用户直接受益）
  - 多 Agent 质量闭环
  - Workbench 多模态预览
  - API 配额管理
  - Agent 执行追踪
  - 智库浏览 UI

结构优化（开发者受益，间接影响用户）
  - 统一错误处理
  - 事件类型安全
  - 日志查询接口
  - 性能追踪
  - Store 整合
```

### 7.2 推荐策略

**交替进行**（功能 + 结构穿插）：

```
Week 1: 功能优先
  Day 1-3: 多 Agent 质量闭环（功能）
  Day 4: 统一错误处理（结构）
  Day 5: 事件类型安全（结构）

Week 2: 功能优先
  Day 1-3: Workbench 多模态预览（功能）
  Day 4: 日志查询接口（结构）
  Day 5: 前端 Store 整合（结构）

Week 3: 功能优先
  Day 1-2: API 配额管理（功能）
  Day 3-4: Runtime 职责分离（结构）
  Day 5: 性能追踪（结构）

Week 4: 功能优先
  Day 1-2: Agent 执行追踪（功能）
  Day 3: 智库浏览 UI（功能）
  Day 4-5: 工具抽象（结构）
```

**原则**：

- ✅ 每周至少 60% 时间在功能开发（用户可见）
- ✅ 每周至少 1-2 天做结构优化（技术债务）
- ✅ 结构优化选择"快速见效、风险低"的项目

---

## 八、总结与建议

### 8.1 当前架构评估

**优点**：

- ✅ 分层清晰（Gateway / Agent / Storage）
- ✅ 扩展性好（Skill / Extension / Worker）
- ✅ 安全性考虑周到（Sandbox / HITL）
- ✅ 功能丰富（Agent / Swarm / Orchestrator / Brain / Memory）

**不足**：

- ❌ 部分模块职责过重（Runtime、ThreadView）
- ❌ 配置和状态管理分散
- ❌ 缺少统一的错误/日志/性能基础设施
- ❌ 事件系统类型不安全

**总体评价**：⭐⭐⭐⭐ (4/5)

- 架构设计合理，模块化良好
- 需要适度重构，不需要推倒重来
- 通过渐进式优化即可达到 ⭐⭐⭐⭐⭐

### 8.2 明天的行动计划

**推荐做法（两手抓）**：

#### 上午：功能开发（3-4 小时）

- 启动 **多 Agent 质量闭环**（Aggregator 实现）
- 或启动 **Workbench 多模态预览**（BrowserFrame 实现）

#### 下午：结构优化（2-3 小时）

- 实现 **统一错误处理**（AppError + Gateway 中间件）
- 实现 **事件类型安全**（EventMap + 类型化 emit/on）

**预期产出**：

- 1 个功能 MVP（质量闭环 or 多模态预览）
- 2 个结构优化（错误处理 + 事件类型）

### 8.3 我的角色

**作为架构师**，我已经：

- ✅ 识别了 9 个结构性问题
- ✅ 提供了每个问题的优化方案
- ✅ 给出了优先级和实施建议
- ✅ 平衡了功能与结构的开发节奏

**下一步**：

- 你决定明天做什么（功能 or 结构 or 两者）
- 我立即开始实施
- 边开发边重构，渐进式改进

---

**文档版本**: v1.0.0  
**创建时间**: 2026-02-24  
**状态**: 📋 架构分析完成，等待实施决策
