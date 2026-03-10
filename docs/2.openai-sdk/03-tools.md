# 03 - 工具系统

> 来源：`examples/basic/tools.ts`, `basic/tool-use-behavior.ts`, `basic/file-tool-output.ts`, `basic/image-tool-output.ts`, `agent-patterns/forcing-tool-use.ts`

## 概述

工具（Tools）是赋予 Agent 能力的核心机制。通过工具，Agent 可以调用外部 API、查询数据库、操作文件等。SDK 提供了类型安全的工具定义方式。

## 基础工具定义

```typescript
import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';

const getWeather = tool({
  name: 'get_weather',
  description: 'Get the weather for a city.',
  parameters: z.object({
    city: z.string().describe('The city name')
  }),
  execute: async ({ city }) => {
    return {
      city,
      temperatureRange: '14-20C',
      conditions: 'Sunny with wind.'
    };
  }
});

const agent = new Agent({
  name: 'Weather Agent',
  instructions: 'You help users check the weather.',
  tools: [getWeather]
});

const result = await run(agent, 'What is the weather in Tokyo?');
```

### 工具定义参数

| 参数               | 类型                  | 必需 | 说明                             |
| ------------------ | --------------------- | ---- | -------------------------------- |
| `name`             | `string`              | 是   | 工具名称                         |
| `description`      | `string`              | 是   | 工具描述（LLM 用来决定何时调用） |
| `parameters`       | `ZodSchema`           | 是   | 输入参数的 Zod schema            |
| `execute`          | `Function`            | 是   | 执行函数，接收解析后的参数       |
| `inputGuardrails`  | `ToolGuardrail[]`     | 否   | 输入护栏                         |
| `outputGuardrails` | `ToolGuardrail[]`     | 否   | 输出护栏                         |
| `needsApproval`    | `Function \| boolean` | 否   | 是否需要人工审批                 |
| `isEnabled`        | `Function \| boolean` | 否   | 是否启用                         |

## 工具级 Guardrails

工具可以配置输入和输出护栏，在工具执行前后进行检查：

### 输入护栏

```typescript
const getWeather = tool({
  name: 'get_weather',
  description: 'Get the weather for a city.',
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => {
    return { city, conditions: 'Sunny' };
  },
  inputGuardrails: [
    {
      name: 'get_weather_input_guardrail',
      run: async ({ toolCall }) => {
        const toolArgs = JSON.parse(toolCall.arguments);
        // 只允许查询日本城市
        if (toolArgs.city.toLowerCase() !== 'tokyo') {
          return {
            behavior: {
              type: 'rejectContent',
              message: 'I can help you only for cities in Japan.'
            }
          };
        }
        return { behavior: { type: 'allow' } };
      }
    }
  ]
});
```

### 输出护栏

```typescript
const getWeather = tool({
  name: 'get_weather',
  // ... 其他配置
  outputGuardrails: [
    {
      name: 'get_weather_output_guardrail',
      run: async ({ output }) => {
        // 检查输出是否包含敏感信息
        return { behavior: { type: 'allow' } };
      }
    }
  ]
});
```

护栏行为类型：

- `{ type: 'allow' }` — 允许继续
- `{ type: 'rejectContent', message: string }` — 拒绝并返回消息给 LLM

## 工具使用行为（toolUseBehavior）

控制 Agent 调用工具后的行为：

### 方式一：默认行为 — `run_llm_again`

工具结果返回给 LLM，LLM 基于结果生成最终输出：

```typescript
const agent = new Agent({
  name: 'Weather Agent',
  tools: [getWeather]
  // 默认行为，无需显式设置
  // toolUseBehavior: 'run_llm_again',
});
```

### 方式二：在指定工具处停止 — `stopAtToolNames`

Agent 调用指定工具后立即停止，返回工具结果：

```typescript
const agent = new Agent({
  name: 'Data Agent',
  tools: [getWeather, saySomething],
  toolUseBehavior: {
    stopAtToolNames: ['get_weather']
  },
  outputType: WeatherSchema
});

// Agent 调用 get_weather 后直接返回，不会再调用 LLM
const result = await run(agent, 'Weather in Tokyo?');
```

### 方式三：自定义函数

完全控制工具结果的处理方式：

```typescript
import type { ToolToFinalOutputFunction, FunctionToolResult } from '@openai/agents';

const customBehavior: ToolToFinalOutputFunction = async (_context, results: FunctionToolResult[]) => {
  const outputResult = results.find((r) => r.type === 'function_output');
  if (!outputResult) {
    return { isFinalOutput: false, isInterrupted: undefined };
  }
  const weather = outputResult.output as Weather;
  return {
    isFinalOutput: true,
    finalOutput: `${weather.city} is ${weather.conditions}.`
  };
};

const agent = new Agent({
  name: 'Custom Agent',
  tools: [getWeather],
  toolUseBehavior: customBehavior
});
```

## 强制使用工具

通过 `toolChoice` 强制 Agent 必须调用工具：

```typescript
const agent = new Agent({
  name: 'Tool Agent',
  tools: [getWeather],
  modelSettings: {
    toolChoice: 'required' // 强制使用工具
  }
});
```

`toolChoice` 选项：

- `'auto'` — LLM 自行决定（默认）
- `'required'` — 必须调用至少一个工具
- `'none'` — 不允许调用工具

## 工具返回文件

工具可以返回文件内容，Agent 会分析文件：

```typescript
import { Agent, run, tool, ToolOutputFileContent } from '@openai/agents';

const fetchSystemCard = tool({
  name: 'fetch_system_card',
  description: 'Fetch the system card for the given topic.',
  parameters: z.object({ topic: z.string() }),
  execute: async ({ topic }): Promise<ToolOutputFileContent> => {
    return {
      type: 'file',
      file: {
        data: fs.readFileSync(pdfPath),
        mediaType: 'application/pdf',
        filename: 'system-card.pdf'
      }
    };
  }
});
```

## 工具返回图片

```typescript
import { Agent, run, tool, ToolOutputImage } from '@openai/agents';

const fetchImage = tool({
  name: 'fetch_image',
  description: 'Fetch a sample image.',
  parameters: z.object({}),
  execute: async (): Promise<ToolOutputImage> => {
    return {
      type: 'image',
      image: 'https://example.com/image.jpg',
      detail: 'auto' // 'auto' | 'low' | 'high'
    };
  }
});
```

## 条件启用工具

根据运行时上下文动态启用或禁用工具：

```typescript
import { Agent, RunContext } from '@openai/agents';

type AppContext = { isPremiumUser: boolean };

const premiumTool = tool({
  name: 'premium_feature'
  // ...
});

const agent = new Agent<AppContext>({
  tools: [
    someAgent.asTool({
      toolName: 'premium_agent',
      isEnabled: ({ runContext }: { runContext: RunContext<AppContext> }) => {
        return runContext.context.isPremiumUser;
      }
    })
  ]
});
```

## 最佳实践

1. **工具描述要清晰** — LLM 根据描述决定何时调用工具
2. **用 Zod 定义参数** — 自动获得类型安全和校验
3. **工具执行要健壮** — 处理错误和边界情况
4. **敏感操作加护栏** — 使用 `inputGuardrails` 或 `needsApproval`
5. **合理设置 toolChoice** — 需要工具时用 `required`，否则用 `auto`

## 下一步

- 结构化输出 → [04-structured-output.md](./04-structured-output.md)
- 人工审批工具调用 → [11-hitl.md](./11-hitl.md)
- 护栏详解 → [12-guardrails.md](./12-guardrails.md)
