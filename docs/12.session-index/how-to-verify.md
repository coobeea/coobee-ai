# 如何验证 sessions.jsonl 功能

本文档说明如何验证 Agent Session Index 功能是否正常工作。

---

## 方法 1：查看现有索引

查看某个 agent 的 sessions.jsonl 文件：

```bash
# 直接查看文件
cat .home/homes/app-copilot/sessions.jsonl

# 使用查询脚本
node scripts/query-agent-sessions.js app-copilot

# 统计所有 agent
node scripts/list-agent-homes.js
```

**预期结果**：能看到该 agent 的所有 session ID 和创建时间。

---

## 方法 2：创建新 thread 测试自动追加

### 准备

确保应用正在运行：

```bash
pnpm dev
```

### 测试步骤

#### 2.1 记录当前数量

```bash
# 查看当前 app-copilot 的 session 数量
wc -l .home/homes/app-copilot/sessions.jsonl
# 假设输出: 119
```

#### 2.2 创建新 thread

使用 HTTP API 创建：

```bash
curl -X POST http://localhost:3789/gateway/threads \
  -H "Content-Type: application/json" \
  -d '{
    "title": "测试自动追加",
    "agentId": "app-copilot"
  }'
```

或使用测试脚本：

```bash
node scripts/test-create-thread.js
```

#### 2.3 验证索引更新

```bash
# 再次查看数量
wc -l .home/homes/app-copilot/sessions.jsonl
# 应该输出: 120（增加了 1）

# 查看最后一行
tail -1 .home/homes/app-copilot/sessions.jsonl
# 应该看到刚创建的 thread ID
```

**预期结果**：

- sessions.jsonl 文件增加一行
- 新增的行包含刚创建的 thread ID 和创建时间
- 格式正确：`{"id":"...","createdAt":"..."}`

---

## 方法 3：通过 HTTP API 查询

```bash
# 查询 app-copilot 的所有 sessions
curl http://localhost:3789/gateway/agents/app-copilot/home/sessions
```

**预期响应**：

```json
{
  "agentId": "app-copilot",
  "sessions": [
    {"id":"283557218403819520","createdAt":"2026-02-21T11:15:09.105Z"},
    {"id":"283557235642408960","createdAt":"2026-02-21T11:15:13.215Z"},
    ...
  ],
  "count": 119
}
```

---

## 初始化现有数据

如果是首次部署或索引丢失，需要初始化：

```bash
node scripts/init-agent-session-index.js
```

**预期输出**：

```
=== 初始化 Agent Home sessions.jsonl 索引 ===

1. 扫描 threads 目录...
   ✓ 找到 146 个 thread 文件

2. 按 agent 分组...
   ✓ 找到 7 个 agent

3. 生成 sessions.jsonl 文件...
   ✓ app-copilot: 119 条记录
   ✓ task-analyzer: 4 条记录
   ...

✅ 初始化完成！
```

---

## 常见问题

### Q: sessions.jsonl 不存在怎么办？

A: 运行初始化脚本：`node scripts/init-agent-session-index.js`

### Q: 数量不匹配怎么办？

A: 重新运行初始化脚本，会覆盖现有文件并重建索引。

### Q: 如何清空某个 agent 的索引？

A: 直接删除文件：`rm .home/homes/{agentId}/sessions.jsonl`，下次创建 thread 时会自动重建。

---

## 性能验证

```bash
# 测试大量 sessions 的查询性能
time node scripts/query-agent-sessions.js app-copilot

# 预期: < 100ms（119 条记录）
```
