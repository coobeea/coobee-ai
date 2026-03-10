# 统一 Embedding 模型配置体系

> **提交**: `8465e60` - feat(config): add unified embedding model configuration system  
> **日期**: 2026-03-06  
> **影响**: 所有扩展统一通过 `models.defaults.embedding.primary` 获取 embedding 模型

---

## 需求背景

### 重构前的问题

在之前的实现中，embedding 模型配置分散在多个地方：

```typescript
// ❌ 扩展内部硬编码
const DEFAULT_CONFIG = {
  embeddingModel: 'text-embedding-3-small' // 写死在扩展代码里
};

// ❌ 系统层硬编码候选列表
const embeddingCandidates = ['silicon', 'dashscope', 'openai', 'deepseek'];
```

**问题**：

- ❌ 扩展需要自己关注 embedding 模型配置
- ❌ 无法统一管理和切换 embedding 模型
- ❌ 没有明确标识哪些模型支持 embedding
- ❌ 用户无法在前端 UI 中选择 embedding 模型

---

## 解决方案

### 设计原则

1. **统一管理**：所有模型配置（聊天模型 + embedding 模型）都在 `coobee.json5` 中
2. **明确标识**：通过 `supportsEmbedding` 属性区分模型能力
3. **系统默认**：在 `models.defaults.embedding.primary` 中配置默认模型
4. **扩展透明**：扩展通过 `api.services.llm.embed()` 调用，无需关注底层配置

---

## 配置结构

### 1. 模型定义（添加 supportsEmbedding 属性）

#### 聊天模型（不支持 embedding）

```json5
{
  id: 'qwen3.5-plus',
  name: 'Qwen3.5 Plus',
  contextWindow: 1000000
  // supportsEmbedding 默认为 false（或不写）
}
```

#### Embedding 模型（支持向量化）

```json5
{
  id: 'text-embedding-v4',
  name: 'Text Embedding V4',
  contextWindow: 8192,
  maxInputTokens: 8192,
  supportsEmbedding: true, // ← 关键标识
  embeddingDimensions: [2048, 1536, 1024, 768, 512, 256, 128, 64],
  defaultDimension: 1024,
  features: ['向量化', '100+语种', '灵活维度', '0.0005元/千Token']
}
```

### 2. 默认模型配置

```json5
{
  models: {
    defaults: {
      model: {
        primary: 'dashscope-subscription/qwen3.5-plus' // 默认聊天模型
      },
      embedding: {
        primary: 'dashscope/text-embedding-v4' // ← 默认 embedding 模型
      },
      thinkingLevel: 'medium'
    }
  }
}
```

### 3. Provider 配置（以 dashscope 为例）

```json5
{
  models: {
    providers: {
      dashscope: {
        id: 'dashscope',
        name: '百炼',
        api: 'openai-compatible',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: '${DASHSCOPE_API_KEY}',
        enabled: true,
        models: [
          // 聊天模型
          { id: 'qwen3.5-plus', name: 'Qwen3.5 Plus' /* ... */ },
          { id: 'qwen-turbo-latest', name: 'Qwen Turbo' /* ... */ },

          // Embedding 模型
          { id: 'text-embedding-v4', supportsEmbedding: true /* ... */ },
          { id: 'text-embedding-v3', supportsEmbedding: true /* ... */ },
          { id: 'text-embedding-v2', supportsEmbedding: true /* ... */ }
        ]
      }
    }
  }
}
```

---

## 实现细节

### ExtensionApi.services.llm.embed()

扩展通过此接口调用 embedding：

```typescript
// 使用默认 embedding 模型
const embeddings = await api.services.llm.embed(['text1', 'text2']);

// 或覆盖模型
const embeddings = await api.services.llm.embed(['text1', 'text2'], {
  model: 'dashscope/text-embedding-v3'
});
```

### 配置解析逻辑（ExtensionApi.ts）

```typescript
function resolveEmbeddingConfigForApi(
  config: Record<string, unknown>,
  modelOverride?: string
): { apiKey: string; baseURL?: string; model: string } | undefined {
  // 1. 确定目标模型（优先级：override > defaults.embedding.primary）
  let modelRef = modelOverride || config.models.defaults.embedding.primary;

  // 2. 解析 'provider/model' 引用
  const [providerId, modelId] = modelRef.split('/');

  // 3. 验证 provider 可用（enabled=true, apiKey 有效）
  const provider = config.models.providers[providerId];

  // 4. 验证模型支持 embedding（supportsEmbedding=true）
  const model = provider.models.find((m) => m.id === modelId);
  if (!model.supportsEmbedding) return undefined;

  // 5. 返回配置
  return { apiKey: provider.apiKey, baseURL: provider.baseUrl, model: modelId };
}
```

**安全检查**：

- ✅ 验证 provider 是否 enabled
- ✅ 验证 apiKey 是否有效（不是空或 `${VAR}` 占位符）
- ✅ 验证模型是否设置 `supportsEmbedding: true`

---

## 使用示例

### 扩展开发者

**在扩展中使用 embedding**：

```typescript
export default {
  id: 'my-extension',
  async register(api: ExtensionApi) {
    api.on('agent_end', async (event) => {
      // 直接调用，无需关心底层模型
      const embeddings = await api.services.llm.embed([event.output]);

      // 存储到向量数据库...
    });
  }
};
```

### 用户配置

**在 coobee.json5 中配置**：

```json5
{
  models: {
    defaults: {
      embedding: {
        primary: 'dashscope/text-embedding-v4' // 切换为其他模型
      }
    }
  }
}
```

**支持的 embedding 模型**：

- `dashscope/text-embedding-v4`（推荐，100+ 语种）
- `dashscope/text-embedding-v3`
- `dashscope/text-embedding-v2`
- `silicon/BAAI/bge-large-zh-v1.5`（未来可添加）
- `openai/text-embedding-3-small`（未来可添加）

---

## 与 memory-global 的关系

### 配置流程

```
┌─────────────────────────────────────────────┐
│ 1. 用户配置（coobee.json5）                  │
│    models.defaults.embedding.primary        │
│    = 'dashscope/text-embedding-v4'          │
└─────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────┐
│ 2. ExtensionApi 解析配置                     │
│    resolveEmbeddingConfigForApi()           │
│    → 返回 { apiKey, baseURL, model }        │
└─────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────┐
│ 3. 扩展调用                                  │
│    api.services.llm.embed(texts)            │
│    → 使用系统默认 embedding 模型             │
└─────────────────────────────────────────────┘
```

### memory-global 简化

**改进前**：

```typescript
// ❌ 扩展自己管理 embedding 模型
const config = {
  embeddingModel: 'text-embedding-3-small'
};

await api.services.llm.embed([text], {
  model: config.embeddingModel
});
```

**改进后**：

```typescript
// ✅ 直接调用，使用系统默认
await api.services.llm.embed([text]);
```

---

## 前端 UI 集成（未来）

### 设置页面

未来可以在前端添加一个 embedding 模型选择器：

```vue
<template>
  <div class="setting-item">
    <label>文本向量模型</label>
    <select v-model="embeddingModel">
      <option v-for="model in embeddingModels" :key="model.ref" :value="model.ref">
        {{ model.name }} - {{ model.provider }}
      </option>
    </select>
  </div>
</template>

<script setup lang="ts">
const embeddingModels = computed(() => {
  // 从所有 provider 中过滤出 supportsEmbedding=true 的模型
  return providers.flatMap((p) =>
    p.models
      .filter((m) => m.supportsEmbedding)
      .map((m) => ({
        ref: `${p.id}/${m.id}`,
        name: m.name,
        provider: p.name
      }))
  );
});
</script>
```

---

## 迁移指南

### 对于扩展开发者

**如果你的扩展使用 embedding**：

**改动前**：

```typescript
// ❌ 不要这样做
const config = { embeddingModel: 'text-embedding-v3' };
await api.services.llm.embed(texts, { model: config.embeddingModel });
```

**改动后**：

```typescript
// ✅ 推荐：使用系统默认
await api.services.llm.embed(texts);

// ✅ 或明确指定（特殊场景）
await api.services.llm.embed(texts, {
  model: 'dashscope/text-embedding-v4'
});
```

### 对于用户

**确保配置正确**：

1. 检查 `coobee.json5` 中是否有 embedding 模型定义
2. 检查 `models.defaults.embedding.primary` 是否配置
3. 检查对应 provider 的 `apiKey` 是否有效

**验证配置**：

```bash
node scripts/config-get.js models.defaults.embedding
# 应输出：{ primary: 'dashscope/text-embedding-v4' }
```

---

## 错误处理

### 常见错误

#### 错误 1：未配置 embedding 模型

```
Error: No embedding model configured.
Please set models.defaults.embedding.primary in coobee.json5
```

**解决**：

```json5
{
  models: {
    defaults: {
      embedding: { primary: 'dashscope/text-embedding-v4' }
    }
  }
}
```

#### 错误 2：API Key 无效

```
Error: Provider dashscope is enabled but apiKey is not configured
```

**解决**：

```bash
# 设置环境变量
export DASHSCOPE_API_KEY='your-actual-api-key'

# 或在 coobee.json5 中直接写入（不推荐）
{
  models: {
    providers: {
      dashscope: {
        apiKey: 'sk-xxx'  // 替换 ${DASHSCOPE_API_KEY}
      }
    }
  }
}
```

#### 错误 3：模型不支持 embedding

```
Error: Model qwen3.5-plus does not support embedding
```

**原因**：尝试对聊天模型调用 embedding。

**解决**：检查 `models.defaults.embedding.primary` 是否指向正确的 embedding 模型。

---

## 已知限制

### 1. 模型切换无热重载

修改 `models.defaults.embedding.primary` 后需要重启应用才能生效。

**未来改进**：监听配置变更并通知扩展。

### 2. 暂未支持维度选择

当前使用模型的 `defaultDimension`，未来可以支持动态选择：

```typescript
await api.services.llm.embed(texts, {
  model: 'dashscope/text-embedding-v4',
  dimensions: 512 // 自定义维度
});
```

### 3. 批量调用未优化

当前每次调用都重新解析配置。未来可以缓存配置解析结果。

---

## 扩展案例

### memory-global 扩展

**改进前**（硬编码）：

```typescript
const config = {
  embeddingModel: 'text-embedding-3-small'
};

const embeddings = await api.services.llm.embed([text], {
  model: config.embeddingModel
});
```

**改进后**（系统配置）：

```typescript
// 直接调用，使用 models.defaults.embedding.primary
const embeddings = await api.services.llm.embed([text]);
```

**配置（coobee.json5）**：

```json5
{
  models: {
    defaults: {
      embedding: { primary: 'dashscope/text-embedding-v4' }
    }
  }
}
```

---

## 总结

### ✅ 改进

- **集中管理**：所有 embedding 模型配置在 `coobee.json5`
- **明确标识**：`supportsEmbedding` 属性清晰区分能力
- **扩展简化**：扩展无需关注配置细节
- **灵活切换**：用户可以统一切换 embedding 模型
- **未来友好**：为前端 UI 选择器做好准备

### 📊 数据

- **新增模型定义**: 3 个（text-embedding-v4/v3/v2）
- **新增配置项**: 1 个（models.defaults.embedding）
- **重构代码**: 105 行（ExtensionApi + 配置解析逻辑）
- **简化扩展**: -7 行（移除硬编码）

### 🎯 核心价值

**统一、简单、可扩展** — 所有与模型相关的配置都在 `coobee.json5` 中，扩展只需要调用 `api.services.llm.embed()`，系统自动处理模型解析、API 调用和错误处理。
