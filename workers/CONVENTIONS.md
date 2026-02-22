# Worker 开发约定

> **约定优于配置** — 遵循约定，系统自动发现和管理

## 📁 目录结构约定

### 最小 Worker 结构

```
workers/
└── my-worker/              # Worker 名称（唯一标识）
    ├── worker.json         # 必需：Worker 配置
    ├── requirements.txt    # 必需：Python 依赖
    └── server.py           # 必需：入口文件（可在 worker.json 中自定义）
```

### 完整 Worker 结构

```
workers/
└── my-worker/
    ├── worker.json         # Worker 配置
    ├── requirements.txt    # Python 依赖
    ├── server.py           # 入口文件
    ├── venv/               # 可选：就地虚拟环境（自动创建或手动预置）
    ├── model.py            # 可选：模型实现
    ├── utils.py            # 可选：工具函数
    └── README.md           # 可选：Worker 说明文档
```

## 🔧 虚拟环境约定

### 统一位置规则

所有 Worker 的虚拟环境**必须**位于其目录内：

```plaintext
workers/{name}/venv/
```

**优势**：

- Worker 自包含，易于打包分发
- 源码与环境一体化管理
- 适合 LLM 生成 Worker
- 简单清晰，无需额外目录

**如果虚拟环境不存在**，WorkerManager 会自动创建（使用项目的 `uv` 工具或 `venv`）

### 示例场景

#### 场景 1：开发新 Worker（默认方式）

```bash
# 1. 创建 Worker 目录
mkdir workers/my-worker

# 2. 创建配置文件
cat > workers/my-worker/worker.json <<EOF
{
  "name": "my-worker",
  "label": "我的 Worker",
  "entry": "server.py",
  "port": 18300
}
EOF

# 3. 创建依赖文件
cat > workers/my-worker/requirements.txt <<EOF
fastapi==0.115.12
uvicorn==0.34.0
EOF

# 4. 创建入口文件
cat > workers/my-worker/server.py <<EOF
from fastapi import FastAPI
app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok"}
EOF

# 5. 启动应用
pnpm dev

# ✅ WorkerManager 自动：
#    - 扫描发现 my-worker
#    - 创建虚拟环境：workers/my-worker/venv/
#    - 安装依赖
#    - 启动 Worker
```

#### 场景 2：手动预创建虚拟环境

```bash
# 使用项目的 uv 工具（推荐）
cd /path/to/coobee-ai
./runtime/macos-arm64/uv venv workers/my-worker/venv
./runtime/macos-arm64/uv pip install -r workers/my-worker/requirements.txt --python workers/my-worker/venv/bin/python

# 或使用标准 venv
cd workers/my-worker
python3 -m venv venv
venv/bin/pip install -r requirements.txt

# ✅ WorkerManager 检测到 venv/，直接使用，启动更快
```

#### 场景 3：打包分发 Worker

```bash
# Worker 目录自包含，可直接打包
cd workers
tar -czf my-worker.tar.gz my-worker/

# ✅ 接收方解压后即可使用，无需额外配置
```

## ⚙️ worker.json 配置约定

### 最小配置

```json
{
  "name": "my-worker",
  "label": "我的 Worker",
  "entry": "server.py",
  "port": 18300
}
```

### 完整配置

```json
{
  "name": "my-worker", // 必需：Worker 唯一标识
  "label": "我的 Worker", // 必需：显示名称
  "enable": false, // 可选：是否启用（默认 false）
  "entry": "server.py", // 必需：入口文件（相对于 Worker 目录）
  "port": 18300, // 必需：服务端口（每个 Worker 独立）
  "autoStart": false, // 可选：应用启动时是否自动启动（默认 false）
  "autoRestart": true, // 可选：崩溃后是否自动重启（默认 true）
  "maxRestarts": 3, // 可选：最大重启次数（默认 3）
  "healthCheckTimeout": 120000, // 可选：健康检查超时（ms，默认 120000）
  "args": [], // 可选：额外命令行参数
  "env": {} // 可选：额外环境变量
}
```

### 约定规范

1. **命名约定**：
   - `name` 使用 kebab-case（如 `my-worker`）
   - 目录名必须与 `name` 一致

2. **端口分配**：
   - ASR: 18100
   - TTS: 18200
   - OCR: 18300
   - 自定义 Worker: 18400+

3. **入口文件**：
   - 默认 `server.py`
   - 可自定义（如 `main.py`, `app.py`）
   - 必须支持 `--port` 参数

## 🚀 开发工作流

### 1. 创建 Worker

```bash
# 使用脚本自动生成 Worker 骨架（未来实现）
pnpm worker:create my-worker

# 或手动创建（参考上面的示例）
mkdir workers/my-worker
# ...
```

### 2. 开发和测试

```bash
# 启动应用（Worker 自动启动）
pnpm dev

# 或手动测试 Worker
cd workers/my-worker
python server.py --port 18300
```

### 3. 管理虚拟环境

```bash
# 查看虚拟环境位置
ls -la workers/my-worker/venv/        # 就地虚拟环境
ls -la worker-envs/my-worker_env/     # 独立虚拟环境

# 清理并重建
rm -rf worker-envs/my-worker_env/
pnpm dev  # 自动重建

# 手动创建就地虚拟环境（加速启动）
cd workers/my-worker
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## 📦 打包和分发

### 分发完整 Worker（含虚拟环境）

```bash
# 1. 在 Worker 内创建虚拟环境
cd workers/my-worker
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 2. 打包
cd ..
tar -czf my-worker.tar.gz my-worker/

# 3. 用户使用
# 解压到 workers/ 目录即可使用，无需安装依赖
```

### 仅分发源码（用户自行安装）

```bash
# 1. 打包（排除 venv）
cd workers
tar -czf my-worker-src.tar.gz \
  --exclude='my-worker/venv' \
  --exclude='my-worker/__pycache__' \
  my-worker/

# 2. 用户使用
# 解压后启动应用，WorkerManager 自动创建虚拟环境
```

## 🤖 LLM 生成 Worker 指南

### 提示词模板

```
创建一个名为 {name} 的 Worker，实现 {功能描述}。

要求：
1. 创建 workers/{name}/ 目录
2. 包含 worker.json（端口 {port}）
3. 包含 requirements.txt（依赖列表）
4. 包含 server.py（FastAPI 实现）
5. 支持 --port 命令行参数
6. 提供 /health 健康检查接口
```

### 生成后验证

```bash
# 1. 检查目录结构
ls -la workers/{name}/

# 2. 验证配置
cat workers/{name}/worker.json

# 3. 测试启动
pnpm dev
```

## 🎯 设计原则

1. **约定优于配置**：遵循约定，减少配置
2. **自动发现**：扫描 workers/ 自动注册
3. **灵活扩展**：支持多种虚拟环境组织方式
4. **向后兼容**：兼容旧版本 worker-envs/ 结构
5. **LLM 友好**：简单规范，便于 LLM 生成

## 📚 参考

- WorkerManager 实现：`src/main/common/worker/WorkerManager.ts`
- 示例 Worker：`workers/asr/`, `workers/tts/`, `workers/ocr/`
- 虚拟环境说明：`worker-envs/README.md`
- 环境配置：`src/main/common/env.ts`

---

**核心理念**：让 Worker 开发像写插件一样简单，丢到 `workers/` 目录就能用！ 🚀
