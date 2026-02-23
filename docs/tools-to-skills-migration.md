# 工具到 Skills 迁移总结

## 优化动机

### 问题

系统内置 17 个工具，其中 5 个工具：

- ✅ **功能完善**：实现正确、测试完整
- ❌ **使用频率低**：大部分场景下不会用到
- ❌ **常驻上下文**：作为工具定义，必须注入到每次 LLM 调用
- ❌ **占用空间大**：约 20KB+ Token，浪费上下文窗口

### 解决方案

将低频工具转换为 **Skill + 脚本** 模式：

- 📚 **按需加载**：只在需要时读取 Skill 文档
- 🐍 **脚本执行**：通过 `exec` 工具调用 Python 脚本
- 💾 **大幅节省**：工具定义从上下文中移除
- 🎯 **保留能力**：功能完全保留，只是调用方式改变

---

## 迁移清单

### 迁移工具（5 个）

| 原工具            | 新 Skill         | 脚本文件             | 功能                |
| ----------------- | ---------------- | -------------------- | ------------------- |
| `session_status`  | `observability`  | `session-status.py`  | 查看会话状态        |
| `session_history` | `observability`  | `session-history.py` | 查看对话历史时间线  |
| `context_inspect` | `observability`  | `context-inspect.py` | 检查 LLM 调用上下文 |
| `config_get`      | `config-manager` | `config-get.py`      | 查看应用配置        |
| `config_patch`    | `config-manager` | `config-patch.py`    | 修改应用配置        |

### 新增 Skills（2 个）

#### 1. **observability** - 系统可观测性工具集

**位置**：`skills/observability/`

**功能**：

- `session-status.py` - 查看会话状态（会话 ID、快照数量、最后调用信息）
- `session-history.py` - 查看对话历史时间线（所有 LLM 调用概览）
- `context-inspect.py` - 深入检查 LLM 调用上下文（指令、工具、消息、输出）

**数据来源**：`{COOBEE_WORKSPACE}/contexts/*.json`

**使用场景**：

- 自我监控、成本意识
- 回顾对话历程、分析性能
- 调试 LLM 行为、优化 Prompt

---

#### 2. **config-manager** - 应用配置管理工具集

**位置**：`skills/config-manager/`

**功能**：

- `config-get.py` - 查看配置（支持完整配置或指定章节）
- `config-patch.py` - 修改配置（深度合并，热重载）

**数据来源**：`{COOBEE_CONFIG_DIR}/coobee.json5`

**使用场景**：

- 查看/修改应用配置
- 切换沙箱模式
- 调整审批策略
- 更新默认模型

**安全特性**：

- ✅ API Key 自动脱敏
- ✅ 深度合并（不覆盖未修改部分）
- ✅ 立即生效（热重载）

---

## 技术实现

### 1. 自动路径推导

所有脚本自动推导路径，无需环境变量：

**配置文件**（model-config、config-manager）：

```python
def find_config_file() -> Path:
    # 1. 向上查找 .home 目录（开发环境）
    current = Path(__file__).resolve()
    for parent in [current] + list(current.parents):
        config_path = parent / ".home" / "config" / "coobee.json5"
        if config_path.exists():
            return config_path

    # 2. 回退到用户主目录（生产环境）
    home_config = Path.home() / ".coobee-ai" / "config" / "coobee.json5"
    if home_config.exists():
        return home_config

    raise FileNotFoundError("无法定位配置文件")
```

**工作空间**（observability）：

```python
def find_workspace_dir() -> Path:
    # 1. 使用当前目录（如果包含 contexts/）
    cwd = Path.cwd()
    if (cwd / "contexts").exists():
        return cwd

    # 2. 向上查找包含 contexts/ 的父目录
    for parent in list(cwd.parents):
        if (parent / "contexts").exists():
            return parent

    return cwd
```

### 2. 路径设计理念

符合系统的规整设计：

- **开发环境**：`{项目}/.home/config/`
- **生产环境**：`~/.coobee-ai/config/`
- 只有两个位置，规整统一

### 3. 优势特性

- ✅ **无需环境变量**：脚本自动推导路径
- ✅ **开发友好**：可以直接执行脚本测试（`python skills/.../xxx.py`）
- ✅ **环境适配**：自动适配开发和生产环境
- ✅ **路径规整**：只有两个位置，逻辑清晰

### 4. 调用方式

**原工具调用**（17 KB 常驻上下文）：

```typescript
await tools.session_status();
```

**新 Skill 调用**（按需加载）：

```typescript
// 1. LLM 识别需要可观测性能力
// 2. 读取 observability Skill 文档（仅在需要时）
// 3. 执行脚本
await tools.exec({
  command: 'python skills/observability/scripts/session-status.py'
});
```

---

## 优化效果

### 工具数量

| 指标             | 迁移前 | 迁移后 | 变化 |
| ---------------- | ------ | ------ | ---- |
| **内置工具总数** | 17     | 12     | -5   |
| **低风险工具**   | 10     | 6      | -4   |
| **中风险工具**   | 6      | 5      | -1   |
| **高风险工具**   | 1      | 1      | 0    |

### 上下文占用

| 项目           | 大小估算 | 说明                       |
| -------------- | -------- | -------------------------- |
| **工具定义**   | -17 KB   | 5 个工具的 TypeScript 定义 |
| **Skill 文档** | +5 KB    | 按需加载（不常驻）         |
| **净节省**     | ~12 KB   | 约 3000 tokens             |

### 风险分布

**迁移前**：

- 🟢 低风险：10 个（59%）
- 🟡 中风险：6 个（35%）
- 🔴 高风险：1 个（6%）

**迁移后**：

- 🟢 低风险：6 个（50%）
- 🟡 中风险：5 个（42%）
- 🔴 高风险：1 个（8%）

**分析**：

- 低频工具移出后，剩余工具更加核心、高频
- 风险分布更加均衡
- Agent 可用工具更加聚焦

---

## 使用对比

### 迁移前（工具模式）

```typescript
// 可观测性
await tools.session_status();
await tools.session_history();
await tools.context_inspect({ filename: 'xxx.json' });

// 配置管理
await tools.config_get({ key: 'models' });
await tools.config_patch({
  patch: '{ security: { sandbox: { mode: "docker" } } }'
});
```

**特点**：

- ✅ 调用简单
- ❌ 常驻上下文（~17KB）
- ❌ 低频但占用高

### 迁移后（Skill + 脚本模式）

```typescript
// 可观测性
await tools.exec({
  command: 'python skills/observability/scripts/session-status.py'
});
await tools.exec({
  command: 'python skills/observability/scripts/session-history.py'
});
await tools.exec({
  command: 'python skills/observability/scripts/context-inspect.py xxx.json'
});

// 配置管理
await tools.exec({
  command: 'python skills/config-manager/scripts/config-get.py models'
});
await tools.exec({
  command: 'python skills/config-manager/scripts/config-patch.py \'{ security: { sandbox: { mode: "docker" } } }\''
});
```

**特点**：

- ✅ 按需加载（Skill 文档 ~5KB，只在需要时读取）
- ✅ 功能完全保留
- ✅ 大幅节省上下文（~12KB）
- 🟡 调用略复杂（但 Skill 文档会指导）

---

## 文件变更

### 新增文件（9 个）

```
skills/observability/
├── SKILL.md
└── scripts/
    ├── session-status.py
    ├── session-history.py
    └── context-inspect.py

skills/config-manager/
├── SKILL.md
└── scripts/
    ├── config-get.py
    └── config-patch.py

docs/
└── builtin-tools-inventory.md
```

### 删除文件（8 个）

```
src/main/ai/tools/builtin/
├── session_status.ts (删除)
├── session_history.ts (删除)
├── context_inspect.ts (删除)
├── config_get.ts (删除)
├── config_patch.ts (删除)
└── __tests__/
    ├── observability-tools.test.ts (删除)
    ├── config_get.test.ts (删除)
    └── config_patch.test.ts (删除)
```

### 修改文件（4 个）

```
src/main/ai/tools/builtin/index.ts  — 移除 5 个工具导出
src/main/ai/tools/index.ts          — 更新导出列表
src/main/ai/tools/__tests__/r4-improvements.test.ts — 删除 context_inspect 测试
AGENTS.md                            — 添加 2 个新 Skills
```

---

## 测试验证

### 类型检查

```bash
npx tsc --noEmit -p tsconfig.node.json  # ✅ 通过
npx vue-tsc --noEmit -p tsconfig.web.json # ✅ 通过
```

### 脚本测试

```bash
# 测试 config-get.py
COOBEE_CONFIG_DIR=".home/config" python skills/config-manager/scripts/config-get.py models
# ✅ 正确读取配置，API Key 已脱敏

# 测试 session-status.py
COOBEE_WORKSPACE="." python skills/observability/scripts/session-status.py
# ✅ 正确显示会话状态
```

---

## 后续使用指南

### 对于用户

**问：** "查看当前会话状态"

**答：** Agent 会：

1. 识别到需要可观测性能力
2. 读取 `observability` Skill
3. 执行 `python skills/observability/scripts/session-status.py`
4. 返回结果

**问：** "修改沙箱模式为 docker"

**答：** Agent 会：

1. 识别到需要配置管理能力
2. 读取 `config-manager` Skill
3. 执行 `python skills/config-manager/scripts/config-patch.py '{ security: { sandbox: { mode: "docker" } } }'`
4. 返回结果

### 对于开发者

如需直接执行脚本（调试/测试）：

```bash
# 设置环境变量
export COOBEE_CONFIG_DIR="/path/to/.home/config"
export COOBEE_WORKSPACE="/path/to/workspace"

# 执行脚本
python skills/observability/scripts/session-status.py
python skills/config-manager/scripts/config-get.py models
```

---

## 优势总结

### ✅ 优势

1. **上下文优化**：减少约 12KB 常驻上下文（~3000 tokens）
2. **按需加载**：只在需要时读取 Skill 文档
3. **功能保留**：所有能力完全保留，只是调用方式改变
4. **更加聚焦**：剩余 12 个工具更加核心、高频
5. **易于扩展**：新增功能只需添加脚本，不占用上下文
6. **环境灵活**：通过环境变量适配不同部署环境

### 🟡 权衡

1. **调用略复杂**：从直接调用工具变为通过 `exec` 执行脚本
2. **文档依赖**：需要 Skill 文档指导使用
3. **Python 依赖**：需要 Python 3 + json5 库

---

## 后续优化建议

### 1. 可能迁移的工具

如果继续优化上下文，可以考虑迁移：

| 工具                | 使用频率 | 迁移难度 | 优先级 |
| ------------------- | -------- | -------- | ------ |
| `task_plan`         | 低       | 中       | 中     |
| `delegate_to_agent` | 中       | 高       | 低     |
| `memory`            | 中       | 中       | 低     |

**建议**：暂时不迁移，先观察当前效果。

### 2. Skill 文档优化

- 添加更多使用示例
- 提供常见场景的快捷命令
- 增加错误处理说明

### 3. 脚本功能增强

**observability**：

- 支持 JSON 输出格式（便于程序解析）
- 支持过滤和筛选
- 支持统计分析

**config-manager**：

- 添加配置验证脚本
- 添加配置备份/恢复脚本
- 支持批量修改

---

## 提交记录

```bash
commit e1c1418
refactor(tools): migrate 5 low-frequency tools to Skills

变更统计：
- 新增 9 个文件（2 个 Skills + 5 个脚本 + 2 个文档）
- 删除 8 个文件（5 个工具 + 3 个测试）
- 修改 4 个文件（索引 + 测试 + 文档）
```

---

## 相关文档

- `docs/builtin-tools-inventory.md` - 工具清单（已更新为 12 个工具）
- `skills/observability/SKILL.md` - 可观测性 Skill 文档
- `skills/config-manager/SKILL.md` - 配置管理 Skill 文档
- `AGENTS.md` - 已添加新 Skills

---

## 快速参考

### 查看会话状态

```bash
python skills/observability/scripts/session-status.py
```

### 查看对话历史

```bash
python skills/observability/scripts/session-history.py
```

### 检查上下文

```bash
python skills/observability/scripts/context-inspect.py <filename>
```

### 查看配置

```bash
python skills/config-manager/scripts/config-get.py [key]
```

### 修改配置

```bash
python skills/config-manager/scripts/config-patch.py '<patch-json>'
```
