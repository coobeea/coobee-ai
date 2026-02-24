# Worker 虚拟环境检测 - 简明版

## 🎯 一句话回答

**WorkerManager 通过以下约定自动识别并使用虚拟环境：**

```
默认所有 Worker 都是 Python Worker（需要虚拟环境）
除非在 worker.json 中指定 "type": "native"
```

---

## 📋 完整流程（5 步）

### 1️⃣ 扫描发现

```typescript
// WorkerManager 启动时扫描 workers/ 目录
workers/
├── asr/
│   └── worker.json     ← 有配置文件 → 注册为 Worker
├── tts/
│   └── worker.json     ← 有配置文件 → 注册为 Worker
└── random-folder/      ← 无配置文件 → 跳过
```

**约定 #1**：目录下有 `worker.json` → 这是一个 Worker

---

### 2️⃣ 判断类型

```typescript
// 启动 Worker 时
const config = this.configs.get('asr');

const isNative = config.type === 'native';

if (isNative) {
  // Native Worker（Go/Rust 编译的二进制）
  await this.spawnNativeWorker(worker); // 直接运行二进制
} else {
  // Python Worker（默认）
  await this.ensureVenv(config); // ✅ 创建/查找虚拟环境
  await this.spawnWorker(worker); // ✅ 使用虚拟环境启动
}
```

**约定 #2**：

- `type: "native"` → Native Worker（**不需要**虚拟环境）
- 否则 → Python Worker（**需要**虚拟环境）

---

### 3️⃣ 查找虚拟环境

```typescript
private getVenvDir(name: string): string {
  // 优先级 1: workers/{name}/venv/
  const localVenv = path.join(workerDir, 'venv');
  if (fs.existsSync(localVenv)) {
    return localVenv;  // ✅ 使用就地虚拟环境
  }

  // 优先级 2: worker-envs/{name}_env/
  const sharedVenv = path.join(workerEnvsDir, `${name}_env`);
  if (fs.existsSync(sharedVenv)) {
    return sharedVenv;  // ✅ 使用独立虚拟环境
  }

  // 默认：返回独立虚拟环境路径（将被创建）
  return sharedVenv;
}
```

**约定 #3**：按优先级查找

1. `workers/asr/venv/`（就地）
2. `worker-envs/asr_env/`（独立）

---

### 4️⃣ 创建虚拟环境（如不存在）

```typescript
async ensureVenv(config: WorkerConfig): Promise<void> {
  const venvDir = this.getVenvDir(config.name);

  if (!fs.existsSync(venvDir)) {
    // 创建虚拟环境
    await this.exec('uv', ['venv', venvDir]);

    // 安装依赖
    const requirementsPath = path.join(workerDir, 'requirements.txt');
    if (fs.existsSync(requirementsPath)) {
      await this.exec('uv', ['pip', 'install', '-r', requirementsPath]);
    }
  }
}
```

**约定 #4**：

- 检查 `requirements.txt`
- 如果存在，安装依赖

---

### 5️⃣ 使用虚拟环境启动

```typescript
private async spawnWorker(worker: ManagedWorker): Promise<void> {
  // 获取虚拟环境中的 Python
  const pythonBin = this.getPythonBin(config.name);
  // 例如：worker-envs/asr_env/bin/python

  // 启动命令
  const child = spawn(
    pythonBin,                    // 虚拟环境中的 Python
    ['server.py', '--port', '18100'],
    { cwd: 'workers/asr/', ... }
  );
}
```

**约定 #5**：使用虚拟环境中的 Python 启动

---

## 📁 目录结构示例

### Python Worker（默认）

```
workers/
└── asr/
    ├── worker.json         ← 配置文件（不指定 type）
    ├── requirements.txt    ← Python 依赖
    ├── server.py           ← 入口文件
    └── venv/               ← 可选：就地虚拟环境

worker-envs/
└── asr_env/                ← 独立虚拟环境（自动创建）
    └── bin/python          ← 用这个 Python 启动
```

**worker.json**：

```json
{
  "name": "asr",
  "label": "语音识别",
  "entry": "server.py",
  "port": 18100
  // 不指定 type → 默认 Python Worker
}
```

---

### Native Worker

```
workers/
└── native-worker/
    └── worker.json         ← 指定 type: "native"

runtime/
└── darwin-arm64/
    └── native-binary       ← 编译好的二进制
```

**worker.json**：

```json
{
  "name": "native-worker",
  "label": "原生 Worker",
  "type": "native",         ← 关键：指定为 native
  "entry": "native-binary",
  "port": 18600
}
```

---

## 🔄 完整流程图（简化版）

```
应用启动
   ↓
扫描 workers/ 目录
   ↓
有 worker.json？
   ↓ 是
注册 Worker
   ↓
用户点击"启动"
   ↓
type === "native"？
   ↓ 否（默认）        ↓ 是
Python Worker       Native Worker
   ↓                    ↓
查找虚拟环境       直接运行二进制
   ↓
workers/{name}/venv/ 存在？
   ↓ 是              ↓ 否
使用就地虚拟环境   worker-envs/{name}_env/ 存在？
   ↓                  ↓ 是            ↓ 否
   │              使用独立虚拟环境   创建独立虚拟环境
   │                  ↓                  ↓
   └──────────────────┴──────────────────┘
                      ↓
          使用虚拟环境中的 Python 启动
```

---

## 💡 关键约定总结

| 检测内容      | 约定                                                          | 结果                                       |
| ------------- | ------------------------------------------------------------- | ------------------------------------------ |
| 是否为 Worker | 目录下有 `worker.json`                                        | 注册为 Worker                              |
| Worker 类型   | `type === "native"`？                                         | 是 → Native<br>否 → Python（默认）         |
| 虚拟环境位置  | 优先 `workers/{name}/venv/`<br>其次 `worker-envs/{name}_env/` | 自动查找或创建                             |
| 安装依赖      | 检查 `requirements.txt`                                       | 存在则安装                                 |
| 启动命令      | 使用虚拟环境中的 Python                                       | `{venv}/bin/python server.py --port 18100` |

---

## 🎓 开发示例

### 创建新的 Python Worker

```bash
# 1. 创建目录结构
mkdir -p workers/my-worker

# 2. 创建配置（不指定 type → 默认 Python Worker）
cat > workers/my-worker/worker.json <<EOF
{
  "name": "my-worker",
  "label": "我的 Worker",
  "entry": "server.py",
  "port": 18400
}
EOF

# 3. 创建依赖文件
echo "fastapi==0.115.12" > workers/my-worker/requirements.txt

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
#    - 识别为 Python Worker（默认）
#    - 查找/创建虚拟环境：worker-envs/my-worker_env/
#    - 安装 requirements.txt 中的依赖
#    - 使用虚拟环境中的 Python 启动
```

### 创建预构建 Worker（就地虚拟环境）

```bash
# 1. 创建目录并预置虚拟环境
mkdir -p workers/packaged-worker
cd workers/packaged-worker

# 2. 创建就地虚拟环境
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn

# 3. 创建配置和代码
# ... (同上)

# 4. 打包
cd ..
tar -czf packaged-worker.tar.gz packaged-worker/

# ✅ 用户解压后：
#    - WorkerManager 优先使用就地虚拟环境 venv/
#    - 无需重新安装依赖
#    - 直接启动
```

---

## ❓ 常见问题

### Q1: 为什么我的 Worker 不需要指定虚拟环境路径？

**A**: 因为使用了**约定优于配置**的设计，系统按以下优先级自动查找：

1. `workers/{name}/venv/`
2. `worker-envs/{name}_env/`
3. 如果都不存在，自动创建 `worker-envs/{name}_env/`

### Q2: 如何让 Worker 不使用虚拟环境？

**A**: 在 `worker.json` 中指定 `"type": "native"`：

```json
{
  "name": "my-native-worker",
  "type": "native",
  "entry": "binary-name",
  "port": 18500
}
```

### Q3: 虚拟环境会自动创建吗？

**A**: 是的。如果找不到虚拟环境，WorkerManager 会：

1. 使用 `uv` 创建虚拟环境
2. 检查 `requirements.txt`
3. 如果存在，自动安装依赖

### Q4: 我可以手动创建虚拟环境吗？

**A**: 可以。有两种方式：

```bash
# 方式 1: 就地虚拟环境（Worker 目录内）
cd workers/my-worker
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 方式 2: 独立虚拟环境
python3 -m venv worker-envs/my-worker_env
worker-envs/my-worker_env/bin/pip install -r workers/my-worker/requirements.txt
```

---

## 🎯 核心理念

**约定优于配置 + 自动检测 = 零配置体验**

```
开发者只需：
  1. 创建 workers/{name}/worker.json
  2. 创建 workers/{name}/requirements.txt
  3. 创建 workers/{name}/server.py

系统自动：
  ✅ 扫描发现 Worker
  ✅ 识别为 Python Worker（默认）
  ✅ 查找/创建虚拟环境
  ✅ 安装依赖
  ✅ 启动 Worker
```

---

**相关文档**：

- 完整检测机制：`docs/worker-venv-detection.md`
- Worker 开发约定：`workers/CONVENTIONS.md`
- 灵活虚拟环境：`docs/worker-flexible-venv.md`
