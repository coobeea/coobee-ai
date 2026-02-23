---
name: config-manager
description: 应用配置管理工具集。当需要查看或修改应用配置（coobee.json5）时使用。提供 config-get、config-patch 两个脚本，支持查看完整配置、指定章节、以及深度合并修改。Use when user asks to view or modify app configuration, change settings, adjust security policies, or update model defaults.
---

# Config Manager Skill

应用配置管理工具集，安全地查看和修改 `coobee.json5` 配置文件。

## 何时使用

当遇到以下场景时使用此 Skill：

1. **查看配置**：查看当前应用配置、模型设置、安全策略
2. **修改配置**：调整系统设置、切换沙箱模式、更新审批策略
3. **配置调试**：检查配置有效性、定位配置问题
4. **动态调整**：运行时修改配置（热重载）

## 可用脚本

### 1. `config-get.py` - 查看配置

**用途**：查看当前生效的配置（经过 Schema 验证和默认值填充）。

**使用方式**：

```bash
# 查看完整配置
python skills/config-manager/scripts/config-get.py

# 查看指定章节
python skills/config-manager/scripts/config-get.py models
python skills/config-manager/scripts/config-get.py security
```

**支持的章节**（`key` 参数）：

| Key        | 说明     | 内容                         |
| ---------- | -------- | ---------------------------- |
| `models`   | 模型配置 | Provider、模型列表、默认模型 |
| `security` | 安全设置 | 沙箱模式、审批策略           |
| `tools`    | 工具配置 | 工具启用/禁用、参数          |
| `ui`       | 界面设置 | 主题、语言、音效             |
| `logging`  | 日志设置 | 日志级别、文件输出           |

**输出格式**（JSON5）：

```json5
{
  models: {
    providers: {
      dashscope: {
        enabled: true,
        name: '百炼'
        // ...
      }
    },
    defaults: {
      model: {
        primary: 'dashscope/qwen3.5-plus'
      }
    }
  }
}
```

**特点**：

- ✅ API Key 自动脱敏（显示为 `****`）
- ✅ 显示有效配置（含默认值）
- ✅ 只读操作，安全无风险

---

### 2. `config-patch.py` - 修改配置

**用途**：修改应用配置，支持深度合并（deep merge）。

**使用方式**：

```bash
python skills/config-manager/scripts/config-patch.py '<patch-json>'
```

**参数**：

- `<patch-json>`: JSON5 格式的 patch 对象（深度合并到现有配置）

**示例**：

#### 示例 1：切换沙箱模式

```bash
python skills/config-manager/scripts/config-patch.py '{
  security: {
    sandbox: {
      mode: "docker"
    }
  }
}'
```

#### 示例 2：修改默认模型

```bash
python skills/config-manager/scripts/config-patch.py '{
  models: {
    defaults: {
      model: {
        primary: "deepseek/deepseek-v3"
      }
    }
  }
}'
```

#### 示例 3：调整审批策略

```bash
python skills/config-manager/scripts/config-patch.py '{
  security: {
    approvals: {
      exec: "ask"
    }
  }
}'
```

**输出格式**（JSON）：

```json
{
  "success": true,
  "message": "Configuration updated successfully",
  "changed_paths": ["security.sandbox.mode"]
}
```

**特点**：

- ✅ 深度合并（不会覆盖未修改的部分）
- ✅ 立即生效（热重载）
- ✅ Schema 验证（拒绝非法配置）
- ⚠️ 需谨慎使用（配置立即生效）

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

## 安全性设计

### 1. API Key 脱敏

`config-get.py` 会自动脱敏所有 `apiKey` 字段：

```json5
// 原值
{ apiKey: 'sk-abc123def456...' }

// 脱敏后
{ apiKey: '****' }
```

### 2. 深度合并（防止覆盖）

`config-patch.py` 使用深度合并，只修改指定的字段：

```json5
// 原配置
{
  security: {
    sandbox: { mode: 'off' },
    approvals: { exec: 'never' }
  }
}

// Patch
{ security: { sandbox: { mode: 'docker' } } }

// 合并后
{
  security: {
    sandbox: { mode: 'docker' },  // ✅ 修改
    approvals: { exec: 'never' }  // ✅ 保留
  }
}
```

### 3. Schema 验证

修改前会验证配置有效性，拒绝非法配置：

```python
# ❌ 非法值会被拒绝
{ security: { sandbox: { mode: 'invalid_mode' } } }

# ✅ 只允许合法值
{ security: { sandbox: { mode: 'off' | 'docker' | 'e2b' } } }
```

### 4. 热重载机制

修改后配置立即生效，无需重启应用：

```
config-patch.py 写入配置文件
    ↓
ConfigWatcher 检测到文件变化
    ↓
重新加载并验证配置
    ↓
触发 config:reload 事件
    ↓
系统各模块响应更新
```

---

## 常见配置操作

### 切换沙箱模式

```bash
# 关闭沙箱
python skills/config-manager/scripts/config-patch.py '{ security: { sandbox: { mode: "off" } } }'

# 启用 Docker 沙箱
python skills/config-manager/scripts/config-patch.py '{ security: { sandbox: { mode: "docker" } } }'

# 启用 E2B 沙箱
python skills/config-manager/scripts/config-patch.py '{ security: { sandbox: { mode: "e2b" } } }'
```

### 调整审批策略

```bash
# exec 工具总是询问
python skills/config-manager/scripts/config-patch.py '{ security: { approvals: { exec: "ask" } } }'

# exec 工具从不询问
python skills/config-manager/scripts/config-patch.py '{ security: { approvals: { exec: "never" } } }'
```

### 修改默认模型

```bash
python skills/config-manager/scripts/config-patch.py '{
  models: {
    defaults: {
      model: {
        primary: "deepseek/deepseek-v3",
        fallbacks: ["dashscope/qwen3.5-plus"]
      }
    }
  }
}'
```

---

## 使用流程

### 场景 1：检查当前配置

```bash
# 1. 查看完整配置
python skills/config-manager/scripts/config-get.py

# 2. 查看特定章节
python skills/config-manager/scripts/config-get.py security
```

### 场景 2：修改配置

```bash
# 1. 先查看当前配置（了解结构）
python skills/config-manager/scripts/config-get.py security

# 2. 修改配置
python skills/config-manager/scripts/config-patch.py '{
  security: { sandbox: { mode: "docker" } }
}'

# 3. 验证修改结果
python skills/config-manager/scripts/config-get.py security
```

---

## 依赖

这些脚本需要 Python 3 和 `json5` 库：

```bash
pip install json5
```

---

## 错误处理

所有错误以 JSON 格式输出到 stderr：

```json
{
  "error": "Configuration file not found",
  "path": "/path/to/coobee.json5"
}
```

---

## 注意事项

1. **配置立即生效**：`config-patch` 修改后配置热重载，无需重启
2. **谨慎修改**：某些配置项（如沙箱模式）会影响系统安全性
3. **备份建议**：重要配置修改前建议先查看当前配置
4. **验证结果**：修改后使用 `config-get` 验证是否生效
