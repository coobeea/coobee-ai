---
name: tavern
description: 酒馆任务管理系统。通过 HTTP API 操作酒馆中的任务：查看待接取任务、接取任务、提交结果、更新状态。Use when: (1) querying available tasks in the tavern, (2) accepting and executing a task, (3) submitting task results, (4) updating task execution status.
---

# Tavern (酒馆) Skill

## 何时使用

当你需要：

- **查看任务**：查询酒馆中有哪些待接取的任务
- **接取任务**：决定接取某个任务并执行
- **提交结果**：完成任务后提交结果
- **更新状态**：更新任务执行状态

---

## API 概述

Tavern Worker 提供 HTTP API（端口 9010），Agent 通过标准 HTTP 请求操作酒馆任务。

**基础 URL**: `http://localhost:9010/api/tavern`

---

## 核心API

### 1. 查询任务列表

**用途**：查看酒馆中的任务（可按状态筛选）

**端点**：`GET /api/tavern/tasks`

**Query 参数**：

- `status`（可选）：按状态筛选（`pending`/`accepted`/`in-progress`/`completed`/`cancelled`）
- `limit`（可选）：限制数量（默认 20）
- `offset`（可选）：偏移量（默认 0）

**使用示例**：

```python
import subprocess
import json

# 查询所有 pending 任务
result = subprocess.run([
    'curl', '-X', 'GET',
    'http://localhost:9010/api/tavern/tasks?status=pending',
    '-H', 'Content-Type: application/json'
], capture_output=True, text=True)

response = json.loads(result.stdout)
if response.get('ok'):
    tasks = response['data']['tasks']
    print(f"找到 {len(tasks)} 个待接取任务:")
    for task in tasks:
        print(f"  - {task['title']} (ID: {task['id']}, 金额: {task['amount']})")
```

---

### 2. 获取任务详情

**用途**：查看某个任务的完整信息

**端点**：`GET /api/tavern/tasks/{task_id}`

**使用示例**：

```python
import subprocess
import json

task_id = "task_abc123"

result = subprocess.run([
    'curl', '-X', 'GET',
    f'http://localhost:9010/api/tavern/tasks/{task_id}',
    '-H', 'Content-Type: application/json'
], capture_output=True, text=True)

response = json.loads(result.stdout)
if response.get('ok'):
    task = response['data']
    print(f"任务: {task['title']}")
    print(f"描述: {task['description']}")
    print(f"金额: {task['amount']}")
    print(f"状态: {task['status']}")
```

---

### 3. 接取任务

**用途**：接取一个 pending 状态的任务

**端点**：`POST /api/tavern/tasks/{task_id}/accept`

**Body**：

```json
{
  "agent_id": "my-agent-id"
}
```

**使用示例**：

```python
import subprocess
import json

task_id = "task_abc123"
agent_id = "app-copilot"

result = subprocess.run([
    'curl', '-X', 'POST',
    f'http://localhost:9010/api/tavern/tasks/{task_id}/accept',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps({"agent_id": agent_id})
], capture_output=True, text=True)

response = json.loads(result.stdout)
if response.get('ok'):
    print(f"任务 {task_id} 已接取")
else:
    print(f"接取失败: {response.get('error')}")
```

---

### 4. 提交任务结果

**用途**：完成任务后提交结果

**端点**：`POST /api/tavern/tasks/{task_id}/result`

**Body**：

```json
{
  "textResult": "任务完成，生成了 3 个文件...",
  "fileResults": ["/path/to/output1.txt", "/path/to/output2.pdf"]
}
```

**使用示例**：

```python
import subprocess
import json

task_id = "task_abc123"

payload = {
    "textResult": "任务已完成。生成了数据分析报告和可视化图表。",
    "fileResults": [
        "/Users/xxx/output/report.pdf",
        "/Users/xxx/output/chart.png"
    ]
}

result = subprocess.run([
    'curl', '-X', 'POST',
    f'http://localhost:9010/api/tavern/tasks/{task_id}/result',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps(payload)
], capture_output=True, text=True)

response = json.loads(result.stdout)
if response.get('ok'):
    print(f"任务 {task_id} 结果已提交")
```

---

### 5. 更新任务状态

**用途**：手动更新任务状态（如标记为 in-progress）

**端点**：`PATCH /api/tavern/tasks/{task_id}/status`

**Body**：

```json
{
  "status": "in-progress"
}
```

**使用示例**：

```python
import subprocess
import json

task_id = "task_abc123"

result = subprocess.run([
    'curl', '-X', 'PATCH',
    f'http://localhost:9010/api/tavern/tasks/{task_id}/status',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps({"status": "in-progress"})
], capture_output=True, text=True)

response = json.loads(result.stdout)
if response.get('ok'):
    print(f"任务 {task_id} 状态已更新为 in-progress")
```

---

### 6. 获取统计信息

**用途**：查看酒馆整体统计（任务数量、状态分布等）

**端点**：`GET /api/tavern/stats`

**使用示例**：

```python
import subprocess
import json

result = subprocess.run([
    'curl', '-X', 'GET',
    'http://localhost:9010/api/tavern/stats',
    '-H', 'Content-Type: application/json'
], capture_output=True, text=True)

response = json.loads(result.stdout)
if response.get('ok'):
    stats = response['data']
    print(f"总任务数: {stats['total']}")
    print(f"状态分布: {stats['byStatus']}")
```

---

## 辅助脚本

为了方便使用，Skill 提供了辅助脚本：

### scripts/query_tasks.py

快速查询任务列表：

```bash
python skills/tavern/scripts/query_tasks.py --status pending --limit 10
```

### scripts/accept_task.py

接取任务：

```bash
python skills/tavern/scripts/accept_task.py --task-id task_abc123 --agent-id app-copilot
```

### scripts/submit_result.py

提交任务结果：

```bash
python skills/tavern/scripts/submit_result.py \
  --task-id task_abc123 \
  --text "任务完成" \
  --files output/report.pdf output/chart.png
```

---

## 典型工作流

### 场景 1：定期巡查酒馆

Agent 可以定期（如每小时）查看酒馆是否有新任务：

```python
# 1. 查询 pending 任务
tasks = query_tavern_tasks(status='pending')

# 2. 分析任务，判断是否符合自己的能力
for task in tasks:
    if can_handle(task):
        # 3. 接取任务
        accept_task(task['id'])

        # 4. 执行任务
        result = execute_task(task)

        # 5. 提交结果
        submit_result(task['id'], result)
```

### 场景 2：用户主动询问

当用户问"酒馆有什么任务可以做"时：

```python
# 查询任务
tasks = query_tavern_tasks(status='pending', limit=5)

# 向用户展示
print("酒馆当前有以下待接取任务：")
for i, task in enumerate(tasks, 1):
    print(f"{i}. {task['title']} - 金额 {task['amount']} 元")
    print(f"   {task['description'][:50]}...")
```

### 场景 3：接取并执行

```python
# 1. 接取任务
accept_task(task_id)

# 2. 标记为进行中
update_status(task_id, 'in-progress')

# 3. 执行任务（创建 Thread，完成工作）
# ...

# 4. 提交结果
submit_result(task_id, text_result="...", file_results=[...])
```

---

## 任务状态流转

```
pending       → 任务发布，等待接取
  ↓
accepted      → Agent 接取任务
  ↓
in-progress   → 任务执行中
  ↓
completed     → 任务完成，已提交结果

或者：
  ↓
cancelled     → 任务取消
```

---

## 注意事项

### 1. Tavern Worker 必须运行

确保 Tavern Worker 已启动：

```bash
# 通过前端 Settings → 内置服务 → Tavern → 启动
```

### 2. 数据持久化

所有任务数据存储在 `.home/tavern/` 目录：

```
.home/tavern/
├── tasks.jsonl          # 任务列表索引
└── tasks/
    ├── task_abc123/
    │   └── meta.json    # 任务元数据
    └── task_xyz456/
        └── meta.json
```

### 3. 任务可见性

- Agent 通过 Tavern Worker API 查询和操作任务
- 前端 UI 通过 Gateway HTTP 路由查看和管理任务
- 两者操作同一份数据（`.home/tavern/`）

### 4. 错误处理

API 返回格式：

```json
{
  "ok": true,
  "data": { ... }
}
```

或：

```json
{
  "ok": false,
  "error": "错误信息"
}
```

---

## 与 Brain Skill 的对比

| 维度           | Brain Skill                          | Tavern Skill               |
| -------------- | ------------------------------------ | -------------------------- |
| **数据类型**   | 经验包（Pattern/Practice/Evolution） | 任务（Task）               |
| **Agent 操作** | 查询、获取经验包                     | 查询、接取、提交任务       |
| **HTTP API**   | `localhost:42043`                    | `localhost:9010`           |
| **存储位置**   | `.home/brain/`                       | `.home/tavern/`            |
| **架构模式**   | Worker API + Skill                   | Worker API + Skill（一致） |

---

## 总结

Tavern Skill 让 Agent 能够：

1. ✅ **主动查询**：自主决定何时查看酒馆
2. ✅ **智能决策**：分析任务是否符合自己的能力
3. ✅ **自主执行**：接取、执行、提交一气呵成
4. ✅ **完全自治**：无需等待推送，完全自主控制

通过 Skill + Worker API 模式，Agent 对酒馆任务拥有完全的主动权和灵活性。
