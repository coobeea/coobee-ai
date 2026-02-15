# 09 — 三大基础设施系统开发计划

> 消息管线 (Message Pipeline)、模型 Provider 体系 (Model Provider)、配置系统 (Config System)
>
> 基于 OpenClaw 源码深度分析 + coobee-ai 现状盘点

---

## 0. 背景

coobee-ai 当前在三个基础设施维度存在结构性缺失：

- **消息管线**：busy 时直接拒绝新消息，无排队/合并/中断能力
- **模型 Provider**：单 Provider 硬编码（`.env`），无 Fallback、无模型目录、无多级选择
- **配置系统**：分散在 electron-store / SQLite / .env 三处，无校验、无热重载、无统一结构

三者相互依赖：配置系统是模型 Provider 和消息管线的基础；模型 Provider 是消息管线（Agent 执行）的前置条件。

---

## 1. 消息管线 (Message Pipeline)

### 1.1 现状

```
用户输入 → chat.send → AgentExecutor.submit
  ├── busy → 返回 SESSION_BUSY（直接拒绝）
  └── 空闲 → execute → runtime.stream → StreamEmitter → WebSocket
```

- `busySessions: Map<string, { startedAt }>` 控制并发
- 无排队、无合并、无中断、无 abort
- `chat.abort` 预留但未实现

### 1.2 OpenClaw 参考设计

OpenClaw 使用双队列架构：

- **Lane 队列**：执行调度（"什么时候开始跑"），每 session 串行
- **Followup 队列**：消息策略（"Agent 正在跑时新消息怎么办"）

四种 Followup 模式：

- **followup**（排队等待）：入队 → run 结束后 FIFO 逐条执行
- **steer**（注入当前 run）：`queueEmbeddedPiMessage` 注入正在流式的 Agent
- **collect**（合并处理）：同渠道消息合并为一条 prompt 统一处理
- **interrupt**（中断重来）：`clearCommandLane` + `abortEmbeddedPiRun` → 新消息重新开始

关键数据结构：

```typescript
// OpenClaw: queue/types.ts
type QueueMode = 'steer' | 'followup' | 'collect' | 'interrupt'
type QueueSettings = {
  mode: QueueMode
  debounceMs?: number    // 排队去抖（默认 1000ms）
  cap?: number           // 队列容量（默认 20）
  dropPolicy?: 'old' | 'new' | 'summarize'  // 满了怎么办
}
type FollowupRun = {
  prompt: string
  enqueuedAt: number
  run: { sessionId, agentId, model, ... }
}
```

关键协作时序：

```
新消息到达
  → runPreparedReply
    ├── interrupt + laneSize>0 → clearLane + abort → 新 run
    └── 进入 runReplyAgent
         ├── steer + isStreaming → 注入当前 run（不排队）
         ├── isActive + (followup|collect) → 入 Followup 队列
         └── else → 直接执行（通过 Lane 队列）
  → run 结束
  → finalizeWithFollowup
  → scheduleFollowupDrain
  → drain 循环
       ├── collect 模式：splice 全部 → buildCollectPrompt → 执行一次
       └── followup 模式：shift 逐条 → 执行
```

### 1.3 我们的设计方案

#### 核心原则

- **不照搬 OpenClaw 的多渠道复杂性**（我们目前只有桌面端一个入口）
- **保持架构可扩展**：未来可支持 WebSocket/HTTP 等多入口
- **四种模式全部实现**：followup / steer / collect / interrupt
- **与 Extension 系统联动**：可通过 Hook 自定义队列行为

#### 1.3.1 数据结构

```typescript
// src/main/ai/pipeline/types.ts
export type QueueMode = 'followup' | 'steer' | 'collect' | 'interrupt'

export interface QueueSettings {
  mode: QueueMode
  debounceMs: number // 默认 500ms
  cap: number // 默认 20
  dropPolicy: 'old' | 'new' | 'summarize'
}

export interface PendingMessage {
  id: string
  sessionId: string
  message: string
  enqueuedAt: number
  metadata?: Record<string, unknown>
}

export interface SessionPipelineState {
  sessionId: string
  settings: QueueSettings
  queue: PendingMessage[]
  isRunning: boolean
  currentRunAbortController?: AbortController
  draining: boolean
  droppedCount: number
  summaryLines: string[]
}
```

#### 1.3.2 模块结构

```
src/main/ai/pipeline/
├── types.ts              — 类型定义
├── MessagePipeline.ts    — 主入口（单例）
├── SessionQueue.ts       — 每 session 的队列管理
├── QueueSettings.ts      — 设置解析（session/agent/全局优先级）
├── DrainStrategy.ts      — drain 策略（followup/collect/summarize）
├── AbortManager.ts       — 中断管理（interrupt 模式）
└── __tests__/
    ├── MessagePipeline.test.ts
    ├── SessionQueue.test.ts
    └── DrainStrategy.test.ts
```

#### 1.3.3 MessagePipeline 核心 API

```typescript
class MessagePipeline {
  // 提交消息（替代 AgentExecutor.submit）
  submit(sessionId: string, message: string, opts?: SubmitOptions): SubmitResult

  // 中断当前 run
  abort(sessionId: string): boolean

  // 获取队列状态
  getQueueStatus(sessionId: string): QueueStatus

  // 清空队列
  clearQueue(sessionId: string): number

  // 设置队列模式
  setQueueMode(sessionId: string, mode: QueueMode): void
}
```

#### 1.3.4 与现有系统的集成

```
chat.send → MessagePipeline.submit(sessionId, message)
  ├── 空闲 → 直接执行（AgentExecutor.execute）
  └── 忙碌 → 按 QueueMode 处理
       ├── followup → 入队，返回 { status: 'queued' }
       ├── steer → 注入当前 run（如果流式中）
       ├── collect → 入队，返回 { status: 'queued' }
       └── interrupt → abort + 清空 + 立即执行
  → run 结束 → drain 队列
       ├── collect → 合并执行
       └── followup → 逐条执行

chat.abort → MessagePipeline.abort(sessionId)
  → AbortController.abort()
  → runtime stream 中断
  → drain 下一条（如果有）
```

#### 1.3.5 实现任务清单

| 编号  | 任务                        | 说明                                                                        | 依赖           |
| ----- | --------------------------- | --------------------------------------------------------------------------- | -------------- |
| P1-1  | 定义 Pipeline 类型          | `types.ts` — QueueMode、QueueSettings、PendingMessage、SessionPipelineState | 无             |
| P1-2  | 实现 SessionQueue           | 单 session 队列管理（入队、出队、容量、drop）                               | P1-1           |
| P1-3  | 实现 DrainStrategy          | followup/collect/summarize 三种 drain 策略                                  | P1-2           |
| P1-4  | 实现 AbortManager           | AbortController 管理 + runtime 中断                                         | P1-1           |
| P1-5  | 实现 QueueSettings          | 三级优先级解析（session → agent → 全局默认）                                | P1-1, 配置系统 |
| P1-6  | 实现 MessagePipeline        | 主入口单例，串联上述模块                                                    | P1-2 ~ P1-5    |
| P1-7  | 改造 AgentExecutor          | 增加 abort 支持，stream 接受 AbortSignal                                    | P1-4           |
| P1-8  | 改造 chat.send / chat.abort | 接入 MessagePipeline，返回 queued 状态                                      | P1-6           |
| P1-9  | 前端支持                    | 队列状态展示、abort 按钮、queued 状态提示                                   | P1-8           |
| P1-10 | Extension Hook              | `message_queued` / `message_dequeued` / `queue_drain_start`                 | P1-6           |
| P1-11 | 测试                        | 单元 + 集成测试覆盖四种模式                                                 | P1-1 ~ P1-10   |

---

## 2. 模型 Provider 体系 (Model Provider)

### 2.1 现状

```
.env: VITE_LLM_API_KEY / VITE_LLM_BASE_URL / VITE_LLM_MODEL
  → PiMonoBuilder.build() → PiMonoAgentRuntime
```

- 只有一个 Provider（.env 中的一组配置）
- chat 路径固定使用 `agentExecutor.piMono()`
- Agent 在 SQLite 中存一个 `model` 字段（默认 `gpt-4o`）
- 无 Fallback、无模型目录、无成本追踪

### 2.2 OpenClaw 参考设计

OpenClaw 的 Provider 体系：

**类型层次**：

```typescript
// Provider 配置
type ModelProviderConfig = {
  baseUrl: string
  apiKey?: string
  api?: ModelApi // openai-completions | anthropic-messages | ...
  auth?: AuthMode
  headers?: Record<string, string>
  models: ModelDefinitionConfig[]
}

// 模型定义
type ModelDefinitionConfig = {
  id: string
  name: string
  api?: ModelApi // 可覆盖 Provider 的 api
  reasoning: boolean
  input: ('text' | 'image')[]
  cost: { input; output; cacheRead; cacheWrite } // $/M tokens
  contextWindow: number
  maxTokens: number
}

// 模型引用（provider/model 格式）
type ModelRef = { provider: string; model: string }
```

**四级选择优先级**（高→低）：

1. 会话覆盖（`sessionEntry.modelOverride`）
2. Agent 覆盖（`agents.list[].model`）
3. 全局默认（`agents.defaults.model.primary`）
4. 内置默认（`anthropic/claude-opus-4-5`）

**Fallback 链**：

```
primary → fallbacks[0] → fallbacks[1] → ... → 全局 default
```

- `isFailoverError`（rate limit、timeout）→ 换模型重试
- `isFallbackAbortError`（用户取消）→ 停止

**API Key 解析优先级**（高→低）：

1. 指定 profile
2. auth override（如 aws-sdk）
3. auth profiles（按 order 排序）
4. 环境变量
5. models.json 配置值

### 2.3 我们的设计方案

#### 核心原则

- **Provider 抽象统一**：所有 LLM 访问通过 Provider 接口
- **配置驱动**：Provider 配置存储在 Config System 中
- **渐进增强**：先支持 OpenAI-compatible，后扩展其他 API 格式
- **Fallback 内置**：自动重试 + 模型切换

#### 2.3.1 数据结构

```typescript
// src/main/ai/provider/types.ts

/** 支持的 API 格式 */
export type ModelApi =
  | 'openai-compatible' // OpenAI / 阿里云 / MiniMax / 各兼容厂商
  | 'anthropic' // Anthropic Claude
  | 'google' // Google Gemini

/** Provider 配置 */
export interface ProviderConfig {
  id: string
  name: string
  baseUrl: string
  apiKey?: string // 密钥或 ${ENV_VAR}
  api: ModelApi
  headers?: Record<string, string>
  models: ModelConfig[]
  enabled: boolean
}

/** 模型配置 */
export interface ModelConfig {
  id: string // 模型 ID（如 qwen3-max）
  name: string // 显示名称
  api?: ModelApi // 可覆盖 Provider
  reasoning?: boolean // 支持推理模式
  input?: ('text' | 'image')[]
  contextWindow?: number
  maxTokens?: number
  cost?: ModelCostConfig
}

/** 成本配置（$/百万 token） */
export interface ModelCostConfig {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

/** 模型引用 */
export interface ModelRef {
  provider: string // Provider ID
  model: string // 模型 ID
}

/** 模型选择配置 */
export interface ModelSelectionConfig {
  primary: string // "provider/model" 格式
  fallbacks?: string[] // 备选列表
}

/** Fallback 结果 */
export interface FallbackResult<T> {
  result: T
  provider: string
  model: string
  attempts: number
  failedModels: string[]
}
```

#### 2.3.2 模块结构

```
src/main/ai/provider/
├── types.ts               — 类型定义
├── ProviderRegistry.ts    — Provider 注册与发现
├── ModelCatalog.ts        — 模型目录（查找、匹配、能力查询）
├── ModelSelector.ts       — 四级模型选择
├── ModelFallback.ts       — Fallback 链执行
├── ApiKeyResolver.ts      — API Key 解析
├── CostTracker.ts         — 成本追踪与统计
├── builtin/               — 内置 Provider 定义
│   ├── openai.ts
│   ├── anthropic.ts
│   ├── aliyun.ts          — 阿里云（通义/DashScope）
│   ├── minimax.ts
│   └── index.ts
└── __tests__/
    ├── ProviderRegistry.test.ts
    ├── ModelSelector.test.ts
    ├── ModelFallback.test.ts
    └── CostTracker.test.ts
```

#### 2.3.3 核心 API

```typescript
/** Provider 注册中心 */
class ProviderRegistry {
  register(config: ProviderConfig): void
  unregister(id: string): void
  get(id: string): ProviderConfig | undefined
  getAll(): ProviderConfig[]

  // 从配置加载所有 Provider
  loadFromConfig(config: AppConfig): void

  // 解析隐式 Provider（基于环境变量）
  resolveImplicit(): ProviderConfig[]
}

/** 模型目录 */
class ModelCatalog {
  // 查找模型
  find(ref: ModelRef): ResolvedModel | undefined

  // 列出所有可用模型
  listAll(): ResolvedModel[]

  // 按能力过滤
  listByCapability(cap: { reasoning?: boolean; image?: boolean }): ResolvedModel[]
}

/** 模型选择器 */
class ModelSelector {
  // 四级优先级解析
  resolve(opts: { sessionId?: string; agentId?: string }): ModelRef

  // 带 Fallback 的完整解析
  resolveWithFallbacks(opts): ModelSelectionConfig
}

/** Fallback 执行器 */
class ModelFallback {
  run<T>(
    candidates: ModelRef[],
    execute: (ref: ModelRef) => Promise<T>,
    opts?: { isRetryable?: (error: Error) => boolean }
  ): Promise<FallbackResult<T>>
}
```

#### 2.3.4 与现有系统的集成

```
chat.send
  → ModelSelector.resolve({ sessionId, agentId })
  → ModelRef { provider: 'aliyun', model: 'qwen3-max' }
  → ProviderRegistry.get('aliyun') → ProviderConfig
  → Builder.model(config.model).apiKey(config.apiKey).baseURL(config.baseUrl)
  → AgentExecutor.execute(...)
  → 失败？→ ModelFallback.run(fallbacks, execute)
  → CostTracker.record(usage, costConfig)
```

改造点：

- `chat.ts` 的 `createBuilder` 改为从 ModelSelector 获取配置
- `PiMonoBuilder` / `OpenAIBuilder` 的 model/apiKey/baseURL 改为从 ProviderConfig 注入
- `AgentConfigStore` 的 `model` 字段改为 `modelRef`（`provider/model` 格式）

#### 2.3.5 实现任务清单

| 编号  | 任务                  | 说明                                                  | 依赖           |
| ----- | --------------------- | ----------------------------------------------------- | -------------- |
| P2-1  | 定义 Provider 类型    | `types.ts` — ProviderConfig、ModelConfig、ModelRef 等 | 无             |
| P2-2  | 实现 ProviderRegistry | 注册/发现/加载 Provider                               | P2-1           |
| P2-3  | 实现 ModelCatalog     | 模型查找、能力查询、列举                              | P2-2           |
| P2-4  | 内置 Provider 定义    | openai / anthropic / aliyun / minimax                 | P2-1           |
| P2-5  | 实现 ApiKeyResolver   | 环境变量 / 配置 / ${ENV_VAR} 模板解析                 | P2-1           |
| P2-6  | 实现 ModelSelector    | 四级优先级选择（session → agent → 全局 → 内置）       | P2-3, 配置系统 |
| P2-7  | 实现 ModelFallback    | Fallback 链 + 错误分类 + 重试                         | P2-6           |
| P2-8  | 实现 CostTracker      | 用量记录 + 成本计算 + 统计汇总                        | P2-1           |
| P2-9  | 改造 Builder          | PiMonoBuilder / OpenAIBuilder 接受 ProviderConfig     | P2-2           |
| P2-10 | 改造 chat.send        | 从 ModelSelector 获取模型，不再硬编码                 | P2-6, P2-9     |
| P2-11 | 改造 AgentConfigStore | `model` → `modelRef`，存储 `provider/model` 格式      | P2-1           |
| P2-12 | 前端支持              | 模型选择 UI、Provider 管理 UI、成本展示               | P2-2, P2-8     |
| P2-13 | Extension Hook        | `model_resolved` / `model_fallback` 钩子              | P2-7           |
| P2-14 | 测试                  | Provider / Selector / Fallback / CostTracker 全覆盖   | P2-1 ~ P2-13   |

---

## 3. 配置系统 (Config System)

### 3.1 现状

| 来源           | 格式      | 内容                                | 位置                                |
| -------------- | --------- | ----------------------------------- | ----------------------------------- |
| electron-store | JSON      | UI 偏好（theme/language/shortcuts） | `userData/config.json`              |
| .env           | KEY=VALUE | LLM 密钥、端口、日志级别            | 项目根目录                          |
| SQLite         | JSON 列   | Agent/Team 配置                     | `agent_configs` / `team_configs` 表 |
| localStorage   | JSON      | 渲染进程偏好                        | 浏览器存储                          |

问题：

- 配置分散在 4 处，无统一视图
- 无 Zod 校验（配置错误只在运行时暴露）
- 无热重载（除 electron-store 的 watch）
- 无覆盖优先级链
- 无 CLI/API 配置修改能力

### 3.2 OpenClaw 参考设计

OpenClaw 配置系统核心特性：

**一个 JSON5 文件管一切**（`~/.openclaw/openclaw.json`）

```
加载流程（10 步）：
路径解析 → 读文件 → JSON5 解析 → $include 合并 → env.vars 注入
  → ${VAR} 替换 → Zod 校验 → 填充默认值 → 路径规范化 → 运行时覆盖
```

**热重载机制**：

```
chokidar 监听文件变更
  → debounce 300ms
  → readConfigFileSnapshot()（直接读磁盘）
  → diffConfigPaths(prev, next) → changedPaths
  → buildGatewayReloadPlan(changedPaths)
    ├── hot 规则 → 热重载（如重启 cron、channel）
    ├── restart 规则 → Gateway 重启
    └── none 规则 → 无操作（loadConfig 缓存过期后自动取新值）
```

**覆盖优先级**（低→高）：

1. 代码默认值
2. 主配置文件
3. `$include` 引入的文件
4. `config.env.vars`
5. 环境变量 `${VAR}` 替换
6. 运行时覆盖（`setConfigOverride`）

**关键数据结构**：

```typescript
type ReloadRule = {
  prefix: string
  kind: 'restart' | 'hot' | 'none'
  actions?: ReloadAction[]
}

type ConfigFileSnapshot = {
  path: string
  exists: boolean
  raw: string | null
  parsed: unknown
  valid: boolean
  config: OpenClawConfig
  hash?: string
  issues: ConfigValidationIssue[]
}
```

### 3.3 我们的设计方案

#### 核心原则

- **统一入口**：一个 JSON5 主配置文件 `~/.coobee-ai/coobee.json5`
- **Zod 校验**：所有配置通过 Zod schema 校验
- **热重载**：chokidar 监听 + diff-based 分级重载
- **渐进迁移**：现有 electron-store 配置逐步迁入新系统
- **Electron 友好**：兼顾主进程 / 渲染进程的配置访问

#### 3.3.1 配置文件结构

```json5
// ~/.coobee-ai/coobee.json5
{
  // 模型与 Provider
  models: {
    providers: {
      aliyun: {
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: '${DASHSCOPE_API_KEY}',
        api: 'openai-compatible',
        models: [
          {
            id: 'qwen3-max',
            name: '通义千问 3 Max',
            reasoning: true,
            input: ['text', 'image'],
            contextWindow: 131072,
            maxTokens: 8192,
            cost: { input: 2, output: 8, cacheRead: 0.2 }
          }
        ]
      },
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '${OPENAI_API_KEY}',
        api: 'openai-compatible',
        models: [
          {
            id: 'gpt-4o',
            name: 'GPT-4o',
            reasoning: false,
            input: ['text', 'image'],
            contextWindow: 128000,
            maxTokens: 16384,
            cost: { input: 2.5, output: 10 }
          }
        ]
      }
    }
  },

  // Agent 配置
  agents: {
    defaults: {
      model: {
        primary: 'aliyun/qwen3-max',
        fallbacks: ['openai/gpt-4o']
      }
    },
    list: [
      { agentId: 'coder', model: 'aliyun/qwen3-max' },
      { agentId: 'chat', model: 'openai/gpt-4o' }
    ]
  },

  // 消息管线
  messages: {
    queue: {
      mode: 'collect', // 默认队列模式
      debounceMs: 500,
      cap: 20,
      dropPolicy: 'summarize'
    }
  },

  // 工具配置
  tools: {
    exec: {
      timeout: 30000,
      blacklist: ['rm -rf /', 'sudo', 'curl|sh']
    }
  },

  // 安全
  security: {
    sandbox: { mode: 'path-only' },
    approvals: { exec: 'auto' }
  },

  // UI 偏好（从 electron-store 迁入）
  ui: {
    theme: 'auto',
    language: 'zh-CN',
    soundEffects: true
  },

  // 日志
  logging: {
    level: 'info',
    file: true
  }
}
```

#### 3.3.2 Zod Schema

```typescript
// src/main/common/config/schema.ts
import { z } from 'zod'

const ModelApiSchema = z.enum(['openai-compatible', 'anthropic', 'google'])

const ModelCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional()
})

const ModelConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  api: ModelApiSchema.optional(),
  reasoning: z.boolean().optional().default(false),
  input: z
    .array(z.enum(['text', 'image']))
    .optional()
    .default(['text']),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
  cost: ModelCostSchema.optional()
})

const ProviderConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  api: ModelApiSchema.default('openai-compatible'),
  headers: z.record(z.string()).optional(),
  models: z.array(ModelConfigSchema),
  enabled: z.boolean().optional().default(true)
})

export const CoobeeConfigSchema = z
  .object({
    models: z
      .object({
        providers: z.record(ProviderConfigSchema).optional()
      })
      .optional(),
    agents: z
      .object({
        defaults: z
          .object({
            model: z
              .object({
                primary: z.string(),
                fallbacks: z.array(z.string()).optional()
              })
              .optional()
          })
          .optional(),
        list: z
          .array(
            z.object({
              agentId: z.string(),
              model: z.string().optional()
            })
          )
          .optional()
      })
      .optional(),
    messages: z
      .object({
        queue: z
          .object({
            mode: z.enum(['followup', 'steer', 'collect', 'interrupt']).default('collect'),
            debounceMs: z.number().default(500),
            cap: z.number().default(20),
            dropPolicy: z.enum(['old', 'new', 'summarize']).default('summarize')
          })
          .optional()
      })
      .optional(),
    tools: z
      .object({
        exec: z
          .object({
            timeout: z.number().default(30000),
            blacklist: z.array(z.string()).optional()
          })
          .optional()
      })
      .optional(),
    security: z
      .object({
        sandbox: z
          .object({ mode: z.enum(['off', 'path-only', 'docker']).default('path-only') })
          .optional(),
        approvals: z
          .object({ exec: z.enum(['auto', 'always', 'never']).default('auto') })
          .optional()
      })
      .optional(),
    ui: z
      .object({
        theme: z.enum(['auto', 'light', 'dark']).default('auto'),
        language: z.string().default('zh-CN'),
        soundEffects: z.boolean().default(true)
      })
      .optional(),
    logging: z
      .object({
        level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
        file: z.boolean().default(true)
      })
      .optional()
  })
  .strict()

export type CoobeeConfig = z.infer<typeof CoobeeConfigSchema>
```

#### 3.3.3 模块结构

```
src/main/common/config/
├── schema.ts              — Zod schema 定义
├── types.ts               — 导出类型
├── ConfigLoader.ts        — 配置加载管线（10 步）
├── ConfigWatcher.ts       — chokidar 热重载
├── ConfigDiff.ts          — diff 算法 + 重载计划
├── ConfigEnv.ts           — ${VAR} 环境变量替换
├── ConfigDefaults.ts      — 默认值填充
├── ConfigStore.ts         — 配置读写接口（替代 electron-store）
├── ConfigMigration.ts     — 从旧格式迁移
└── __tests__/
    ├── ConfigLoader.test.ts
    ├── ConfigWatcher.test.ts
    ├── ConfigDiff.test.ts
    └── schema.test.ts
```

#### 3.3.4 核心 API

```typescript
/** 配置加载器 */
class ConfigLoader {
  // 加载配置（带缓存）
  load(): CoobeeConfig

  // 直接读文件快照（无缓存）
  snapshot(): ConfigSnapshot

  // 清除缓存
  clearCache(): void
}

/** 配置监听器 */
class ConfigWatcher {
  // 启动监听
  start(): void

  // 停止监听
  stop(): void

  // 注册变更回调
  onReload(handler: (plan: ReloadPlan) => void): void
}

/** diff + 重载 */
function diffConfigPaths(prev: unknown, next: unknown): string[]
function buildReloadPlan(changedPaths: string[]): ReloadPlan

/** 配置存储 */
class ConfigStore {
  get<K extends keyof CoobeeConfig>(key: K): CoobeeConfig[K]
  set<K extends keyof CoobeeConfig>(key: K, value: CoobeeConfig[K]): void
  patch(partial: DeepPartial<CoobeeConfig>): void
}
```

#### 3.3.5 热重载规则

| 配置前缀         | 行为 | 说明                        |
| ---------------- | ---- | --------------------------- |
| `models`         | none | 下次 Agent run 时自动取新值 |
| `agents`         | none | 同上                        |
| `tools`          | none | 同上                        |
| `messages.queue` | none | 同上                        |
| `security`       | none | 同上                        |
| `ui.theme`       | hot  | 立即通知渲染进程切换主题    |
| `ui.language`    | hot  | 立即切换语言                |
| `logging`        | hot  | 立即调整日志级别            |

#### 3.3.6 迁移策略

从现有系统迁移到新系统的步骤：

1. **Phase 1**：创建 `coobee.json5` + schema + loader，并行于 electron-store
2. **Phase 2**：将 `.env` 的 LLM 配置迁入 `coobee.json5` 的 `models` 节
3. **Phase 3**：将 electron-store 的 UI 偏好迁入 `coobee.json5` 的 `ui` 节
4. **Phase 4**：将 SQLite AgentConfigStore 的 model 配置迁入 `agents` 节
5. **Phase 5**：移除旧配置源，统一到 `coobee.json5`

#### 3.3.7 实现任务清单

| 编号  | 任务                  | 说明                                                | 依赖         |
| ----- | --------------------- | --------------------------------------------------- | ------------ |
| P3-1  | 定义 Zod Schema       | `schema.ts` — 完整配置 schema                       | 无           |
| P3-2  | 实现 ConfigEnv        | `${VAR}` 替换 + 环境变量解析                        | P3-1         |
| P3-3  | 实现 ConfigDefaults   | 默认值填充链                                        | P3-1         |
| P3-4  | 实现 ConfigLoader     | 10 步加载管线 + JSON5 解析 + 缓存                   | P3-1 ~ P3-3  |
| P3-5  | 实现 ConfigDiff       | 递归 diff + ReloadPlan 生成                         | P3-1         |
| P3-6  | 实现 ConfigWatcher    | chokidar 监听 + debounce + 触发 reload              | P3-4, P3-5   |
| P3-7  | 实现 ConfigStore      | 读写接口 + 文件写入 + 缓存清除                      | P3-4         |
| P3-8  | Gateway 配置方法      | `config.get` / `config.set` / `config.patch`        | P3-7         |
| P3-9  | 迁移 .env 配置        | LLM 配置 → models 节                                | P3-4, P2-2   |
| P3-10 | 迁移 electron-store   | UI 偏好 → ui 节                                     | P3-7         |
| P3-11 | 迁移 AgentConfigStore | model → agents 节                                   | P3-7, P2-11  |
| P3-12 | 前端支持              | 配置编辑器 UI（JSON5 编辑 + 可视化表单）            | P3-7, P3-8   |
| P3-13 | 测试                  | schema / loader / diff / watcher / migration 全覆盖 | P3-1 ~ P3-12 |

---

## 4. 实施顺序

三个系统存在依赖关系：

```
配置系统（基础）
  → 模型 Provider（依赖配置加载）
    → 消息管线（依赖模型选择 + 配置）
```

### 建议实施阶段

#### 阶段 1：配置系统基础 + 模型 Provider 核心

先建立配置加载能力，同时实现 Provider 类型和注册。

| 任务                  | 来源     |
| --------------------- | -------- |
| P3-1 Zod Schema       | 配置     |
| P3-2 ConfigEnv        | 配置     |
| P3-3 ConfigDefaults   | 配置     |
| P3-4 ConfigLoader     | 配置     |
| P2-1 Provider 类型    | Provider |
| P2-2 ProviderRegistry | Provider |
| P2-4 内置 Provider    | Provider |
| P2-5 ApiKeyResolver   | Provider |

#### 阶段 2：模型选择 + Fallback + 配置热重载

建立模型选择链路，同时完善配置系统的热重载。

| 任务               | 来源     |
| ------------------ | -------- |
| P2-3 ModelCatalog  | Provider |
| P2-6 ModelSelector | Provider |
| P2-7 ModelFallback | Provider |
| P2-8 CostTracker   | Provider |
| P3-5 ConfigDiff    | 配置     |
| P3-6 ConfigWatcher | 配置     |
| P3-7 ConfigStore   | 配置     |

#### 阶段 3：集成改造

将新系统接入现有代码。

| 任务                        | 来源     |
| --------------------------- | -------- |
| P2-9 改造 Builder           | Provider |
| P2-10 改造 chat.send        | Provider |
| P2-11 改造 AgentConfigStore | Provider |
| P3-9 迁移 .env              | 配置     |
| P3-10 迁移 electron-store   | 配置     |
| P3-11 迁移 AgentConfigStore | 配置     |

#### 阶段 4：消息管线

在前三阶段完成后，全力实现消息管线。

| 任务        | 来源     |
| ----------- | -------- |
| P1-1 ~ P1-6 | 管线核心 |
| P1-7 ~ P1-8 | 集成     |
| P1-9        | 前端     |

#### 阶段 5：完善与测试

| 任务               | 来源          |
| ------------------ | ------------- |
| P1-10, P1-11       | 管线测试      |
| P2-13, P2-14       | Provider 测试 |
| P3-8, P3-12, P3-13 | 配置测试/前端 |
| P2-12              | Provider 前端 |

---

## 5. 涉及的现有文件清单

### 需要改造的文件

| 文件                                          | 改造内容                      |
| --------------------------------------------- | ----------------------------- |
| `src/main/gateway/methods/chat.ts`            | 接入 Pipeline + ModelSelector |
| `src/main/ai/AgentExecutor.ts`                | 增加 abort、接入 Pipeline     |
| `src/main/ai/runtime/pimono/PiMonoBuilder.ts` | 接受 ProviderConfig           |
| `src/main/ai/runtime/openai/OpenAIBuilder.ts` | 接受 ProviderConfig           |
| `src/main/ai/storage/AgentConfigStore.ts`     | model → modelRef              |
| `src/main/common/config.ts`                   | 渐进迁移到新 ConfigStore      |
| `src/main/common/env.ts`                      | 增加 configDir 路径           |
| `.env`                                        | LLM 配置迁入 coobee.json5     |

### 新增的目录

| 目录                      | 内容                                  |
| ------------------------- | ------------------------------------- |
| `src/main/ai/pipeline/`   | 消息管线                              |
| `src/main/ai/provider/`   | 模型 Provider                         |
| `src/main/common/config/` | 新配置系统（与现有 `config.ts` 并存） |

---

## 6. 风险与注意事项

1. **渐进迁移**：不能一次性替换，新旧系统需并存过渡
2. **Electron 约束**：主进程 / 渲染进程 / preload 三层都需要访问配置
3. **JSON5 依赖**：需添加 `json5` npm 包
4. **chokidar 依赖**：需添加 `chokidar` npm 包（Electron 兼容性需验证）
5. **API Key 安全**：`${VAR}` 模板中的密钥不能暴露到渲染进程
6. **测试覆盖**：每个模块必须有完整的单元测试
7. **向后兼容**：旧 `.env` 和 electron-store 配置在迁移期间仍需工作
