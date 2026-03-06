# Agent Session Index 设计

## 概述

为了方便查询某个 Agent 的所有会话，系统在每个 Agent 的 Home 目录下维护一个 `sessions.jsonl` 索引文件。

**存储位置**: `.home/homes/{agentId}/sessions.jsonl`  
**文件格式**: JSONL（每行一条 JSON 记录）

---

## 设计原则

### 1. 极简设计

只存储两个字段：

- `id` - Thread ID（也是 session ID）
- `createdAt` - 创建时间（ISO 8601 格式）

```jsonl
{"id":"283557218403819520","createdAt":"2026-02-21T11:15:09.105Z"}
{"id":"283557235642408960","createdAt":"2026-02-21T11:15:13.215Z"}
{"id":"283559123590914048","createdAt":"2026-02-21T11:22:43.337Z"}
```

**为什么不存储 title？**

- title 可能变化，存储会导致同步问题
- 需要 title 时，通过 ThreadStore.get(id) 查询完整信息

### 2. 追加式写入

- 创建 thread 时，使用 `fs.appendFileSync()` 追加新行
- 不需要读取-修改-写入，性能高，线程安全
- 按创建时间自然排序（早的在前，晚的在后）

### 3. 不处理删除

- 不记录 thread 删除事件
- 索引中可能包含已删除的 thread ID
- 查询时，通过检查 thread 文件是否存在来过滤

**理由**：

- 系统不提供删除功能（thread 只会归档，不会真正删除）
- 即使删除，保留历史记录也有价值
- 避免复杂的同步逻辑

---

## 实现架构

### 自动追加机制

```
用户创建 Thread
    ↓
ThreadStore.create()
    ↓
1. 生成 Snowflake ID
    ↓
2. 写入 .home/threads/{id}.json
    ↓
3. 更新内存索引
    ↓
4. 创建 workspace 目录
    ↓
5. 追加到 homes/{agentId}/sessions.jsonl ← 新增
    ↓
6. 触发 thread:created 事件
```

### 核心代码

```typescript
// ThreadStore.ts
private async appendToAgentSessionIndex(
  agentId: string,
  entry: { id: string; createdAt: string }
): Promise<void> {
  const homeDir = path.join(Env.paths.homesDir, agentId);

  // 确保目录存在
  if (!fs.existsSync(homeDir)) {
    fs.mkdirSync(homeDir, { recursive: true });
  }

  const indexPath = path.join(homeDir, 'sessions.jsonl');
  const line = JSON.stringify(entry) + '\n';

  // 追加模式
  fs.appendFileSync(indexPath, line, 'utf-8');
}
```

---

## 查询方法

### 1. 代码查询

```typescript
// AgentHomeManager.ts
const manager = new AgentHomeManager(Env.paths.homesDir);
const sessions = manager.readSessionIndex('app-copilot');
// 返回: [{ id: string, createdAt: string }, ...]
```

### 2. HTTP API 查询

```bash
GET /gateway/agents/:id/home/sessions
```

响应：

```json
{
  "agentId": "app-copilot",
  "sessions": [
    { "id": "283557218403819520", "createdAt": "2026-02-21T11:15:09.105Z" },
    { "id": "283557235642408960", "createdAt": "2026-02-21T11:15:13.215Z" }
  ],
  "count": 119
}
```

### 3. 命令行查询

```bash
# 列出所有 agent 及其 session 数量
node scripts/list-agent-homes.js

# 查询某个 agent 的详细 sessions
node scripts/query-agent-sessions.js app-copilot

# 直接查看文件
cat .home/homes/app-copilot/sessions.jsonl
```

---

## 初始化

首次部署时，需要从现有 threads 生成初始索引：

```bash
node scripts/init-agent-session-index.js
```

该脚本会：

1. 扫描 `.home/threads/` 目录下的所有 thread 文件
2. 按 agentId 分组
3. 为每个 agent 生成 `sessions.jsonl` 文件
4. 按创建时间排序

---

## 使用场景

### 场景 1：快速查看某个 agent 的历史会话

```bash
$ node scripts/query-agent-sessions.js app-copilot

=== Agent: app-copilot ===

总计: 119 个 sessions

最近 10 个 sessions:
  286353850618945536 - 2026/3/1 12:27:58
  286463390425358336 - 2026/3/1 19:43:14
  ...
```

### 场景 2：统计 agent 使用情况

```bash
$ node scripts/list-agent-homes.js

Agent                          Sessions  Index
─────────────────────────────  ────────  ─────
app-copilot                         119  ✓
default                              13  ✓
task-analyzer                         4  ✓
...
```

### 场景 3：Agent 自我查询历史会话

Agent 可以通过读取自己的 sessions.jsonl 来了解历史会话：

```typescript
// 在 Agent 运行时
const sessions = read('homes/{agentId}/sessions.jsonl');
// 分析历史会话模式、频率等
```

---

## 性能特点

| 操作          | 性能 | 说明                         |
| ------------- | ---- | ---------------------------- |
| 创建 thread   | O(1) | 追加一行，无需读取           |
| 查询 sessions | O(n) | n = 该 agent 的 session 数量 |
| 统计数量      | O(1) | 只需读文件 + 数行数          |
| 磁盘占用      | 极低 | 每条记录约 70 字节           |

**示例**：app-copilot 有 119 个 sessions，文件大小仅 7.9 KB。

---

## 一致性保障

### 正常流程

ThreadStore.create() 在同一个事务中完成：

1. 写入 thread.json
2. 更新内存索引
3. 追加到 sessions.jsonl

如果步骤 3 失败，只记录警告，不阻塞主流程。

### 异常恢复

如果索引丢失或不一致，运行初始化脚本重建：

```bash
node scripts/init-agent-session-index.js
```

---

## 与现有系统的关系

| 系统组件                         | 存储内容                                        | 用途                      |
| -------------------------------- | ----------------------------------------------- | ------------------------- |
| `threads/{id}.json`              | Thread 元数据（title, status, messageCount 等） | 会话列表、状态管理        |
| `workspaces/{id}/`               | 实际对话内容、上下文、事件                      | Agent 执行环境            |
| `homes/{agentId}/sessions.jsonl` | 该 agent 的 session ID 索引                     | 快速查询 agent 的所有会话 |

**关系**：

- sessions.jsonl 是 threads/ 的反向索引
- 提供从 agent 视角的查询入口
- 轻量级，不存储冗余数据

---

## 文件示例

```bash
$ cat .home/homes/task-analyzer/sessions.jsonl
{"id":"284713812575461376","createdAt":"2026-02-24T15:51:02.644Z"}
{"id":"284937084130893824","createdAt":"2026-02-25T06:38:14.731Z"}
{"id":"285813053020512256","createdAt":"2026-02-27T16:39:01.989Z"}
{"id":"287259338697154560","createdAt":"2026-03-03T16:26:03.365Z"}
```

每行一个 JSON 对象，格式固定，便于解析和追加。
