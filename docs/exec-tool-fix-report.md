# exec 工具执行错误修复报告

## 问题描述

用户在对话中遇到错误："没找到这个工具"（exec 工具）。

## 根本原因

**`app-copilot` Agent 配置中缺少 `exec` 工具**。

### 原配置（有问题）

```json
{
  "tools": [
    "manage_agent", // ❌ 已废弃
    "manage_skill", // ❌ 已废弃
    "skill_list",
    "config_get",
    "config_patch",
    "read",
    "write",
    "edit",
    "search",
    "glob"
    // ❌ 缺少 "exec"
  ]
}
```

## 排查过程

### 1. 环境检查 ✅

```bash
# Python 版本
Python 3.14.2 ✅

# json5 依赖
json5 version: 0.13.0 ✅

# 脚本测试
python3 skills/model-config/scripts/list_models.py
# 输出正常 ✅
```

**结论**：Python 环境和脚本本身都正常。

### 2. Agent 配置检查 ❌

```bash
cat agents/app-copilot.json
```

**发现问题**：

- `tools` 数组中**缺少** `"exec"` 工具
- `instructions` 中提到了已废弃的 `manage_agent` 和 `manage_skill` 工具

## 修复方案

### 1. 添加 exec 工具

```json
{
  "tools": [
    "skill_list",
    "config_get",
    "config_patch",
    "read",
    "write",
    "edit",
    "exec", // ✅ 新增
    "search",
    "glob"
  ]
}
```

### 2. 移除已废弃的工具

删除了：

- `"manage_agent"` → 已转为 `agent-creator` Skill
- `"manage_skill"` → 已转为 `skill-creator` Skill

### 3. 更新 instructions

**旧版**（有问题）：

```
### 1. 技能管理
- 调用 manage_skill 工具写入  ❌ 已废弃

### 2. 智能体管理
- 调用 manage_agent 工具创建  ❌ 已废弃
```

**新版**（修复后）：

```
### 1. 技能管理
- 使用现有工具（read/write/glob 等）创建  ✅

### 2. 智能体管理
- 使用现有工具（read/write/glob 等）创建  ✅

### 4. 模型配置  ✅ 新增
- 使用 exec 工具执行 Python 脚本
- 参考 model-config 技能
```

### 4. 添加 model-config Skill

```json
{
  "skills": [
    "skill-creator",
    "agent-creator",
    "model-config", // ✅ 新增
    "system-config"
  ]
}
```

## 修复后的完整配置

```json
{
  "id": "app-copilot",
  "name": "应用管家",
  "description": "管理技能、智能体和系统配置的全能助手，用对话代替手动操作",
  "tools": [
    "skill_list",
    "config_get",
    "config_patch",
    "read",
    "write",
    "edit",
    "exec", // ✅ 关键修复
    "search",
    "glob"
  ],
  "skills": [
    "skill-creator",
    "agent-creator",
    "model-config", // ✅ 新增
    "system-config"
  ],
  "createdBy": "system"
}
```

## 验证

### 测试 exec 工具可用性

现在 `app-copilot` Agent 可以：

1. **列出可用模型**：

   ```bash
   exec: python3 skills/model-config/scripts/list_models.py
   ```

2. **添加新模型**：

   ```bash
   exec: python3 skills/model-config/scripts/add_model.py dashscope '{...}'
   ```

3. **执行其他脚本**：
   ```bash
   exec: <任何其他 shell 命令>
   ```

## 学到的教训

### 1. Agent 工具清单需要定期审查

- ❌ **问题**：Agent 创建时没有包含必要的工具
- ✅ **解决**：创建 Agent 时明确指定需要的工具
- ✅ **最佳实践**：如果不确定需要哪些工具，可以省略 `tools` 字段，让 Agent 继承所有工具

### 2. 废弃工具需要及时清理

- ❌ **问题**：`manage_agent` 和 `manage_skill` 已删除，但配置中仍引用
- ✅ **解决**：删除工具时，同时更新所有 Agent 配置和文档
- ✅ **最佳实践**：使用全局搜索确保没有遗留引用

### 3. Instructions 需要与工具保持一致

- ❌ **问题**：Instructions 中提到的工具不在 `tools` 列表中
- ✅ **解决**：更新 Instructions，使用正确的工具和 Skill
- ✅ **最佳实践**：Agent 配置的 `tools` 和 `instructions` 应该匹配

## 相关文档

- `docs/troubleshooting-exec-tool.md` - exec 工具排查指南
- `skills/model-config/SKILL.md` - 模型配置管理 Skill
- `skills/agent-creator/SKILL.md` - Agent 创建指南

## 总结

**根本原因**：Agent 配置中缺少 `exec` 工具。

**修复措施**：

1. ✅ 添加 `"exec"` 到 `tools` 数组
2. ✅ 移除已废弃的工具引用
3. ✅ 更新 `instructions` 说明
4. ✅ 添加 `model-config` Skill

**验证结果**：

- ✅ Python 环境正常
- ✅ 脚本可以执行
- ✅ Agent 配置已修复
- ✅ exec 工具现在可用
