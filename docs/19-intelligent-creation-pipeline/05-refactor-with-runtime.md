# 使用 AgentRuntime 重构 AgentCreatorService

## 🎯 核心思路

**不要创建 LLMCallWrapper，直接使用 AgentExecutor！**

参考 `quickChat` 的成功实现模式：

```typescript
// quickChat 的做法（line 367-373）
const builder = createBuilderFromAgentDef(agentDef, 'chat');
const gen = agentExecutor.stream({ sessionId, message, builder });
```

---

## 📋 重构方案

### Step 1: 创建内置的 "agent-creator" Agent

在 `agents/` 目录创建一个系统级 Agent：

```typescript
// agents/system-agent-creator/agent.json
{
  "id": "system-agent-creator",
  "name": "智能体创建助手",
  "description": "基于自然语言需求生成 Agent 定义",
  "instructions": "{{DYNAMIC_SYSTEM_PROMPT}}",  // 运行时动态注入
  "tools": [],  // 不需要工具
  "skills": []  // 不需要技能
}
```

**为什么使用 Agent 定义**：

- ✅ 可以复用 AgentExecutor 的完整能力
- ✅ 可以享受错误恢复、重试、压缩等特性
- ✅ 架构统一，易于维护

---

### Step 2: 重构 aiCreateAgent() 函数

**修改文件**: `src/main/ai/services/AgentCreatorService.ts`

#### 方案 A：使用临时 Agent 定义（推荐 ⭐）

````typescript
export async function aiCreateAgent(requirement: string, onProgress?: ProgressCallback): Promise<AiCreateResult> {
  const emit = onProgress ?? (() => {});

  // Step 1: 收集资源
  emit({ step: 'analyzing', message: '正在分析需求...' });
  const tools = getAvailableTools();
  const skills = getAvailableSkills();
  const systemPrompt = buildSystemPrompt(tools, skills);

  // Step 2: 创建临时 Agent 定义
  const tempAgentDef: AgentDefinition = {
    id: 'temp-agent-creator',
    name: '智能体创建助手',
    description: 'AI 驱动的智能体创建',
    instructions: systemPrompt, // 动态系统提示词
    tools: [], // 不需要工具
    skills: [],
    model: undefined // 使用默认模型选择
  };

  // Step 3: 通过 AgentExecutor 调用（✅ 自动错误恢复）
  emit({ step: 'generating', message: '正在生成智能体定义...' });

  const sessionId = `agent-create-${Date.now()}`;
  const builder = createBuilderFromAgentDef(tempAgentDef, 'chat');

  try {
    // 执行流式对话
    const gen = agentExecutor.stream({
      sessionId,
      message: requirement,
      builder
    });

    let output = '';
    for await (const chunk of gen) {
      // 只收集文本内容
      if (chunk.type === 'text:delta' && chunk.content) {
        output += chunk.content;
      }
      // 可选：透传错误恢复事件
      if (chunk.type === 'run:error') {
        emit({
          step: 'generating',
          message: `恢复中: ${chunk.content}`,
          detail: chunk.data?.recoveryAttempt
        });
      }
    }

    // Step 4: 解析和校验（与原来一样）
    emit({ step: 'validating', message: '正在校验生成结果...' });

    const content = output.trim();
    if (!content) {
      throw new Error('AI 未返回有效内容');
    }

    // JSON 解析
    let parsed: Record<string, unknown>;
    try {
      // 去除可能的 Markdown 代码块标记
      const jsonStr = content
        .replace(/```json?\s*\n?/g, '')
        .replace(/```\s*$/g, '')
        .trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      log.error(`[AgentCreatorService] JSON 解析失败: ${content.slice(0, 200)}`);
      throw new Error('AI 返回的内容不是有效的 JSON 格式');
    }

    // 校验必需字段
    const { id, name, description, instructions } = parsed as {
      id?: string;
      name?: string;
      description?: string;
      instructions?: string;
    };

    if (!id || !name || !instructions) {
      throw new Error('AI 生成的 Agent 定义缺少必需字段（id、name、instructions）');
    }

    // 过滤工具和技能
    const toolNames = tools.map((t) => t.name);
    const skillNames = skills.map((s) => s.name);
    const validTools = [...toolNames]; // 默认全选工具
    const rawSkills = parsed.skills as string[] | undefined;
    const validSkills = (rawSkills ?? []).filter((s) => skillNames.includes(s));

    // Step 5: 保存（与原来一样）
    emit({ step: 'saving', message: '正在保存智能体...' });

    const agentDef: CreateAgentParams = {
      id,
      name,
      description: description || name,
      instructions,
      tools: validTools,
      skills: validSkills
    };

    const store = await AgentStore.getInstance();
    const created = await store.create(agentDef);

    emit({ step: 'done', message: '智能体创建成功！' });
    return { agent: created };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    emit({ step: 'error', message: msg });
    throw error;
  }
}

/**
 * 从 AgentDefinition 创建 Builder（复用 quickChat 的逻辑）
 */
function createBuilderFromAgentDef(
  def: AgentDefinition,
  agentMode: 'chat' | 'discuss'
): ReturnType<typeof agentExecutor.piMono> {
  const builder = agentExecutor
    .piMono()
    .name(def.name || def.id)
    .agentId(def.id)
    .mode(agentMode)
    .sessionMode('file')
    .lightweight(true) // ✅ 轻量模式，不持久化会话
    .instructions(def.instructions);

  // 覆盖模型（如果指定）
  if (def.model) {
    builder.model(def.model);
  }

  return builder;
}
````

**改动点**：

1. ✅ 删除 `createOpenAIClient()` 和直接调用 OpenAI API
2. ✅ 创建临时 Agent 定义（包含动态系统提示词）
3. ✅ 使用 `agentExecutor.stream()` 调用
4. ✅ 遍历生成器，收集输出
5. ✅ 自动享受错误恢复能力（无需额外代码）

---

#### 方案 B：使用预定义的系统 Agent

**更进一步的优化**：将 "agent-creator" 做成一个真正的系统 Agent

```typescript
// agents/system-agent-creator/agent.json
{
  "id": "system-agent-creator",
  "name": "智能体创建助手",
  "description": "基于自然语言需求生成 Agent 定义",
  "instructions": "你是一个专业的 Agent 设计专家...",  // 固定的系统提示词
  "tools": [],
  "skills": ["agent-creator"]  // ✅ 引用 agent-creator Skill
}
```

然后在 `aiCreateAgent()` 中：

```typescript
export async function aiCreateAgent(requirement: string, onProgress?: ProgressCallback): Promise<AiCreateResult> {
  // 加载系统 Agent
  const store = await AgentStore.getInstance();
  const agentCreator = await store.get('system-agent-creator');

  if (!agentCreator) {
    throw new Error('System agent "system-agent-creator" not found');
  }

  // 通过 AgentExecutor 调用
  const sessionId = `agent-create-${Date.now()}`;
  const builder = createBuilderFromAgentDef(agentCreator, 'chat');

  const gen = agentExecutor.stream({ sessionId, message: requirement, builder });

  // ... 后续逻辑与方案 A 一致
}
```

**方案 B 的优点**：

- ✅ 更规范，Agent 是一等公民
- ✅ 可以通过修改 agent.json 调整系统提示词
- ✅ 可以给 "agent-creator" 分配专用模型
- ✅ 可以追踪 "agent-creator" 的调用历史

---

### Step 3: 同样重构 SkillCreatorService

**修改文件**: `src/main/ai/services/SkillCreatorService.ts`

完全一样的模式：

```typescript
export async function aiCreateSkill(requirement: string, onProgress?: ProgressCallback): Promise<AiCreateSkillResult> {
  // 1. 创建临时 "skill-creator" Agent
  const tempAgentDef: AgentDefinition = {
    id: 'temp-skill-creator',
    name: '技能创建助手',
    instructions: buildSystemPrompt(), // 动态系统提示词
    tools: [],
    skills: []
  };

  // 2. 通过 AgentExecutor 调用
  const sessionId = `skill-create-${Date.now()}`;
  const builder = createBuilderFromAgentDef(tempAgentDef, 'chat');

  const gen = agentExecutor.stream({ sessionId, message: requirement, builder });

  let output = '';
  for await (const chunk of gen) {
    if (chunk.type === 'text:delta') {
      output += chunk.content;
    }
  }

  // 3. 解析和保存 SKILL.md
  // ... 后续逻辑不变
}
```

---

## 🎯 方案对比

### 原方案（LLMCallWrapper）

```typescript
// ❌ 需要创建新的包装器
const content = await callLLMWithRecovery(client, {
  model,
  messages: [...],
  maxRetries: 3
});
```

**缺点**：

- ❌ 需要维护额外的 `LLMCallWrapper.ts`
- ❌ 重复实现错误恢复逻辑（与 ErrorRecoveryChain 重叠）
- ❌ 不享受上下文压缩、思考级别降级等高级特性

---

### 新方案（AgentExecutor）

```typescript
// ✅ 直接使用现有的 AgentExecutor
const builder = agentExecutor.piMono().name('智能体创建助手').instructions(systemPrompt).lightweight(true);

const gen = agentExecutor.stream({ sessionId, message: requirement, builder });
```

**优点**：

- ✅ 不需要创建新模块
- ✅ 自动享受完整的错误恢复链
- ✅ 自动享受上下文压缩
- ✅ 自动享受思考级别降级
- ✅ 自动享受模型 fallback
- ✅ 架构统一（所有 LLM 调用都走 AgentExecutor）
- ✅ 可追踪、可监控、可调试

---

## 📊 错误恢复能力对比

| 能力             | 直接调用 OpenAI | LLMCallWrapper | **AgentExecutor** ⭐ |
| ---------------- | --------------- | -------------- | -------------------- |
| 网络超时重试     | ❌              | ✅             | ✅                   |
| 速率限制延迟重试 | ❌              | ✅             | ✅                   |
| 上下文超限压缩   | ❌              | ❌             | ✅                   |
| 思考级别降级     | ❌              | ❌             | ✅                   |
| 模型 fallback    | ❌              | ❌             | ✅                   |
| 调用追踪         | ❌              | ❌             | ✅                   |
| 会话持久化       | ❌              | ❌             | ✅（可选）           |

---

## 🚀 实施计划

### Phase 1: 重构 AgentCreatorService（1-2 小时）

1. [ ] 删除 `createOpenAIClient()` 函数
2. [ ] 删除直接调用 `client.chat.completions.create()`
3. [ ] 实现 `createBuilderFromAgentDef()` 辅助函数
4. [ ] 使用 `agentExecutor.stream()` 替代
5. [ ] 测试创建流程（正常、超时、速率限制场景）

### Phase 2: 重构 SkillCreatorService（1 小时）

1. [ ] 同样的重构步骤
2. [ ] 测试技能创建流程

### Phase 3: 前端优化（可选，30 分钟）

1. [ ] 监听 `run:error` 事件，显示"正在重试..."
2. [ ] 优化错误提示（技术错误 → 用户友好）

### Phase 4: 创建系统 Agent（可选，30 分钟）

1. [ ] 创建 `agents/system-agent-creator/agent.json`
2. [ ] 创建 `agents/system-skill-creator/agent.json`
3. [ ] 修改服务使用预定义 Agent（方案 B）

---

## 💡 为什么这个方案更好？

### 1. **架构统一**

所有 LLM 调用都走 `AgentExecutor`：

```
前端请求
  ↓
HTTP API
  ↓
AgentExecutor.stream() ✅ 统一入口
  ↓
AbstractAgentRuntime
  ↓
ErrorRecoveryChain ✅ 自动错误恢复
  ↓
LLM Provider
```

### 2. **代码复用**

- 复用 `ErrorRecoveryChain` 的所有策略
- 复用 `ContextCompressor` 的压缩能力
- 复用 `ModelSelector` 的 fallback 能力
- 复用 `SessionManager` 的会话管理

### 3. **易于扩展**

未来如果需要：

- 为 "agent-creator" 分配专用模型 → 修改 `agent.json`
- 调整重试策略 → 修改 `ErrorRecoveryChain`
- 增加新的恢复策略 → 扩展 `RecoveryStrategy`

### 4. **可观测性**

- 所有调用都记录在日志中
- 可以追踪每次创建的完整对话
- 可以监控错误率、重试率
- 可以分析性能瓶颈

---

## 🎓 经验总结

### 反面教材：LLMCallWrapper

```typescript
// ❌ 这是在重复造轮子
export async function callLLMWithRecovery(client, options) {
  // 手动实现重试逻辑... 🤦‍♂️
  // 手动实现延迟逻辑... 🤦‍♂️
  // 但享受不到上下文压缩、模型 fallback 等高级特性
}
```

### 正面案例：quickChat

```typescript
// ✅ 复用现有基础设施
const builder = createBuilderFromAgentDef(agentDef, 'chat');
const gen = agentExecutor.stream({ sessionId, message, builder });
// 自动享受所有 Runtime 能力！
```

---

## 📚 相关文档

- [04-direct-llm-calls-inventory.md](./04-direct-llm-calls-inventory.md) - 直接调用盘点
- [03-error-recovery-analysis.md](./03-error-recovery-analysis.md) - 错误恢复分析
- `src/main/gateway/http/agents.ts:367-398` - quickChat 参考实现
- `src/main/ai/runtime/ErrorRecoveryChain.ts` - 错误恢复链

---

**更新时间**: 2026-03-31  
**方案优势**: 不造新轮子，复用现有基础设施 ✅  
**推荐度**: ⭐⭐⭐⭐⭐
