# Worker Creator Skill

**描述**: 指导 Agent 创建新的 Worker 子进程。使用现有工具组合完成目录创建、配置生成、虚拟环境搭建、依赖安装等全流程。

**使用时机**: 当用户要求创建新 Worker、添加新服务、集成新模型、或 Agent 判断需要新的后台能力时使用此 Skill。

---

## 🎯 核心原则

- ✅ **工具组合，而非新增工具** - 使用现有的 19 个 builtin tools
- ✅ **约定优于配置** - 遵循 `workers/CONVENTIONS.md` 的目录结构和命名规范
- ✅ **就地虚拟环境** - 虚拟环境放在 `workers/{name}/venv/`
- ✅ **使用 uv 工具** - 统一使用项目内置的 `uv` 创建环境和安装依赖
- ✅ **错误可恢复** - 每一步都需检查返回值，失败时清理现场

---

## 📋 Worker 创建流程（11 步）

### 准备阶段：需求分析

在开始创建前，先明确：

1. **功能定位**: Worker 的作用是什么？（如 ASR、TTS、OCR）
2. **接口设计**: HTTP 还是 WebSocket？有哪些端点？
3. **依赖列表**: 需要哪些 Python 包？（如 torch、transformers）
4. **模型路径**: 是否使用本地模型？路径在哪？
5. **端口分配**: 选择可用端口（18xxx 范围，避免冲突）
6. **Worker 名称**: kebab-case 命名（如 `my-worker`）

### 第 1 步：检查端口冲突

**工具**: `glob` + `read`

```typescript
// 1. 列出所有 Worker 配置
glob({ pattern: 'workers/*/worker.json' });

// 2. 读取配置，提取已用端口
read({ path: 'workers/asr/worker.json' }); // 示例
read({ path: 'workers/tts/worker.json' });
read({ path: 'workers/ocr/worker.json' });

// 3. 确保新端口不冲突
```

**输出**: 已用端口列表（如 `[18001, 18002, 18003]`）

### 第 2 步：创建 Worker 目录

**工具**: `exec`

```typescript
exec({
  command: 'mkdir -p workers/{name}'
});
```

**验证**: 检查命令返回值 `exit_code === 0`

### 第 3 步：生成 worker.json 配置

**工具**: `write`

```typescript
write({
  path: 'workers/{name}/worker.json',
  content: JSON.stringify(
    {
      name: '{name}',
      label: '{显示名称}',
      type: 'native',
      entry: 'server.py',
      port: { port },
      enabled: true
    },
    null,
    2
  )
});
```

**示例内容**:

```json
{
  "name": "my-worker",
  "label": "我的 Worker",
  "type": "native",
  "entry": "server.py",
  "port": 18300,
  "enabled": true
}
```

### 第 4 步：生成 requirements.txt 依赖文件

**工具**: `write`

```typescript
write({
  path: 'workers/{name}/requirements.txt',
  content: `# {显示名称} 依赖
# 由 WorkerManager 通过 uv pip install 安装到就地 venv

# FastAPI 框架（必需）
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
websockets>=14.0

# 业务依赖（根据需求添加）
${dependencies.join('\n')}
`
});
```

**示例内容**:

```txt
# 我的 Worker 依赖
# 由 WorkerManager 通过 uv pip install 安装到就地 venv

# FastAPI 框架（必需）
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
websockets>=14.0

# 业务依赖
torch>=2.0.0
transformers>=4.57.3
```

### 第 5 步：生成 server.py 服务代码

**工具**: `write`

**模板**: 参考 `workers/CONVENTIONS.md` 中的最小模板

```python
#!/usr/bin/env python3
"""
{显示名称} — Worker 服务

FastAPI + WebSocket 服务
由 WorkerManager 管理生命周期
"""

import argparse
import logging
import os
import sys

try:
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.responses import JSONResponse
    import uvicorn
except ImportError:
    print(f"[{name.upper()}] 缺少依赖，请先安装", file=sys.stderr)
    sys.exit(1)

# ==================== 配置 ====================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.environ.get("MODEL_DIR", "/Users/lifeng/data/models")

logging.basicConfig(level=logging.INFO, format=f"[{name.upper()}] %(message)s")
log = logging.getLogger("{name}")

app = FastAPI(title="{显示名称}", version="0.1.0")

# ==================== 全局状态 ====================

model_loaded = False

# ==================== HTTP 接口 ====================

@app.get("/health")
async def health():
    """健康检查（WorkerManager 轮询此接口判断是否就绪）"""
    return JSONResponse({
        "status": "ok",
        "model_loaded": model_loaded,
        "model_dir": MODEL_DIR,
    })

# TODO: 添加业务接口
# @app.post("/api/process")
# async def process(request: dict):
#     ...

# ==================== 启动 ====================

def main():
    parser = argparse.ArgumentParser(description="{显示名称} Server")
    parser.add_argument("--port", type=int, default={port})
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    log.info(f"启动服务 {args.host}:{args.port}")
    log.info(f"MODEL_DIR = {MODEL_DIR}")

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")

if __name__ == "__main__":
    main()
```

**关键点**:

- 必须有 `/health` 端点（WorkerManager 依赖此端点判断就绪）
- 支持 `--port` 和 `--host` 参数
- 日志格式统一使用 `[WORKER_NAME] message`

### 第 6 步：创建虚拟环境

**工具**: `exec`

```typescript
// 检测平台并选择 uv 路径
const platform = process.platform; // darwin, linux, win32
const arch = process.arch; // arm64, x64

// macOS arm64 示例
exec({
  command: './runtime/macos-arm64/uv venv workers/{name}/venv'
});
```

**平台适配**:

- macOS arm64: `./runtime/macos-arm64/uv`
- macOS x64: `./runtime/macos/uv`
- Linux x64: `./runtime/linux-x64/uv`
- Linux arm64: `./runtime/linux-arm64/uv`

**验证**: 检查 `workers/{name}/venv/bin/python` 是否存在

### 第 7 步：安装依赖

**工具**: `exec`

```typescript
exec({
  command:
    './runtime/macos-arm64/uv pip install -r workers/{name}/requirements.txt --python workers/{name}/venv/bin/python'
});
```

**注意**:

- 耗时较长（30-60s），需要设置合适的超时时间
- 可能需要网络连接下载包
- 失败时检查 stderr 输出错误信息

**常见错误**:

- 网络超时 → 重试或切换镜像源
- 依赖冲突 → 调整版本号
- 磁盘空间不足 → 清理缓存

### 第 8 步：验证 Python 语法

**工具**: `exec`

```typescript
exec({
  command: 'workers/{name}/venv/bin/python -m py_compile workers/{name}/server.py'
});
```

**作用**: 提前发现语法错误，避免运行时失败

### 第 9 步：启动测试（可选）

**工具**: `process` + `exec`

```typescript
// 1. 后台启动 Worker
process({
  action: 'start',
  name: '{name}-test',
  command: 'workers/{name}/venv/bin/python',
  args: ['workers/{name}/server.py', '--port', '{port}'],
  cwd: '/path/to/coobee-ai'
});

// 2. 等待启动
exec({ command: 'sleep 5' });

// 3. 健康检查
exec({ command: `curl -s http://127.0.0.1:{port}/health` });

// 4. 停止测试进程
process({
  action: 'stop',
  name: '{name}-test'
});
```

**可选理由**: Worker 会由 WorkerManager 自动启动，手动测试可能导致端口占用

### 第 10 步：记录到记忆（可选）

**工具**: `memory`

```typescript
memory({
  action: "save",
  key: `worker.{name}`,
  content: JSON.stringify({
    name: "{name}",
    label: "{显示名称}",
    port: {port},
    createdAt: new Date().toISOString(),
    purpose: "{功能描述}",
    dependencies: [...],
    modelName: "{模型名称}"
  })
})
```

**作用**: 方便后续查询和管理

### 第 11 步：创建文档（推荐）

**工具**: `write`

```typescript
write({
  path: 'workers/{name}/README.md',
  content: `# {显示名称}

## 功能

{详细描述 Worker 的功能、接口、使用场景}

## 接口

### HTTP

- \`GET /health\` - 健康检查

### WebSocket

- \`/ws/process\` - 流式处理（如有）

## 依赖

{列出关键依赖及其作用}

## 配置

- 端口: {port}
- 模型路径: \`MODEL_DIR\` 环境变量（由 WorkerManager 注入）

## 测试

\`\`\`bash
# 手动启动
workers/{name}/venv/bin/python workers/{name}/server.py --port {port}

# 健康检查
curl http://127.0.0.1:{port}/health
\`\`\`
`
});
```

---

## ✅ 成功标志

Worker 创建成功需满足：

1. ✅ 目录结构完整: `workers/{name}/` 包含 `worker.json`, `requirements.txt`, `server.py`, `venv/`
2. ✅ 配置文件合法: `worker.json` 格式正确，端口无冲突
3. ✅ 虚拟环境可用: `venv/bin/python` 可执行
4. ✅ 依赖安装完成: `uv pip install` 返回成功
5. ✅ 语法验证通过: `py_compile` 无错误
6. ✅ 健康检查响应: `/health` 返回 `{"status": "ok"}`

---

## 🛠️ 工具使用清单

| 步骤 | 工具    | 作用                  | 风险 |
| ---- | ------- | --------------------- | ---- |
| 1    | glob    | 列出已有 Worker       | 低   |
| 1    | read    | 读取配置检查端口冲突  | 低   |
| 2    | exec    | 创建目录              | 低   |
| 3    | write   | 生成 worker.json      | 中   |
| 4    | write   | 生成 requirements.txt | 中   |
| 5    | write   | 生成 server.py        | 中   |
| 6    | exec    | 创建虚拟环境（uv）    | 中   |
| 7    | exec    | 安装依赖（uv pip）    | 中   |
| 8    | exec    | 验证 Python 语法      | 低   |
| 9    | process | 启动测试进程（可选）  | 中   |
| 9    | exec    | 健康检查（可选）      | 低   |
| 10   | memory  | 记录到记忆（可选）    | 低   |
| 11   | write   | 创建文档（推荐）      | 低   |

**总计**: 使用 5 个核心工具（`glob`, `read`, `write`, `exec`, `process`）

---

## 🚨 错误处理

### 端口冲突

**检测**: 第 1 步发现端口已被使用

**处理**:

1. 自动选择下一个可用端口（18xxx 递增）
2. 或询问用户指定新端口

### 目录已存在

**检测**: 第 2 步 `mkdir` 返回错误

**处理**:

1. 检查是否为未完成的创建（缺少文件）
2. 询问用户是否覆盖或选择新名称
3. 使用 `exec rm -rf workers/{name}` 清理后重试

### 依赖安装失败

**检测**: 第 7 步 `uv pip install` 返回非 0 退出码

**处理**:

1. 检查 stderr 输出，识别具体错误（网络、版本冲突等）
2. 尝试降级依赖版本
3. 建议用户手动介入

### 语法错误

**检测**: 第 8 步 `py_compile` 报错

**处理**:

1. 显示错误行号和内容
2. 使用 `edit` 工具修复（如果是简单错误）
3. 或返回错误，让用户/Agent 重新生成代码

### 启动失败

**检测**: 第 9 步健康检查超时或返回错误

**处理**:

1. 检查进程日志（如果 `process` 工具支持）
2. 检查端口是否被占用
3. 检查依赖是否正确安装
4. 提供诊断命令给用户

---

## 📚 参考资料

- **Worker 约定**: `workers/CONVENTIONS.md`
- **现有 Worker 示例**:
  - ASR: `workers/asr/server.py`
  - TTS: `workers/tts/server.py`
  - OCR: `workers/ocr/server.py`
- **WorkerManager 源码**: `src/main/common/worker/WorkerManager.ts`
- **工具清单**: `docs/tools-inventory.md`

---

## 💡 最佳实践

1. **先小后大**: 先创建最小可用版本（只有 `/health` 端点），测试通过后再添加业务逻辑
2. **复用模板**: 从已有 Worker（如 ASR）复制代码结构，修改关键部分
3. **分步验证**: 每一步完成后验证结果，而非一次性创建所有文件
4. **保留日志**: 使用 `memory` 工具记录创建过程和关键参数
5. **文档先行**: 先写 README.md 明确接口设计，再写代码

---

## 🎯 使用示例

### 示例 1: 创建简单的 Echo Worker

```typescript
// 需求: 创建一个简单的 Echo Worker，返回输入内容

// 1. 检查端口
glob({ pattern: 'workers/*/worker.json' });
// 发现已用端口: 18001, 18002, 18003
// 选择端口: 18004

// 2. 创建目录
exec({ command: 'mkdir -p workers/echo' });

// 3. 创建配置
write({
  path: 'workers/echo/worker.json',
  content: JSON.stringify(
    {
      name: 'echo',
      label: 'Echo Worker',
      type: 'native',
      entry: 'server.py',
      port: 18004,
      enabled: true
    },
    null,
    2
  )
});

// 4. 创建依赖文件
write({
  path: 'workers/echo/requirements.txt',
  content: `fastapi>=0.115.0
uvicorn[standard]>=0.32.0
websockets>=14.0`
});

// 5. 创建服务代码
write({
  path: 'workers/echo/server.py',
  content: `#!/usr/bin/env python3
from fastapi import FastAPI
import uvicorn
import argparse

app = FastAPI(title="Echo Worker")

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/api/echo")
def echo(request: dict):
    return {"echo": request.get("text", "")}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18004)
    args = parser.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port)

if __name__ == "__main__":
    main()
`
});

// 6-7. 创建环境并安装依赖
exec({ command: './runtime/macos-arm64/uv venv workers/echo/venv' });
exec({
  command: './runtime/macos-arm64/uv pip install -r workers/echo/requirements.txt --python workers/echo/venv/bin/python'
});

// 8. 验证语法
exec({ command: 'workers/echo/venv/bin/python -m py_compile workers/echo/server.py' });

// 完成！重启应用即可看到 Echo Worker 运行
```

### 示例 2: 创建 AI 模型 Worker

```typescript
// 需求: 创建一个使用 Transformers 模型的 Worker

// 1-3. 基础步骤同上

// 4. 依赖文件（包含 AI 库）
write({
  path: 'workers/ai-model/requirements.txt',
  content: `fastapi>=0.115.0
uvicorn[standard]>=0.32.0
torch>=2.0.0
transformers>=4.57.3`
});

// 5. 服务代码（包含模型加载）
write({
  path: 'workers/ai-model/server.py',
  content: `#!/usr/bin/env python3
from fastapi import FastAPI
import uvicorn
import argparse
import os

app = FastAPI(title="AI Model Worker")

model = None
MODEL_DIR = os.environ.get("MODEL_DIR", "/Users/lifeng/data/models")

@app.on_event("startup")
async def load_model():
    global model
    # TODO: 加载模型
    # from transformers import AutoModel
    # model = AutoModel.from_pretrained(...)
    pass

@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model is not None}

@app.post("/api/predict")
def predict(request: dict):
    if model is None:
        return {"error": "模型未加载"}
    # TODO: 推理逻辑
    return {"result": "..."}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18005)
    args = parser.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port)

if __name__ == "__main__":
    main()
`
});

// 6-8. 环境创建、依赖安装、语法验证（同上）
```

---

## 🔄 与 WorkerManager 的集成

创建完成后，Worker 会被 WorkerManager 自动发现和管理：

1. **自动发现**: WorkerManager 扫描 `workers/` 目录，读取 `worker.json`
2. **生命周期管理**: 自动启动、监控、重启
3. **端口分配**: 根据 `worker.json` 中的 `port` 字段启动
4. **环境注入**: 自动注入 `MODEL_DIR`, `MODELSCOPE_CACHE` 等环境变量
5. **健康检查**: 轮询 `/health` 端点，判断是否就绪

**Agent 无需关心启动细节**，只需创建文件结构即可。

---

## ✨ 总结

**核心思想**: 通过 **Skill 描述流程**，使用 **现有工具组合**，避免 **工具膨胀导致上下文增大**。

**工具数量**: 保持 **19 个**，不新增专用工具

**灵活性**: Agent 可根据具体需求调整步骤（如跳过测试、添加文档等）

**可维护性**: 流程集中在 Skill 中，修改时只需更新此文档
