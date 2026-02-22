# 模型 Provider 配置

## Provider 配置结构

Provider 配置在 `models.providers` 下，每个 Provider 包含：

| 字段      | 说明                                            |
| --------- | ----------------------------------------------- |
| `name`    | Provider 名称                                   |
| `baseUrl` | API 端点                                        |
| `apiKey`  | API Key（建议使用 `${VAR}` 引用 secrets.json5） |
| `api`     | API 类型: openai-compatible/anthropic/google    |
| `models`  | 模型列表                                        |
| `enabled` | 是否启用                                        |

---

## 示例配置

```json5
{
  models: {
    providers: [
      {
        name: 'dashscope',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: '${DASHSCOPE_API_KEY}',
        api: 'openai-compatible',
        models: [{ id: 'qwen3.5-plus', name: 'Qwen 3.5 Plus' }],
        enabled: true
      }
    ]
  }
}
```

---

## API Key 管理

> **重要**: API Key 应存放在 secrets.json5 中，不要通过 config_patch 直接写入。

### secrets.json5 格式

```json5
{
  DASHSCOPE_API_KEY: 'sk-xxx',
  OPENAI_API_KEY: 'sk-xxx'
}
```

### 配置中引用

```json5
{
  apiKey: '${DASHSCOPE_API_KEY}' // 使用 ${VAR} 语法引用
}
```

**config_patch 会自动脱敏**，防止 API Key 泄漏到主配置文件。

---

## 启用/禁用 Provider

### 禁用某个 Provider

```typescript
config_patch({
  patch: '{"models": {"providers": [{"name": "dashscope", "enabled": false}]}}',
  description: '禁用 DashScope Provider'
});
```

### 添加新的 Provider

```typescript
config_patch({
  patch: `{
    "models": {
      "providers": [{
        "name": "custom-provider",
        "baseUrl": "https://api.custom.com/v1",
        "apiKey": "\${CUSTOM_API_KEY}",
        "api": "openai-compatible",
        "models": [{"id": "custom-model", "name": "Custom Model"}],
        "enabled": true
      }]
    }
  }`,
  description: '添加自定义 Provider'
});
```

---

## 注意事项

1. **不要硬编码 API Key** - 使用 `${VAR}` 引用 secrets.json5
2. **深度合并** - config_patch 会深度合并，不会覆盖整个 providers 数组
3. **API 类型** - 确保选择正确的 API 类型（openai-compatible/anthropic/google）
4. **模型 ID** - 确保模型 ID 与 Provider 支持的模型匹配
