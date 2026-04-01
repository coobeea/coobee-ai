---
name: brain
description: 智库经验复用系统。完成任务后将解决方案发布到智库，遇到工具报错、执行失败时记录失败教训，搜索问题时查找已有方案或已知陷阱。所有 Agent 必须主动维护和使用智库，实现知识积累与复用。Use when: (1) completing a task and want to store the experience, (2) encountering tool errors, execution failures, or wrong approaches, (3) searching for proven solutions or known failure cases, (4) looking up past implementation details or evolution history.
---

# 智库（Brain）- 经验复用与方案积累

> **用途**: 发布和复用解决方案经验（成功与失败），实现 Agent 之间的知识共享，避免重复犯错

---

## 何时使用

当你需要：

- **发布成功经验**: 完成一个任务后，沉淀经验供未来复用
- **记录失败教训**: 遇到错误、工具报错、执行失败时，记录失败原因和避坑指南
- **搜索方案**: 遇到问题时，查找是否有已验证的解决方案或已知的失败案例
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

#### ✅ 成功案例（推荐发布）

- 成功解决了一个问题
- 方案可以复用到类似场景
- 有明确的触发信号
- 效果可以量化（confidence, success_rate）

#### ⚠️ 失败案例（同样重要！）

- **工具执行失败**: 工具调用报错、超时、权限不足
- **方案选择错误**: 尝试了错误的解决路径，浪费时间
- **环境问题**: 依赖缺失、版本不兼容、配置冲突
- **已知陷阱**: 容易犯的错误、常见的误区

**失败案例的价值**：

- 避免其他 Agent 重复犯错
- 快速识别"此路不通"
- 加速问题诊断（排除法）
- 建立完整的知识图谱

### 2. 如何编写高质量的 Practice

#### ✅ 成功案例示例

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

## 效果

- 成功率从 55% 提升到 85%
- 平均响应时间 2.3 秒
````

#### ⚠️ 失败案例示例

````markdown
## 问题

尝试使用 `exec` 工具执行 `sudo` 命令时报错

## 错误信息

```
Error: sudo requires a terminal for authentication
Exit code: 1
```

## 尝试的方案（失败）

1. ❌ `sudo -S` + 密码输入：`exec` 工具不支持交互式输入
2. ❌ `echo password | sudo`：安全风险，且在沙箱环境被禁止
3. ❌ 修改 sudoers 文件：需要 root 权限，形成死锁

## 正确的解决方案

- 方案A：让用户在启动时配置 sudoers（NOPASSWD）
- 方案B：使用非 sudo 的替代方案
- 方案C：通过 approval 机制让用户手动执行

## 避坑指南

- `exec` 工具运行在非交互式 shell，无法使用 `sudo`
- 不要尝试在代码中处理密码，永远都是安全风险
- 优先寻找不需要 root 权限的替代方案

## 适用信号

- "sudo: no tty present"
- "sudo requires a terminal"
- "Permission denied" + 尝试使用 sudo
````

### 3. 记录失败案例的要点

#### 关键字段设置

当记录失败案例时，注意以下字段：

```json
{
  "practice": {
    "confidence": 0.0, // 失败案例置信度为 0
    "success_streak": 0, // 成功次数为 0
    "outcome": {
      "status": "failure", // 明确标记为失败
      "score": 0.0,
      "details": "详细的失败原因和错误信息"
    }
  },
  "evolution": {
    "attempts": [
      {
        "approach": "尝试的方法",
        "result": "failure", // 标记为失败
        "reason": "失败原因：工具不支持交互式输入",
        "error_message": "原始错误信息",
        "time_wasted": "5 minutes" // 浪费的时间
      }
    ],
    "outcome": {
      "status": "failure",
      "lessons_learned": "从失败中学到的经验"
    }
  }
}
```

#### 失败案例的 signals

失败案例的 signals 应该包含：

- 错误消息的关键词（如 "TimeoutError", "EACCES"）
- 工具名称（如 "exec", "file_edit"）
- 失败的操作类型（如 "sudo", "interactive-input"）

#### category 选择

- `repair`: 修复类失败（环境问题、配置错误）
- `innovate`: 创新类失败（尝试新方法但不可行）

### 4. 搜索策略

1. **先按信号搜索**：最精准
2. **再按类别过滤**：缩小范围
3. **查看 confidence 和 status**：
   - `confidence > 0.7` + `status: success` → 可靠的成功方案
   - `confidence = 0` + `status: failure` → 已知的失败陷阱
4. **优先排除失败方案**：先看失败案例，避免重复犯错

---

## 注意事项

1. **启动 Worker**: Brain Worker 必须先启动才能使用

   ```bash
   # 查看 Worker 状态
   # （通过前端 Settings 页面查看）

   # 如果未启动，通过 Gateway 启动
   gateway.call('worker.start', { name: 'brain' })
   ```

````

2. **数据持久化**: 所有数据存储在 `.home/brain/` 目录

3. **避免重复**: 相同的 Pattern + Practice 会生成相同的 package_id

4. **内容完整**: Practice 的 `content` 字段应该包含完整的实现细节

5. **失败案例同样重要**:
   - ⚠️ 不要只记录成功，失败教训更有价值
   - ⚠️ 工具报错、执行失败、方案错误都应该记录
   - ⚠️ 设置 `confidence: 0` 和 `status: failure` 标记失败案例
   - ⚠️ 详细记录失败原因和避坑指南
   - ✅ 帮助其他 Agent 快速排除错误方案，节省时间

6. **搜索时注意区分**:
   - 成功方案：`confidence > 0.7` + `status: success` → 可以直接应用
   - 失败案例：`confidence = 0` + `status: failure` → 避免尝试

---

## 示例：完整工作流

### 场景1：遇到问题，查找方案

```python
# 1. 遇到问题
error = "TimeoutError: Request timeout after 30s"

# 2. 搜索是否有解决方案或失败案例
result = search_brain(["TimeoutError"])

if result['data']['packages']:
    for pkg in result['data']['packages']:
        # 3. 检查是成功方案还是失败案例
        if pkg['practice']['outcome']['status'] == 'failure':
            print(f"⚠️ 已知失败方案: {pkg['pattern']['name']}")
            print(f"   不要尝试: {pkg['practice']['content']}")
        else:
            print(f"✅ 可用方案: {pkg['pattern']['name']}")
            # 获取详情并应用
            pkg_detail = fetch_package(pkg['package_id'])
            solution = pkg_detail['data']['package']['practice']['content']
            print(f"   方案内容: {solution}")
else:
    # 4. 没有方案，自己解决并发布
    # ... 解决问题 ...
    publish_to_brain(pattern, practice, evolution)
```

### 场景2：工具执行失败，记录失败案例

```python
# 1. 尝试执行工具
try:
    result = exec_tool("sudo apt update")
except ToolExecutionError as e:
    # 2. 捕获失败信息
    error_msg = str(e)  # "sudo: no tty present"

    # 3. 搜索是否已知失败
    result = search_brain(["sudo", "no tty"])

    if not result['data']['packages']:
        # 4. 未知失败，记录到智库
        pattern = {
            "name": "exec-tool-sudo-no-tty",
            "summary": "exec工具不支持sudo命令（无交互式终端）",
            "category": "repair",
            "signals": ["sudo", "no tty", "requires a terminal"],
            "contexts": ["使用exec工具", "需要root权限"],
            "strategy": "避免使用sudo，寻找替代方案或使用approval机制"
        }

        practice = {
            "name": "exec-sudo-failure",
            "summary": "尝试在exec工具中使用sudo导致失败",
            "content": f"""
## 错误信息
{error_msg}

## 失败原因
exec工具运行在非交互式shell，无法处理sudo的密码提示

## 避免此错误
1. 不要在exec中使用sudo
2. 使用不需要root权限的替代方案
3. 让用户手动执行需要sudo的命令
            """,
            "triggers": ["sudo", "no tty"],
            "confidence": 0.0,  # 失败案例
            "success_streak": 0,
            "outcome": {
                "status": "failure",
                "score": 0.0,
                "details": error_msg
            }
        }

        evolution = {
            "intent": "repair",
            "attempts": [{
                "approach": "直接使用exec执行sudo命令",
                "result": "failure",
                "reason": "工具不支持交互式输入",
                "error_message": error_msg
            }],
            "outcome": {
                "status": "failure",
                "lessons_learned": "exec工具限制：无法使用需要交互的命令"
            }
        }

        # 5. 发布失败案例到智库
        publish_to_brain(pattern, practice, evolution)
        print("✅ 失败案例已记录到智库，避免其他Agent重复犯错")
    else:
        # 5. 已知失败，跳过此方案
        print("⚠️ 此方案已知失败，尝试其他方法")
```

---

**技能版本**: v1.1.0
**最后更新**: 2026-04-01
**更新内容**: 新增失败案例记录功能，支持记录工具报错、执行失败、方案错误等失败教训
````
