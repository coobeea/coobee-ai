# WorkerManager 虚拟环境检测机制

> 揭秘：WorkerManager 如何自动识别并使用虚拟环境

## 🔍 核心问题

**问题**：WorkerManager 启动时，怎么知道某个 Worker 需要使用 Python 虚拟环境？

**答案**：通过**约定检测**（Convention Detection）

---

## 📋 完整检测流程

### 阶段 1：扫描发现 Worker

```typescript
// src/main/common/worker/WorkerManager.ts

scanAndRegister(): number {
  const workersDir = Env.paths.workersDir;  // workers/ 目录

  // 1. 读取 workers/ 下的所有子目录
  const entries = fs.readdirSync(workersDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // 2. 检查是否有 worker.json（约定 #1）
    const configPath = path.join(workersDir, entry.name, 'worker.json');
    if (!fs.existsSync(configPath)) {
      continue;  // ❌ 没有 worker.json，跳过
    }

    // 3. 解析配置并注册
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    this.register(config);  // ✅ 注册 Worker
  }
}
```

**约定 #1**：目录下有 `worker.json` → 这是一个 Worker

---

### 阶段 2：判断 Worker 类型

```typescript
async start(name: string): Promise<void> {
  const config = this.configs.get(name);

  // 判断是否为原生 Worker（不需要 Python）
  const isNative = this.isNativeWorker(config);

  if (isNative) {
    // Native Worker: Go/Rust 编译的二进制
    await this.spawnNativeWorker(worker);
  } else {
    // Python Worker: 需要虚拟环境
    await this.ensureVenv(config);      // ✅ 创建/检查虚拟环境
    await this.spawnWorker(worker);     // ✅ 使用虚拟环境中的 Python
  }
}
```

**约定 #2**：根据特征判断 Worker 类型

---

### 阶段 3：检测 Python Worker（需要虚拟环境）

```typescript
private isNativeWorker(config: WorkerConfig): boolean {
  // 检查 1: 入口文件扩展名
  if (!config.entry.endsWith('.py')) {
    return true;  // 不是 .py → Native Worker
  }

  // 检查 2: 是否有 requirements.txt（约定 #3）
  const scriptsDir = this.getWorkerScriptsDir(config.name);
  const requirementsPath = path.join(scriptsDir, 'requirements.txt');

  if (!fs.existsSync(requirementsPath)) {
    return true;  // 没有 requirements.txt → Native Worker
  }

  return false;  // ✅ 有 .py + requirements.txt → Python Worker
}
```

**约定 #3**：

- `entry` 是 `.py` 文件 → 可能是 Python Worker
- 有 `requirements.txt` → 确认是 Python Worker → **需要虚拟环境**

---

### 阶段 4：查找虚拟环境

```typescript
private getVenvDir(name: string): string {
  const workerDir = this.getWorkerScriptsDir(name);

  // 优先级 1: 就地虚拟环境（约定 #4）
  const localVenv = path.join(workerDir, 'venv');
  if (fs.existsSync(localVenv)) {
    return localVenv;  // ✅ 找到 workers/{name}/venv/
  }

  // 优先级 2: 独立虚拟环境（约定 #5）
  const sharedVenv = path.join(Env.paths.workerEnvsDir, `${name}_env`);
  if (fs.existsSync(sharedVenv)) {
    return sharedVenv;  // ✅ 找到 worker-envs/{name}_env/
  }

  // 默认：返回独立虚拟环境路径（将被创建）
  return sharedVenv;
}
```

**约定 #4**：优先查找 `workers/{name}/venv/`（就地虚拟环境）  
**约定 #5**：其次查找 `worker-envs/{name}_env/`（独立虚拟环境）

---

### 阶段 5：使用虚拟环境启动

```typescript
private async spawnWorker(worker: ManagedWorker): Promise<void> {
  const { config } = worker;

  // 获取虚拟环境中的 Python 可执行文件
  const pythonBin = this.getPythonBin(config.name);
  // 例如：worker-envs/asr_env/bin/python

  const entryPath = path.join(
    this.getWorkerScriptsDir(config.name),
    config.entry
  );
  // 例如：workers/asr/server.py

  // 启动命令：
  // worker-envs/asr_env/bin/python workers/asr/server.py --port 18100
  const child = spawn(pythonBin, [entryPath, '--port', String(config.port)], {
    cwd: scriptsDir,
    env: { MODEL_DIR: '...', ... }
  });

  worker.process = child;  // ✅ Worker 进程启动
}
```

**约定 #6**：使用虚拟环境中的 Python 可执行文件启动 Worker

---

## 🎯 完整约定总结

| 序号   | 约定内容                  | 检测方式     | 作用                 |
| ------ | ------------------------- | ------------ | -------------------- |
| **#1** | 目录下有 `worker.json`    | 文件是否存在 | 识别 Worker          |
| **#2** | `entry` 字段指定入口文件  | 读取配置     | 确定启动文件         |
| **#3** | 有 `requirements.txt`     | 文件是否存在 | 判断是 Python Worker |
| **#4** | `workers/{name}/venv/`    | 目录是否存在 | 优先查找就地虚拟环境 |
| **#5** | `worker-envs/{name}_env/` | 目录是否存在 | 其次查找独立虚拟环境 |
| **#6** | 使用虚拟环境中的 Python   | 路径拼接     | 启动 Worker          |

---

## 📁 目录结构示例

### Python Worker（需要虚拟环境）

```
workers/
└── asr/
    ├── worker.json         ← 约定 #1: 识别为 Worker
    ├── requirements.txt    ← 约定 #3: 识别为 Python Worker
    ├── server.py           ← 约定 #2: 入口文件
    └── venv/               ← 约定 #4: 就地虚拟环境（可选）

worker-envs/
└── asr_env/                ← 约定 #5: 独立虚拟环境（可选）
    └── bin/python          ← 约定 #6: 用这个 Python 启动
```

**检测结果**：

- ✅ 有 `worker.json` → 识别为 Worker
- ✅ 有 `requirements.txt` → 识别为 Python Worker
- ✅ 查找虚拟环境：`venv/` 或 `asr_env/`
- ✅ 使用虚拟环境中的 Python 启动

### Native Worker（不需要虚拟环境）

```
workers/
└── native-worker/
    ├── worker.json         ← 约定 #1: 识别为 Worker
    └── config.yaml         ← 无 requirements.txt

runtime/
└── darwin-arm64/
    └── native-worker       ← 编译好的二进制
```

**检测结果**：

- ✅ 有 `worker.json` → 识别为 Worker
- ❌ 无 `requirements.txt` → 识别为 Native Worker
- ✅ 直接运行二进制，无需虚拟环境

---

## 🔄 完整流程图

```
应用启动
   ↓
WorkerManager.scanAndRegister()
   ↓
扫描 workers/ 目录
   ↓
有 worker.json？
   ↓ 是                    ↓ 否
注册 Worker            跳过此目录
   ↓
───────────────────────────────
用户点击"启动 Worker"
   ↓
WorkerManager.start(name)
   ↓
检查是否为 Native Worker
   ↓
入口是 .py？          ↓ 否
   ↓ 是            Native Worker
有 requirements.txt？     ↓
   ↓ 是         ↓ 否    直接启动二进制
Python Worker   Native
   ↓
───────────────────────────────
ensureVenv(config)
   ↓
查找虚拟环境
   ↓
workers/{name}/venv/ 存在？
   ↓ 是                      ↓ 否
使用就地虚拟环境      worker-envs/{name}_env/ 存在？
   ↓                      ↓ 是            ↓ 否
   │                  使用独立虚拟环境   创建独立虚拟环境
   │                      ↓                  ↓
   └──────────────────────┴──────────────────┘
                          ↓
                  getPythonBin(name)
                          ↓
              获取虚拟环境中的 Python 路径
              （如 worker-envs/asr_env/bin/python）
                          ↓
                  spawnWorker(worker)
                          ↓
          spawn(pythonBin, [server.py, --port, 18100])
                          ↓
                    ✅ Worker 启动
```

---

## 💡 关键设计点

### 1. **零配置**

不需要在 `worker.json` 中指定虚拟环境路径，系统自动检测。

```json
{
  "name": "asr",
  "entry": "server.py",
  "port": 18100
  // ✅ 不需要指定 venv 路径
}
```

### 2. **约定优于配置**

通过文件存在性判断 Worker 类型：

- 有 `requirements.txt` → Python Worker
- 有 `venv/` 目录 → 使用就地虚拟环境
- 否则 → 使用/创建独立虚拟环境

### 3. **向后兼容**

支持多种虚拟环境组织方式，自动按优先级查找。

### 4. **LLM 友好**

LLM 只需生成标准目录结构，系统自动识别和处理：

```bash
# LLM 生成的 Worker
workers/
└── llm-worker/
    ├── worker.json         # 必需
    ├── requirements.txt    # 必需（Python Worker）
    └── server.py           # 必需

# ✅ 丢到 workers/ 目录即可，无需额外配置
```

---

## 🎓 最佳实践

### 开发新 Worker（推荐方式）

```bash
# 1. 创建标准目录结构
mkdir -p workers/my-worker

# 2. 创建 worker.json（约定 #1）
cat > workers/my-worker/worker.json <<EOF
{
  "name": "my-worker",
  "label": "我的 Worker",
  "entry": "server.py",
  "port": 18400
}
EOF

# 3. 创建 requirements.txt（约定 #3）
echo "fastapi==0.115.12" > workers/my-worker/requirements.txt

# 4. 创建入口文件（约定 #2）
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
#    - 识别为 Python Worker（有 requirements.txt）
#    - 查找虚拟环境（约定 #4, #5）
#    - 创建虚拟环境：worker-envs/my-worker_env/
#    - 使用虚拟环境中的 Python 启动
```

### 预构建 Worker（就地虚拟环境）

```bash
# 1. 创建标准目录结构
mkdir -p workers/packaged-worker
cd workers/packaged-worker

# 2. 创建就地虚拟环境（约定 #4）
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn

# 3. 创建配置文件
cat > worker.json <<EOF
{
  "name": "packaged-worker",
  "entry": "server.py",
  "port": 18500
}
EOF

# 4. 创建 requirements.txt（约定 #3）
cat > requirements.txt <<EOF
fastapi==0.115.12
uvicorn==0.34.0
EOF

# 5. 打包分发
cd ..
tar -czf packaged-worker.tar.gz packaged-worker/

# ✅ 用户解压后：
#    - WorkerManager 扫描发现（约定 #1）
#    - 识别为 Python Worker（约定 #3）
#    - 优先使用就地虚拟环境 venv/（约定 #4）
#    - 直接启动，无需安装依赖
```

---

## 🚀 总结

### WorkerManager 如何知道需要虚拟环境？

```
通过约定检测：
  ✅ 有 worker.json           → 识别为 Worker
  ✅ 有 requirements.txt      → 识别为 Python Worker
  ✅ Python Worker            → 需要虚拟环境
  ✅ 按优先级查找虚拟环境    → 自动使用/创建
  ✅ 使用虚拟环境中的 Python → 启动 Worker
```

### 核心理念

**约定优于配置 + 自动检测 = 零配置体验**

---

**相关文档**：

- Worker 开发约定：`workers/CONVENTIONS.md`
- 灵活虚拟环境机制：`docs/worker-flexible-venv.md`
- WorkerManager 实现：`src/main/common/worker/WorkerManager.ts`
