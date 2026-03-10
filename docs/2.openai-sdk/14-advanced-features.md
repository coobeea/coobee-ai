# 14 - 高级特性

> 来源：`examples/basic/reasoning.ts`, `basic/hello-world-gpt-oss.ts`, 以及各文件中的高级配置

## 概述

本文汇总 SDK 中的高级配置和工具函数，包括追踪、Reasoning 控制、辅助函数等。

## 追踪（Tracing）

### withTrace

`withTrace` 将一系列操作组织成一个可追踪的 Trace：

```typescript
import { withTrace } from '@openai/agents';

await withTrace('My workflow', async () => {
  const outline = await run(outlineAgent, input);
  const check = await run(checkerAgent, outline.finalOutput);
  const story = await run(storyAgent, outline.finalOutput);
});
```

`withTrace` 的参数：

- 第一个参数：Trace 名称（用于在 OpenAI Dashboard 中识别）
- 第二个参数：异步函数，内部所有 `run()` 调用都归属于这个 Trace

### Runner 追踪元数据

```typescript
import { Runner } from '@openai/agents';

const runner = new Runner({
  groupId: 'customer-support',
  traceMetadata: {
    user_id: 'user-123',
    session_id: 'sess-456',
    environment: 'production'
  }
});
```

### 禁用追踪

测试或使用本地模型时可以禁用：

```typescript
import { setTracingDisabled } from '@openai/agents';

setTracingDisabled(true);
```

## Reasoning 配置

### effort（推理力度）

控制模型在回答前的"思考"程度：

```typescript
const agent = new Agent({
  name: 'Deep Thinker',
  model: 'gpt-5.2',
  modelSettings: {
    reasoning: {
      effort: 'high', // 'high' | 'medium' | 'low' | 'minimal' | 'none'
      summary: 'auto' // 'auto' | 'always' | 'never'
    }
  }
});
```

| effort 值   | 说明     | 适用场景             |
| ----------- | -------- | -------------------- |
| `'high'`    | 深度推理 | 复杂问题、数学、逻辑 |
| `'medium'`  | 中等推理 | 一般任务             |
| `'low'`     | 轻度推理 | 简单任务             |
| `'minimal'` | 最小推理 | 快速响应             |
| `'none'`    | 禁用推理 | 纯生成任务           |

### summary（推理摘要）

| summary 值 | 说明                     |
| ---------- | ------------------------ |
| `'auto'`   | 模型自行决定是否返回摘要 |
| `'always'` | 始终返回推理摘要         |
| `'never'`  | 不返回摘要               |

### 访问推理内容

```typescript
const agent = new Agent({
  name: 'Agent',
  model: 'gpt-5.2',
  modelSettings: {
    reasoning: { effort: 'high', summary: 'auto' },
    text: { verbosity: 'high' }
  }
});

const result = await run(agent, 'How many r are in strawberry?');

// 遍历推理项
for (const item of result.newItems) {
  if (item.type === 'reasoning_item') {
    for (const entry of item.rawItem.content) {
      if (entry.type === 'input_text') {
        console.log(`Thinking: ${entry.text}`);
      }
    }
  }
}

// 最终输出
console.log('Answer:', result.finalOutput);
```

## Text 配置

### verbosity（输出详细度）

```typescript
const agent = new Agent({
  modelSettings: {
    text: {
      verbosity: 'low' // 'high' | 'medium' | 'low'
    }
  }
});
```

| verbosity 值 | 说明       |
| ------------ | ---------- |
| `'high'`     | 详细解释   |
| `'medium'`   | 中等详细度 |
| `'low'`      | 简洁回答   |

## maxTurns（最大轮次）

限制 Agent 执行的最大轮次，防止无限循环：

```typescript
const result = await run(agent, 'Complex task', {
  maxTurns: 10 // 最多 10 轮（包括工具调用）
});
```

Agent-as-Tool 也可以限制：

```typescript
const tool = subAgent.asTool({
  toolName: 'sub_agent',
  runOptions: {
    maxTurns: 3 // 子 Agent 最多 3 轮
  }
});
```

## 辅助函数

### `user()` — 创建用户消息

```typescript
import { user } from '@openai/agents';

// 等价于 { role: 'user', content: 'Hello' }
const message = user('Hello');
```

### `extractAllTextOutput()` — 提取文本输出

从运行结果中提取所有文本内容：

```typescript
import { extractAllTextOutput } from '@openai/agents';

const result = await run(agent, 'Tell me a story');
const text = extractAllTextOutput(result.newItems);
console.log(text); // 完整的文本输出
```

适用场景：

- 并行执行后提取各结果的文本
- 需要纯文本而非结构化 RunItem

## store 配置

控制是否在 OpenAI 端存储对话：

```typescript
const agent = new Agent({
  modelSettings: {
    store: true // 默认：存储对话（支持 Conversations API）
    // store: false,  // 不存储（隐私敏感场景）
  }
});
```

当 `store: false` 时：

- 无法使用 `previousResponseId`
- 无法使用 Conversations API
- 会话压缩自动切换到 `input` 模式

## 本地模型集成

通过 `OpenAIChatCompletionsModel` 连接本地模型：

```typescript
import { Agent, OpenAIChatCompletionsModel, run, setTracingDisabled } from '@openai/agents';
import OpenAI from 'openai';

// 禁用追踪（本地模型不支持）
setTracingDisabled(true);

const agent = new Agent({
  name: 'Local Agent',
  model: new OpenAIChatCompletionsModel(
    new OpenAI({
      baseURL: 'http://localhost:11434/v1', // Ollama
      apiKey: 'ollama'
    }),
    'llama3:8b' // 模型名称
  ),
  instructions: 'You answer questions concisely.',
  modelSettings: {
    reasoning: { effort: 'low' }
  }
});

// 流式输出
const stream = await run(agent, 'What is TypeScript?', { stream: true });
for await (const event of stream.toTextStream()) {
  process.stdout.write(event);
}
```

### 支持的本地/第三方服务

| 服务         | baseURL                         | 说明          |
| ------------ | ------------------------------- | ------------- |
| Ollama       | `http://localhost:11434/v1`     | 本地推理      |
| LM Studio    | `http://localhost:1234/v1`      | 本地 GUI 推理 |
| vLLM         | `http://localhost:8000/v1`      | 高性能推理    |
| Azure OpenAI | `https://xxx.openai.azure.com/` | Azure 托管    |

## Agent 克隆

创建 Agent 的变体，修改部分配置：

```typescript
const baseAgent = new Agent({
  name: 'Base Agent',
  instructions: 'You are helpful.',
  model: 'gpt-5'
});

// 克隆并修改（注释中的示例 API）
// const variantAgent = baseAgent.clone({
//   name: 'Variant Agent',
//   model: 'gpt-5.1',
// });
```

## RunResult 完整属性

| 属性             | 类型               | 说明                 |
| ---------------- | ------------------ | -------------------- |
| `finalOutput`    | `string \| T`      | 最终输出             |
| `lastAgent`      | `Agent`            | 最后执行的 Agent     |
| `currentAgent`   | `Agent`            | 当前活跃的 Agent     |
| `newItems`       | `RunItem[]`        | 新产生的 Item        |
| `history`        | `AgentInputItem[]` | 完整历史             |
| `lastResponseId` | `string`           | 最后响应 ID          |
| `interruptions`  | `Interruption[]`   | 中断列表（HITL）     |
| `state`          | `RunState`         | 运行状态（可序列化） |

## 事件类型速查

### 流式事件

| 事件类型                     | 说明           |
| ---------------------------- | -------------- |
| `raw_model_stream_event`     | 原始模型流事件 |
| `agent_updated_stream_event` | Agent 切换     |
| `run_item_stream_event`      | 运行项事件     |

### 生命周期事件

| 事件类型           | 说明           |
| ------------------ | -------------- |
| `agent_start`      | Agent 开始执行 |
| `agent_end`        | Agent 执行结束 |
| `agent_tool_start` | 工具开始调用   |
| `agent_tool_end`   | 工具调用完成   |
| `agent_handoff`    | Agent 移交     |

### RunItem 类型

| item.type               | 说明     |
| ----------------------- | -------- |
| `tool_call_item`        | 工具调用 |
| `tool_call_output_item` | 工具输出 |
| `message_output_item`   | 消息输出 |
| `reasoning_item`        | 推理内容 |

## 最佳实践

1. **生产环境启用 Tracing** — 用于调试和监控
2. **Reasoning effort 按需设置** — 简单任务用 `low`，复杂问题用 `high`
3. **设置合理的 maxTurns** — 防止意外的无限循环
4. **本地模型禁用 Tracing** — 避免报错
5. **敏感场景设置 `store: false`** — 保护隐私

## 文档导航

返回 [README.md](./README.md) 查看完整文档目录。
