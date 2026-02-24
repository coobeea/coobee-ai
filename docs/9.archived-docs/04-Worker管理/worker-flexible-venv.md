# Worker 灵活虚拟环境机制

> **从硬编码到约定优于配置的进化**

## 🎯 解决的问题

### 之前的痛点

```typescript
// ❌ 硬编码：虚拟环境路径写死
private getVenvDir(name: string): string {
  return path.join(Env.paths.workerEnvsDir, `${name}_env`);
}
```

**问题**：

1. ❌ **路径写死**：只支持 `worker-envs/{name}_env/` 一种位置
2. ❌ **不够灵活**：无法支持就地虚拟环境 `workers/{name}/venv/`
3. ❌ **分发困难**：Worker 无法自带虚拟环境打包
4. ❌ **LLM 不友好**：生成的 Worker 需要额外配置

### 现在的方案

```typescript
// ✅ 灵活查找：按约定自动发现虚拟环境
private getVenvDir(name: string): string {
  const workerDir = this.getWorkerScriptsDir(name);

  // 优先级 1: {worker_dir}/venv/ (就地虚拟环境)
  const localVenv = path.join(workerDir, 'venv');
  if (fs.existsSync(localVenv)) return localVenv;

  // 优先级 2: worker-envs/{name}_env/ (独立虚拟环境)
  const sharedVenv = path.join(Env.paths.workerEnvsDir, `${name}_env`);
  if (fs.existsSync(sharedVenv)) return sharedVenv;

  // 默认：返回独立虚拟环境路径（将被自动创建）
  return sharedVenv;
}
```

**优势**：

1. ✅ **自动查找**：支持两种位置，按优先级查找
2. ✅ **向后兼容**：兼容旧的 `worker-envs/` 结构
3. ✅ **便于分发**：Worker 可以自带 venv 打包
4. ✅ **LLM 友好**：生成的 Worker 开箱即用

## 📁 虚拟环境组织方式

### 方式 1：就地虚拟环境（推荐用于分发）

```
workers/
└── my-worker/
    ├── worker.json
    ├── requirements.txt
    ├── server.py
    └── venv/              # 虚拟环境在 Worker 内
        ├── bin/
        ├── lib/
        └── ...
```

**适用场景**：

- 📦 预构建的 Worker（打包分发）
- 🤖 LLM 生成的 Worker
- 🚀 需要快速部署的 Worker

**优势**：

- Worker 自包含，拷贝即用
- 无需重新安装依赖
- 适合离线环境

### 方式 2：独立虚拟环境（推荐用于开发）

```
worker-envs/
├── my-worker_env/         # 虚拟环境独立存放
│   ├── bin/
│   ├── lib/
│   └── ...

workers/
└── my-worker/             # Worker 源码
    ├── worker.json
    ├── requirements.txt
    └── server.py
```

**适用场景**：

- 🛠️ 开发中的 Worker
- 🧹 需要频繁清理的环境
- 📝 保持源码目录干净

**优势**：

- 统一管理，便于清理
- 源码目录保持简洁
- 适合版本控制

## 🔄 自动查找流程

```
启动 Worker
   ↓
检查 workers/{name}/venv/ 是否存在？
   ↓ 是                      ↓ 否
使用就地虚拟环境          检查 worker-envs/{name}_env/ 是否存在？
   ↓                          ↓ 是                    ↓ 否
启动 Worker              使用独立虚拟环境         创建独立虚拟环境
                              ↓                          ↓
                          启动 Worker              安装依赖 → 启动 Worker
```

## 🚀 使用场景示例

### 场景 1：开发新 Worker（默认方式）

```bash
# 1. 创建 Worker 目录结构
mkdir -p workers/new-worker
cat > workers/new-worker/worker.json <<EOF
{
  "name": "new-worker",
  "label": "新 Worker",
  "entry": "server.py",
  "port": 18400
}
EOF

# 2. 创建依赖和代码
echo "fastapi==0.115.12" > workers/new-worker/requirements.txt
echo "uvicorn==0.34.0" >> workers/new-worker/requirements.txt

# 3. 启动应用
pnpm dev

# ✅ 自动创建虚拟环境：worker-envs/new-worker_env/
```

### 场景 2：预构建 Worker（就地虚拟环境）

```bash
# 1. 创建 Worker 并预置虚拟环境
mkdir -p workers/packaged-worker
cd workers/packaged-worker

# 2. 创建就地虚拟环境
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn

# 3. 创建配置
cat > worker.json <<EOF
{
  "name": "packaged-worker",
  "label": "打包 Worker",
  "entry": "server.py",
  "port": 18500
}
EOF

# 4. 打包分发
cd ..
tar -czf packaged-worker.tar.gz packaged-worker/

# ✅ 用户解压即用，无需安装依赖
```

### 场景 3：LLM 生成 Worker

```bash
# LLM 生成完整的 Worker 结构
# （包含 worker.json, requirements.txt, server.py, venv/）

# 用户只需：
tar -xzf llm-generated-worker.tar.gz -C workers/

# ✅ 启动应用即可使用，完全自动化
pnpm dev
```

### 场景 4：迁移旧 Worker（兼容性）

```bash
# 旧的 Worker（独立虚拟环境）
worker-envs/
└── old-worker_env/

workers/
└── old-worker/
    ├── worker.json
    └── server.py

# ✅ 无需修改，自动查找到 worker-envs/old-worker_env/
pnpm dev
```

## 🔧 手动管理

### 创建就地虚拟环境

```bash
cd workers/my-worker
python3 -m venv venv
source venv/bin/activate  # macOS/Linux
# 或 venv\Scripts\activate  # Windows

pip install -r requirements.txt
```

### 创建独立虚拟环境

```bash
# 使用 uv（推荐，快 10-100 倍）
./runtime/darwin-arm64/uv venv worker-envs/my-worker_env
./runtime/darwin-arm64/uv pip install -r workers/my-worker/requirements.txt

# 或使用 Python venv
python3 -m venv worker-envs/my-worker_env
worker-envs/my-worker_env/bin/pip install -r workers/my-worker/requirements.txt
```

### 清理虚拟环境

```bash
# 清理就地虚拟环境
rm -rf workers/my-worker/venv

# 清理独立虚拟环境
rm -rf worker-envs/my-worker_env

# 重新启动应用，自动重建
pnpm dev
```

## 📊 对比表

| 特性           | 就地虚拟环境           | 独立虚拟环境              |
| -------------- | ---------------------- | ------------------------- |
| **路径**       | `workers/{name}/venv/` | `worker-envs/{name}_env/` |
| **自包含**     | ✅ 是                  | ❌ 否                     |
| **便于分发**   | ✅ 是                  | ❌ 否                     |
| **统一管理**   | ❌ 否                  | ✅ 是                     |
| **源码干净**   | ❌ 否                  | ✅ 是                     |
| **查找优先级** | 1（优先）              | 2                         |
| **适用场景**   | 打包分发、LLM 生成     | 开发调试、版本控制        |

## 🎓 设计原则

### 1. 约定优于配置

**不需要**在配置文件中指定虚拟环境路径，系统自动按约定查找。

### 2. 灵活扩展

支持多种组织方式，适应不同使用场景。

### 3. 向后兼容

兼容旧的 `worker-envs/` 结构，无需迁移。

### 4. LLM 友好

简单规范，便于 LLM 生成完整的 Worker。

### 5. 零配置

遵循约定，丢到 `workers/` 目录就能用。

## 📚 相关文档

- **Worker 开发约定**：`workers/CONVENTIONS.md`
- **虚拟环境说明**：`worker-envs/README.md`
- **Worker 示例**：`workers/asr/`, `workers/tts/`, `workers/ocr/`
- **实现代码**：`src/main/common/worker/WorkerManager.ts`

## 🎯 总结

### 核心改进

从**硬编码路径**到**约定优于配置**的进化：

```
❌ 之前：只支持 worker-envs/{name}_env/
✅ 现在：按优先级自动查找两种位置

✅ 灵活：支持多种 Worker 组织方式
✅ 兼容：向后兼容旧版本
✅ 简单：遵循约定，零配置
✅ 强大：适应各种使用场景
```

### 未来展望

1. **Worker 脚手架**：`pnpm worker:create` 一键生成 Worker
2. **LLM 集成**：让 LLM 直接生成可用的 Worker
3. **Worker 市场**：分享和安装社区 Worker
4. **热更新**：Worker 代码变更自动重载

---

**设计理念**：让 Worker 开发像写插件一样简单，让分发像复制文件一样容易！ 🚀

**Commit**：`f94bd45 refactor(workers): 灵活的虚拟环境查找机制（约定优于配置）`
