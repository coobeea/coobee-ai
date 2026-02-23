---
name: observability
description: 系统可观测性工具集。当需要查看会话状态、对话历史、或检查 LLM 调用上下文时使用。提供 session-status、session-history、context-inspect 三个脚本。Use when user asks about session status, conversation history, or needs to inspect LLM call details.
---

# Observability Skill

系统可观测性工具集，帮助 Agent 和用户了解会话运行状态、历史记录和详细上下文。

## 何时使用

当遇到以下场景时使用此 Skill：

1. **自我监控**：查看当前会话状态、Token 使用情况
2. **回顾历史**：查看对话历史时间线、定位问题时刻
3. **调试分析**：检查特定 LLM 调用的详细上下文、工具调用记录
4. **成本意识**：了解 Token 消耗、模型使用情况

## 可用脚本

### 1. `session-status.py` - 会话状态

**用途**：查看当前会话的运行状态。

**使用方式**：

```bash
python skills/observability/scripts/session-status.py
```

**输出内容**：

- 会话 ID
- 快照数量（LLM 调用次数）
- 最后一次调用信息：
  - 时间戳
  - 使用的模型
  - 执行时长
  - 工具调用数量
  - 是否有错误

**使用场景**：

- 查看会话基本信息
- 监控 Token 使用
- 自我感知运行状态

---

### 2. `session-history.py` - 对话历史

**用途**：查看完整的对话历史时间线。

**使用方式**：

```bash
python skills/observability/scripts/session-history.py
```

**输出内容**：

- 所有 LLM 调用的时间线
- 每次调用的快照文件名
- 时间戳
- 使用的模型
- 执行时长
- 用户消息摘要
- 工具调用数量

**使用场景**：

- 回顾对话历程
- 分析性能瓶颈
- 定位问题发生时刻
- 审计 LLM 使用

---

### 3. `context-inspect.py` - 上下文检查

**用途**：深入检查特定 LLM 调用的详细上下文。

**使用方式**：

```bash
python skills/observability/scripts/context-inspect.py <filename>
```

**参数**：

- `<filename>`: 快照文件名（从 session-history 获取）

**输出内容**：

- 系统指令
- 加载的 Skills
- 可用工具列表
- 用户消息
- LLM 输出内容
- 工具调用详情（参数、结果）
- Token 使用统计
- 执行时长

**使用场景**：

- 深入调试问题
- 分析 LLM 行为
- 优化 Prompt
- 审查工具调用

---

## 数据来源

所有脚本读取 **工作空间** 的快照文件：

```
{COOBEE_WORKSPACE}/contexts/*.json
```

环境变量 `COOBEE_WORKSPACE` 由系统自动注入（通过 `exec` 工具执行时）。

---

## 典型工作流程

### 场景 1：查看会话基本信息

```bash
# 快速查看当前状态
python skills/observability/scripts/session-status.py
```

### 场景 2：回顾对话历史

```bash
# 1. 查看所有对话记录
python skills/observability/scripts/session-history.py

# 输出示例：
# 1. 20240223_093042_abc123.json
#    时间: 2024-02-23 09:30:42
#    模型: dashscope/qwen3.5-plus
#    耗时: 2.3s
#    用户: "帮我创建一个 test.txt 文件"
#    工具: 1 个 (write)
#
# 2. 20240223_093055_def456.json
#    ...
```

### 场景 3：深入检查特定调用

```bash
# 2. 检查第 2 次调用的详细信息
python skills/observability/scripts/context-inspect.py 20240223_093055_def456.json
```

---

## 环境变量

脚本依赖以下环境变量（由系统自动注入）：

| 变量               | 说明             | 降级方案                  |
| ------------------ | ---------------- | ------------------------- |
| `COOBEE_WORKSPACE` | 当前工作空间目录 | `{当前目录}` （开发环境） |

---

## 安全性

- ✅ **只读操作**：所有脚本都是只读，不修改任何文件
- ✅ **无副作用**：可安全重复执行
- ✅ **API Key 脱敏**：不会输出敏感信息

---

## 依赖

这些脚本只依赖 Python 标准库，无需额外安装依赖。

---

## 使用建议

1. **先查状态，再看历史**：使用 `session-status` 快速了解概况
2. **定位后深入**：从 `session-history` 找到问题时刻，再用 `context-inspect` 查看详情
3. **定期回顾**：长任务中定期查看状态，监控 Token 使用
4. **调试利器**：遇到问题时，检查上下文是诊断问题的最佳方法

---

## 错误处理

所有脚本以 JSON 格式输出错误（stderr），便于 LLM 解析：

```json
{
  "error": "Workspace not found",
  "message": "COOBEE_WORKSPACE environment variable not set"
}
```
