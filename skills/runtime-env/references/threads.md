# 会话线程 (Threads)

## 概述

Thread（会话线程）记录用户与 Agent 之间的对话会话。

**存储位置**: `{userHome}/threads/`  
**文件格式**: 每个 Thread 一个 JSON 文件（`{threadId}.json`）

---

## 数据结构

```json
{
  "id": "1234567890123456789", // Snowflake ID（天然有序）
  "title": "帮我审查代码", // 显示标题
  "agentId": "code-reviewer", // 关联的 Agent ID
  "status": "active", // 状态：active | archived | deleted
  "messageCount": 12, // 消息数量
  "createdAt": "2025-01-01T...", // 创建时间
  "updatedAt": "2025-01-01T..." // 最后更新时间
}
```

---

## 关键设计

| 特性          | 说明                                                         |
| ------------- | ------------------------------------------------------------ |
| ID 生成       | 使用 Snowflake 算法，天然有序，按 ID 降序 = 按时间降序       |
| 持久化        | 每个线程一个 JSON 文件，应用重启后保留                       |
| 与 Agent 绑定 | 每个 Thread 通过 `agentId` 关联到一个智能体                  |
| 管理方式      | HTTP REST API（`/gateway/threads/*`）— GET/POST/PATCH/DELETE |

---

## Thread 状态

| 状态       | 说明             |
| ---------- | ---------------- |
| `active`   | 活跃中           |
| `archived` | 已归档（不活跃） |
| `deleted`  | 已删除           |

---

## 与工作空间的关系

**Thread** 是用户可见的"会话列表"概念，而 **workspace** 是 Agent 执行时的文件系统隔离区域。

```
Thread.id → 对应 → workspace sessionId
```

一般情况下，Thread 的 `id` 对应 workspace 的 `sessionId`。

---

## 使用场景

Thread 主要由前端管理，Agent 一般不需要直接操作 Thread 数据。

如果需要了解当前会话信息：

- 查看 `<session>` 块中的 `sessionId`
- 查看 `<session>` 块中的 `workspace` 路径
