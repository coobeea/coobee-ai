# Agent 配置 (Agents)

## 默认模型 `agents.defaults.model`

```json5
{
  agents: {
    defaults: {
      model: {
        primary: 'dashscope/qwen3.5-plus',
        fallbacks: ['siliconflow/deepseek-v3']
      }
    }
  }
}
```

### 修改示例

```typescript
config_patch({
  patch: '{"agents": {"defaults": {"model": {"primary": "openai/gpt-4o"}}}}',
  description: '切换到 GPT-4o 模型'
});
```

---

## 思维链级别 `agents.defaults.thinkingLevel`

控制 LLM 推理深度（需模型支持 reasoning）。

| 值        | 推理深度     | 适用场景       |
| --------- | ------------ | -------------- |
| `minimal` | 最小         | 简单任务       |
| `low`     | 低           | 常规任务       |
| `medium`  | 中等（默认） | 标准任务       |
| `high`    | 高           | 复杂推理       |
| `xhigh`   | 最高         | 极度复杂的任务 |

### 修改示例

```typescript
config_patch({
  patch: '{"agents": {"defaults": {"thinkingLevel": "high"}}}',
  description: '提高推理深度'
});
```

---

## 配置建议

1. **模型选择** - 根据任务复杂度选择合适的模型
2. **推理深度** - 简单任务用 low，复杂任务用 high
3. **Fallback** - 配置备用模型，提高可用性
4. **成本控制** - 高级模型更贵，按需使用
