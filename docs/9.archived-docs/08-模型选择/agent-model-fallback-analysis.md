# Agent 多模型备选机制分析

## 📊 现状分析

### 1. SDK 支持情况 ✅

**系统已经内置了完整的模型备选（Fallback）机制**：

#### `ModelFallback.ts` 类

```typescript
async run<T>(
  candidates: (string | ModelRef)[],
  execute: (ref: ModelRef) => Promise<T>,
  opts?: FallbackOptions
): Promise<FallbackResult<T>>
```

**核心特性**：

- ✅ **顺序尝试**：按 `[primary, fallback1, fallback2, ...]` 顺序执行
- ✅ **智能重试**：只对"可重试错误"触发 fallback
  - Rate limit (429)
  - Timeout
  - Server errors (500, 502, 503)
  - Overloaded
- ✅ **立即停止**：用户取消（AbortError）不会触发 fallback
- ✅ **扩展钩子**：每次 fallback 触发 `model_fallback` 钩子，可用于监控
- ✅ **延迟重试**：支持可配置的延迟时间（`delayMs`）

#### 配置格式

```typescript
interface ModelSelectionConfig {
  primary: string; // 主模型
  fallbacks?: string[]; // 备选模型列表
}
```

### 2. 全局配置现状 ⚠️

**当前配置**（`.home/config/coobee.json5`）：

```json5
models: {
  defaults: {
    model: {
      primary: 'dashscope/qwen3.5-plus'
      // 缺少 fallbacks 字段
    }
  }
}
```

**问题**：全局配置中**未启用** fallbacks。

### 3. Agent 配置现状 ❌

**当前 Agent 定义**（`AgentDefinition`）：

```typescript
interface AgentDefinition {
  // ...
  model?: string; // ❌ 只支持单个模型字符串
}
```

**问题**：Agent **不支持**配置备选模型列表。

---

## 🎯 用户需求

1. **Agent 配置增加"模型设置"项**
2. **支持配置多个模型**（主模型 + 多个备选）
3. **失败时自动切换**到备选模型

---

## 💡 实现方案

### 方案 1：扩展 Agent 配置格式（推荐）⭐

#### 设计思路

**向后兼容**，支持两种格式：

```typescript
// 格式 1：简单字符串（兼容旧版）
model?: string;

// 格式 2：完整配置对象（新增）
modelConfig?: {
  primary: string;
  fallbacks?: string[];
};
```

#### 类型定义

```typescript
// src/main/ai/agents/types.ts

export interface AgentDefinition {
  // ... 其他字段

  /** 指定模型（可选，默认用全局配置） */
  model?: string;

  /**
   * 模型配置（支持主模型 + 备选模型）
   *
   * 优先级：modelConfig > model > 全局配置
   */
  modelConfig?: {
    primary: string;
    fallbacks?: string[];
  };
}
```

#### 解析逻辑

```typescript
function resolveAgentModel(agentDef: AgentDefinition): ModelSelectionConfig | null {
  // 优先使用 modelConfig
  if (agentDef.modelConfig) {
    return agentDef.modelConfig;
  }

  // 回退到 model（转为 ModelSelectionConfig 格式）
  if (agentDef.model) {
    return {
      primary: agentDef.model,
      fallbacks: []
    };
  }

  // 使用全局配置
  return null;
}
```

#### 配置示例

**Agent 配置**（`agents/code-reviewer.json`）：

```json5
{
  id: 'code-reviewer',
  name: '代码审查专家',
  description: '专业的代码审查助手',
  instructions: '...',
  tools: ['read', 'search', 'glob'],

  // 方式 1：简单字符串（兼容旧版）
  model: 'deepseek/deepseek-v3',

  // 方式 2：完整配置（推荐）
  modelConfig: {
    primary: 'deepseek/deepseek-v3',
    fallbacks: ['dashscope/qwen3.5-plus', 'openai/gpt-4o']
  }
}
```

#### 实现步骤

1. **更新类型定义**：`src/main/ai/agents/types.ts`
   - `AgentDefinition` 添加 `modelConfig` 字段
   - `CreateAgentParams` 和 `UpdateAgentParams` 同步添加

2. **更新 Agent 构建器**：`src/main/gateway/methods/chat.ts`
   - `createBuilderFromDefinition` 函数中读取 `modelConfig`
   - 使用 `ModelFallback` 执行模型选择

3. **更新 `manage_agent` 工具**（如果还存在）：
   - Schema 支持 `modelConfig` 字段
   - 验证 `primary` 和 `fallbacks` 格式

4. **更新 `agent-creator` Skill**：
   - 指导 LLM 生成 `modelConfig` 而非单一 `model`
   - 提供备选模型选择策略建议

5. **更新前端界面**：
   - Agent 创建/编辑表单支持多模型配置
   - 显示主模型 + 备选模型列表

---

### 方案 2：仅使用全局 Fallback（简单但不够灵活）

#### 设计思路

- 只在**全局配置**中启用 fallbacks
- Agent 继承全局配置，不单独配置

#### 配置示例

**全局配置**（`.home/config/coobee.json5`）：

```json5
models: {
  defaults: {
    model: {
      primary: 'dashscope/qwen3.5-plus',
      fallbacks: [
        'deepseek/deepseek-v3',
        'openai/gpt-4o'
      ]
    }
  }
}
```

#### 优缺点

**优点**：

- ✅ 实现简单，只需修改配置文件
- ✅ 所有 Agent 自动享受 fallback

**缺点**：

- ❌ **不够灵活**：无法为特定 Agent 定制备选策略
- ❌ **不符合实际需求**：
  - 代码生成 Agent 可能需要 DeepSeek 作为主模型，GPT-4o 作为备选
  - 对话 Agent 可能需要 Qwen 作为主模型，Claude 作为备选
  - 无法为不同场景配置不同的 fallback 策略

---

## 🏆 推荐方案

**采用方案 1：扩展 Agent 配置格式**

### 理由

1. **灵活性**：不同 Agent 可定制不同的备选策略
   - 代码审查 Agent：`deepseek-v3 → qwen3.5-coder → gpt-4o`
   - 对话 Agent：`qwen3.5-plus → claude-sonnet → gpt-4o`
   - OCR Agent：`glm-ocr → paddleocr → fallback to API`

2. **一致性**：与全局配置格式保持一致

   ```
   全局：models.defaults.model = { primary, fallbacks }
   Agent：agentDef.modelConfig = { primary, fallbacks }
   ```

3. **向后兼容**：旧的 `model: string` 格式仍然有效

4. **可观测性**：每次 fallback 触发 `model_fallback` 钩子，便于监控

5. **扩展性**：未来可以添加更多选项
   - `delayMs`: 重试延迟
   - `isRetryable`: 自定义重试判断
   - `maxAttempts`: 最大重试次数

---

## 📋 实施清单

### 阶段 1：后端支持（核心）

- [ ] 更新 `AgentDefinition` 类型定义（添加 `modelConfig`）
- [ ] 更新 `createBuilderFromDefinition` 逻辑（支持 `modelConfig`）
- [ ] 更新 `AgentStore` 的 `create` 和 `update` 方法
- [ ] 编写单元测试（`AgentStore.test.ts`，覆盖 `modelConfig` CRUD）

### 阶段 2：工具和 Skill 更新

- [ ] 更新 `agent-creator` Skill（指导生成 `modelConfig`）
- [ ] 更新 `skill-creator` Skill（如果相关）
- [ ] 更新 `system-config` Skill（增加模型 fallback 配置指南）

### 阶段 3：前端界面

- [ ] Agent 创建表单：支持多模型配置
  - 主模型选择器（`ModelSelector`）
  - 备选模型列表（可拖拽排序）
  - 添加/删除备选模型按钮
- [ ] Agent 编辑表单：支持修改模型配置
- [ ] Agent 详情页：显示模型配置（主模型 + 备选）

### 阶段 4：全局配置增强

- [ ] 在设置页面的"基本配置"中增加"默认备选模型"设置
- [ ] 更新 `coobee.json5` schema 验证
- [ ] 提供配置示例和文档

### 阶段 5：监控和调试

- [ ] Extension 钩子：监听 `model_fallback` 事件
- [ ] 日志记录：记录每次 fallback 的原因和目标
- [ ] 前端通知：模型切换时可选地通知用户

---

## 🔍 技术细节

### 1. 模型选择优先级

```
会话覆盖 > Agent modelConfig > Agent model > 全局 defaults.model > 内置默认
```

### 2. Fallback 触发条件

**会触发 fallback**：

- Rate limit (HTTP 429)
- Timeout
- Server errors (HTTP 500, 502, 503)
- Overloaded 错误

**不会触发 fallback**：

- 用户取消（AbortError）
- 认证失败（HTTP 401, 403）
- 请求格式错误（HTTP 400）
- 模型不存在（HTTP 404）

### 3. 性能考虑

- **延迟**：每次 fallback 可配置延迟（默认 0ms）
- **日志**：fallback 事件通过钩子异步记录，不阻塞主流程
- **缓存**：模型引用解析结果可缓存，避免重复解析

---

## 📚 相关文档

- `src/main/ai/provider/ModelFallback.ts` - Fallback 执行引擎
- `src/main/ai/provider/types.ts` - 类型定义
- `src/main/ai/agents/types.ts` - Agent 定义类型
- `docs/architecture-review/10-fifth-round-comprehensive-analysis.md` - 架构分析

---

## 🚀 下一步行动

1. **确认方案**：与用户确认采用方案 1
2. **实施阶段 1**：更新后端类型定义和逻辑
3. **测试验证**：编写单元测试确保向后兼容
4. **更新 Skill**：指导 LLM 生成带 `modelConfig` 的 Agent
5. **前端界面**：实现多模型配置 UI
6. **文档更新**：更新 AGENTS.md 和相关文档

---

**总结**：系统已具备完整的 Fallback 能力，只需扩展 Agent 配置格式和前端界面即可实现用户需求。推荐采用方案 1（扩展 Agent 配置），既灵活又向后兼容。
