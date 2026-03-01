---
name: cron-manager
description: 定时任务管理系统。通过 Gateway HTTP API 创建、查询、更新、删除定时任务，支持暂停/恢复、立即触发、查看执行历史。Use when: (1) user asks to create a scheduled/recurring task, (2) querying or listing existing cron jobs, (3) pausing/resuming/deleting a cron job, (4) checking cron job execution history, (5) troubleshooting a failed cron job.
---

# Cron Manager Skill - 定时任务管理

> **用途**: 管理系统中的定时任务（Cron Jobs）：创建、查询、更新、删除、触发

---

## 何时使用

当你需要：

- **创建定时任务**：用户说"每天早上9点汇总进度"、"每小时检查服务状态"等
- **查看任务**：列出已有的定时任务、检查任务状态
- **管理任务**：暂停、恢复、删除、立即触发某个任务
- **排查问题**：查看任务执行历史、定位失败原因

---

## HTTP API 端点

**基础 URL**: `http://localhost:8765/gateway/cron-jobs`

> 端口默认 8765，可通过 `VITE_SERVER_PORT` 环境变量修改。

所有 API 调用使用 `exec` 工具 + `curl` 命令。

---

### 1. 查询任务列表

**用途**: 获取所有定时任务

**端点**: `GET /gateway/cron-jobs`

**使用示例**:

```bash
curl -s http://localhost:8765/gateway/cron-jobs | python3 -m json.tool
```

**响应格式**:

```json
{
  "jobs": [
    {
      "id": "abc123",
      "name": "每日进度汇总",
      "description": "每天早上自动汇总项目进度",
      "cronExpression": "0 9 * * *",
      "status": "active",
      "agentId": "app-copilot",
      "task": "请汇总今天的项目进度",
      "runCount": 15,
      "failCount": 0,
      "lastRunAt": "2026-02-22T01:00:00.000Z",
      "createdAt": "2026-02-01T00:00:00.000Z"
    }
  ]
}
```

---

### 2. 获取单个任务详情

**用途**: 查看某个任务的完整信息

**端点**: `GET /gateway/cron-jobs/{id}`

**使用示例**:

```bash
curl -s http://localhost:8765/gateway/cron-jobs/abc123 | python3 -m json.tool
```

---

### 3. 创建定时任务

**用途**: 创建一个新的定时任务

**端点**: `POST /gateway/cron-jobs`

**必需字段**:

| 字段             | 类型   | 说明                                     |
| ---------------- | ------ | ---------------------------------------- |
| `name`           | string | 任务名称（简短，4-10 字）                |
| `description`    | string | 任务详细描述                             |
| `cronExpression` | string | 标准 cron 表达式（5 位：分 时 日 月 周） |
| `task`           | string | 智能体收到的具体指令                     |

**可选字段**:

| 字段       | 类型   | 说明                                      |
| ---------- | ------ | ----------------------------------------- |
| `agentId`  | string | 执行任务的智能体 ID（默认 `app-copilot`） |
| `status`   | string | 初始状态：`active`（默认）或 `paused`     |
| `metadata` | object | 扩展元数据                                |

**使用示例**:

```bash
curl -s -X POST http://localhost:8765/gateway/cron-jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "每日进度汇总",
    "description": "每天早上9点自动汇总项目进度并生成报告",
    "cronExpression": "0 9 * * *",
    "task": "请汇总今天的项目进度，整理成报告格式输出",
    "agentId": "app-copilot"
  }' | python3 -m json.tool
```

**常用 Cron 表达式参考**:

| 表达式         | 含义               |
| -------------- | ------------------ |
| `0 9 * * *`    | 每天上午 9:00      |
| `0 9 * * 1`    | 每周一上午 9:00    |
| `0 9 * * 1-5`  | 工作日上午 9:00    |
| `0 */2 * * *`  | 每 2 小时          |
| `*/30 * * * *` | 每 30 分钟         |
| `0 9,18 * * *` | 每天 9:00 和 18:00 |
| `0 0 1 * *`    | 每月 1 号 0:00     |

**响应**（201 Created）:

```json
{
  "job": {
    "id": "generated-id",
    "name": "每日进度汇总",
    "status": "active",
    ...
  }
}
```

> 创建时 `status` 为 `active` 的任务会自动开始调度。

---

### 4. 更新定时任务

**用途**: 修改已有任务的参数

**端点**: `PATCH /gateway/cron-jobs/{id}`

**可更新字段**（所有字段均为可选）:

- `name` - 任务名称
- `description` - 任务描述
- `cronExpression` - cron 表达式
- `task` - 执行指令
- `agentId` - 智能体 ID
- `status` - 状态（`active` / `paused` / `disabled`）

**使用示例**:

```bash
# 修改执行频率
curl -s -X PATCH http://localhost:8765/gateway/cron-jobs/abc123 \
  -H 'Content-Type: application/json' \
  -d '{"cronExpression": "0 */4 * * *"}' | python3 -m json.tool

# 暂停任务
curl -s -X PATCH http://localhost:8765/gateway/cron-jobs/abc123 \
  -H 'Content-Type: application/json' \
  -d '{"status": "paused"}' | python3 -m json.tool

# 恢复任务
curl -s -X PATCH http://localhost:8765/gateway/cron-jobs/abc123 \
  -H 'Content-Type: application/json' \
  -d '{"status": "active"}' | python3 -m json.tool
```

---

### 5. 删除定时任务

**用途**: 永久删除一个定时任务

**端点**: `DELETE /gateway/cron-jobs/{id}`

**使用示例**:

```bash
curl -s -X DELETE http://localhost:8765/gateway/cron-jobs/abc123
```

> 删除前会自动取消调度。返回 204 No Content 表示成功。

---

### 6. 立即触发任务

**用途**: 手动立即执行一次任务（不影响正常调度）

**端点**: `POST /gateway/cron-jobs/{id}/trigger`

**使用示例**:

```bash
curl -s -X POST http://localhost:8765/gateway/cron-jobs/abc123/trigger | python3 -m json.tool
```

**响应**:

```json
{
  "success": true
}
```

---

### 7. 查看执行历史

**用途**: 获取某个任务的执行记录

**端点**: `GET /gateway/cron-jobs/{id}/executions`

**Query 参数**:

- `limit`（可选）：返回条数（默认 10）

**使用示例**:

```bash
curl -s 'http://localhost:8765/gateway/cron-jobs/abc123/executions?limit=5' | python3 -m json.tool
```

**响应格式**:

```json
{
  "executions": [
    {
      "id": "exec_001",
      "jobId": "abc123",
      "startedAt": "2026-02-22T01:00:00.000Z",
      "endedAt": "2026-02-22T01:00:15.000Z",
      "status": "success",
      "result": "项目进度汇总完成..."
    },
    {
      "id": "exec_002",
      "jobId": "abc123",
      "startedAt": "2026-02-21T01:00:00.000Z",
      "endedAt": "2026-02-21T01:00:05.000Z",
      "status": "failed",
      "error": "连接超时"
    }
  ]
}
```

---

## 任务状态说明

| 状态       | 含义                            |
| ---------- | ------------------------------- |
| `active`   | 正常运行，按 cron 表达式触发    |
| `paused`   | 暂停中，不会触发                |
| `disabled` | 已禁用（连续失败 3 次自动禁用） |
| `error`    | 错误（cron 表达式无效等）       |

**状态流转**:

```
active ←→ paused     (手动切换)
active  → disabled   (连续失败 ≥3 次自动禁用)
disabled → active    (手动恢复)
error   → active     (修正后手动恢复)
```

---

## 执行机制

- 每个定时任务触发时，系统会驱动指定的**智能体**（Agent）执行
- 如果未指定 `agentId`，默认使用 `app-copilot`（应用管家）
- 每次执行创建独立的会话（session），互不干扰
- 连续失败 3 次，任务自动禁用，需手动恢复

---

## 典型工作流

### 场景 1：用户要求创建定时任务

```python
import subprocess
import json

def create_cron_job(name, description, cron_expr, task, agent_id="app-copilot"):
    """创建定时任务"""
    payload = {
        "name": name,
        "description": description,
        "cronExpression": cron_expr,
        "task": task,
        "agentId": agent_id
    }

    result = subprocess.run([
        'curl', '-s', '-X', 'POST',
        'http://localhost:8765/gateway/cron-jobs',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps(payload, ensure_ascii=False)
    ], capture_output=True, text=True)

    return json.loads(result.stdout)

# 示例
result = create_cron_job(
    name="每日进度汇总",
    description="每天早上9点自动汇总项目进度并生成报告",
    cron_expr="0 9 * * *",
    task="请汇总今天的项目进度，整理成报告格式输出"
)
print(f"创建成功: {result['job']['id']}")
```

### 场景 2：查看并管理已有任务

```python
import subprocess
import json

def list_cron_jobs():
    """列出所有定时任务"""
    result = subprocess.run([
        'curl', '-s',
        'http://localhost:8765/gateway/cron-jobs'
    ], capture_output=True, text=True)
    return json.loads(result.stdout)

def toggle_job(job_id, new_status):
    """切换任务状态"""
    result = subprocess.run([
        'curl', '-s', '-X', 'PATCH',
        f'http://localhost:8765/gateway/cron-jobs/{job_id}',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps({"status": new_status})
    ], capture_output=True, text=True)
    return json.loads(result.stdout)

# 列出任务
jobs = list_cron_jobs()
for job in jobs.get('jobs', []):
    print(f"[{job['status']}] {job['name']} - {job['cronExpression']}")

# 暂停某任务
toggle_job("abc123", "paused")
```

### 场景 3：排查失败任务

```python
import subprocess
import json

def check_job_health(job_id):
    """检查任务健康状况"""
    # 获取任务详情
    r1 = subprocess.run([
        'curl', '-s',
        f'http://localhost:8765/gateway/cron-jobs/{job_id}'
    ], capture_output=True, text=True)
    job = json.loads(r1.stdout).get('job', {})

    print(f"任务: {job['name']}")
    print(f"状态: {job['status']}")
    print(f"成功: {job['runCount']} 次, 失败: {job['failCount']} 次")

    if job.get('lastError'):
        print(f"最后错误: {job['lastError']}")

    # 获取最近执行记录
    r2 = subprocess.run([
        'curl', '-s',
        f'http://localhost:8765/gateway/cron-jobs/{job_id}/executions?limit=3'
    ], capture_output=True, text=True)
    executions = json.loads(r2.stdout).get('executions', [])

    for exe in executions:
        status_icon = "✓" if exe['status'] == 'success' else "✗"
        print(f"  {status_icon} {exe['startedAt']} - {exe.get('error', exe.get('result', ''))[:50]}")
```

---

## 数据持久化

定时任务数据存储在 `.home/cron/` 目录：

```
.home/cron/
├── jobs/
│   ├── {job_id}.json        # 任务定义
│   └── ...
└── executions/
    ├── {job_id}/
    │   ├── {exec_id}.json   # 执行记录
    │   └── ...
    └── ...
```

---

## 注意事项

1. **Cron 表达式验证**：系统会验证 cron 表达式的合法性，无效表达式会导致任务状态变为 `error`
2. **自动禁用**：连续失败 3 次的任务会被自动禁用，需要手动排查问题后恢复
3. **智能体选择**：选择与任务类型匹配的智能体可以提高执行质量
4. **并发控制**：同一任务不会并发执行（上一次未结束时不会再次触发）
5. **时区**：Cron 表达式基于服务器本地时区

---

**技能版本**: v1.0.0
**最后更新**: 2026-03-01
