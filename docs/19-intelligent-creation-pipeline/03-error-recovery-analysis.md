# Agent 错误恢复机制分析

## 问题描述

在使用 `ark-code-latest` 模型创建智能体时，遇到 API 参数不兼容错误：

```
The parameter `response_format.type` specified in the request are not valid:
`json_object` is not supported by this model
```

**核心问题**：为什么系统没有自动重试或智能修复？

---

## 系统现状分析

### ✅ 已有的错误恢复机制

系统在 `src/main/ai/runtime/ErrorRecoveryChain.ts` 中实现了完善的**渐进式错误恢复链**：

#### 恢复策略链（按优先级）

1. **认证错误检测** (`AuthenticationStrategy`)
   - 匹配：`unauthorized`、`invalid_api_key`、`401`、`403`
   - 动作：直接抛出（不可恢复）

2. **上下文压缩恢复** (`ContextCompressionStrategy`)
   - 匹配：`context_length_exceeded`、`tokens exceed`
   - 动作：触发上下文压缩后重试（最多2次）

3. **思考级别降级** (`ThinkingLevelFallbackStrategy`)
   - 匹配：`context_length_exceeded`、`reasoning_tokens`
   - 动作：逐级降低思考级别 `high → medium → low → off`

4. **简单重试（指数退避）** (`SimpleRetryStrategy`)
   - 匹配：网络超时、速率限制（`timeout`、`429`、`500-503`）
   - 动作：最多重试 2 次，延迟 1s → 2s → 4s

#### 工作机制

```typescript
// AbstractAgentRuntime.ts (line 142-170)
try {
  // LLM 调用
  const result = await this.doStream(input, config, signal);
  return result;
} catch (error) {
  // ✅ 渐进式错误恢复
  const recovery = await defaultRecoveryChain.recover(error, {
    attempt,
    maxAttempts,
    sessionId: config?.sessionId,
    runtime: this.buildRecoveryRuntime() // 注入 runtime 能力
  });

  if (recovery.action === 'retry') {
    attempt++;
    if (recovery.delay) {
      await sleep(recovery.delay); // 延迟重试
    }
    continue; // 🔄 重新执行
  }

  throw error; // 不可恢复，抛出
}
```

---

## ❌ 问题根源：AgentCreatorService 绕过了 Runtime

### 架构差异

| 组件                    | 执行路径                                                | 是否有错误恢复           |
| ----------------------- | ------------------------------------------------------- | ------------------------ |
| **正常 Agent 调用**     | `AgentExecutor` → `AbstractAgentRuntime` → `doStream()` | ✅ 有 ErrorRecoveryChain |
| **AgentCreatorService** | 直接调用 `OpenAI.chat.completions.create()`             | ❌ 无恢复机制            |
| **SkillCreatorService** | 直接调用 `OpenAI.chat.completions.create()`             | ❌ 无恢复机制            |

### 代码对比

**正常 Agent 调用**（有错误恢复）：

```typescript
// AgentExecutor.ts
const runtime = this.createRuntime(agent, options);
const result = await runtime.stream(input); // ✅ 经过 AbstractAgentRuntime.stream()
```

**AgentCreatorService**（无错误恢复）：

```typescript
// AgentCreatorService.ts (line 258-266)
const { client, model } = createOpenAIClient();

const response = await client.chat.completions.create({
  // ❌ 直接调用，绕过 Runtime
  model,
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: requirement }
  ],
  temperature: 0.7,
  max_tokens: 2000
});
// 没有 try-catch，没有重试逻辑
```

---

## 🎯 解决方案对比

### 方案 A：为 AgentCreatorService 单独封装重试（快速修复）

**优点**：

- 改动最小，立即生效
- 保持 AgentCreatorService 的轻量特性

**缺点**：

- 代码重复（与 ErrorRecoveryChain 功能重叠）
- 需要同时修改 AgentCreatorService 和 SkillCreatorService

**实现示例**：

```typescript
// AgentCreatorService.ts
async function callLLMWithRetry(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  requirement: string,
  maxRetries = 3
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: requirement }
        ],
        temperature: 0.7,
        max_tokens: 2000
      });
      return response.choices[0]?.message?.content || '';
    } catch (error) {
      const recovery = await defaultRecoveryChain.recover(error, {
        attempt,
        maxAttempts: maxRetries
      });

      if (recovery.action === 'retry') {
        if (recovery.delay) await sleep(recovery.delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}
```

---

### 方案 B：改造为使用 AgentRuntime（标准化）

**优点**：

- 自动享受所有 Runtime 能力（错误恢复、上下文压缩、思考级别降级）
- 统一架构，未来扩展方便

**缺点**：

- 需要重构 AgentCreatorService
- 需要创建临时 Agent 定义

**实现思路**：

```typescript
// 创建一个内置的 "agent-creator" Agent
const agentCreatorAgent: AgentDefinition = {
  id: 'system-agent-creator',
  name: '智能体创建助手',
  instructions: buildSystemPrompt(tools, skills),
  tools: [],
  skills: []
};

// 通过 AgentExecutor 调用
const runtime = agentExecutor.createRuntime(agentCreatorAgent, {
  model: 'ark-code-latest'
});

const result = await runtime.stream(requirement); // ✅ 自动错误恢复
```

---

### 方案 C：提取通用 LLM 调用包装器（推荐 ⭐）

**优点**：

- 复用 ErrorRecoveryChain 逻辑，避免代码重复
- 轻量，不依赖完整 AgentRuntime
- 可供所有直接调用 LLM 的场景使用

**缺点**：

- 需要新增一个模块

**实现示例**：

```typescript
// src/main/ai/common/LLMCallWrapper.ts
import { defaultRecoveryChain, type RecoveryContext } from '@main/ai/runtime/ErrorRecoveryChain';
import type OpenAI from 'openai';

export interface LLMCallOptions {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  max_tokens?: number;
  maxRetries?: number;
}

/**
 * 带错误恢复的 LLM 调用包装器
 *
 * 复用 ErrorRecoveryChain 的渐进式恢复策略
 */
export async function callLLMWithRecovery(client: OpenAI, options: LLMCallOptions): Promise<string> {
  const maxRetries = options.maxRetries ?? 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const response = await client.chat.completions.create({
        model: options.model,
        messages: options.messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens ?? 2000
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('LLM 返回空内容');
      }

      return content;
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;

      // 使用 ErrorRecoveryChain 分析错误
      const recovery = await defaultRecoveryChain.recover(error, {
        attempt,
        maxAttempts: maxRetries
      });

      if (recovery.action === 'retry') {
        attempt++;
        if (recovery.delay) {
          await new Promise((resolve) => setTimeout(resolve, recovery.delay));
        }
        continue; // 重试
      }

      // 不可恢复，抛出原错误
      throw error;
    }
  }

  throw new Error(`Max retries (${maxRetries}) exceeded`);
}
```

**使用方式**：

```typescript
// AgentCreatorService.ts
import { callLLMWithRecovery } from '@main/ai/common/LLMCallWrapper';

export async function aiCreateAgent(requirement: string, onProgress?: ProgressCallback) {
  // ...

  const { client, model } = createOpenAIClient();

  // ✅ 使用带错误恢复的包装器
  const content = await callLLMWithRecovery(client, {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: requirement }
    ],
    temperature: 0.7,
    max_tokens: 2000,
    maxRetries: 3
  });

  // ...
}
```

---

## 🤔 为什么这次错误没有被自动修复？

### 错误类型分析

```
InvalidParameter: The parameter `response_format.type` specified in the request are not valid
```

这是一个 **API 参数不兼容错误**，属于以下分类：

| 错误类型           | 是否可自动恢复      | ErrorRecoveryChain 策略                                        |
| ------------------ | ------------------- | -------------------------------------------------------------- |
| 网络超时、速率限制 | ✅ 可重试           | `SimpleRetryStrategy`                                          |
| 上下文长度超限     | ✅ 可压缩/降级      | `ContextCompressionStrategy` + `ThinkingLevelFallbackStrategy` |
| **API 参数错误**   | ❌ **不可自动恢复** | 无对应策略（需要修改代码）                                     |
| 认证错误           | ❌ 不可恢复         | `AuthenticationStrategy`                                       |

### 为什么不可自动恢复？

1. **需要修改请求参数**：重试时仍会使用相同的 `response_format` 参数
2. **需要理解错误语义**：Agent 需要知道"这个模型不支持 json_object"
3. **需要调整代码逻辑**：不能简单重试，必须删除不兼容的参数

---

## 💡 进阶方案：智能参数自适应（未来方向）

### 概念

让 Agent 能够**理解错误信息**并**自适应调整 API 参数**：

```typescript
// 伪代码示例
class SmartParameterStrategy implements RecoveryStrategy {
  name = 'smart-parameter';

  canHandle(error: Error): boolean {
    return error.message.includes('InvalidParameter') || error.message.includes('not supported by this model');
  }

  async recover(error: Error, context: RecoveryContext): Promise<RecoveryAction> {
    // 1. 解析错误信息，提取不支持的参数名
    const unsupportedParam = this.extractParameter(error.message);
    // 例如："response_format.type"

    // 2. 告知调用方移除该参数
    context.runtime?.removeParameter?.(unsupportedParam);

    // 3. 重试
    return {
      action: 'retry',
      reason: `Removed unsupported parameter: ${unsupportedParam}`
    };
  }
}
```

### 挑战

1. **状态管理**：需要在重试间传递"已移除的参数"信息
2. **参数理解**：需要 LLM 参与分析错误 → 成本高
3. **通用性**：不同 API 的参数结构差异大

---

## 📋 推荐实施步骤

### Phase 1: 快速修复（本次）

✅ **已完成**：移除 `response_format: { type: 'json_object' }` 参数

### Phase 2: 标准化（短期）

1. 实现 `LLMCallWrapper` 包装器（方案C）
2. 重构 `AgentCreatorService` 使用包装器
3. 重构 `SkillCreatorService` 使用包装器
4. 为其他直接调用 LLM 的场景也使用包装器

### Phase 3: 智能化（长期）

1. 设计 `SmartParameterStrategy` 策略
2. 实现参数黑名单缓存（避免重复错误）
3. 添加模型能力元数据（哪些模型支持哪些参数）
4. 集成到 ErrorRecoveryChain

---

## 🎯 总结

### 系统优势

- ✅ 已有完善的错误恢复基础设施（ErrorRecoveryChain）
- ✅ 支持网络、上下文、思考级别等多维度自动恢复
- ✅ 架构清晰，易于扩展新策略

### 当前不足

- ❌ AgentCreatorService 和 SkillCreatorService 绕过了 Runtime
- ❌ 缺少 API 参数不兼容的智能处理
- ❌ 错误恢复能力未统一到所有 LLM 调用场景

### 优化建议

**立即实施**：

- 实现 `LLMCallWrapper` 通用包装器

**后续优化**：

- 为不同模型建立参数兼容性元数据
- 实现智能参数自适应策略
- 在前端显示错误恢复过程（"正在重试..."）

---

**更新时间**: 2026-03-31  
**相关文件**:

- `src/main/ai/runtime/ErrorRecoveryChain.ts`
- `src/main/ai/runtime/AbstractAgentRuntime.ts`
- `src/main/ai/services/AgentCreatorService.ts`
