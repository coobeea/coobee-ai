# Agent 系统

## 概述

Agent（智能体）是 coobee-ai 的核心概念。每个 Agent 定义了一个特定角色的行为模式。

**存储位置**: `{userHome}/agents/`  
**文件格式**: 每个 Agent 一个 JSON 文件（`{agent-id}.json`）

---

## 数据结构

```json
{
  "id": "code-reviewer", // 唯一标识（kebab-case）
  "name": "代码审查专家", // 显示名称
  "description": "审查代码质量...", // 一句话描述
  "instructions": "你是一个...", // 系统指令（Agent 的灵魂）
  "tools": ["read", "search"], // 启用的工具名称列表
  "skills": ["coding-standards"], // 关联的 Skill 名称列表
  "model": "openai/gpt-4o", // 指定模型（可选）
  "createdAt": "2025-01-01T...", // 创建时间（ISO 8601）
  "updatedAt": "2025-01-01T...", // 最后更新时间
  "createdBy": "user", // 创建者：user | agent
  "version": 1 // 版本号（每次更新递增）
}
```

---

## 管理方式

| 方式                | 说明                                   |
| ------------------- | -------------------------------------- |
| HTTP REST API       | 前端通过 `/gateway/agents/*` 管理      |
| AI Creator          | 用户输入需求，系统 AI 自动生成完整定义 |
| `delegate_to_agent` | LLM 通过工具调用委托任务给已注册 Agent |

---

## 与会话的关系

- 每个 **Thread**（会话线程）绑定一个 `agentId`
- Agent 定义决定了该会话中 LLM 的行为方式（指令、工具、技能）
- Agent 是**模板**，Thread 是**实例**

```
用户创建 Thread → 选择 Agent → 该 Thread 使用 Agent 的配置运行
```

---

## Agent Home 会话索引

每个 Agent 的 Home 目录下维护一个 `sessions.jsonl` 索引文件，记录该 Agent 的所有会话。

**文件位置**: `{userHome}/homes/{agentId}/sessions.jsonl`

**格式**（JSONL，每行一条记录）：

```jsonl
{"id":"283557218403819520","createdAt":"2026-02-21T11:15:09.105Z"}
{"id":"283557235642408960","createdAt":"2026-02-21T11:15:13.215Z"}
```

**查询方法**：

```bash
# 查看某个 agent 的所有 sessions
cat {userHome}/homes/{agentId}/sessions.jsonl

# 或使用查询脚本
node scripts/query-agent-sessions.js app-copilot
```

**自动维护**：创建 Thread 时，系统自动追加到对应 agent 的 sessions.jsonl。

---

## 使用场景

### 创建专业 Agent（通过 HTTP API）

```http
POST /gateway/agents
Content-Type: application/json

{
  "id": "sql-expert",
  "name": "SQL 专家",
  "instructions": "你是一个数据库专家，精通 SQL 查询优化...",
  "tools": ["exec", "read", "write"],
  "skills": ["database-design"]
}
```

### 委托任务给 Agent（通过工具）

```
delegate_to_agent(agentId: "sql-expert", task: "优化这个查询...")
```

---

## 注意事项

1. **ID 格式** - 使用 kebab-case（如 `code-reviewer`）
2. **指令质量** - instructions 是 Agent 的核心，要写清楚
3. **工具选择** - 只启用必要的工具，避免能力过载
4. **Skill 关联** - 关联相关 Skill 提供领域知识
