# 02 - Agent 与 Runner 核心概念

> 来源：`examples/basic/index.ts`, `basic/hello-world.ts`, `basic/hello-world-gpt-5.ts`, `basic/hello-world-gpt-5.1.ts`, `basic/hello-world-gpt-oss.ts`

## 概述

`Agent` 和 `Runner` 是 SDK 的两个核心概念。Agent 定义了 AI 的身份和能力，Runner 负责执行 Agent 并管理运行过程。

## Agent 配置

### 完整配置项

```typescript
import { Agent } from '@openai/agents';

const agent = new Agent({
  // 基础配置
  name: 'My Agent', // Agent 名称（必需）
  instructions: 'You are helpful.', // 系统指令（字符串或函数）
  model: 'gpt-5', // 模型名称

  // 能力配置
  tools: [], // 工具列表
  handoffs: [], // 可移交的 Agent 列表
  handoffDescription: '', // 被移交时的描述

  // 输出配置
  outputType: zodSchema, // 结构化输出类型（Zod schema 或 JSON Schema）

  // 模型设置
  modelSettings: {
    reasoning: { effort: 'high', summary: 'auto' },
    text: { verbosity: 'low' },
    toolChoice: 'auto', // 'auto' | 'required' | 'none'
    store: true // 是否在 OpenAI 端存储对话
  },

  // 护栏
  inputGuardrails: [], // 输入护栏
  outputGuardrails: [], // 输出护栏

  // 工具行为
  toolUseBehavior: 'run_llm_again', // 工具使用后的行为

  // Prompt 管理
  prompt: {
    // 使用 OpenAI Platform Prompt
    promptId: 'prompt_xxx',
    version: '1',
    variables: { key: 'value' }
  }
});
```

### 模型选择

SDK 支持多种模型配置方式：

#### 使用模型名称（字符串）

```typescript
// GPT-5
const agent = new Agent({
  name: 'Assistant',
  model: 'gpt-5',
  modelSettings: {
    reasoning: { effort: 'minimal' },
    text: { verbosity: 'low' }
  }
});

// GPT-5.1（禁用 reasoning）
const agent51 = new Agent({
  name: 'Assistant',
  model: 'gpt-5.1',
  modelSettings: {
    reasoning: { effort: 'none' },
    text: { verbosity: 'low' }
  }
});
```

#### 使用自定义模型（本地 / 第三方）

```typescript
import { Agent, OpenAIChatCompletionsModel } from '@openai/agents';
import OpenAI from 'openai';

// 使用 Ollama 本地模型
const agent = new Agent({
  name: 'Local Assistant',
  model: new OpenAIChatCompletionsModel(
    new OpenAI({
      baseURL: 'http://localhost:11434/v1',
      apiKey: 'ollama'
    }),
    'gpt-oss:20b'
  ),
  instructions: 'You answer questions concisely.',
  modelSettings: { reasoning: { effort: 'low' } }
});
```

### 结构化输出

```typescript
import { z } from 'zod';

const output = z.object({
  title: z.string(),
  description: z.string()
});

const agent = new Agent({
  name: 'Structured Agent',
  model: 'gpt-5',
  instructions: "You're a helpful assistant.",
  outputType: output
});

const result = await run(agent, 'Describe TypeScript');
// result.finalOutput 的类型为 { title: string; description: string }
```

## Runner 使用

### 简洁方式：`run()` 函数

```typescript
import { run } from '@openai/agents';

// 最简用法
const result = await run(agent, 'Hello');

// 带选项
const result = await run(agent, 'Hello', {
  stream: true, // 流式输出
  maxTurns: 10, // 最大轮次
  context: myContext, // 自定义上下文
  session: mySession // 会话管理
});
```

### 高级方式：`Runner` 实例

```typescript
import { Runner } from '@openai/agents';

const runner = new Runner({
  model: 'gpt-4.1-mini', // 默认模型
  groupId: 'My group', // 分组 ID
  traceMetadata: { user_id: '123' } // 追踪元数据
});

const result = await runner.run(agent, 'Hello');
```

`Runner` 实例的优势：

- 可以设置**默认模型**，覆盖 Agent 的模型配置
- 可以附加 **groupId** 和 **traceMetadata** 用于追踪
- 适合在同一配置下运行多个 Agent

## 多轮对话

使用 `history` 保持对话上下文：

```typescript
import { Agent, run, user } from '@openai/agents';
import type { AgentInputItem } from '@openai/agents';

let history: AgentInputItem[] = [];
let latestAgent: Agent = agent;

// 对话循环
while (true) {
  const message = getUserInput();
  history.push(user(message));

  const result = await run(latestAgent, history);
  console.log(result.finalOutput);

  // 更新 Agent（可能因 handoff 而改变）
  if (result.lastAgent) {
    latestAgent = result.lastAgent;
  }
  // 更新历史记录
  history = result.history;
}
```

关键点：

- `user()` 辅助函数将字符串包装为用户消息
- `result.history` 包含完整历史，直接传入下次 `run()` 调用
- `result.lastAgent` 追踪当前活跃的 Agent

## 使用 `previousResponseId` 延续对话

另一种保持对话上下文的方式，无需手动管理 history：

```typescript
// 非流式
let result = await run(agent, 'What is the largest country in South America?');

result = await run(agent, 'What is the capital of that country?', {
  previousResponseId: result.lastResponseId
});

// 流式模式同样支持
let stream = await run(agent, 'Tell me a story', { stream: true });
// ... 处理流
stream = await run(agent, 'Continue the story', {
  stream: true,
  previousResponseId: stream.lastResponseId
});
```

## 使用 Conversations API

OpenAI Conversations API 在服务端管理对话上下文：

```typescript
import { Agent, run } from '@openai/agents';
import OpenAI from 'openai';

const client = new OpenAI();
const newConvo = await client.conversations.create({});
const conversationId = newConvo.id;

const options = { conversationId };

let result = await run(agent, 'What is the largest country in South America?', options);
result = await run(agent, 'What is the capital of that country?', options);
result = await run(agent, 'What is the weather there today?', options);
```

优势：无需在客户端管理 history，OpenAI 服务端自动维护。

## 最佳实践

1. **简单场景用 `run()`**，复杂场景用 `Runner` 实例
2. **明确设置 `instructions`**，这是 Agent 行为的核心
3. **多轮对话选择合适的方式**：
   - `history` — 完全控制对话内容
   - `previousResponseId` — 简单延续
   - `conversationId` — 服务端管理
   - `Session` — SDK 内置会话管理（详见 [10-memory-session.md](./10-memory-session.md)）

## 下一步

- 给 Agent 添加工具 → [03-tools.md](./03-tools.md)
- 配置结构化输出 → [04-structured-output.md](./04-structured-output.md)
- 了解模型高级配置 → [14-advanced-features.md](./14-advanced-features.md)
