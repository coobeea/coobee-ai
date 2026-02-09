# 01 - 快速入门

> 来源：`examples/basic/hello-world.ts`

## 概述

OpenAI Agents JS SDK 提供了一套简洁的 API 来创建和运行 AI Agent。本文展示最简单的 Agent 创建和运行方式。

## 安装

```bash
pnpm add @openai/agents
```

确保设置环境变量：

```bash
export OPENAI_API_KEY=your-api-key
```

## 最小示例

```typescript
import { Agent, run } from '@openai/agents'

const agent = new Agent({
  name: 'Assistant',
  instructions: 'You only respond in haikus.'
})

const result = await run(agent, 'Tell me about recursion in programming.')
console.log(result.finalOutput)
```

这就是全部！三步完成：

1. **创建 Agent** — `new Agent({ name, instructions })`
2. **运行 Agent** — `run(agent, input)`
3. **获取结果** — `result.finalOutput`

## 核心 API

### `Agent` 构造函数

```typescript
new Agent({
  name: string;          // Agent 名称
  instructions: string;  // 系统指令（System Prompt）
  model?: string;        // 模型名称（可选，默认使用 SDK 默认模型）
})
```

### `run()` 函数

```typescript
const result = await run(agent, input)
```

- `agent` — Agent 实例
- `input` — 用户输入（字符串或消息数组）
- 返回 `RunResult`，包含 `finalOutput`（最终输出文本）

## RunResult 关键属性

| 属性             | 类型               | 说明                                                   |
| ---------------- | ------------------ | ------------------------------------------------------ |
| `finalOutput`    | `string \| T`      | 最终输出（文本或结构化数据）                           |
| `lastAgent`      | `Agent`            | 最后执行的 Agent（handoff 场景下可能不同于初始 Agent） |
| `newItems`       | `RunItem[]`        | 本次运行产生的新 Item                                  |
| `history`        | `AgentInputItem[]` | 完整的历史记录（可传入下次运行）                       |
| `lastResponseId` | `string`           | 最后一次响应的 ID                                      |

## 下一步

- 了解 Agent 和 Runner 的完整配置 → [02-agent-and-runner.md](./02-agent-and-runner.md)
- 给 Agent 添加工具 → [03-tools.md](./03-tools.md)
- 启用流式输出 → [05-streaming.md](./05-streaming.md)
