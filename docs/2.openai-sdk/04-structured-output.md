# 04 - 结构化输出

> 来源：`examples/basic/json-schema-output-type.ts`, `basic/hello-world-gpt-5.ts`

## 概述

结构化输出让 Agent 返回格式化的 JSON 数据而非自由文本。SDK 支持两种定义方式：Zod Schema 和 JSON Schema。

## 方式一：Zod Schema（推荐）

使用 Zod 定义输出类型，享受完整的 TypeScript 类型推断：

```typescript
import { Agent, run } from '@openai/agents';
import { z } from 'zod';

const output = z.object({
  title: z.string(),
  description: z.string()
});

const agent = new Agent({
  name: 'Structured Agent',
  instructions: "You're a helpful assistant.",
  outputType: output
});

const result = await run(agent, 'Describe TypeScript in one sentence.');

// result.finalOutput 类型自动推断为 { title: string; description: string }
console.log(result.finalOutput.title);
console.log(result.finalOutput.description);
```

### 复杂 Schema 示例

```typescript
const Weather = z.object({
  city: z.string().describe('City name'),
  temperatureRange: z.string().describe('Temperature range like 14-20C'),
  conditions: z.string().describe('Weather conditions description')
});

const agent = new Agent({
  name: 'Weather Reporter',
  instructions: 'Report the weather in the requested city.',
  outputType: Weather
});
```

## 方式二：JSON Schema

使用纯 JSON Schema 定义，不依赖 Zod：

```typescript
import { Agent, run, JsonSchemaDefinition } from '@openai/agents';

const WeatherSchema: JsonSchemaDefinition = {
  type: 'json_schema',
  name: 'Weather',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      city: { type: 'string' },
      forecast: { type: 'string' }
    },
    required: ['city', 'forecast'],
    additionalProperties: false
  }
};

const agent = new Agent({
  name: 'Weather Reporter',
  instructions: 'Return the city and a short weather forecast.',
  outputType: WeatherSchema
});

const result = await run(agent, 'Weather in Paris?');
// result.finalOutput 类型为 unknown，需要手动断言
const output = result.finalOutput as { city: string; forecast: string };
```

### JSON Schema 关键参数

| 参数                   | 说明                            |
| ---------------------- | ------------------------------- |
| `type`                 | 固定为 `'json_schema'`          |
| `name`                 | Schema 名称                     |
| `strict`               | 是否启用严格模式（推荐 `true`） |
| `schema`               | 标准 JSON Schema 定义           |
| `additionalProperties` | 设为 `false` 禁止额外属性       |

## 两种方式对比

| 特性       | Zod Schema      | JSON Schema         |
| ---------- | --------------- | ------------------- |
| 类型推断   | 自动            | 需手动断言          |
| 运行时验证 | 内置            | 无                  |
| 编写体验   | TypeScript 友好 | 纯 JSON             |
| 描述字段   | `.describe()`   | `description` 属性  |
| 适用场景   | TypeScript 项目 | 动态 Schema、跨语言 |

## 结构化输出与 Agent 设计模式

结构化输出在门控逻辑和评估中非常有用：

```typescript
// 评估 Agent 返回结构化的评判结果
const EvaluationResult = z.object({
  good_quality: z.boolean(),
  is_scifi: z.boolean()
});

const checker = new Agent({
  name: 'Outline Checker',
  instructions: 'Judge the quality of the story outline.',
  outputType: EvaluationResult
});

const result = await run(checker, outlineText);

// 基于结构化结果进行门控
if (!result.finalOutput.good_quality) {
  console.log('Quality check failed');
  return;
}
```

## 最佳实践

1. **优先使用 Zod** — 自动类型推断，减少运行时错误
2. **设置 `strict: true`** — JSON Schema 方式下启用严格模式
3. **用 `.describe()` 添加字段描述** — 帮助 LLM 理解每个字段的含义
4. **保持 Schema 简洁** — 避免过深嵌套，LLM 更容易正确生成

## 下一步

- 流式处理 → [05-streaming.md](./05-streaming.md)
- Agent 设计模式中的结构化输出应用 → [13-agent-patterns.md](./13-agent-patterns.md)
