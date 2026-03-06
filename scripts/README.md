# Scripts 目录

这个目录包含各种实用脚本，用于管理和维护 coobee-ai 系统。

---

## Agent Session Index 管理

### init-agent-session-index.js

**用途**：从现有 threads 生成初始的 sessions.jsonl 索引

**使用场景**：

- 首次部署时初始化索引
- 索引丢失后重建
- 迁移数据后同步

**用法**：

```bash
node scripts/init-agent-session-index.js
```

**输出示例**：

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

### list-agent-homes.js

**用途**：列出所有 agent 及其 session 数量统计

**用法**：

```bash
node scripts/list-agent-homes.js
```

**输出示例**：

```
=== Agent Homes 统计 ===

总计: 16 个 agents

Agent                          Sessions  Index
─────────────────────────────  ────────  ─────
app-copilot                         119  ✓
default                              13  ✓
task-analyzer                         4  ✓
business-analyst                      0  ✗
...
```

**说明**：

- Sessions: 该 agent 的会话数量
- Index: ✓ = 有索引文件，✗ = 无索引文件

---

### query-agent-sessions.js

**用途**：查询某个 agent 的详细 session 列表

**用法**：

```bash
node scripts/query-agent-sessions.js <agent-id>
```

**示例**：

```bash
# 查询 app-copilot 的所有 sessions
node scripts/query-agent-sessions.js app-copilot

# 查询 task-analyzer 的所有 sessions
node scripts/query-agent-sessions.js task-analyzer
```

**输出示例**：

```
=== Agent: app-copilot ===

总计: 119 个 sessions

最近 10 个 sessions:
  286353850618945536 - 2026/3/1 12:27:58
  286463390425358336 - 2026/3/1 19:43:14
  ...

最早的 session:
  283557218403819520 - 2026/2/21 19:15:09

最新的 session:
  288000153685925888 - 2026/3/6 01:29:47
```

---

## 其他脚本

### test-api.ts

API 功能测试脚本（用于手动测试各个 API 端点）。

### verify-commit.js

Git commit message 格式校验脚本（pre-commit hook 使用）。

### generate-icons.js

图标生成脚本（构建时使用）。
