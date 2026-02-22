---
name: system-config
description: 应用配置体系和自我管理指南。当 Agent 需要修改系统配置（沙箱模式、模型设置、审批策略等）、了解可配置项、或进行自我优化时使用此技能。
---

# System Configuration & Self-Management

## 概述

你拥有修改 coobee-ai 系统配置的能力。通过 `config_patch` 工具，你可以在用户授权后修改运行时配置。

**配置文件**: `coobee.json5` (存放在 `<paths>.configDir` 目录)  
**修改方式**: `config_patch` 工具（需用户确认）  
**生效方式**: 自动热重载，立即生效

---

## 快速开始

### 修改配置示例

```typescript
config_patch({
  patch: '{"security": {"sandbox": {"mode": "off"}}}',
  description: '关闭沙箱模式'
});
```

- `patch`: JSON5 格式的配置补丁，深度合并到当前配置
- `description`: 描述本次修改的目的
- 修改前需要用户确认（needUserConfirm: true）

---

## 📚 配置主题索引

点击查看详细配置说明：

1. **[安全配置](./references/security.md)** - 沙箱模式、命令审批策略
2. **[Agent 配置](./references/agents.md)** - 默认模型、推理深度
3. **[工具配置](./references/tools.md)** - 命令超时、黑名单
4. **[UI 配置](./references/ui.md)** - 主题、语言、音效
5. **[日志配置](./references/logging.md)** - 日志级别、文件输出
6. **[模型 Provider](./references/models.md)** - Provider 配置、API Key 管理
7. **[自我进化指南](./references/self-improvement.md)** - 如何扩展和优化系统

---

## 🔍 使用场景

### 场景 1: 调整安全级别

用户需要执行敏感操作 → 临时关闭沙箱或调整审批策略

### 场景 2: 切换默认模型

用户想用更强大的模型 → 修改 `agents.defaults.model`

### 场景 3: 优化推理深度

任务需要深度思考 → 调整 `agents.defaults.thinkingLevel`

### 场景 4: 自我优化

发现配置不合理 → 主动优化并告知用户

---

## ⚠️ 注意事项

1. **config_patch 需要用户确认** - 这是安全设计，不要尝试绕过
2. **不要修改 API Key** - API Key 由 secrets.json5 管理，config_patch 会自动脱敏
3. **配置立即生效** - 修改后通过热重载立即应用，无需重启
4. **Schema 校验** - 非法配置会被拒绝，不用担心写坏配置文件
5. **先读后改** - 修改前用 `read` 工具查看当前配置，了解现状

---

## 🚀 渐进式使用

```
需要修改配置时:
  ↓
1. 先读 SKILL.md，找到相关主题
  ↓
2. 点击链接进入 references/xxx.md
  ↓
3. 阅读详细配置说明
  ↓
4. 使用 config_patch 修改
```

**优势**: 按需加载，不浪费 Token
