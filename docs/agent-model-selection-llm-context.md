# LLM 创建 Agent 时的模型选择上下文设计

## 📋 背景

当 LLM 创建 Agent（Builder Agent 创建专业 Agent，或 Agent 动态创建 Sub-Agent）时，需要能够：

1. **自主选择合适的模型**（primary）
2. **配置备选模型列表**（fallbacks）
3. **基于任务特征做出合理决策**

**核心问题**：需要暴露哪些信息给 LLM？如何设计这个上下文？

---

## 🎯 设计目标

1. **信息充分**：LLM 能做出合理的模型选择
2. **简洁高效**：不过度消耗 context window
3. **易于理解**：LLM 能理解模型特性和适用场景
4. **可维护**：配置变更时自动同步

---

## 📊 需要暴露的信息

### 方案 A：完整模型信息（详细但消耗大）

```typescript
interface ModelInfo {
  // 基础标识
  provider: string; // 'dashscope'
  id: string; // 'qwen3.5-plus'
  name: string; // 'Qwen3.5 Plus'
  fullRef: string; // 'dashscope/qwen3.5-plus'

  // 能力参数
  contextWindow: number; // 1000000
  maxInputTokens: number; // 983616
  maxOutputTokens: number; // 65536
  maxThinkingTokens?: number; // 81920

  // 能力标志
  reasoning: boolean; // 是否支持推理（思考链）
  functionCalling: boolean; // 是否支持工具调用
  webSearch: boolean; // 是否支持联网搜索
  vision: boolean; // 是否支持视觉理解

  // 描述性标签
  features: string[]; // ['上下文1M', '输出64k', '思考模型']

  // 适用场景（可选）
  suitableFor?: string[]; // ['coding', 'reasoning', 'long-context']
}
```

**优点**：信息完整，LLM 可以做出精细决策  
**缺点**：消耗 context window 较大（假设 50 个模型 × 300 tokens = 15k tokens）

---

### 方案 B：精简模型摘要（推荐）⭐

```typescript
interface ModelSummary {
  ref: string; // 'dashscope/qwen3.5-plus'（唯一标识）
  name: string; // 'Qwen3.5 Plus'（显示名称）

  // 核心能力（位标志压缩）
  caps: string; // 'R+F+W' (Reasoning + FunctionCalling + WebSearch)
  // 'V' (Vision)
  // 'R' (Reasoning)
  // 'F' (FunctionCalling)

  // 关键参数（精简表示）
  ctx: string; // '1M/64k' (contextWindow / maxOutputTokens)

  // 适用场景（标签）
  tags: string[]; // ['reasoning', 'coding', 'long-context']
}
```

**示例数据**（JSON 格式，1k tokens 内可列出 30+ 模型）：

```json
[
  {
    "ref": "dashscope/qwen3.5-plus",
    "name": "Qwen3.5 Plus",
    "caps": "R+F+W",
    "ctx": "1M/64k",
    "tags": ["reasoning", "general", "search"]
  },
  { "ref": "dashscope/qwen-coder-plus", "name": "Qwen Coder Plus", "caps": "F", "ctx": "128k/8k", "tags": ["coding"] },
  { "ref": "dashscope/qwen-vl-plus", "name": "Qwen VL Plus", "caps": "V", "ctx": "128k/8k", "tags": ["vision"] },
  {
    "ref": "deepseek/deepseek-v3",
    "name": "DeepSeek V3",
    "caps": "F",
    "ctx": "128k/64k",
    "tags": ["coding", "reasoning"]
  },
  { "ref": "openai/gpt-4o", "name": "GPT-4o", "caps": "R+F+V", "ctx": "128k/16k", "tags": ["general", "vision"] }
]
```

**优点**：

- ✅ 信息密度高（1-2k tokens 可列出所有模型）
- ✅ 保留关键决策依据
- ✅ LLM 易于理解和比较

**缺点**：

- ❌ 损失了部分细节（如 maxThinkingTokens）

---

### 方案 C：分层信息（按需加载）

**第一层：快速列表**（在 Skill 文档中）

```markdown
## 可用模型快速参考

| Model Ref                 | 适用场景           | 能力     |
| ------------------------- | ------------------ | -------- |
| dashscope/qwen3.5-plus    | 通用推理、联网搜索 | R+F+W 1M |
| dashscope/qwen-coder-plus | 代码生成           | F 128k   |
| deepseek/deepseek-v3      | 代码推理           | F 128k   |
| openai/gpt-4o             | 通用、视觉         | R+F+V    |
```

**第二层：详细信息**（通过工具获取）

- LLM 如需详细参数，调用 `config_get_models` 工具

**优点**：

- ✅ 日常使用消耗最小
- ✅ 复杂场景可深入查询

**缺点**：

- ❌ 需要额外的工具调用
- ❌ 增加了工具数量

---

## 🏆 推荐方案

**采用方案 B（精简摘要）+ Skill 内嵌**

### 实现方式

#### 1. 在 `agent-creator` Skill 中嵌入模型摘要

**位置**：`skills/agent-creator/SKILL.md` 的 "Step 2.3 模型配置" 部分

**内容示例**：

````markdown
### Step 2.3：模型配置（新增）

#### 为什么需要为 Agent 配置模型？

不同 Agent 有不同的能力需求：

- **代码生成 Agent** → 需要代码能力强的模型（如 DeepSeek V3, Qwen Coder）
- **推理型 Agent** → 需要推理能力（如 Qwen3.5 Plus, Claude Sonnet）
- **视觉 Agent** → 需要视觉理解（如 GPT-4o, Qwen VL）
- **通用对话 Agent** → 可用通用模型

#### 模型选择矩阵

**能力标识说明**：

- `R` = Reasoning（推理/思考链）
- `F` = Function Calling（工具调用）
- `W` = Web Search（联网搜索）
- `V` = Vision（视觉理解）

**可用模型列表**（按场景分类）：

##### 🧠 推理与通用场景

| Model Ref                  | 能力  | Context  | 推荐用途                     |
| -------------------------- | ----- | -------- | ---------------------------- |
| dashscope/qwen3.5-plus     | R+F+W | 1M/64k   | 通用推理、复杂任务、联网搜索 |
| dashscope/qwen-plus-latest | R+F   | 1M/64k   | 通用推理、性价比高           |
| openai/gpt-4o              | R+F+V | 128k/16k | 通用、视觉理解               |
| anthropic/claude-sonnet    | R+F   | 200k/8k  | 复杂推理、长文本分析         |

##### 💻 代码与技术场景

| Model Ref                 | 能力 | Context  | 推荐用途         |
| ------------------------- | ---- | -------- | ---------------- |
| deepseek/deepseek-v3      | F    | 128k/64k | **代码生成首选** |
| dashscope/qwen-coder-plus | F    | 128k/8k  | 代码生成         |
| deepseek/deepseek-r1      | R    | 128k/64k | 代码推理与优化   |

##### 👁️ 视觉场景

| Model Ref              | 能力  | Context  | 推荐用途      |
| ---------------------- | ----- | -------- | ------------- |
| dashscope/qwen-vl-plus | V     | 128k/8k  | 图像理解      |
| openai/gpt-4o          | R+F+V | 128k/16k | 图像+复杂推理 |

##### ⚡ 快速与经济场景

| Model Ref                   | 能力 | Context | 推荐用途         |
| --------------------------- | ---- | ------- | ---------------- |
| dashscope/qwen-turbo-latest | R    | 1M/8k   | 极速响应、低成本 |

#### 如何选择主模型（Primary）？

根据 Agent 的**核心任务**选择：

```python
if "代码生成" in 核心任务:
    primary = "deepseek/deepseek-v3"  # 代码能力最强
elif "视觉理解" in 核心任务:
    primary = "dashscope/qwen-vl-plus"  # 视觉专用
elif "复杂推理" in 核心任务:
    primary = "dashscope/qwen3.5-plus"  # 推理能力强 + 长上下文
elif "快速响应" in 需求:
    primary = "dashscope/qwen-turbo-latest"  # 极速
else:
    primary = "dashscope/qwen3.5-plus"  # 通用首选
```
````

#### 如何配置备选模型（Fallbacks）？

**原则**：

1. **能力互补**：备选模型应具备相似能力
2. **Provider 分散**：避免单点故障（如主模型用 Dashscope，备选用 DeepSeek 或 OpenAI）
3. **成本考虑**：从高能力/高成本 → 低能力/低成本

**示例配置**：

```json5
// 代码审查 Agent
{
  "modelConfig": {
    "primary": "deepseek/deepseek-v3",        // 代码能力最强
    "fallbacks": [
      "dashscope/qwen-coder-plus",            // 同样适合代码
      "dashscope/qwen3.5-plus"                // 通用兜底
    ]
  }
}

// 推理型 Agent
{
  "modelConfig": {
    "primary": "dashscope/qwen3.5-plus",      // 推理能力强
    "fallbacks": [
      "openai/gpt-4o",                        // 通用能力强
      "dashscope/qwen-plus-latest"            // 性价比备选
    ]
  }
}

// 视觉 Agent
{
  "modelConfig": {
    "primary": "dashscope/qwen-vl-plus",      // 视觉专用
    "fallbacks": [
      "openai/gpt-4o"                         // 视觉+通用
    ]
  }
}
```

#### 特殊场景

**场景 1：预算敏感型 Agent**

```json5
{
  modelConfig: {
    primary: 'dashscope/qwen-turbo-latest', // 低成本首选
    fallbacks: [] // 不配置备选，失败即失败
  }
}
```

**场景 2：高可用性 Agent（跨 Provider 容错）**

```json5
{
  modelConfig: {
    primary: 'dashscope/qwen3.5-plus', // 主供应商
    fallbacks: [
      'openai/gpt-4o', // 备用供应商 1
      'anthropic/claude-sonnet' // 备用供应商 2
    ]
  }
}
```

**场景 3：无需模型配置（继承全局默认）**

```json5
{
  // 不设置 model 和 modelConfig，使用全局 defaults.model
}
```

````

---

#### 2. 创建 `config_get_models` 工具（可选，用于深入查询）

**仅在 LLM 需要详细模型参数时提供**：

```typescript
// src/main/ai/tools/builtin/config-get-models.ts

export const configGetModelsTool = createTool({
  name: 'config_get_models',
  description: '获取所有可用模型的详细信息（包括参数、能力、特性）',
  schema: z.object({}),
  execute: async () => {
    const config = configStoreInstance.getAll();
    const providers = config.models?.providers ?? {};

    const models = [];
    for (const [providerId, provider] of Object.entries(providers)) {
      if (!provider.enabled) continue;

      for (const model of provider.models ?? []) {
        models.push({
          ref: `${providerId}/${model.id}`,
          name: model.name,
          provider: provider.name,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutputTokens,
          reasoning: model.reasoning ?? false,
          functionCalling: model.functionCalling ?? false,
          webSearch: model.webSearch ?? false,
          vision: model.vision ?? false,
          features: model.features ?? []
        });
      }
    }

    return { models, count: models.length };
  }
});
````

**决策**：

- ❌ **不推荐立即创建此工具**，理由：
  1. 信息已在 Skill 中提供，覆盖 95% 场景
  2. 详细参数（如 maxThinkingTokens）在 Agent 创建时非必需
  3. 避免工具数量膨胀

- ✅ **未来可以考虑**，如果：
  - 模型数量激增（100+ 模型）
  - 需要动态过滤（如"只显示支持 vision 的模型"）
  - Skill 文档过长影响性能

---

## 📋 实施方案

### 推荐：方案 B + Skill 内嵌

#### 阶段 1：更新 `agent-creator` Skill

1. **在 Step 2 中新增 "Step 2.3：模型配置" 章节**
   - 模型选择矩阵（表格形式）
   - 选择决策流程图
   - 常见场景示例

2. **在 Step 3 中更新 Agent 定义模板**

   ```json5
   {
     "id": "...",
     "name": "...",
     "description": "...",
     "instructions": "...",
     "tools": [...],
     "skills": [...],

     // 新增：模型配置
     "modelConfig": {
       "primary": "provider/model",
       "fallbacks": ["provider/model2", "provider/model3"]
     }
   }
   ```

3. **在 Step 6 验证步骤中增加模型验证**
   - 检查 primary 和 fallbacks 是否为有效的模型引用
   - 确保模型能力匹配 Agent 需求

#### 阶段 2：更新 Agent 类型定义

1. **扩展 `AgentDefinition` 接口**（已在 `agent-model-fallback-analysis.md` 中规划）
   ```typescript
   interface AgentDefinition {
     // ... 其他字段
     model?: string;
     modelConfig?: {
       primary: string;
       fallbacks?: string[];
     };
   }
   ```

#### 阶段 3：更新前端界面

1. **Agent 创建/编辑表单**
   - 主模型选择器（复用 `ModelSelector.vue`）
   - 备选模型列表（可拖拽排序）
   - 显示模型能力标签（R/F/W/V）

2. **模型摘要卡片**（显示在 Agent 详情页）
   ```
   主模型：Qwen3.5 Plus (R+F+W, 1M/64k)
   备选：
     1. GPT-4o (R+F+V, 128k/16k)
     2. Qwen Plus (R+F, 1M/64k)
   ```

---

## 🔍 关键设计决策

### 1. 信息放在哪里？

**决策**：嵌入 `agent-creator` Skill，而非创建新工具

**理由**：

- ✅ 模型信息相对稳定，不频繁变化
- ✅ Skill 文档本身就是 LLM 的上下文
- ✅ 避免工具数量膨胀（从 17 → 18）
- ✅ 减少 API 调用开销

**权衡**：

- ❌ Skill 文档会变长（+1-2k tokens）
- ✅ 但只在创建 Agent 时加载，不影响其他场景

---

### 2. 信息粒度如何？

**决策**：精简摘要（方案 B）+ 表格形式

**理由**：

- ✅ 信息密度高（30+ 模型 < 2k tokens）
- ✅ 表格形式 LLM 容易解析
- ✅ 保留关键决策依据（caps, ctx, tags）
- ✅ 人类可读性强

---

### 3. 如何保持同步？

**问题**：配置文件中的模型信息更新时，Skill 文档如何同步？

**方案 A**：手动维护  
**方案 B**：自动生成（推荐长期方案）

#### 方案 B：自动生成模型表格

**实现思路**：

1. 创建脚本 `scripts/generate-model-table.ts`
2. 读取 `coobee.json5` 中的模型配置
3. 生成 Markdown 表格
4. 更新 `skills/agent-creator/SKILL.md`

**触发时机**：

- 配置文件变更时（通过 git hook）
- 手动执行（`pnpm gen:model-table`）

**优先级**：P2（非紧急，可手动维护）

---

## 🚀 下一步行动

### 立即实施（P0）

1. **更新 `agent-creator` Skill**
   - [ ] 新增 "Step 2.3：模型配置" 章节
   - [ ] 嵌入模型选择矩阵（4 个场景分类表格）
   - [ ] 提供决策流程和示例配置

2. **更新 `AgentDefinition` 类型**
   - [ ] 添加 `modelConfig` 字段
   - [ ] 更新 `CreateAgentParams` 和 `UpdateAgentParams`

3. **更新 Agent 构建逻辑**
   - [ ] `createBuilderFromDefinition` 支持 `modelConfig`
   - [ ] 使用 `ModelFallback` 执行模型选择

### 后续优化（P1）

4. **前端界面**
   - [ ] Agent 创建表单支持模型配置
   - [ ] 显示模型能力标签

5. **测试验证**
   - [ ] 创建测试 Agent 验证模型 fallback
   - [ ] 编写单元测试

### 未来考虑（P2）

6. **自动化脚本**
   - [ ] 模型表格自动生成脚本
   - [ ] 配置变更时自动同步

7. **高级工具**（仅在必要时）
   - [ ] `config_get_models` 工具
   - [ ] 模型能力动态过滤

---

## 📚 相关文档

- `docs/agent-model-fallback-analysis.md` - 模型 Fallback 机制分析
- `skills/agent-creator/SKILL.md` - Agent 创建指南（待更新）
- `src/main/ai/agents/types.ts` - Agent 定义类型（待更新）
- `src/main/ai/provider/ModelFallback.ts` - Fallback 执行引擎

---

**总结**：推荐将精简的模型信息（能力标签 + 适用场景）嵌入 `agent-creator` Skill 文档，以表格形式呈现。这样 LLM 在创建 Agent 时可以自主选择合适的模型配置，无需额外工具，消耗最小，效果最佳。
