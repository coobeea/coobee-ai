# Worker 虚拟环境恢复说明

## 🔧 问题诊断

### 原始问题

之前的修改将虚拟环境从外部目录移到了 worker 内部：

```
旧路径：worker-envs/asr_env/, worker-envs/tts_env/
新路径：workers/asr/venv/, workers/tts/venv/
```

但这导致：

- ❌ 找不到已有的虚拟环境
- ❌ Worker 启动失败
- ❌ 虚拟环境丢失

## ✅ 解决方案

### 1. 恢复独立虚拟环境目录

现在每个 Worker 都有自己独立的虚拟环境目录：

```
worker-envs/
├── asr_env/       # ASR Worker 虚拟环境
├── tts_env/       # TTS Worker 虚拟环境
└── ocr_env/       # OCR Worker 虚拟环境
```

### 2. 路径结构

#### 开发环境

```
/Users/lifeng/git/git_agents/coobee-ai/
├── workers/           # Worker 源码
│   ├── asr/
│   ├── tts/
│   └── ocr/
└── worker-envs/       # 虚拟环境
    ├── asr_env/
    ├── tts_env/
    └── ocr_env/
```

#### 生产环境

```
~/.coobee-ai/
└── worker-envs/       # 虚拟环境
    ├── asr_env/
    ├── tts_env/
    └── ocr_env/
```

## 🚀 如何使用

### 自动管理（推荐）

启动应用后，WorkerManager 会**自动检测并创建**虚拟环境：

```bash
pnpm dev
```

WorkerManager 会：

1. 检查 `worker-envs/{name}_env/` 是否存在
2. 如不存在，自动使用 uv 创建虚拟环境
3. 自动安装 `workers/{name}/requirements.txt` 中的依赖
4. 启动 Worker 进程

### 手动创建（调试用）

如果需要手动创建虚拟环境：

#### 方式 1：使用 uv（推荐，快 10-100 倍）

```bash
# ASR Worker
./runtime/darwin-arm64/uv venv worker-envs/asr_env
worker-envs/asr_env/bin/python -m pip install --upgrade pip
./runtime/darwin-arm64/uv pip install -r workers/asr/requirements.txt

# TTS Worker
./runtime/darwin-arm64/uv venv worker-envs/tts_env
./runtime/darwin-arm64/uv pip install -r workers/tts/requirements.txt

# OCR Worker
./runtime/darwin-arm64/uv venv worker-envs/ocr_env
./runtime/darwin-arm64/uv pip install -r workers/ocr/requirements.txt
```

#### 方式 2：使用 Python venv

```bash
# ASR Worker
python3 -m venv worker-envs/asr_env
worker-envs/asr_env/bin/pip install -r workers/asr/requirements.txt

# TTS Worker
python3 -m venv worker-envs/tts_env
worker-envs/tts_env/bin/pip install -r workers/tts/requirements.txt

# OCR Worker
python3 -m venv worker-envs/ocr_env
worker-envs/ocr_env/bin/pip install -r workers/ocr/requirements.txt
```

## 🔍 验证虚拟环境

### 检查虚拟环境是否存在

```bash
ls -la worker-envs/
```

应该看到：

```
drwxr-xr-x  asr_env/
drwxr-xr-x  tts_env/
drwxr-xr-x  ocr_env/
```

### 测试虚拟环境

```bash
# 测试 ASR 环境
worker-envs/asr_env/bin/python -c "import funasr; print('ASR OK')"

# 测试 TTS 环境
worker-envs/tts_env/bin/python -c "import cosyvoice; print('TTS OK')"

# 测试 OCR 环境
worker-envs/ocr_env/bin/python -c "import paddleocr; print('OCR OK')"
```

## 🧹 清理与重建

### 清理单个虚拟环境

```bash
rm -rf worker-envs/asr_env
```

### 清理所有虚拟环境

```bash
rm -rf worker-envs/*_env
```

### 重建虚拟环境

清理后，重新启动应用，WorkerManager 会自动重建：

```bash
rm -rf worker-envs/*_env
pnpm dev
```

## ⚙️ 技术细节

### 为什么是独立目录？

**优势**：

1. **完全隔离**：每个 Worker 依赖互不影响
2. **便于管理**：统一在 `worker-envs/` 目录
3. **便于清理**：`rm -rf worker-envs/asr_env` 即可
4. **路径清晰**：开发/生产环境分离

**对比**：

| 方案                 | 路径                   | 优势                                      | 劣势                             |
| -------------------- | ---------------------- | ----------------------------------------- | -------------------------------- |
| **独立目录（当前）** | `worker-envs/asr_env/` | ✅ 统一管理<br>✅ 便于清理<br>✅ 路径清晰 | -                                |
| Worker 内部          | `workers/asr/venv/`    | ✅ 代码环境一体                           | ❌ 混在源码中<br>❌ 生产部署复杂 |

### WorkerManager 如何查找虚拟环境？

```typescript
// src/main/common/worker/WorkerManager.ts

private getVenvDir(name: string): string {
  // 返回：worker-envs/{name}_env/
  return path.join(Env.paths.workerEnvsDir, `${name}_env`);
}

private getPythonBin(name: string): string {
  const venvDir = this.getVenvDir(name);
  // macOS/Linux: worker-envs/asr_env/bin/python
  // Windows: worker-envs/asr_env/Scripts/python.exe
  return Env.isWindows
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
}
```

## 📝 Commit 记录

```bash
git log --oneline -1
73ff069 fix(workers): 恢复独立虚拟环境管理系统
```

修改文件：

- `src/main/common/worker/WorkerManager.ts`：恢复 `getVenvDir()` 使用 `workerEnvsDir`
- `src/main/common/env.ts`：更新 `workerEnvsDir` 注释
- `workers/.gitignore`：移除 `*/venv/` 忽略规则
- `worker-envs/.gitignore`：添加 `*_env/` 忽略规则
- `worker-envs/README.md`：虚拟环境说明文档

## 🎯 总结

✅ **每个 Worker 都有自己独立的虚拟环境**  
✅ **自动管理，无需手动操作**  
✅ **路径清晰，便于维护**  
✅ **完全隔离，互不干扰**

---

**问题解决时间**：2026-02-22  
**影响范围**：所有 Python Worker（ASR, TTS, OCR）  
**解决状态**：✅ 已修复并提交
