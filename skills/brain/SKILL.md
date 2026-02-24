---
name: brain
description: 智库经验复用系统。完成任务后将解决方案发布到智库，遇到问题时优先搜索已有方案。所有 Agent 必须主动维护和使用智库，实现知识积累与复用。Use when: (1) completing a task and want to store the experience, (2) encountering a problem and searching for proven solutions, (3) looking up past implementation details or evolution history.
---

# 智库（Brain）- 经验复用与方案积累

> **用途**: 发布和复用解决方案经验，实现 Agent 之间的知识共享

---

## 何时使用

当你需要：

- **发布经验**: 完成一个任务后，沉淀经验供未来复用
- **搜索方案**: 遇到问题时，查找是否有已验证的解决方案
- **复用知识**: 获取完整的实现细节和演进过程

---

## HTTP API 端点

**基础 URL**: `http://localhost:42043`

所有 API 调用使用 `exec` 工具 + `curl` 命令。

---

### 1. 发布经验包

**用途**: 将解决方案经验发布到智库

**端点**: `POST /api/brain/publish`

**请求格式**:

```json
{
  "message_id": "msg_<timestamp>_<random>",
  "timestamp": "<ISO8601>",
  "payload": {
    "pattern": {
      "type": "Pattern",
      "schema_version": "1.0.0",
      "name": "方案名称",
      "summary": "简短描述（10字以上）",
      "category": "repair|optimize|innovate",
      "signals": ["触发信号1", "触发信号2"],
      "contexts": ["适用场景1", "适用场景2"],
      "strategy": "解决策略详细说明"
    },
    "practice": {
      "type": "Practice",
      "schema_version": "1.0.0",
      "name": "实践案例名称",
      "summary": "简短描述（20字以上）",
      "content": "完整的实现方案（代码、配置、步骤等）",
      "triggers": ["触发信号1"],
      "confidence": 0.85,
      "success_streak": 5,
      "impact": {
        "files": 2,
        "lines": 50
      },
      "outcome": {
        "status": "success",
        "score": 0.85
      },
      "environment": {
        "platform": "darwin|linux|win32"
      }
    },
    "evolution": {
      "type": "Evolution",
      "schema_version": "1.0.0",
      "intent": "repair|optimize|innovate",
      "attempts": [
        {
          "approach": "尝试的方法",
          "result": "success|failure",
          "reason": "成功或失败的原因"
        }
      ],
      "outcome": {
        "status": "success",
        "score": 0.85,
        "final_choice": "最终选择的方案",
        "reason": "为什么选择这个方案"
      },
      "mutations_tried": 3
    }
  }
}
```

**使用示例**:

```python
import json
import subprocess
from datetime import datetime

def publish_to_brain(pattern, practice, evolution=None):
    """发布经验包到智库"""
    payload = {
        "message_id": f"msg_{int(datetime.utcnow().timestamp())}",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "payload": {
            "pattern": pattern,
            "practice": practice
        }
    }

    if evolution:
        payload["payload"]["evolution"] = evolution

    # 写入临时文件
    with open('/tmp/brain_publish.json', 'w') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    # 发送请求
    result = subprocess.run([
        'curl', '-X', 'POST',
        'http://localhost:42043/api/brain/publish',
        '-H', 'Content-Type: application/json',
        '-d', f'@/tmp/brain_publish.json'
    ], capture_output=True, text=True)

    return json.loads(result.stdout)

# 示例使用
pattern = {
    "type": "Pattern",
    "schema_version": "1.0.0",
    "name": "http-timeout-retry",
    "summary": "HTTP 超时时使用指数退避重试",
    "category": "repair",
    "signals": ["TimeoutError", "ETIMEDOUT"],
    "contexts": ["当 API 调用超时时"],
    "strategy": "使用指数退避重试机制：首次重试间隔 1 秒，之后每次翻倍，最多重试 3-5 次"
}

practice = {
    "type": "Practice",
    "schema_version": "1.0.0",
    "name": "aws-api-retry-implementation",
    "summary": "在 AWS API 上实现 HTTP 超时重试，成功率提升至 85%",
    "content": "完整的实现方案...",
    "triggers": ["TimeoutError"],
    "confidence": 0.85,
    "success_streak": 12,
    "impact": {"files": 1, "lines": 25},
    "outcome": {"status": "success", "score": 0.85},
    "environment": {"platform": "linux"}
}

result = publish_to_brain(pattern, practice)
print(f"Published: {result['data']['package_id']}")
```

---

### 2. 搜索经验包

**用途**: 根据触发信号或类别搜索经验包

**端点**: `POST /api/brain/search`

**请求格式**:

```json
{
  "message_id": "msg_xxx",
  "timestamp": "<ISO8601>",
  "payload": {
    "signals": ["触发信号1", "触发信号2"],
    "category": "repair", // 可选
    "status": "promoted", // 可选
    "limit": 10
  }
}
```

**使用示例**:

```python
def search_brain(signals, category=None, limit=10):
    """搜索经验包"""
    payload = {
        "message_id": f"msg_{int(datetime.utcnow().timestamp())}",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "payload": {
            "signals": signals,
            "limit": limit
        }
    }

    if category:
        payload["payload"]["category"] = category

    with open('/tmp/brain_search.json', 'w') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    result = subprocess.run([
        'curl', '-X', 'POST',
        'http://localhost:42043/api/brain/search',
        '-H', 'Content-Type: application/json',
        '-d', '@/tmp/brain_search.json'
    ], capture_output=True, text=True)

    return json.loads(result.stdout)

# 示例使用
result = search_brain(["TimeoutError"], category="repair")
for pkg in result['data']['packages']:
    print(f"- {pkg['pattern']['name']}: {pkg['practice']['summary']}")
```

---

### 3. 获取完整经验包

**用途**: 获取经验包的完整内容（包括代码、配置等）

**端点**: `POST /api/brain/fetch`

**请求格式**:

```json
{
  "message_id": "msg_xxx",
  "timestamp": "<ISO8601>",
  "payload": {
    "package_id": "pkg_abc123def456"
  }
}
```

**使用示例**:

```python
def fetch_package(package_id):
    """获取完整经验包"""
    payload = {
        "message_id": f"msg_{int(datetime.utcnow().timestamp())}",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "payload": {
            "package_id": package_id
        }
    }

    with open('/tmp/brain_fetch.json', 'w') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    result = subprocess.run([
        'curl', '-X', 'POST',
        'http://localhost:42043/api/brain/fetch',
        '-H', 'Content-Type: application/json',
        '-d', '@/tmp/brain_fetch.json'
    ], capture_output=True, text=True)

    return json.loads(result.stdout)

# 示例使用
pkg = fetch_package("pkg_abc123def456")
print(f"Content: {pkg['data']['package']['practice']['content']}")
```

---

## 辅助脚本

智库提供了辅助脚本简化使用：

### 发布脚本

**位置**: `skills/brain/scripts/publish.py`

**使用**:

```bash
# 通过 JSON 文件发布
python skills/brain/scripts/publish.py --file my_experience.json

# 通过参数发布
python skills/brain/scripts/publish.py \
  --pattern-name "http-timeout-retry" \
  --pattern-summary "HTTP 超时重试" \
  --practice-name "aws-implementation" \
  --practice-content "完整实现..."
```

### 搜索脚本

**位置**: `skills/brain/scripts/search.py`

**使用**:

```bash
# 按信号搜索
python skills/brain/scripts/search.py --signals "TimeoutError" "ETIMEDOUT"

# 按类别搜索
python skills/brain/scripts/search.py --category repair --limit 20
```

---

## 数据结构详解

### Pattern（方案模板）

解决问题的策略和方法论。

**必需字段**:

- `name`: 方案名称
- `summary`: 简短描述
- `category`: repair（修复）| optimize（优化）| innovate（创新）
- `signals`: 触发信号列表
- `strategy`: 解决策略

### Practice（实践案例）

具体的实现和效果。

**必需字段**:

- `name`: 案例名称
- `summary`: 简短描述
- `content`: 完整内容（**关键**：包含代码、配置、步骤）
- `confidence`: 置信度（0-1）
- `outcome`: 实际效果

### Evolution（演进记录）

解决过程和经验（可选但推荐）。

**必需字段**:

- `attempts`: 尝试记录列表
- `outcome`: 最终结果和选择理由

---

## 最佳实践

### 1. 何时发布经验包

- ✅ 成功解决了一个问题
- ✅ 方案可以复用到类似场景
- ✅ 有明确的触发信号
- ✅ 效果可以量化（confidence, success_rate）

### 2. 如何编写高质量的 Practice

**好的 Practice**:

````markdown
## 问题

API 调用频繁超时（TimeoutError）

## 解决方案

使用指数退避重试机制

## 实现代码

```python
async def retry_fetch(url, max_retries=3):
    delay = 1
    for i in range(max_retries):
        try:
            return await fetch(url, timeout=5)
        except TimeoutError:
            if i == max_retries - 1:
                raise
            await sleep(delay)
            delay *= 2
```
````

## 效果

- 成功率从 55% 提升到 85%
- 平均响应时间 2.3 秒

````

### 3. 搜索策略

1. **先按信号搜索**：最精准
2. **再按类别过滤**：缩小范围
3. **查看 confidence**：选择最可靠的方案

---

## 注意事项

1. **启动 Worker**: Brain Worker 必须先启动才能使用
   ```bash
   # 查看 Worker 状态
   # （通过前端 Settings 页面查看）

   # 如果未启动，通过 Gateway 启动
   gateway.call('worker.start', { name: 'brain' })
````

2. **数据持久化**: 所有数据存储在 `.home/brain/` 目录

3. **避免重复**: 相同的 Pattern + Practice 会生成相同的 package_id

4. **内容完整**: Practice 的 `content` 字段应该包含完整的实现细节

---

## 示例：完整工作流

```python
# 1. 遇到问题
error = "TimeoutError: Request timeout after 30s"

# 2. 搜索是否有解决方案
result = search_brain(["TimeoutError"])

if result['data']['packages']:
    # 3. 找到方案，获取详情
    pkg = fetch_package(result['data']['packages'][0]['package_id'])
    solution = pkg['data']['package']['practice']['content']
    print(f"找到方案: {solution}")
else:
    # 4. 没有方案，自己解决并发布
    # ... 解决问题 ...
    # 发布经验
    publish_to_brain(pattern, practice, evolution)
```

---

**技能版本**: v1.0.0  
**最后更新**: 2026-02-23
