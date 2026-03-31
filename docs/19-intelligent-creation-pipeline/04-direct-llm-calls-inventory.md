# 直接调用 LLM 的代码盘点

## 📊 盘点结果

### ✅ 生产代码中绕过 AgentRuntime 的 LLM 调用

找到 **2 个**直接调用 LLM 的地方（非测试代码）：

| 文件路径                                      | 行号 | 调用方式                           | 功能          | 风险等级 |
| --------------------------------------------- | ---- | ---------------------------------- | ------------- | -------- |
| `src/main/ai/services/AgentCreatorService.ts` | 258  | `client.chat.completions.create()` | AI 创建智能体 | 🔴 高    |
| `src/main/ai/services/SkillCreatorService.ts` | 203  | `client.chat.completions.create()` | AI 创建技能   | 🔴 高    |

### ❌ 不在盘点范围内

| 文件路径                                               | 原因                             | 说明                                                          |
| ------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------- |
| `src/main/common/extension/ExtensionApi.ts` (line 304) | 是 Embeddings API，不是聊天完成  | 用于文本向量化，不需要错误恢复链                              |
| `src/main/gateway/http/agents.ts` (line 313)           | `quickChat` 最终走 AgentExecutor | 通过标准 Runtime 路径（第373行调用 `agentExecutor.stream()`） |
| `src/main/ai/runtime/openai/__tests__/*.ts`            | 测试文件                         | 不属于生产代码                                                |

---

## 🔍 详细分析

### 1. AgentCreatorService.ts

**位置**: `src/main/ai/services/AgentCreatorService.ts:258-266`

**代码片段**:

```typescript
// ❌ 直接调用，没有错误恢复
const { client, model } = createOpenAIClient();

const response = await client.chat.completions.create({
  model,
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: requirement }
  ],
  temperature: 0.7,
  max_tokens: 2000
});
```

**功能说明**:

- 用户通过自然语言描述需求，AI 自动生成 Agent 定义（JSON 格式）
- 单次 LLM 调用，解析后持久化到 AgentStore

**存在的问题**:

1. ❌ 没有网络重试（超时、429 等会直接失败）
2. ❌ 没有上下文压缩（虽然这个场景不太可能超限）
3. ❌ 没有思考级别降级
4. ❌ API 参数不兼容错误会直接抛出（如本次 `response_format` 错误）

**调用路径**:

```
前端 (AgentView.vue)
  ↓ HTTP POST
/gateway/agents/ai-create
  ↓
aiCreateAgent()
  ↓ 直接调用
OpenAI API ❌ 绕过 Runtime
```

---

### 2. SkillCreatorService.ts

**位置**: `src/main/ai/services/SkillCreatorService.ts:203-211`

**代码片段**:

```typescript
// ❌ 直接调用，没有错误恢复
const { client, model } = createOpenAIClient();

const response = await client.chat.completions.create({
  model,
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: requirement }
  ],
  temperature: 0.7,
  max_tokens: 4000
});
```

**功能说明**:

- 用户通过自然语言描述需求，AI 自动生成 SKILL.md 文件内容
- 单次 LLM 调用，解析后写入到用户技能目录

**存在的问题**:

1. ❌ 同 AgentCreatorService，没有任何错误恢复机制
2. ❌ `max_tokens: 4000` 更高，更容易触发上下文限制错误

**调用路径**:

```
前端 (可能是某个 Skill 创建页面)
  ↓ HTTP POST
/gateway/skills/ai-create (推测)
  ↓
aiCreateSkill()
  ↓ 直接调用
OpenAI API ❌ 绕过 Runtime
```

---

### 3. ExtensionApi.ts (不在整改范围)

**位置**: `src/main/common/extension/ExtensionApi.ts:304`

**代码片段**:

```typescript
// ✅ Embeddings API，不是聊天完成
const response = await client.embeddings.create({
  model: embeddingConfig.model,
  input: texts
});
```

**为什么不需要整改**:

- 这是 **Embeddings API**，用于文本向量化，不是聊天完成
- Embeddings 调用通常很稳定，错误率低
- 即使失败，影响范围小（仅影响某个功能的向量检索）
- 可以考虑加简单重试，但不是高优先级

---

### 4. quickChat (已走标准路径 ✅)

**位置**: `src/main/gateway/http/agents.ts:313-398`

**代码片段**:

```typescript
// ✅ 最终走标准 Runtime 路径
router.post('/agents/:id/quick-chat', async (ctx) => {
  // ...
  const builder = createBuilderFromAgentDef(agentDef, 'chat');

  // ✅ 通过 AgentExecutor，享受完整错误恢复能力
  const gen = agentExecutor.stream({ sessionId, message, builder });
  // ...
});
```

**为什么不在整改范围**:

- 虽然前端调用 `useQuickChat.ts` 看起来是"快速调用"
- 但后端实现（第373行）通过 `agentExecutor.stream()`
- **完全走标准 AgentRuntime 路径，享受所有错误恢复能力** ✅

---

## 📈 风险评估

### 风险矩阵

| 调用场景                | 调用频率           | 失败影响       | 当前错误处理 | 综合风险  |
| ----------------------- | ------------------ | -------------- | ------------ | --------- |
| **AgentCreatorService** | 低（用户主动创建） | 高（创建失败） | 无           | 🔴 **高** |
| **SkillCreatorService** | 低（用户主动创建） | 高（创建失败） | 无           | 🔴 **高** |
| quickChat               | 高（频繁使用）     | 中（对话失败） | ✅ 完整      | 🟢 **低** |
| Embeddings              | 中（后台调用）     | 低（影响小）   | 无           | 🟡 **中** |

### 风险说明

**AgentCreatorService & SkillCreatorService**:

- **风险原因**:
  1. 单次调用失败 = 整个创建流程失败
  2. 用户需要重新输入需求（体验差）
  3. 前端没有显示"重试中..."的反馈
  4. 错误信息可能不友好（技术错误直接暴露给用户）

- **实际影响**:
  - 网络波动 → 创建失败（可重试修复）
  - 速率限制（429）→ 创建失败（可延迟重试修复）
  - API 参数不兼容 → 创建失败（本次案例，需要代码修复）
  - 模型选择器失败 → 创建失败（可 fallback 修复）

---

## 🎯 整改方案

### 方案对比

| 方案                                      | 工作量 | 效果                              | 推荐度     |
| ----------------------------------------- | ------ | --------------------------------- | ---------- |
| **方案 A**: 单独封装重试逻辑              | 1-2h   | 仅解决网络重试                    | ⭐⭐       |
| **方案 B**: 改造为 AgentRuntime           | 1 天   | 功能最完整                        | ⭐⭐⭐⭐   |
| **方案 C**: LLMCallWrapper 包装器（推荐） | 2-3h   | 统一架构，复用 ErrorRecoveryChain | ⭐⭐⭐⭐⭐ |

### 推荐方案：LLMCallWrapper (方案C)

**实施步骤**:

#### Step 1: 创建通用 LLM 调用包装器

创建 `src/main/ai/common/LLMCallWrapper.ts`：

```typescript
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
 * 复用 ErrorRecoveryChain 的渐进式恢复策略：
 * - 网络超时/速率限制 → 自动重试（指数退避）
 * - 上下文超限 → 触发压缩（如有 runtime 支持）
 * - 认证错误 → 直接抛出（不可恢复）
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

        // 延迟重试（指数退避）
        if (recovery.delay) {
          await new Promise((resolve) => setTimeout(resolve, recovery.delay));
        }

        continue; // 🔄 重试
      }

      // 不可恢复，抛出原错误
      throw error;
    }
  }

  throw new Error(`Max retries (${maxRetries}) exceeded`);
}
```

#### Step 2: 重构 AgentCreatorService

修改 `src/main/ai/services/AgentCreatorService.ts`：

```typescript
import { callLLMWithRecovery } from '@main/ai/common/LLMCallWrapper';

export async function aiCreateAgent(requirement: string, onProgress?: ProgressCallback) {
  // ... 前置步骤 ...

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
    maxRetries: 3 // 最多重试3次
  });

  // ... 后续步骤 ...
}
```

#### Step 3: 重构 SkillCreatorService

修改 `src/main/ai/services/SkillCreatorService.ts`：

```typescript
import { callLLMWithRecovery } from '@main/ai/common/LLMCallWrapper';

export async function aiCreateSkill(requirement: string, onProgress?: ProgressCallback) {
  // ... 前置步骤 ...

  const { client, model } = createOpenAIClient();

  // ✅ 使用带错误恢复的包装器
  const content = await callLLMWithRecovery(client, {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: requirement }
    ],
    temperature: 0.7,
    max_tokens: 4000,
    maxRetries: 3
  });

  // ... 后续步骤 ...
}
```

#### Step 4: 前端优化（可选）

在 `AgentView.vue` 等前端组件中，增加重试反馈：

```typescript
// 捕获 SSE 流中的 'run:error' 事件
eventSource.addEventListener('run:error', (event) => {
  const data = JSON.parse(event.data);
  if (data.recoveryAttempt) {
    // 显示 "正在重试（第 X 次）..." 提示
    showRetryToast(data.recoveryAttempt);
  }
});
```

---

## 📋 实施清单

### Phase 1: 基础设施（2-3 小时）

- [ ] 创建 `LLMCallWrapper.ts` 包装器
- [ ] 编写单元测试（验证重试、延迟、错误分类）
- [ ] 编写集成测试（真实 API 调用 + 错误注入）

### Phase 2: 重构现有代码（1-2 小时）

- [ ] 重构 `AgentCreatorService.ts`
- [ ] 重构 `SkillCreatorService.ts`
- [ ] 测试创建流程（正常、超时、速率限制场景）

### Phase 3: 前端优化（1 小时）

- [ ] 增加重试进度提示
- [ ] 优化错误信息展示（技术错误 → 用户友好）
- [ ] 添加"手动重试"按钮（用户体验增强）

### Phase 4: 文档和监控（1 小时）

- [ ] 更新技术文档
- [ ] 添加错误恢复日志（便于排查）
- [ ] 配置错误率监控（Sentry/日志分析）

---

## 🎓 经验教训

### 架构设计原则

1. **统一调用路径**:
   - ✅ 所有 LLM 调用都应走统一包装层
   - ❌ 避免分散的直接调用（难以维护）

2. **错误恢复层级**:
   - Level 1: 网络重试（必须）
   - Level 2: 上下文压缩（推荐）
   - Level 3: 模型降级（可选）
   - Level 4: 智能参数自适应（未来）

3. **代码复用**:
   - ✅ 提取通用逻辑到包装器/工具函数
   - ❌ 避免在多个地方重复实现重试

### 测试覆盖

每个直接调用 LLM 的地方都应测试：

1. **正常场景**: API 正常返回
2. **网络错误**: 超时、连接失败 → 自动重试
3. **速率限制**: 429 错误 → 延迟重试
4. **参数错误**: 400 错误 → 友好提示（不重试）
5. **认证错误**: 401 错误 → 直接失败，提示用户检查 API Key

---

## 📚 相关文档

- [03-error-recovery-analysis.md](./03-error-recovery-analysis.md) - 错误恢复机制深度分析
- `src/main/ai/runtime/ErrorRecoveryChain.ts` - 现有恢复链实现
- `src/main/ai/runtime/AbstractAgentRuntime.ts` - Runtime 中的恢复逻辑

---

**更新时间**: 2026-03-31  
**盘点人**: AI Assistant  
**下一步行动**: 等待技术决策（选择方案 A/B/C）
