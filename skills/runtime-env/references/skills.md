# Skill 系统

## 概述

Skill 是场景化的操作手册 —— 一段自然语言指导文本，告诉你遇到某种场景时应该如何行动。

---

## Skill 来源（按优先级）

| 优先级    | 来源     | 路径                  | 说明                      |
| --------- | -------- | --------------------- | ------------------------- |
| 1（最低） | 内置     | `builtinSkillsDir`    | 随系统分发，只读          |
| 1.5       | 扩展贡献 | Extension 声明的目录  | Extension manifest 中声明 |
| 2         | 用户     | `userSkillsDir`       | 用户安装/编写             |
| 3（最高） | Agent    | `{workspace}/skills/` | 你自己生成的              |

**同名 Skill 高优先级覆盖低优先级。**

---

## 创建 Skill

### 目录结构

```
{workspace}/skills/my-new-skill/
├── SKILL.md              # 必须 — 技能描述和指令
├── references/           # 可选 — 参考资料
└── scripts/              # 可选 — 辅助脚本
```

### SKILL.md 格式

```markdown
---
name: My Skill Name
description: 一句话描述，告诉系统何时使用此 Skill
---

# Skill 标题

## 使用场景

描述何时应该使用这个 Skill...

## 操作步骤

1. 第一步...
2. 第二步...

## 注意事项

- 注意事项...
```

---

## Skill 配置

需要外部资源（如 API Key）的 Skill 可以在 frontmatter 中声明 `config` 字段：

```markdown
---
name: paddle-ocr
description: 使用 PaddleOCR 进行文字识别
config:
  - key: apiKey
    description: PaddleOCR API Key
    required: true
  - key: baseUrl
    description: API 地址
    required: false
    default: https://api.example.com
---
```

配置值存放在 `{userHome}/config/skills.json5`：

```json5
{
  'paddle-ocr': {
    apiKey: 'your-api-key',
    baseUrl: 'https://custom-api.example.com'
  }
}
```

---

## Skill 脚本访问配置

### 可用环境变量

Skill 脚本（通过 `exec` 工具调用）可以使用以下环境变量：

| 变量                | 说明                          |
| ------------------- | ----------------------------- |
| `COOBEE_CONFIG_DIR` | 配置目录（读取 skills.json5） |
| `COOBEE_WORKSPACE`  | 当前工作空间目录              |
| `COOBEE_SESSION_ID` | 当前会话 ID                   |
| `COOBEE_USER_HOME`  | 应用主目录                    |
| `COOBEE_MEMORY_DIR` | 记忆目录                      |

### Shell 脚本示例

```bash
#!/bin/bash
CONFIG_FILE="$COOBEE_CONFIG_DIR/skills.json5"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: 配置文件不存在: $CONFIG_FILE" >&2
  exit 1
fi
# 读取配置...
```

### Python 脚本示例

```python
import os, json
config_dir = os.environ.get("COOBEE_CONFIG_DIR")
if not config_dir:
    raise RuntimeError("COOBEE_CONFIG_DIR 环境变量未设置")
# 读取 skills.json5...
```

---

## 使用建议

1. **创建前搜索** - 先检查是否已有类似 Skill
2. **命名规范** - 使用 kebab-case，名称清晰
3. **描述精准** - description 决定了何时触发 Skill
4. **结构清晰** - 使用标准格式，便于维护
