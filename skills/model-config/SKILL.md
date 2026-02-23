---
name: model-config
description: '模型配置管理指南。帮助 LLM 安全地管理模型配置（列出、添加模型）并根据任务特征选择最合适的 AI 模型及其备选方案。Use when: (1) creating/updating agents and need to select models, (2) adding new models to configuration, (3) querying available models, (4) optimizing model configuration for specific tasks, (5) designing model fallback strategies. Triggers on: 选择模型, 配置模型, 添加模型, choose model, model selection, model config, add model.'
---

# 模型配置管理（Model Config）

## 核心职责

1. **安全地管理模型配置**：通过内置脚本列出、添加模型
2. **指导模型选择**：根据任务特征选择最合适的 AI 模型配置（primary + fallbacks）

**核心原则**：

- 通过**经过测试的脚本**操作配置，避免直接修改配置文件
- 基于**任务需求**和**模型能力**做出最优匹配

---

## 何时使用此 Skill

### 1. 创建/更新 Agent 时

- 为新 Agent 选择合适的模型
- 优化现有 Agent 的模型配置
- 设计模型备选策略（fallbacks）

### 2. 管理模型配置时

- 查询所有可用模型列表
- 添加新的模型到配置文件
- 验证模型是否存在

### 3. 任务规划时

- 评估任务复杂度，选择合适的模型
- 平衡性能、成本、可用性

---

## 工作流程（3 步）

```
查询可用模型 → 任务分析与模型匹配 → 配置生成
```

---

## Step 1：查询可用模型

### 1.1 使用 `list_models.py` 脚本

**工具**：`exec`

```bash
python skills/model-config/scripts/list_models.py
```

**输出格式**（JSON）：

```json
{
  "success": true,
  "count": 15,
  "models": [
    {
      "ref": "dashscope/qwen3.5-plus",
      "name": "Qwen3.5 Plus",
      "provider": "百炼",
      "providerId": "dashscope",
      "contextWindow": 1000000,
      "maxOutputTokens": 65536,
      "reasoning": true,
      "functionCalling": true,
      "webSearch": true,
      "features": ["上下文1M", "输出64k", "思考模型"]
    }
  ]
}
```

### 1.2 解析输出

从 JSON 输出中提取关键信息：

| 字段              | 说明                         | 用途                     |
| ----------------- | ---------------------------- | ------------------------ |
| `ref`             | 模型引用（`provider/model`） | Agent 配置中使用         |
| `name`            | 显示名称                     | 用户展示                 |
| `contextWindow`   | 上下文窗口大小               | 评估是否适合长文本       |
| `maxOutputTokens` | 最大输出 tokens              | 评估输出能力             |
| `reasoning`       | 是否支持推理/思考链          | 复杂推理任务需要         |
| `functionCalling` | 是否支持工具调用             | Agent 需要使用工具时必需 |
| `webSearch`       | 是否支持联网搜索             | 需要实时信息时必需       |
| `vision`          | 是否支持视觉理解             | 图像、OCR 任务必需       |

---

## Step 2：任务分析与模型匹配

### 2.1 识别核心任务类型

| 任务类型     | 关键特征                   | 推荐模型                          |
| ------------ | -------------------------- | --------------------------------- |
| **代码生成** | 编写、修改、重构代码       | deepseek/deepseek-v3              |
| **复杂推理** | 多步推理、逻辑分析、决策   | dashscope/qwen3.5-plus            |
| **视觉理解** | 图像识别、OCR、视觉问答    | dashscope/qwen-vl-plus            |
| **长文本**   | 处理大量上下文、长文档分析 | dashscope/qwen3.5-plus (1M上下文) |
| **联网搜索** | 需要实时信息、联网查询     | dashscope/qwen3.5-plus            |
| **快速响应** | 延迟敏感、大量请求         | dashscope/qwen-turbo-latest       |
| **通用对话** | 日常对话、问答、信息提取   | dashscope/qwen3.5-plus            |

### 2.2 能力标识说明

| 能力标识 | 全称             | 说明             | 何时需要             |
| -------- | ---------------- | ---------------- | -------------------- |
| **R**    | Reasoning        | 推理能力、思考链 | 复杂推理、多步决策   |
| **F**    | Function Calling | 工具调用         | 需要使用工具的 Agent |
| **W**    | Web Search       | 联网搜索         | 需要实时信息         |
| **V**    | Vision           | 视觉理解         | 图像、OCR、视觉问答  |

### 2.3 模型选择策略矩阵

#### 🧠 策略 1：代码生成任务

**优先顺序**：

1. **deepseek/deepseek-v3** — 代码能力最强（128k/64k, F）
2. **dashscope/qwen-coder-plus** — 代码专用（128k/8k, F）
3. **dashscope/qwen3.5-plus** — 通用兜底（1M/64k, R+F+W）

**配置示例**：

```json5
{
  modelConfig: {
    primary: 'deepseek/deepseek-v3',
    fallbacks: ['dashscope/qwen-coder-plus', 'dashscope/qwen3.5-plus']
  }
}
```

#### 🤔 策略 2：复杂推理任务

**优先顺序**：

1. **dashscope/qwen3.5-plus** — 推理能力强，长上下文（1M/64k, R+F+W）
2. **openai/gpt-4o** — 通用能力强（128k/16k, R+F+V）
3. **dashscope/qwen-plus-latest** — 性价比（1M/64k, R+F）

**配置示例**：

```json5
{
  modelConfig: {
    primary: 'dashscope/qwen3.5-plus',
    fallbacks: ['openai/gpt-4o', 'dashscope/qwen-plus-latest']
  }
}
```

#### 👁️ 策略 3：视觉理解任务

**优先顺序**：

1. **dashscope/qwen-vl-plus** — 视觉专用（128k/8k, V）
2. **openai/gpt-4o** — 视觉+通用（128k/16k, R+F+V）

**配置示例**：

```json5
{
  modelConfig: {
    primary: 'dashscope/qwen-vl-plus',
    fallbacks: ['openai/gpt-4o']
  }
}
```

#### ⚡ 策略 4：快速响应任务

**优先顺序**：

1. **dashscope/qwen-turbo-latest** — 极速，低成本（1M/8k, R）
2. **dashscope/qwen-plus-latest** — 性价比（1M/64k, R+F）

**配置示例**：

```json5
{
  modelConfig: {
    primary: 'dashscope/qwen-turbo-latest',
    fallbacks: [] // 成本敏感，失败即失败
  }
}
```

#### 🌐 策略 5：联网搜索任务

**优先顺序**：

1. **dashscope/qwen3.5-plus** — 支持联网搜索（1M/64k, R+F+W）
2. **dashscope/qwen3-max** — 备选（256k/64k, R+F+W）

**配置示例**：

```json5
{
  modelConfig: {
    primary: 'dashscope/qwen3.5-plus',
    fallbacks: ['dashscope/qwen3-max']
  }
}
```

---

## Step 3：配置生成

### 3.1 Fallback 策略设计

**核心原则**：

1. **能力互补**
   - 备选模型应具备相似能力
   - 代码任务 → 备选也要支持 Function Calling
   - 视觉任务 → 备选也要支持 Vision

2. **Provider 分散**（高可用性场景）
   - 避免单点故障
   - 主模型用 Dashscope，备选用 DeepSeek/OpenAI
   - 示例：`qwen3.5-plus → gpt-4o → claude-sonnet`

3. **成本递减**
   - 从高能力/高成本 → 低能力/低成本
   - 示例：`qwen3.5-plus → qwen-plus-latest → qwen-turbo`

4. **上下文匹配**
   - 备选模型的上下文大小应足够
   - 长文本任务不要 fallback 到小上下文模型

### 3.2 特殊场景

#### 场景 1：预算敏感型

```json5
{
  modelConfig: {
    primary: 'dashscope/qwen-turbo-latest', // 低成本首选
    fallbacks: [] // 不配置备选
  }
}
```

#### 场景 2：高可用性（跨 Provider 容错）

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

#### 场景 3：无需模型配置（继承全局默认）

```json5
{
  // 不设置 model 和 modelConfig
  // 自动使用全局 models.defaults.model 配置
}
```

---

## 添加新模型

### 使用 `add_model.py` 脚本

**工具**：`exec`

```bash
python skills/model-config/scripts/add_model.py <provider-id> '<model-json>'
```

**示例**：

```bash
python skills/model-config/scripts/add_model.py dashscope '{
  "id": "qwen-test",
  "name": "Qwen Test",
  "contextWindow": 32768,
  "maxOutputTokens": 8192,
  "reasoning": true,
  "functionCalling": true,
  "features": ["测试模型", "性能优化"]
}'
```

**模型定义格式**（必需字段）：

- `id`: 模型 ID（字符串，唯一）
- `name`: 显示名称（字符串）

**可选字段**：

- `contextWindow`: 上下文窗口大小（数字）
- `maxInputTokens`: 最大输入 tokens（数字）
- `maxOutputTokens`: 最大输出 tokens（数字）
- `maxThinkingTokens`: 最大思考 tokens（数字）
- `reasoning`: 是否支持推理（布尔值）
- `functionCalling`: 是否支持工具调用（布尔值）
- `webSearch`: 是否支持联网搜索（布尔值）
- `vision`: 是否支持视觉理解（布尔值）
- `features`: 特性标签列表（字符串数组）

**输出格式**（JSON）：

```json
{
  "success": true,
  "message": "Model \"qwen-test\" added to provider \"dashscope\"",
  "model": {
    "ref": "dashscope/qwen-test",
    "name": "Qwen Test",
    "provider": "百炼"
  }
}
```

---

## 安全规范

### ⚠️ 重要约束

1. **不要直接修改配置文件**
   - 不要使用 `read`/`write`/`edit` 工具操作配置文件
   - 只能通过脚本 `list_models.py` 和 `add_model.py` 操作
   - 配置文件路径对 LLM 不可见

2. **不支持删除模型**
   - 系统不提供删除脚本
   - 防止误删除重要配置

3. **格式严格验证**
   - 添加模型时所有字段都会被验证
   - 类型错误会被拒绝
   - Provider 不存在会报错
   - 模型 ID 重复会报错

---

## 使用示例

### 示例 1：为代码审查 Agent 选择模型

**步骤**：

1. 列出可用模型：`python skills/model-config/scripts/list_models.py`
2. 分析任务：代码生成/分析，需要 Function Calling
3. 选择策略：代码生成任务 → 策略 1
4. 生成配置：

```json5
{
  id: 'code-reviewer',
  name: '代码审查专家',
  modelConfig: {
    primary: 'deepseek/deepseek-v3',
    fallbacks: ['dashscope/qwen-coder-plus', 'dashscope/qwen3.5-plus']
  }
}
```

### 示例 2：添加新的自定义模型

**步骤**：

1. 用户请求："帮我添加一个新的 Qwen 测试模型"
2. 使用 `add_model.py` 脚本：

```bash
python skills/model-config/scripts/add_model.py dashscope '{
  "id": "qwen-custom",
  "name": "Qwen Custom",
  "contextWindow": 131072,
  "maxOutputTokens": 8192,
  "reasoning": true,
  "functionCalling": true,
  "features": ["自定义模型", "实验性"]
}'
```

3. 验证结果：再次运行 `list_models.py` 确认添加成功

---

## 相关工具

- **exec** — 执行脚本（`list_models.py`, `add_model.py`）

---

## 相关资源

- `scripts/README.md` — 脚本详细文档
- `docs/agent-model-fallback-analysis.md` — 模型 Fallback 机制详解
- `docs/agent-model-selection-llm-context.md` — LLM 模型选择上下文设计
- `src/main/ai/provider/ModelFallback.ts` — Fallback 执行引擎

---

## 总结

这个 Skill 通过**内置的安全脚本**，帮助 LLM 管理模型配置并为任务选择最合适的模型。

**核心流程**：

1. 使用 `list_models.py` 获取可用模型列表
2. 分析任务特征（类型、能力需求、上下文大小）
3. 根据策略矩阵匹配最优模型
4. 设计 fallback 策略（能力互补、Provider 分散、成本递减）
5. 生成配置并验证

**关键优势**：

- ✅ 安全地操作配置（通过经过测试的脚本）
- ✅ 不暴露配置文件路径
- ✅ 严格的格式验证，防止写入非法数据
- ✅ 只读不删，防止误操作
- ✅ 信息永远最新（实时读取配置文件）
- ✅ 可被其他 Skill 引用（如 `agent-creator`）
