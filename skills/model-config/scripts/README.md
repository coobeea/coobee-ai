# Model Config Scripts

安全地管理模型配置的内置 Python 脚本。

## 脚本列表

### 1. `list_models.py` - 列出已激活的模型

**用途**：安全地读取配置文件，提取所有 `enabled: true` 的模型信息。

**使用方式**：

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

---

### 2. `add_model.py` - 添加新模型

**用途**：安全地向指定 Provider 添加新模型，带严格的格式验证。

**使用方式**：

```bash
python skills/model-config/scripts/add_model.py <provider-id> '<model-json>'
```

**参数**：

- `<provider-id>`: Provider ID（如 `dashscope`, `openai`）
- `<model-json>`: 模型定义（JSON 格式字符串）

**模型定义格式**：

```json
{
  "id": "model-id", // 必需：模型 ID
  "name": "Model Name", // 必需：模型显示名称
  "contextWindow": 32768, // 可选：上下文窗口大小
  "maxInputTokens": 30720, // 可选：最大输入 tokens
  "maxOutputTokens": 8192, // 可选：最大输出 tokens
  "maxThinkingTokens": 4096, // 可选：最大思考 tokens（思考链）
  "reasoning": true, // 可选：是否支持推理
  "functionCalling": false, // 可选：是否支持工具调用
  "webSearch": false, // 可选：是否支持联网搜索
  "vision": false, // 可选：是否支持视觉理解
  "features": ["特性1", "特性2"] // 可选：特性标签列表
}
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

**错误处理**：

- Provider 不存在 → 报错
- 模型 ID 已存在 → 报错
- 格式验证失败 → 报错

---

## 安全性设计

### 1. 不暴露配置文件路径

- 脚本自动推导配置路径（向上查找 `.home` 目录或用户主目录）
- 开发环境：`{项目}/.home/config/coobee.json5`
- 生产环境：`~/.coobee-ai/config/coobee.json5`
- LLM 无法直接访问配置文件，只能通过这些经过测试的脚本操作

### 2. 严格的格式验证

- `add_model.py` 会验证所有字段类型
- 必需字段缺失会拒绝添加
- 防止写入非法数据

### 3. 防止重复和覆盖

- 添加前检查模型 ID 是否已存在
- 不允许覆盖现有模型

### 4. 只读不删

- **不提供删除脚本**
- 防止误删除配置

### 5. JSON5 格式保留

- 写回时使用 json5 库保留格式
- 不会破坏原有配置结构

---

## 配置文件路径解析

脚本自动推导配置文件路径，无需手动配置：

1. **向上查找 `.home` 目录**（开发环境）
   - 从脚本所在位置向上遍历
   - 查找路径：`{父目录}/.home/config/coobee.json5`

2. **回退到用户主目录**（生产环境）
   - 路径：`~/.coobee-ai/config/coobee.json5`

这种设计：

- ✅ 适配开发和生产环境
- ✅ 无需环境变量
- ✅ 可以直接执行脚本测试
- ✅ 路径推导逻辑规整、统一

---

## 依赖要求

这些脚本需要 Python 3 和 `json5` 库：

```bash
pip install json5
```

---

## 使用场景

### 场景 1：LLM 查询可用模型

```bash
# 通过 exec 工具调用
python skills/model-config/scripts/list_models.py
```

### 场景 2：LLM 为 Agent 选择模型

1. 获取模型列表：`list_models.py`
2. 解析输出，根据任务特征匹配最优模型
3. 例如：代码生成任务 → 选择 `deepseek/deepseek-v3`

### 场景 3：用户/LLM 添加新模型

```bash
# LLM 收到用户请求："帮我添加一个新的 GPT 模型"
python skills/model-config/scripts/add_model.py openai '{
  "id": "gpt-4o-mini",
  "name": "GPT-4o Mini",
  "contextWindow": 128000,
  "maxOutputTokens": 16384,
  "reasoning": true,
  "functionCalling": true,
  "vision": true,
  "features": ["经济型", "视觉理解"]
}'
```

---

## 错误输出

所有错误以 JSON 格式输出到 stderr，LLM 可以解析并采取对应措施：

```json
{
  "error": "Failed to add model",
  "message": "Provider \"unknown\" not found in configuration"
}
```

---

## 未来扩展

可能的扩展功能（目前不支持）：

- ✅ **已实现**：列出模型、添加模型
- ❌ **不支持**：删除模型（安全考虑）
- 🔮 **未来**：更新模型（修改现有模型的配置）
- 🔮 **未来**：启用/禁用 Provider
- 🔮 **未来**：验证配置（检查配置文件完整性）
