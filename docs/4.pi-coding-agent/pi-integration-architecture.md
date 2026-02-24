# OpenClaw 与 pi-\* 包集成架构分析

> 分析日期：2026-02-10
> 涉及依赖版本：`@mariozechner/pi-agent-core@0.52.9`、`@mariozechner/pi-ai@0.52.9`、`@mariozechner/pi-coding-agent@0.52.9`

---

## 一、三层依赖架构

OpenClaw 构建在三个 `@mariozechner/pi-*` 包之上，形成清晰的三层抽象：

```
┌──────────────────────────────────────────────────────────┐
│                     OpenClaw（本仓库）                     │
│   工具策略、沙箱、多渠道消息、Claude Code 兼容、蜂群编排     │
└──────────────┬─────────────┬─────────────┬───────────────┘
               │             │             │
       ┌───────▼──────┐ ┌───▼────────┐ ┌──▼──────────────┐
       │pi-agent-core │ │   pi-ai    │ │ pi-coding-agent │
       │──────────────│ │────────────│ │─────────────────│
       │AgentTool     │ │Model<Api>  │ │createAgentSess. │
       │AgentMessage  │ │streamSimple│ │SessionManager   │
       │AgentToolRes. │ │ImageContent│ │SettingsManager  │
       │ToolUpdateCb  │ │            │ │AuthStorage      │
       │              │ │            │ │ModelRegistry    │
       │（基础类型层）  │ │（AI模型层） │ │codingTools      │
       └──────────────┘ └────────────┘ │ToolDefinition  │
                                       │estimateTokens  │
                                       │generateSummary │
                                       │Skill,Extension │
                                       │（编码Agent实现层）│
                                       └─────────────────┘
```

### 1.1 pi-agent-core — 类型基础层

提供最底层的接口定义，不含业务逻辑：

| 类型                      | 用途                                 | 使用位置                          |
| ------------------------- | ------------------------------------ | --------------------------------- |
| `AgentTool<T, R>`         | 工具接口（name/desc/params/execute） | `pi-tools.types.ts`               |
| `AgentToolResult<T>`      | 工具执行返回值                       | `pi-tool-definition-adapter.ts`   |
| `AgentToolUpdateCallback` | 工具执行中间状态回调                 | `pi-tool-definition-adapter.ts`   |
| `AgentMessage`            | 会话消息（user/assistant/tool）      | `compaction.ts`、`run/attempt.ts` |

**设计要点**：整个系统的所有工具（read、write、exec、message、sessions_spawn 等）都统一实现 `AgentTool` 接口，OpenClaw 在 `pi-tools.types.ts` 中将其别名为 `AnyAgentTool = AgentTool<any, unknown>`，作为内部工具传递的通用类型。

### 1.2 pi-ai — AI 模型抽象层

提供模型描述和流式推理能力：

| 导入项         | 用途                                        | 使用位置                      |
| -------------- | ------------------------------------------- | ----------------------------- |
| `Api`、`Model` | 模型定义（provider、contextWindow、api 等） | `pi-embedded-runner/model.ts` |
| `streamSimple` | LLM 流式推理调用函数                        | `run/attempt.ts`（第 518 行） |
| `ImageContent` | 图像内容类型                                | `run/attempt.ts`              |

**设计要点**：

- `Model<Api>` 是统一的模型描述类型，覆盖 Anthropic、OpenAI、Google 等所有 provider
- `resolveModel()` 函数实现了多级回退：内置目录 → 内联配置 → provider 前向兼容 → 泛型回退
- `streamSimple` 在每轮运行时绑定到 `session.agent.streamFn`，允许中间插入缓存追踪和日志拦截

### 1.3 pi-coding-agent — 编码 Agent 实现层

对接最深的包，提供会话管理、编码工具、上下文压缩三大能力：

**会话管理**：
| 导入项 | 用途 |
|---------------------|------------------------|
| `createAgentSession` | 创建 Agent 会话实例 |
| `SessionManager` | 会话文件（JSONL）持久化 |
| `SettingsManager` | Agent 配置管理 |
| `AgentSession` | 会话实例类型 |
| `AuthStorage` | API Key 凭证存储 |
| `ModelRegistry` | 模型注册表 |

**编码工具**：
| 导入项 | 用途 |
|-----------------|------------------------|
| `codingTools` | 预定义编码工具集合 |
| `createReadTool` | 文件读取工具 |
| `createWriteTool`| 文件写入工具 |
| `createEditTool` | 文件编辑工具 |
| `ToolDefinition` | 工具定义接口 |

**上下文管理**：
| 导入项 | 用途 |
|------------------|-----------------------------|
| `estimateTokens` | Token 数量估算 |
| `generateSummary` | 上下文摘要生成（compaction） |
| `ExtensionContext` | 扩展上下文类型 |

---

## 二、会话生命周期设计

### 2.1 核心设计：无状态实例 + 有状态文件

```
会话级（长期存活 - 跨多轮对话）:
┌──────────────────────────────────────────┐
│  Session Store (sessions.json)           │
│    sessionKey → { sessionId,             │
│                   sessionFile,           │
│                   updatedAt, ... }       │
│                                          │
│  Session File (.jsonl) - 追加写入         │
│    [header] [user1] [asst1] [user2] ...  │
│                                          │
│  Lane Queue (session:<key>)              │
│    maxConcurrent: 1（同会话串行化）        │
└──────────────────────────────────────────┘

每轮级（用完即丢 - 单次请求）:
┌──────────────────────────────────────────┐
│  SessionManager  ← 从 JSONL 加载历史     │
│  SettingsManager ← 每次新建              │
│  AgentSession    ← 每次新建              │
│  Tools[]         ← 每次新建              │
│  streamSimple    ← 每次绑定              │
│  WriteLock       ← 获取→持有→释放         │
└──────────────────────────────────────────┘
```

**每次用户发消息，都会完整创建一个新的 AgentSession 对象**，而不是复用上一轮的实例。会话历史的连续性靠 JSONL 文件持久化：

1. `SessionManager.open(sessionFile)` 从磁盘加载全部历史消息
2. 新用户消息被追加到内存中的消息列表
3. AI 推理生成助手消息和工具调用
4. 所有新消息追加写入 JSONL 文件
5. 函数返回，所有内存对象由 GC 回收

### 2.2 不复用内存实例的设计理由

1. **工具配置可变** — 每轮可能因策略/沙箱/provider 差异产生不同的工具集
2. **模型/认证可轮转** — auth profile rotation、failback 机制需要每轮重新 resolve
3. **System Prompt 动态生成** — skills、bootstrap files、workspace 状态每轮都可能变化
4. **内存安全** — 工具结果（大文件、图片）在轮次结束后被释放，避免内存泄漏
5. **简单可靠** — 无状态设计让错误恢复更简单，不会因为脏状态导致连锁故障
6. **多进程安全** — 不依赖内存中的共享状态，多个 gateway 进程可以安全并存

### 2.3 Session Store：双层存储

```
~/.openclaw/sessions/sessions.json       ← 会话索引（所有 session 的元数据）
~/.openclaw/agents/<agentId>/sessions/   ← 会话 JSONL 文件（实际对话内容）
```

- `sessions.json` 记录每个 session 的 key、ID、文件路径、token 用量、模型覆盖等元信息
- JSONL 文件记录实际对话内容（header + message entries）
- 会话新旧判断基于 `updatedAt` 时间戳 + 可配置的 idle timeout（默认 60 分钟）

---

## 三、并发控制：三层防护

### 3.1 Lane 队列（进程内串行化）

```typescript
// src/process/command-queue.ts
// 基于内存队列的命令串行化，每个 lane 独立
type LaneState = {
  queue: QueueEntry[];
  active: number;
  maxConcurrent: number; // 默认 1
};
```

**同一个 session 的多条消息会排队串行执行**。Lane 以 `session:<sessionKey>` 为 key，确保不会并发写同一个 session file。

### 3.2 全局 Lane 并发限制

```typescript
// src/gateway/server-lanes.ts
CommandLane.Main     → maxConcurrent: 4  (主 Agent 对话)
CommandLane.Subagent → maxConcurrent: 8  (子 Agent)
CommandLane.Cron     → maxConcurrent: 1  (定时任务)
```

`runEmbeddedPiAgent()` 使用双层入队：先入 session lane（保证同会话串行），再入 global lane（控制总并发）。

### 3.3 文件写锁（跨进程互斥）

```typescript
// src/agents/session-write-lock.ts
// 基于 fs.open(lockPath, 'wx') 的排他文件锁
acquireSessionWriteLock({ sessionFile });
```

- 基于 `.lock` 文件实现互斥
- 支持重入计数（同进程内可多次获取）
- 过期检测（默认 30 分钟 stale）
- 进程存活检测（通过 `process.kill(pid, 0)` 判断持锁进程是否存活）
- 进程退出时自动清理所有持有的锁

---

## 四、工具系统设计

### 4.1 工具注册流程

```
pi-coding-agent 提供:                 OpenClaw 扩展:
  codingTools (read/write/edit/bash)     exec (沙箱化 bash)
                                         process (后台进程管理)
                                         apply-patch (OpenAI 专用)
                                         message (跨渠道消息发送)
                                         sessions_spawn (子 Agent)
                                         sessions_send/list/history
                                         cron (定时任务)
                                         agents_list (Agent 列表)
                                         image (图像生成)
                                         channel-specific tools (登录等)
                                         plugin tools (插件工具)
```

入口函数 `createOpenClawCodingTools()` 在 `src/agents/pi-tools.ts`：

1. 以 `codingTools` 为基础
2. 替换 read/write/edit 为自定义版本（添加沙箱路径防护、Claude Code 参数兼容）
3. 替换 bash 为自定义 exec（安全策略、超时、后台执行）
4. 添加 OpenClaw 自有工具（message、sessions、cron 等）
5. 多层策略过滤（profile → global → agent → group → sandbox → subagent）

### 4.2 工具适配器

`pi-tool-definition-adapter.ts` 实现了两个关键适配：

**AgentTool → ToolDefinition**（核心适配）：

- 处理新旧版本的 `execute` 参数顺序差异（legacy vs current）
- 统一错误处理（非 abort 错误转为 JSON 错误结果）
- 保持工具名称规范化

**ClientTool → ToolDefinition**（客户端工具适配）：

- 用于 OpenResponses 托管工具
- 返回 "pending" 结果，由客户端实际执行

### 4.3 Claude Code 兼容层

`pi-tools.read.ts` 中实现了 Claude Code 参数名兼容：

```
Claude Code 风格  →  pi-coding-agent 风格
  file_path       →    path
  old_string      →    oldText
  new_string      →    newText
```

通过 `normalizeToolParams()` 在执行前自动转换，通过 `patchToolSchemaForClaudeCompatibility()` 在 schema 中添加别名字段，让训练过 Claude Code 的模型也能正常工作。

---

## 五、多 Agent（子 Agent）模式

### 5.1 架构设计：一级扇出

```
Parent Agent (session: agent:default:user:alice)
├── Subagent A (session: agent:default:subagent:<uuid-1>)
├── Subagent B (session: agent:default:subagent:<uuid-2>)
└── Subagent C (session: agent:researcher:subagent:<uuid-3>)
     └── ✘ 不允许再 spawn（禁止递归）
```

**设计决策**：子 Agent 不允许再 spawn 子 Agent，防止无限递归导致资源耗尽。

### 5.2 子 Agent 生命周期

```
LLM 决定 spawn
      │
      ▼
sessions_spawn tool
      │
      ├─ 生成唯一 childSessionKey
      ├─ 通过 gateway RPC 设置 model/thinking
      ├─ 通过 gateway RPC 发起独立 agent run
      └─ registerSubagentRun() → 注册到内存 Map + 磁盘持久化
            │
            ├─→ waitForSubagentCompletion()  ← gateway RPC 等待完成
            ├─→ onAgentEvent(lifecycle)       ← 事件驱动监听 start/end/error
            │
            ▼
      子 Agent 完成
            │
            ├─→ runSubagentAnnounceFlow()    ← 向父 Agent 会话回报结果
            │
            └─→ cleanup
                  "delete" → 立即删除 session
                  "keep"   → 归档（默认60分钟后清理）
```

### 5.3 子 Agent 也是无状态创建

子 Agent 同样遵循 "每轮新建所有内存对象" 的模式：

- 独立的 session file（JSONL）
- 独立的 SessionManager、AgentSession、Tools
- 独立的模型和认证配置
- 通过 `spawnedBy` 字段关联父 session

适合的原因：

- 子 Agent 通常是单任务、短生命周期
- 天然隔离，不会相互干扰
- 独立工具策略（可通过 `subagents.tools` 配置）
- 磁盘持久化的注册表保证进程重启后可恢复

### 5.4 与深度蜂群架构的差异

| 特性       | OpenClaw 当前模式   | 深度蜂群模式（AutoGen/CrewAI） |
| ---------- | ------------------- | ------------------------------ |
| 层级       | 1 级扇出            | 多级递归                       |
| Agent 通信 | 子 → 父 单向回报    | Agent 间任意通信               |
| 共享状态   | 无（隔离 session）  | 共享工作区/记忆                |
| 实例管理   | 无状态、每次新建    | 可能需要热池/复用              |
| 并发控制   | Lane 队列（默认 8） | 可能需要更高并发               |
| 编排方式   | LLM 自主决策 spawn  | 需要显式协调器                 |

---

## 六、核心设计哲学总结

### 6.1 "消息驱动 + 无状态实例 + 有状态存储"

这是整个系统最核心的设计哲学：

- **消息驱动**：每条用户消息触发一次完整的 "创建 → 推理 → 销毁" 流程
- **无状态实例**：AgentSession、Tools、SessionManager 等都是临时对象
- **有状态存储**：JSONL 文件持久化会话历史，sessions.json 持久化会话索引

好处：简单、可靠、易于调试、天然支持多进程。

### 6.2 "适配器模式 + 多层包装"

工具系统大量使用适配器和包装器：

- `toToolDefinitions()` — AgentTool → ToolDefinition 类型适配
- `wrapToolParamNormalization()` — Claude Code 参数兼容
- `wrapToolWithBeforeToolCallHook()` — 工具调用前钩子
- `wrapToolWithAbortSignal()` — 中止信号传递
- `wrapSandboxPathGuard()` — 沙箱路径安全检查
- `normalizeToolParameters()` — JSON Schema 规范化

每层包装职责单一，可独立测试，组合使用。

### 6.3 "多层策略过滤"

工具可用性由多个维度决定：

```
profile policy        → 全局工具画像
provider policy       → provider 特定限制
agent policy          → Agent 级别配置
group policy          → 群组/频道级别配置
sandbox policy        → 沙箱安全限制
subagent policy       → 子 Agent 特殊限制
owner-only policy     → 仅所有者可用的工具
```

策略按优先级依次过滤，最终决定哪些工具可用。

### 6.4 "渐进式错误恢复"

`runEmbeddedPiAgent()` 中的错误处理是渐进式的：

1. **Auth Profile 轮转** — API Key 失败时自动切换到下一个 profile
2. **Thinking Level 降级** — 不支持的 thinking level 自动降级
3. **上下文溢出自动压缩** — 最多尝试 3 次 compaction
4. **工具结果截断** — compaction 无法解决时尝试截断超大工具结果
5. **模型回退** — 配置 fallback 时自动切换到备选模型

### 6.5 "单进程内的受控并发"

通过 Lane 队列实现精细的并发控制：

- 同一 session：严格串行（maxConcurrent: 1）
- 主 Agent：最多 4 个并发
- 子 Agent：最多 8 个并发
- Cron：最多 1 个并发

所有并发在单 Node.js 进程内管理，不需要外部消息队列或分布式锁。

---

## 七、关键代码入口索引

| 功能                   | 文件路径                                                 |
| ---------------------- | -------------------------------------------------------- |
| 工具类型定义           | `src/agents/pi-tools.types.ts`                           |
| 工具集创建（核心入口） | `src/agents/pi-tools.ts`                                 |
| 工具适配器             | `src/agents/pi-tool-definition-adapter.ts`               |
| Claude Code 兼容层     | `src/agents/pi-tools.read.ts`                            |
| 模型解析               | `src/agents/pi-embedded-runner/model.ts`                 |
| Agent 运行入口         | `src/agents/pi-embedded-runner/run.ts`                   |
| 单轮运行核心           | `src/agents/pi-embedded-runner/run/attempt.ts`           |
| 扩展路径构建           | `src/agents/pi-embedded-runner/extensions.ts`            |
| 会话初始化             | `src/auto-reply/reply/session.ts`                        |
| 会话类型定义           | `src/config/sessions/types.ts`                           |
| 上下文压缩             | `src/agents/compaction.ts`                               |
| 命令队列（Lane）       | `src/process/command-queue.ts`                           |
| Lane 定义              | `src/process/lanes.ts`                                   |
| Gateway Lane 并发配置  | `src/gateway/server-lanes.ts`                            |
| 会话写锁               | `src/agents/session-write-lock.ts`                       |
| SessionManager 缓存    | `src/agents/pi-embedded-runner/session-manager-cache.ts` |
| 子 Agent Spawn 工具    | `src/agents/tools/sessions-spawn-tool.ts`                |
| 子 Agent 注册表        | `src/agents/subagent-registry.ts`                        |
| 子 Agent 并发限制      | `src/config/agent-limits.ts`                             |
| 模型认证发现           | `src/agents/pi-model-discovery.ts`                       |
| 订阅会话事件           | `src/agents/pi-embedded-subscribe.types.ts`              |
