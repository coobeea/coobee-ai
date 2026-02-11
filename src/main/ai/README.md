# AI 模块架构说明

## 目录结构

```
src/main/ai/
├── agents/           # Agent 创建工厂
├── memory/           # 记忆系统
├── skills/           # 技能系统
├── tools/            # 工具系统
├── monitoring/       # 监控与追踪
├── orchestration/    # Orchestrator-Worker 编排
├── teams/            # Agent Team 配置
├── runtime/          # 统一运行时接口（Agent/Team）
├── streaming/        # 流式输出（基于 EventBus）
├── storage/          # 数据持久化
├── gateway/          # WebSocket 网关（旧）
└── index.ts          # 主导出文件
```

---

## 核心模块

### 1. Agents（Agent 工厂）

负责创建和管理 Agent 实例。

- **AgentFactory**: 从配置创建 Agent
- **AgentConfigStore**: 持久化 Agent 配置

### 2. Memory（记忆系统）⭐ 升级

基于认知科学和 Tachikoma 设计的**四类记忆系统**：

#### 1️⃣ Session Memory（会话记忆）

完整持久化对话历史（JSONL 格式）。

- **SessionMemoryStore**: 管理单次会话的所有消息
- 支持按角色、时间过滤
- 用于完整追溯、审计、分析

#### 2️⃣ Short-Term Memory（短期记忆 / 上下文窗口）

LLM 上下文窗口管理，支持两种压缩策略：

- **TrimmingSession**: 保留最近 N 轮对话（修剪策略）
- **SummarizingSession**: 将旧对话压缩为摘要（总结策略）
- 基于 `@openai/agents` SDK 的 `Session`

#### 3️⃣ Working Memory / State（工作记忆 / 状态）⭐ 新增

会话级别的临时变量和状态管理：

- **WorkingMemoryStore**: 管理任务状态、计划、检查点
- 存储：当前计划、子任务状态、自定义变量
- 支持断点续传（Checkpoint 机制）
- 文件存储：`~/.coobee-ai/sessions/{sessionId}/shared/context.json`

#### 4️⃣ Long-Term Memory（长期记忆 / 知识库）

跨会话的持久化知识：

- **LongTermMemoryStore**: 管理长期记忆条目
- 支持五种类型：
  - `SEMANTIC`: 语义记忆（事实性知识）
  - `EPISODIC`: 情景记忆（具体事件）
  - `PROCEDURAL`: 程序记忆（如何做事）
  - `PREFERENCE`: 用户偏好
  - `LESSON`: 经验教训
- 支持重要性评分（1-10）
- 支持关键词检索（未来可升级为向量搜索）
- 数据库存储：SQLite `long_term_memory` 表

#### 使用示例

```typescript
import {
  SessionMemoryStore,
  WorkingMemoryStore,
  LongTermMemoryStore,
  TrimmingSession,
  LongTermMemoryType
} from '@main/ai/memory'

// 1. 会话记忆
const sessionMemory = new SessionMemoryStore(sessionManager, sessionId)
await sessionMemory.appendMessage({ role: 'user', content: 'Hello' })

// 2. 短期记忆（Trimming 策略）
const session = new TrimmingSession(openai, { maxTurns: 10 })
await session.addUserMessage('你好')

// 3. 工作记忆
const workingMemory = new WorkingMemoryStore(sessionManager, sessionId)
await workingMemory.setVariable('currentTaskId', 'task-001')
await workingMemory.markSubtaskCompleted('subtask-1')
const checkpointId = await workingMemory.createCheckpoint()

// 4. 长期记忆
const longTermMemory = new LongTermMemoryStore(db)
await longTermMemory.saveMemory({
  type: LongTermMemoryType.PREFERENCE,
  content: '用户偏好使用中文',
  importance: 8,
  userId: 'user-123'
})
```

详见：[`docs/ai-architecture/12-memory-system-design.md`](../../../docs/ai-architecture/12-memory-system-design.md)

### 3. Skills（技能系统）

扩展 Agent 的能力。

- **SkillManager**: 注册和调用技能
- 支持动态加载技能

### 4. Tools（工具系统）

为 Agent 提供外部工具调用能力。

- **ToolRegistry**: 工具注册中心
- **内置工具**: 文件操作、网络请求等

### 5. Monitoring（监控系统）

追踪 Agent 的执行过程。

- **MonitoringService**: 收集执行指标
- 支持事件追踪和性能分析

### 6. Orchestration（编排系统）

实现 Tachikoma 的 Orchestrator-Worker 模式。

#### 组件

- **Orchestrator**: 核心编排器，协调 Planner 和 Workers
- **Planner**: 计划 Agent，负责任务分解
- **WorkerCoordinator**: Worker 池管理器

#### 使用示例

```typescript
import { Orchestrator } from '@main/ai/orchestration'

const orchestrator = new Orchestrator()
await orchestrator.initialize()

const result = await orchestrator.executeTask({
  id: 'task-001',
  name: '复杂任务',
  description: '需要多个 Agent 协作完成的任务',
  requirements: ['分析', '执行', '验证']
})
```

详见：[`docs/ai-architecture/Orchestrator-Worker交互机制深度解析.md`](../../../docs/ai-architecture/Orchestrator-Worker交互机制深度解析.md)

### 7. Teams（Agent Team）

管理多 Agent 协作配置。

- **TeamConfigStore**: 持久化 Team 配置
- 支持三种协作模式：
  - `sequential`: 顺序执行
  - `parallel`: 并行执行
  - `planner`: 计划式协作（使用 Orchestrator）

详见：[`docs/ai-architecture/06-agent-team-design.md`](../../../docs/ai-architecture/06-agent-team-design.md)

### 8. Runtime（统一运行时接口）

为 Agent 和 Team 提供统一的执行接口。

#### AgentRuntime 接口

```typescript
interface AgentRuntime {
  // 基本信息
  readonly type: 'agent' | 'team' | 'swarm'
  readonly id: string
  readonly name: string
  readonly options: AgentRuntimeOptions

  // 生命周期
  initialize(): Promise<void>
  destroy(): Promise<void>

  // 执行（主方法 — AsyncGenerator）
  stream(
    input: string,
    config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown>
  // 便捷方法
  run(input: string, config?: ExecutionConfig): Promise<ExecutionResult>

  // 会话管理
  getSessionInfo(): Promise<SessionInfo>
  clearSession(): Promise<void>

  // 记忆管理
  getMemorySummary(): Promise<MemorySummary>
  clearMemory(): Promise<void>

  // 工具和技能
  getTools(): ToolInfo[]
  getSkills(): SkillInfo[]
}
```

#### 实现类

- **AgentRuntime**: 单个 Agent 的运行时
- **TeamRuntime**: Agent Team 的运行时

#### 使用示例

```typescript
import { runtimeFactory } from '@main/ai'

// 创建 Agent Runtime
const agentRuntime = await runtimeFactory.createRuntime({
  type: 'agent',
  id: 'agent-001',
  sessionId: 'session-123'
})

// 创建 Team Runtime
const teamRuntime = await runtimeFactory.createRuntime({
  type: 'team',
  id: 'team-001',
  sessionId: 'session-123'
})

// 统一接口执行
await agentRuntime.initialize()
const result = await agentRuntime.run('你好', {})
```

详见：[`UNIFIED_INTERFACE_GUIDE.md`](./UNIFIED_INTERFACE_GUIDE.md)

### 9. Streaming（流式输出）

**新架构**：基于 EventBus 的可靠流式输出系统。

#### 架构

```
生产者 (StreamEmitter)
    → EventBus
    → 消费者们 (Store, WebSocket, Monitor)
```

#### 核心组件

##### 生产者（Producer）

- **StreamEmitter**:
  - 发送流式消息到 EventBus
  - 自动生成消息 ID 和序号
  - 集成在 `AgentRuntime` 和 `TeamRuntime` 中

##### 消费者（Consumers）

- **StreamStore**:
  - 持久化消息到 SQLite
  - 支持按序号查询和恢复

- **WebSocketBroadcaster**:
  - 推送消息到前端
  - 支持会话订阅和消息重发

- **StreamMonitor**:
  - 收集会话统计信息
  - 提供实时监控数据

#### 消息结构

```typescript
interface StreamMessage {
  id: string // Snowflake ID
  sessionId: string // 会话 ID
  sequence: number // 序号（会话内唯一递增）
  type: StreamMessageType // 消息类型
  content: string // 消息内容
  data?: Record<string, unknown>
  timestamp: number // 时间戳
  source: StreamSource // 来源信息
}
```

#### 使用示例

```typescript
// 1. 初始化消费者（应用启动时）
import { streamStore, webSocketBroadcaster, streamMonitor } from '@main/ai'

await streamStore.initialize()
webSocketBroadcaster.initialize(8765)
streamMonitor.initialize()

// 2. 使用 Runtime 自动发送流式消息
const runtime = await runtimeFactory.createRuntime({
  type: 'agent',
  id: 'agent-001',
  sessionId: 'session-123'
})

await runtime.initialize()
const result = await runtime.runStream('Hello', {}, (chunk) => {
  console.log('Chunk:', chunk)
})

// 3. 前端通过 WebSocket 接收消息
const ws = new WebSocket('ws://localhost:8765')
ws.send(JSON.stringify({ type: 'subscribe', sessionId: 'session-123' }))
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  console.log('Message:', msg.data)
}

// 4. 断线恢复
ws.send(
  JSON.stringify({
    type: 'resend',
    sessionId: 'session-123',
    fromSequence: 10
  })
)
```

#### 特性

✅ **可靠性**: 消息持久化，不会丢失  
✅ **可恢复性**: 支持断线重连后恢复  
✅ **有序性**: 使用序号确保消息顺序  
✅ **可扩展性**: 基于 EventBus，易于添加新消费者  
✅ **可监控性**: 内置统计和监控

详见：

- [架构文档](../../../docs/ai-architecture/07-streaming-architecture.md)
- [使用指南](../../../docs/ai-architecture/08-streaming-usage-guide.md)

---

## 使用流程

### 1. 创建 Agent 配置

```typescript
import { agentConfigStore } from '@main/ai'

await agentConfigStore.createConfig({
  id: 'agent-001',
  name: 'My Agent',
  model: 'gpt-4o',
  systemPrompt: 'You are a helpful assistant.',
  tools: ['file_read', 'web_search'],
  skills: []
})
```

### 2. 创建 Agent Runtime

```typescript
import { runtimeFactory } from '@main/ai'

const runtime = await runtimeFactory.createRuntime({
  type: 'agent',
  id: 'agent-001',
  sessionId: 'session-123'
})

await runtime.initialize()
```

### 3. 执行 Agent

```typescript
// 同步执行
const result = await runtime.run('你好', {})
console.log(result.output)

// 流式执行
const result = await runtime.runStream('你好', {}, (chunk) => {
  if (chunk.type === 'text') {
    console.log(chunk.content)
  }
})
```

---

## 配置说明

### Agent 配置

```typescript
interface AgentConfig {
  id: string
  name: string
  model: string
  systemPrompt: string
  temperature?: number
  maxTokens?: number
  tools?: string[]
  skills?: string[]
  metadata?: Record<string, unknown>
}
```

### Team 配置

```typescript
interface TeamConfig {
  id: string
  name: string
  description?: string
  orchestrationType: 'sequential' | 'parallel' | 'planner'
  members: TeamMember[]
  routingRules?: Record<string, unknown>
  metadata?: Record<string, unknown>
}
```

---

## 扩展开发

### 添加新工具

1. 在 `tools/builtin/` 中创建工具文件
2. 使用 `@openai/agents` 的 `tool()` 辅助函数
3. 在 `tools/builtin/index.ts` 中注册

示例：

```typescript
import { tool } from '@openai/agents'
import { z } from 'zod'

export const myTool = tool({
  name: 'my_tool',
  description: '我的自定义工具',
  parameters: z.object({
    input: z.string().describe('输入参数')
  }),
  execute: async ({ input }) => {
    // 实现工具逻辑
    return { result: `处理了: ${input}` }
  }
})
```

### 添加新技能

1. 在 `skills/` 中创建技能文件
2. 实现 `Skill` 接口
3. 注册到 `SkillManager`

### 添加流式消费者

1. 在 `streaming/consumers/` 中创建消费者
2. 订阅 EventBus 事件
3. 在 `streaming/consumers/index.ts` 中导出

示例：

```typescript
import { eventBus } from '@main/common/eventbus'
import { StreamEventType, type StreamEvent } from '../types'

export class MyConsumer {
  initialize(): void {
    eventBus.on(StreamEventType.MESSAGE, (event: StreamEvent) => {
      if (event.message) {
        this.handleMessage(event.message)
      }
    })
  }

  private handleMessage(message: StreamMessage): void {
    // 处理消息
    console.log('Received:', message)
  }
}
```

---

## 相关文档

- [Agent 架构深度解析](../../../docs/ai-architecture/agent-architecture.md)
- [Orchestrator-Worker 交互机制](../../../docs/ai-architecture/Orchestrator-Worker交互机制深度解析.md)
- [Agent Team 设计](../../../docs/ai-architecture/06-agent-team-design.md)
- [统一接口指南](./UNIFIED_INTERFACE_GUIDE.md)
- [流式架构](../../../docs/ai-architecture/07-streaming-architecture.md)
- [流式使用指南](../../../docs/ai-architecture/08-streaming-usage-guide.md)

---

## 待办事项

- [ ] 完善 SessionStore 实现
- [ ] 添加更多内置工具
- [ ] 实现技能系统的动态加载
- [ ] 增强监控可视化
- [ ] 添加向量数据库支持（可选）
- [ ] 前端 WebSocket 客户端实现
- [ ] 添加身份验证到 WebSocket
