# Coobee AI 工具清单

> **日期**: 2026-02-22  
> **位置**: `src/main/ai/tools/builtin/`  
> **总数**: 19 个内置工具

---

## 📊 工具分类

### 1. 文件操作（3 个）

| 工具      | 功能     | 风险等级 | 说明                         |
| --------- | -------- | -------- | ---------------------------- |
| **read**  | 读取文件 | 🟢 低    | 只读操作，支持路径和内容读取 |
| **write** | 写入文件 | 🟡 中    | 创建或覆盖文件               |
| **edit**  | 编辑文件 | 🟡 中    | 精确字符串替换               |

### 2. 执行控制（2 个）

| 工具        | 功能     | 风险等级 | 说明                     |
| ----------- | -------- | -------- | ------------------------ |
| **exec**    | 执行命令 | 🔴 高    | Shell 命令执行           |
| **process** | 进程管理 | 🟡 中    | 后台进程启动、停止、查询 |

### 3. 搜索与发现（3 个）

| 工具           | 功能       | 风险等级 | 说明                     |
| -------------- | ---------- | -------- | ------------------------ |
| **search**     | 内容搜索   | 🟢 低    | 基于正则的文件内容搜索   |
| **glob**       | 文件名搜索 | 🟢 低    | 基于 glob 模式的文件查找 |
| **skill_list** | Skill 发现 | 🟢 低    | 列出可用的 Skill 技能    |

### 4. 记忆系统（1 个）

| 工具       | 功能     | 风险等级 | 说明                   |
| ---------- | -------- | -------- | ---------------------- |
| **memory** | 记忆管理 | 🟢 低    | 存储/查询/删除长期记忆 |

### 5. 可观测性（3 个）

| 工具                | 功能       | 风险等级 | 说明                       |
| ------------------- | ---------- | -------- | -------------------------- |
| **session_status**  | 会话状态   | 🟢 低    | 当前会话状态、配置、上下文 |
| **session_history** | 对话历史   | 🟢 低    | 查看历史对话消息           |
| **context_inspect** | 上下文查看 | 🟢 低    | 检查当前上下文窗口使用情况 |

### 6. 配置管理（2 个）

| 工具             | 功能     | 风险等级 | 说明                                 |
| ---------------- | -------- | -------- | ------------------------------------ |
| **config_get**   | 查看配置 | 🟢 低    | 读取应用配置                         |
| **config_patch** | 修改配置 | 🟡 中    | 修改应用配置（如沙箱模式、模型设置） |

### 7. Agent 管理（3 个）

| 工具                  | 功能       | 风险等级 | 说明                      |
| --------------------- | ---------- | -------- | ------------------------- |
| **manage_agent**      | Agent CRUD | 🟡 中    | 创建/更新/删除 Agent 定义 |
| **manage_skill**      | Skill CRUD | 🟡 中    | 创建/更新/删除 Skill 技能 |
| **delegate_to_agent** | 委托任务   | 🟡 中    | 委托子任务给专业 Agent    |

### 8. 任务管理（2 个）

| 工具           | 功能      | 风险等级 | 说明             |
| -------------- | --------- | -------- | ---------------- |
| **task_plan**  | 任务计划  | 🟢 低    | 长期任务计划管理 |
| **todo_write** | TODO 管理 | 🟢 低    | 会话级 TODO 列表 |

---

## 📈 工具统计

| 分类       | 数量   | 占比     |
| ---------- | ------ | -------- |
| 文件操作   | 3      | 15.8%    |
| 执行控制   | 2      | 10.5%    |
| 搜索与发现 | 3      | 15.8%    |
| 记忆系统   | 1      | 5.3%     |
| 可观测性   | 3      | 15.8%    |
| 配置管理   | 2      | 10.5%    |
| Agent 管理 | 3      | 15.8%    |
| 任务管理   | 2      | 10.5%    |
| **总计**   | **19** | **100%** |

### 风险等级分布

| 风险等级  | 数量 | 占比  |
| --------- | ---- | ----- |
| 🟢 低风险 | 11   | 57.9% |
| 🟡 中风险 | 7    | 36.8% |
| 🔴 高风险 | 1    | 5.3%  |

---

## 🎯 工具能力矩阵

### Agent 能做什么？

使用这 19 个工具，Agent 可以：

| 能力域       | 具体能力                           |
| ------------ | ---------------------------------- |
| **文件系统** | 读取、写入、编辑、搜索文件         |
| **代码执行** | 运行 Shell 命令、管理后台进程      |
| **知识管理** | 存储/查询长期记忆                  |
| **自我管理** | 查看自身状态、配置、上下文使用情况 |
| **协作能力** | 创建专业 Agent、委托子任务         |
| **技能扩展** | 创建/管理 Skill 技能               |
| **任务规划** | 制定计划、管理 TODO                |

---

## 🚀 Agent 创建 Worker 工作流

### 方案：使用现有工具组合

Agent 可以通过组合使用现有工具来创建 Worker：

#### 第 1 步：创建 Worker 目录结构

```typescript
// 使用 exec 工具创建目录
exec: mkdir -p workers/my-new-worker
```

#### 第 2 步：创建 worker.json

```typescript
// 使用 write 工具
write: {
  path: "workers/my-new-worker/worker.json",
  content: JSON.stringify({
    name: "my-new-worker",
    label: "新 Worker",
    type: "native",
    entry: "server.py",
    port: 18300
  }, null, 2)
}
```

#### 第 3 步：创建 requirements.txt

```typescript
// 使用 write 工具
write: {
  path: "workers/my-new-worker/requirements.txt",
  content: `# Worker 依赖
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
websockets>=14.0
`
}
```

#### 第 4 步：创建 server.py

```typescript
// 使用 write 工具
write: {
  path: "workers/my-new-worker/server.py",
  content: `#!/usr/bin/env python3
"""新 Worker 服务"""
from fastapi import FastAPI
import uvicorn

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18300)
    args = parser.parse_args()

    uvicorn.run(app, host="127.0.0.1", port=args.port)
`
}
```

#### 第 5 步：创建虚拟环境（可选）

```typescript
// 使用 exec 工具
exec: cd /path/to/coobee-ai && ./runtime/macos-arm64/uv venv workers/my-new-worker/venv
exec: cd /path/to/coobee-ai && ./runtime/macos-arm64/uv pip install -r workers/my-new-worker/requirements.txt --python workers/my-new-worker/venv/bin/python
```

#### 第 6 步：测试 Worker

```typescript
// 使用 process 工具启动后台进程
process: {
  action: "start",
  command: "workers/my-new-worker/venv/bin/python",
  args: ["workers/my-new-worker/server.py", "--port", "18300"]
}

// 使用 exec 工具测试健康检查
exec: sleep 5 && curl -s http://127.0.0.1:18300/health
```

---

## 🤖 Agent 创建 Worker 的完整示例

### 伪代码流程

```python
async def agent_create_worker(name: str, spec: WorkerSpec):
    """Agent 创建新 Worker 的流程"""

    # 1. 验证名称
    if await tool_call("glob", f"workers/{name}"):
        return "Worker 已存在"

    # 2. 创建目录
    await tool_call("exec", f"mkdir -p workers/{name}")

    # 3. 生成配置文件
    worker_json = generate_worker_config(name, spec)
    await tool_call("write", f"workers/{name}/worker.json", worker_json)

    # 4. 生成依赖文件
    requirements = generate_requirements(spec.dependencies)
    await tool_call("write", f"workers/{name}/requirements.txt", requirements)

    # 5. 生成服务代码
    server_code = generate_server_code(name, spec)
    await tool_call("write", f"workers/{name}/server.py", server_code)

    # 6. 创建虚拟环境
    await tool_call("exec", f"./runtime/macos-arm64/uv venv workers/{name}/venv")
    await tool_call("exec", f"./runtime/macos-arm64/uv pip install -r workers/{name}/requirements.txt --python workers/{name}/venv/bin/python")

    # 7. 测试启动
    process_id = await tool_call("process", {
        "action": "start",
        "command": f"workers/{name}/venv/bin/python",
        "args": [f"workers/{name}/server.py", "--port", spec.port]
    })

    # 8. 健康检查
    await tool_call("exec", f"sleep 5 && curl http://127.0.0.1:{spec.port}/health")

    # 9. 记录到记忆
    await tool_call("memory", {
        "action": "save",
        "key": f"worker.{name}",
        "content": f"创建于 {datetime.now()}, 功能: {spec.description}"
    })

    return f"✅ Worker '{name}' 创建成功"
```

---

## 🛠️ 需要新增的工具？

### 当前工具是否足够？

**✅ 基本足够**：使用现有工具组合可以实现 Worker 创建。

**💡 可选优化**：为提升效率，可考虑新增专用工具：

#### 方案 A：新增 `manage_worker` 工具

```typescript
{
  name: "manage_worker",
  description: "管理 Worker（创建/更新/删除/列表）",
  parameters: {
    action: "create" | "update" | "delete" | "list",
    name: string,
    config?: WorkerConfig,
    code?: string,
    dependencies?: string[]
  }
}
```

**优势**：

- 一次工具调用完成所有步骤
- 自动处理虚拟环境
- 内置健康检查和验证
- 统一错误处理

#### 方案 B：保持现状（推荐）

使用现有工具组合，优势：

- ✅ 灵活性高，Agent 可自主决策
- ✅ 无需新增工具，降低维护成本
- ✅ 符合"工具正交性"原则
- ✅ 透明度高，用户可见每一步

---

## 📋 Agent 创建 Worker 检查清单

当 Agent 需要创建新 Worker 时，应遵循以下步骤：

### 准备阶段

- [ ] 明确 Worker 需求（功能、接口、依赖）
- [ ] 确定 Worker 名称（唯一标识）
- [ ] 选择可用端口（18xxx）
- [ ] 确认模型路径（如需本地模型）

### 创建阶段

- [ ] 使用 `exec` 创建目录
- [ ] 使用 `write` 创建 `worker.json`
- [ ] 使用 `write` 创建 `requirements.txt`
- [ ] 使用 `write` 创建 `server.py`
- [ ] 使用 `exec` 创建虚拟环境（使用 uv）
- [ ] 使用 `exec` 安装依赖

### 验证阶段

- [ ] 使用 `process` 启动 Worker
- [ ] 使用 `exec` 测试健康检查
- [ ] 使用 `read` 查看日志（如有错误）
- [ ] 使用 `process` 停止测试进程

### 记录阶段

- [ ] 使用 `memory` 记录 Worker 信息
- [ ] 使用 `write` 创建 README（可选）
- [ ] 使用 `exec` 提交代码（git add/commit）

---

## 🎓 Agent 创建 Worker 的关键约定

### 1. 目录结构约定

```plaintext
workers/{name}/
├── worker.json         ← 必需：Worker 配置
├── requirements.txt    ← 必需：Python 依赖
├── server.py           ← 必需：入口文件
└── venv/               ← 必需：就地虚拟环境
```

### 2. worker.json 模板

```json
{
  "name": "{worker_name}",
  "label": "{显示名称}",
  "type": "native",
  "entry": "server.py",
  "port": 18xxx,
  "enabled": true
}
```

### 3. server.py 最小模板

```python
#!/usr/bin/env python3
from fastapi import FastAPI
import uvicorn
import argparse

app = FastAPI(title="{Worker Name}", version="0.1.0")

@app.get("/health")
async def health():
    return {"status": "ok"}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18xxx)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port)

if __name__ == "__main__":
    main()
```

### 4. requirements.txt 基础模板

```txt
# HTTP + WebSocket 服务
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
websockets>=14.0

# 添加业务依赖...
```

---

## 💡 实战示例：Agent 创建 Markdown Worker

假设用户说："帮我创建一个 Markdown 格式化 Worker"

### Agent 执行流程

```
1. [glob] 检查 workers/markdown-formatter 是否存在
   → 不存在，继续

2. [exec] mkdir -p workers/markdown-formatter

3. [write] workers/markdown-formatter/worker.json
   {
     "name": "markdown-formatter",
     "label": "Markdown 格式化",
     "type": "native",
     "entry": "server.py",
     "port": 18300
   }

4. [write] workers/markdown-formatter/requirements.txt
   fastapi>=0.115.0
   uvicorn[standard]>=0.32.0
   markdown-it-py>=3.0.0

5. [write] workers/markdown-formatter/server.py
   （完整的 FastAPI 服务代码）

6. [exec] ./runtime/macos-arm64/uv venv workers/markdown-formatter/venv

7. [exec] ./runtime/macos-arm64/uv pip install -r workers/markdown-formatter/requirements.txt --python workers/markdown-formatter/venv/bin/python

8. [process] 启动测试
   start workers/markdown-formatter/venv/bin/python workers/markdown-formatter/server.py --port 18300

9. [exec] 健康检查
   curl http://127.0.0.1:18300/health

10. [process] 停止测试
    stop <process_id>

11. [memory] 记录
    save worker.markdown-formatter "Markdown 格式化 Worker，端口 18300"

12. ✅ 完成，通知用户
```

---

## 🔮 未来扩展建议

### 1. 新增 `manage_worker` 工具（高优先级）

**理由**：

- 简化 Agent 操作（11 步 → 1 步）
- 内置最佳实践（端口冲突检测、依赖校验）
- 统一错误处理
- 自动健康检查

**接口设计**：

```typescript
interface ManageWorkerTool {
  action: 'create' | 'update' | 'delete' | 'list' | 'restart';
  name: string;
  spec?: {
    label: string;
    port: number;
    dependencies: string[];
    code: string; // server.py 内容
    modelName?: string;
  };
}
```

### 2. Worker 模板库

在 `workers/templates/` 目录提供常见模板：

- `basic-http/` - 基础 HTTP Worker
- `websocket/` - WebSocket Worker
- `ml-model/` - 机器学习模型 Worker
- `data-processor/` - 数据处理 Worker

Agent 可以：

```typescript
// 1. 列出模板
glob("workers/templates/*")

// 2. 读取模板
read("workers/templates/ml-model/server.py")

// 3. 复制并修改
exec("cp -r workers/templates/ml-model workers/my-worker")
edit("workers/my-worker/worker.json", ...)
```

### 3. Worker 生成器 Skill

创建一个专门的 Skill：`worker-creator`

```markdown
# Worker Creator Skill

当 Agent 需要创建新 Worker 时：

1. 分析需求（功能、接口、依赖）
2. 选择模板（或从零开始）
3. 生成代码（使用 LLM 代码生成）
4. 创建文件（worker.json + requirements.txt + server.py）
5. 安装环境（使用 uv）
6. 测试验证（健康检查 + 功能测试）
7. 记录文档（README.md）
```

---

## 📚 参考资料

- **Worker 约定**: `workers/CONVENTIONS.md`
- **虚拟环境**: `docs/worker-venv-in-place.md`
- **现有 Worker**: `workers/asr/`, `workers/tts/`, `workers/ocr/`
- **Extension 系统**: 可通过 Extension 注册新工具

---

**总结**：

- 🎯 **当前工具**: 19 个，覆盖文件、执行、搜索、记忆、Agent 管理等
- 🚀 **创建 Worker**: 使用现有工具组合可实现（11 步流程）
- 💡 **优化方向**: 可新增 `manage_worker` 专用工具简化操作
