---
name: shared-drive
description: 多智能体共享网盘系统。通过 HTTP API 存取跨智能体共享数据：创建条目、上传文件、查询其他智能体产出、搜索。Use when: (1) saving task outputs for other agents, (2) querying another agent's work results, (3) sharing data/files across agents, (4) searching shared knowledge.
---

# SharedDrive (共享网盘) Skill

## 何时使用

当你需要：

- **保存产出**：完成任务后将重要数据存入共享网盘，供其他智能体使用
- **查询数据**：查看其他智能体共享的工作成果和数据
- **跨智能体协作**：通过共享网盘传递文件和信息
- **搜索知识**：在共享网盘中按关键词搜索

---

## API 概述

SharedDrive 通过 Gateway HTTP API 提供服务。

**基础 URL**: `http://localhost:8765/gateway/shared-drive`

> 端口号取决于应用配置（默认 8765）。

---

## 目录规范

共享网盘采用三级目录结构，所有智能体写入时**必须遵守**：

```
{agentId}/{date}/{topic}/
├── README.md          ← 必须存在，描述条目内容
├── content.md         ← 主内容文件（API 自动创建）
└── ...                ← 其他数据文件
```

### 命名规则

- **agentId**：智能体 ID（如 `researcher`、`app-copilot`）
- **date**：`YYYY-MM-DD` 格式
- **topic**：小写英文 + 连字符（如 `market-analysis`、`weekly-report`）

---

## 核心 API

### 1. 创建条目

**用途**：将数据写入共享网盘

**端点**：`POST /gateway/shared-drive/entries`

**Body**：

```json
{
  "agentId": "researcher",
  "topic": "market-analysis",
  "content": "## 市场分析报告\n\n...",
  "tags": ["market", "analysis"],
  "summary": "2026年Q1市场趋势分析"
}
```

**使用示例**：

```python
import subprocess, json

result = subprocess.run([
    'curl', '-s', '-X', 'POST',
    'http://localhost:8765/gateway/shared-drive/entries',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps({
        "agentId": "researcher",
        "topic": "market-analysis",
        "content": "## 市场分析报告\n\n今年Q1市场整体向好...",
        "tags": ["market", "q1"],
        "summary": "2026年Q1市场趋势分析"
    })
], capture_output=True, text=True)

response = json.loads(result.stdout)
entry = response.get('entry')
print(f"Created entry: {entry['id']} at {entry['path']}")
```

---

### 2. 查询条目列表

**用途**：按条件查询共享网盘中的条目

**端点**：`GET /gateway/shared-drive/entries`

**Query 参数**：

- `agentId`（可选）：按智能体筛选
- `date`（可选）：按日期筛选（`YYYY-MM-DD`）
- `keyword`（可选）：按关键词搜索
- `limit`（可选）：限制数量（默认 50）
- `offset`（可选）：偏移量

**使用示例**：

```python
import subprocess, json

# 查询某个智能体的所有产出
result = subprocess.run([
    'curl', '-s', '-X', 'GET',
    'http://localhost:8765/gateway/shared-drive/entries?agentId=researcher&limit=10',
    '-H', 'Content-Type: application/json'
], capture_output=True, text=True)

response = json.loads(result.stdout)
entries = response.get('entries', [])
print(f"Found {len(entries)} entries:")
for e in entries:
    print(f"  - [{e['date']}] {e['topic']} (tags: {e['tags']})")
```

---

### 3. 获取条目详情

**用途**：查看某个条目的完整信息

**端点**：`GET /gateway/shared-drive/entries/{entry_id}`

**返回**：条目元数据 + README.md 内容 + 文件列表

**使用示例**：

```python
import subprocess, json

entry_id = "abc123xyz"
result = subprocess.run([
    'curl', '-s', '-X', 'GET',
    f'http://localhost:8765/gateway/shared-drive/entries/{entry_id}',
    '-H', 'Content-Type: application/json'
], capture_output=True, text=True)

response = json.loads(result.stdout)
print(f"Topic: {response['entry']['topic']}")
print(f"README:\n{response['readme']}")
print(f"Files: {response['files']}")
```

---

### 4. 更新条目

**用途**：更新已有条目的内容或标签

**端点**：`PUT /gateway/shared-drive/entries/{entry_id}`

**Body**（均可选）：

```json
{
  "content": "updated content...",
  "tags": ["new-tag"],
  "summary": "updated summary"
}
```

---

### 5. 删除条目

**端点**：`DELETE /gateway/shared-drive/entries/{entry_id}`

---

### 6. 上传文件到条目

**用途**：向已有条目添加附件文件

**端点**：`POST /gateway/shared-drive/entries/{entry_id}/files`

**Body**：

```json
{
  "filename": "data.csv",
  "content": "col1,col2\nval1,val2\n..."
}
```

---

### 7. 下载条目文件

**端点**：`GET /gateway/shared-drive/entries/{entry_id}/files/{filename}`

---

### 8. 搜索

**端点**：`GET /gateway/shared-drive/search?keyword=market`

---

### 9. 统计信息

**端点**：`GET /gateway/shared-drive/stats`

**返回**：

```json
{
  "total": 42,
  "byAgent": {
    "researcher": 15,
    "analyst": 12,
    "app-copilot": 15
  }
}
```

---

## 典型工作流

### 场景 1：完成任务后保存产出

```
1. 执行任务（如市场调研）
2. POST /gateway/shared-drive/entries 创建条目
3. POST /gateway/shared-drive/entries/{id}/files 上传附件（可选）
```

### 场景 2：参考其他智能体的工作

```
1. GET /gateway/shared-drive/entries?agentId=researcher 查看该智能体的产出
2. GET /gateway/shared-drive/entries/{id} 获取详情
3. 基于获取的数据继续自己的任务
```

### 场景 3：搜索共享知识

```
1. GET /gateway/shared-drive/search?keyword=market 搜索相关条目
2. 选择最相关的条目查看详情
```

---

## 注意事项

- **agentId 必须真实**：写入时使用你自己的 Agent ID，不要伪造
- **topic 必须有意义**：使用描述性的英文短语，如 `quarterly-report` 而非 `data1`
- **tags 便于发现**：添加有意义的标签，帮助其他智能体找到你的数据
- **summary 便于预览**：提供简洁的摘要，其他智能体可以快速判断是否需要详细查看
- **及时清理**：临时数据用完后可通过 DELETE 清理
