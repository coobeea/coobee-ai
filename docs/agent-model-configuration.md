# Agent 模型配置指南

## 概述

**每个 Agent 都可以指定自己专属的模型配置**，包括：

- 使用哪个 AI 模型（model）
- 温度参数（temperature）
- 最大输出 Token 数（maxTokens）
- 思维链级别（thinkingLevel）

## 配置字段说明

### 1. `model` — 指定使用的模型

支持三种格式：

#### 格式 1：直接指定模型（推荐）

```json
{
  "model": "gpt-4o-mini"
}
```

常用模型示例：

- `"gpt-4o"` — OpenAI GPT-4o（强大，适合复杂任务）
- `"gpt-4o-mini"` — OpenAI GPT-4o-mini（经济，适合简单任务）
- `"claude-3.5-sonnet"` — Anthropic Claude 3.5 Sonnet
- `"gemini-2.0-flash-exp"` — Google Gemini 2.0 Flash
- `"deepseek-chat"` — DeepSeek Chat（国产，性价比高）
- `"ollama/gemma4:31b"` — 本地 Ollama 模型

#### 格式 2：引用模型组（高级）

```json
{
  "model": "@high-performance"
}
```

引用配置文件中定义的模型组：

- `"@high-performance"` — 高性能模型组（适合复杂推理）
- `"@fast"` — 快速模型组（适合简单任务）
- `"@economical"` — 经济模型组（节省成本）

模型组在 `coobee.json5` 的 `models.groups` 中定义。

#### 格式 3：自动选择（实验性）

```json
{
  "model": "auto"
}
```

系统根据任务复杂度自动选择最佳模型。

#### 不指定 `model` 字段（使用默认）

```json
{
  "id": "my-agent",
  "name": "我的 Agent"
  // 没有 model 字段 → 使用系统默认模型
}
```

系统会使用 `coobee.json5` 中的 `models.defaults.model.primary` 作为默认模型。

### 2. `temperature` — 控制输出随机性

取值范围：`0.0` - `2.0`

```json
{
  "temperature": 0.3
}
```

**推荐值**：

- **0.0 - 0.3**：确定性输出，适合代码生成、数据分析、结构化输出
  - 示例：代码审查 Agent、数据分析 Agent
- **0.5 - 0.7**：平衡模式，适合大部分任务
  - 示例：通用对话 Agent、文档撰写 Agent
- **0.8 - 1.2**：创意输出，适合头脑风暴、创意写作
  - 示例：创意写作 Agent、设计建议 Agent
- **1.5 - 2.0**：高度随机，适合实验性任务
  - 示例：实验性生成、极端创意探索

### 3. `maxTokens` — 限制输出长度

取值范围：正整数（建议 `100` - `16000`）

```json
{
  "maxTokens": 300
}
```

**推荐值**：

- **100 - 500**：简短输出（判断、分类、单句回复）
  - 示例：记忆分析 Agent（判断是否值得记忆）
- **500 - 2000**：中等长度（段落回复、代码片段）
  - 示例：代码生成 Agent、问答 Agent
- **2000 - 4000**：长输出（文档、详细分析）
  - 示例：文档撰写 Agent、需求分析 Agent
- **4000+**：超长输出（完整文章、大型代码文件）
  - 示例：报告生成 Agent、大型代码重构 Agent

### 4. `thinkingLevel` — 思维链级别

可选值：`"low"` | `"medium"` | `"high"`

```json
{
  "thinkingLevel": "medium"
}
```

**推荐值**：

- **`"low"`**：快速响应，适合简单任务
- **`"medium"`**：平衡模式（默认）
- **`"high"`**：深度思考，适合复杂推理任务

## 完整示例

### 示例 1：记忆分析 Agent（轻量级）

```json
{
  "id": "memory-analyzer",
  "name": "记忆分析师",
  "description": "分析 Agent 输出并判断是否值得记忆",
  "instructions": "...",
  "tools": [],
  "skills": [],
  "model": "gpt-4o-mini",
  "temperature": 0.3,
  "maxTokens": 300,
  "createdBy": "system"
}
```

**设计思路**：

- **模型**：`gpt-4o-mini`（轻量快速，成本低）
- **温度**：`0.3`（确定性分类，避免随机性）
- **Token**：`300`（只需简短 JSON 输出）

### 示例 2：需求分析 Agent（对话型）

```json
{
  "id": "requirements-analyst",
  "name": "需求分析师",
  "description": "通过结构化对话引导用户澄清需求",
  "instructions": "...",
  "skills": ["dimension-architect"],
  "model": "gpt-4o",
  "temperature": 0.7,
  "maxTokens": 2000,
  "createdBy": "system"
}
```

**设计思路**：

- **模型**：`gpt-4o`（强大，适合复杂推理和对话）
- **温度**：`0.7`（平衡，既有逻辑性又有灵活性）
- **Token**：`2000`（需要详细的对话回复）

### 示例 3：增值税助手（专业领域）

```json
{
  "id": "tax-assistant",
  "name": "增值税助手",
  "description": "专业的增值税计算和咨询助手",
  "instructions": "...",
  "skills": ["tax-calculator", "tax-regulations"],
  "model": "deepseek-chat",
  "temperature": 0.2,
  "maxTokens": 3000,
  "createdBy": "user"
}
```

**设计思路**：

- **模型**：`deepseek-chat`（国产，性价比高，适合专业领域）
- **温度**：`0.2`（确定性高，税务计算不容出错）
- **Token**：`3000`（需要详细的税务解释）

### 示例 4：创意写作 Agent（高创意）

```json
{
  "id": "creative-writer",
  "name": "创意写作助手",
  "description": "创意故事和文案创作",
  "instructions": "...",
  "model": "claude-3.5-sonnet",
  "temperature": 1.0,
  "maxTokens": 4000,
  "createdBy": "user"
}
```

**设计思路**：

- **模型**：`claude-3.5-sonnet`（擅长创意写作）
- **温度**：`1.0`（高创意，输出多样化）
- **Token**：`4000`（长文本输出）

### 示例 5：使用本地 Ollama 模型

```json
{
  "id": "local-assistant",
  "name": "本地助手",
  "description": "使用本地 Ollama 模型的助手",
  "instructions": "...",
  "model": "ollama/gemma4:31b",
  "temperature": 0.5,
  "maxTokens": 2000,
  "createdBy": "user"
}
```

**设计思路**：

- **模型**：`ollama/gemma4:31b`（本地模型，隐私保护）
- **温度**：`0.5`（平衡）
- **Token**：`2000`（中等长度）

## 如何选择模型？

### 按任务类型选择

| 任务类型 | 推荐模型                  | 温度    | Token     |
| -------- | ------------------------- | ------- | --------- |
| 代码生成 | gpt-4o, deepseek-chat     | 0.2     | 2000-4000 |
| 代码审查 | gpt-4o                    | 0.3     | 1000-2000 |
| 数据分析 | gpt-4o, deepseek-chat     | 0.2     | 2000      |
| 文档撰写 | gpt-4o, claude-3.5-sonnet | 0.5-0.7 | 3000-5000 |
| 对话交互 | gpt-4o-mini, gpt-4o       | 0.7     | 1000-2000 |
| 分类判断 | gpt-4o-mini               | 0.3     | 100-300   |
| 创意写作 | claude-3.5-sonnet         | 0.8-1.2 | 4000+     |
| 翻译     | gpt-4o, deepseek-chat     | 0.3     | 2000      |
| 总结摘要 | gpt-4o-mini               | 0.5     | 500-1000  |
| 专业咨询 | gpt-4o, deepseek-chat     | 0.2-0.3 | 2000-3000 |

### 按成本考虑

| 优先级   | 模型                       | 场景                         |
| -------- | -------------------------- | ---------------------------- |
| 经济型   | gpt-4o-mini, deepseek-chat | 高频调用、简单任务、成本敏感 |
| 平衡型   | gpt-4o, deepseek-chat      | 通用任务                     |
| 高性能型 | gpt-4o, claude-3.5-sonnet  | 复杂推理、高质量输出         |
| 本地型   | ollama/\*                  | 隐私保护、离线使用           |

### 按响应速度考虑

| 速度要求 | 推荐模型                          |
| -------- | --------------------------------- |
| 极快     | gpt-4o-mini, gemini-2.0-flash-exp |
| 快速     | gpt-4o, deepseek-chat             |
| 中等     | claude-3.5-sonnet                 |
| 可容忍慢 | ollama/\* (本地，依赖硬件)        |

## 模型配置的加载顺序

1. **Agent 定义中的显式配置**（最高优先级）
   - 如果 Agent JSON 中定义了 `model`、`temperature`、`maxTokens`，优先使用

2. **系统默认配置**（fallback）
   - 如果 Agent 没有指定，使用 `coobee.json5` 中的默认配置

## 如何修改 Agent 的模型配置？

### 方法 1：直接编辑 JSON 文件

```bash
# 编辑 Agent 定义文件
nano agents/my-agent.json

# 添加或修改 model 字段
{
  "id": "my-agent",
  "model": "gpt-4o-mini",
  "temperature": 0.5,
  "maxTokens": 2000
}
```

### 方法 2：通过对话（向"应用管家"请求）

```
User: 请帮我修改 tax-assistant Agent，使用 gpt-4o-mini 模型，温度 0.3，最大 Token 500

Agent: 好的，我来修改。

[读取当前配置]
read({ path: "agents/tax-assistant.json" })

[更新配置]
write({
  path: "agents/tax-assistant.json",
  content: {
    ...
    "model": "gpt-4o-mini",
    "temperature": 0.3,
    "maxTokens": 500
  }
})

修改完成。下次调用 tax-assistant 时会使用新配置。
```

### 方法 3：通过 HTTP API

```bash
PATCH /gateway/agents/tax-assistant
Content-Type: application/json

{
  "model": "gpt-4o-mini",
  "temperature": 0.3,
  "maxTokens": 500
}
```

## 验证配置是否生效

### 查看日志

启动应用后，查看日志中的模型加载信息：

```
[AgentExecutor] Building agent: tax-assistant
[PiMonoBuilder] Using model: gpt-4o-mini (temperature: 0.3, maxTokens: 500)
```

### 测试调用

向 Agent 发送测试消息，观察响应：

- **温度低（0.2-0.3）**：多次调用，输出应该非常一致
- **温度高（0.8-1.0）**：多次调用，输出应该有明显差异

## 最佳实践

### 1. 轻量级 Agent 优先使用小模型

对于判断、分类、简单回复类 Agent，优先使用 `gpt-4o-mini`：

```json
{
  "model": "gpt-4o-mini",
  "temperature": 0.3,
  "maxTokens": 300
}
```

**好处**：

- 响应更快
- 成本更低
- 对于简单任务，质量差异不大

### 2. 专业领域 Agent 使用确定性配置

对于税务、法律、医疗等专业领域 Agent，设置低温度：

```json
{
  "model": "gpt-4o",
  "temperature": 0.2,
  "maxTokens": 3000
}
```

**好处**：

- 输出确定，减少随机错误
- 适合需要严格准确性的场景

### 3. 创意类 Agent 使用高温度

对于创意写作、头脑风暴类 Agent，设置高温度：

```json
{
  "model": "claude-3.5-sonnet",
  "temperature": 1.0,
  "maxTokens": 4000
}
```

**好处**：

- 输出多样化
- 激发创意

### 4. 限制 Token 数以控制成本

对于高频调用的 Agent，严格限制 Token 数：

```json
{
  "model": "gpt-4o-mini",
  "maxTokens": 500
}
```

**好处**：

- 减少不必要的长输出
- 降低 API 成本

### 5. 使用模型组实现统一管理

对于一组相似功能的 Agent，使用模型组引用：

```json
// Agent A
{
  "model": "@high-performance"
}

// Agent B
{
  "model": "@high-performance"
}
```

**好处**：

- 统一修改（在 `coobee.json5` 中一次性修改所有引用）
- 便于 A/B 测试和模型切换

## 常见问题

### Q1: 为什么我的 Agent 没有使用指定的模型？

**A**: 检查以下几点：

1. Agent JSON 文件中的 `model` 字段拼写是否正确
2. 模型名称是否存在于 `coobee.json5` 的 `providers` 配置中
3. 对应的 Provider 是否已启用（`enabled: true`）
4. 查看日志中的模型加载信息

### Q2: 如何查看可用的模型列表？

**A**: 使用 model-config Skill：

```bash
python3 skills/model-config/scripts/list_models.py
```

或者通过对话：

```
User: 请列出所有可用的模型

Agent: [调用 list_models.py]
...
```

### Q3: 可以为同一个 Agent 指定多个备用模型吗？

**A**: 当前不支持直接在 Agent 定义中指定 fallback 模型。但可以通过模型组实现：

```json5
// coobee.json5
{
  models: {
    groups: {
      "high-performance": {
        primary: "gpt-4o",
        fallback: ["claude-3.5-sonnet", "deepseek-chat"]
      }
    }
  }
}

// Agent JSON
{
  "model": "@high-performance"
}
```

### Q4: 本地 Ollama 模型如何配置？

**A**: 参考我们之前的配置示例：

1. 在 `coobee.json5` 中启用 Ollama Provider
2. 添加模型定义（如 `gemma4:31b`）
3. Agent 中引用：`"model": "ollama/gemma4:31b"`

详见之前的 Ollama 配置文档。

### Q5: 不同 Agent 使用不同模型会有性能差异吗？

**A**: 是的，性能差异主要体现在：

- **响应速度**：小模型（如 gpt-4o-mini）通常更快
- **输出质量**：大模型（如 gpt-4o）通常质量更高，尤其在复杂任务上
- **成本**：小模型成本更低

建议根据任务复杂度选择合适的模型。

## 总结

- ✅ **每个 Agent 都可以自定义模型配置**
- ✅ **支持模型、温度、Token 数、思维链级别**
- ✅ **优先级：Agent 定义 > 系统默认**
- ✅ **灵活性高**：轻量级 Agent 用小模型，复杂 Agent 用大模型
- ✅ **易于管理**：通过 JSON 文件或对话修改

通过合理配置每个 Agent 的模型参数，可以在**性能、成本、质量**之间找到最佳平衡点。
