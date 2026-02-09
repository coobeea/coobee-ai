# 09 - 上下文与动态指令

> 来源：`examples/basic/dynamic-system-prompt.ts`, `basic/prompt-id.ts`, `basic/previous-response-id.ts`, `basic/conversations.ts`

## 概述

SDK 提供了多种方式在运行时定制 Agent 的行为：自定义上下文、动态指令、Prompt ID 管理，以及对话延续机制。

## 自定义上下文（RunContext）

通过泛型为 Agent 定义自定义上下文类型，在运行时传入业务数据：

```typescript
import { Agent, RunContext, run } from '@openai/agents'

// 定义上下文类型
interface AppContext {
  userId: string
  locale: string
  isPremium: boolean
}

// Agent 使用泛型指定上下文类型
const agent = new Agent<AppContext>({
  name: 'Personalized Agent',
  instructions: 'You are a helpful assistant.'
})

// 运行时传入上下文
const result = await run(agent, 'Hello', {
  context: {
    userId: 'user-123',
    locale: 'zh-CN',
    isPremium: true
  }
})
```

## 动态指令函数

`instructions` 可以是一个函数，根据上下文动态生成系统指令：

```typescript
import { Agent, RunContext, run } from '@openai/agents'

type Style = 'haiku' | 'pirate' | 'robot'

interface CustomContext {
  style: Style
}

// 指令函数：接收 RunContext 和 Agent，返回指令字符串
function customInstructions(
  runContext: RunContext<CustomContext>,
  _agent: Agent<CustomContext>
): string {
  const context = runContext.context

  if (context.style === 'haiku') {
    return 'Only respond in haikus.'
  } else if (context.style === 'pirate') {
    return 'Respond as a pirate. Use lots of pirate slang.'
  } else {
    return "Respond as a robot and say 'beep boop' a lot."
  }
}

const agent = new Agent<CustomContext>({
  name: 'Dynamic Agent',
  instructions: customInstructions // 传入函数而非字符串
})

// 不同上下文产生不同行为
const result1 = await run(agent, 'Tell me about the ocean', {
  context: { style: 'pirate' }
})

const result2 = await run(agent, 'Tell me about the ocean', {
  context: { style: 'haiku' }
})
```

### 指令函数签名

```typescript
type InstructionsFn<TContext> = (
  runContext: RunContext<TContext>,
  agent: Agent<TContext>
) => string | Promise<string>
```

- `runContext.context` — 用户传入的自定义上下文
- `agent` — 当前 Agent 实例
- 返回值为字符串（同步）或 Promise<string>（异步）

## Prompt ID 管理

使用 OpenAI Platform 的 Prompt 管理功能，通过 ID 引用 Prompt：

```typescript
import { Agent, run } from '@openai/agents'

const agent = new Agent({
  name: 'Assistant',
  prompt: {
    promptId: 'prompt_abc123', // OpenAI Platform 上的 Prompt ID
    version: '1', // Prompt 版本
    variables: {
      // 变量替换
      poem_style: 'sonnet'
    }
  }
})

const result = await run(agent, 'Write me a poem about nature.')
```

### 动态变量

```typescript
function pickPoemStyle(): string {
  const styles = ['haiku', 'sonnet', 'limerick', 'free verse']
  return styles[Math.floor(Math.random() * styles.length)]
}

const agent = new Agent({
  name: 'Poet',
  prompt: {
    promptId: 'prompt_abc123',
    version: '1',
    variables: {
      poem_style: pickPoemStyle() // 运行时动态选择
    }
  }
})
```

### Prompt ID vs Instructions

| 特性     | `instructions` | `prompt`         |
| -------- | -------------- | ---------------- |
| 定义位置 | 代码中         | OpenAI Platform  |
| 版本管理 | Git            | Platform 内置    |
| 变量支持 | 通过函数       | 内置 `variables` |
| 协作     | 需要代码权限   | 非开发者可编辑   |
| 适用场景 | 开发和小团队   | 大团队、频繁调整 |

## 对话延续：previousResponseId

使用 `previousResponseId` 在多次运行间保持对话上下文，无需管理 history：

```typescript
import { Agent, run } from '@openai/agents'

const agent = new Agent({
  name: 'Chat Agent',
  instructions: 'You are a knowledgeable assistant.'
})

// 第一轮
let result = await run(agent, 'What is the largest country in South America?')
console.log(result.finalOutput) // "Brazil..."

// 第二轮 — 引用上一轮的上下文
result = await run(agent, 'What is the capital of that country?', {
  previousResponseId: result.lastResponseId
})
console.log(result.finalOutput) // "Brasilia..."

// 第三轮
result = await run(agent, 'What is the weather there today?', {
  previousResponseId: result.lastResponseId
})
```

### 流式模式也支持

```typescript
let stream = await run(agent, 'Tell me about Brazil', { stream: true })
for await (const event of stream.toTextStream()) {
  process.stdout.write(event)
}

// 延续对话
stream = await run(agent, 'What about its culture?', {
  stream: true,
  previousResponseId: stream.lastResponseId
})
```

## Conversations API

使用 OpenAI Conversations API 在服务端管理对话：

```typescript
import { Agent, run } from '@openai/agents'
import OpenAI from 'openai'

const client = new OpenAI()

// 创建对话
const newConvo = await client.conversations.create({})
const conversationId = newConvo.id

const agent = new Agent({
  name: 'Assistant',
  instructions: 'You are helpful.',
  tools: [getWeather]
})

const options = { conversationId }

// 多轮对话自动保持上下文
let result = await run(agent, 'What is the largest country in South America?', options)
result = await run(agent, 'What is the capital of that country?', options)
result = await run(agent, 'What is the weather in the city today?', options)

// 获取完整对话历史
const convo = await client.conversations.items.list(conversationId)
for await (const page of convo.iterPages()) {
  for (const item of page.getPaginatedItems()) {
    console.log(JSON.stringify(item, null, 2))
  }
}
```

## 对话上下文管理方式对比

| 方式                 | 数据位置      | 手动管理 | 持久化 | 适用场景     |
| -------------------- | ------------- | -------- | ------ | ------------ |
| `history`            | 客户端        | 是       | 否     | 完全控制     |
| `previousResponseId` | OpenAI 服务端 | 否       | 临时   | 简单延续     |
| `conversationId`     | OpenAI 服务端 | 否       | 是     | 服务端管理   |
| `Session`            | 可配置        | 否       | 可配置 | SDK 内置管理 |

## 最佳实践

1. **动态指令用函数** — 避免在运行前手动拼接字符串
2. **上下文类型要明确** — 使用 TypeScript 泛型确保类型安全
3. **Prompt ID 适合团队协作** — 非开发者可以在 Platform 上修改
4. **简单场景用 `previousResponseId`** — 最少的代码量
5. **需要持久化用 Session** — 详见 [10-memory-session.md](./10-memory-session.md)

## 下一步

- 记忆与会话管理 → [10-memory-session.md](./10-memory-session.md)
- Agent 与 Runner 核心概念 → [02-agent-and-runner.md](./02-agent-and-runner.md)
