# Worker 虚拟环境管理简化：就地模式

> **日期**: 2026-02-22  
> **目标**: 统一虚拟环境管理，采用就地模式（In-Place Virtual Environment）

---

## 📊 变更概览

### 之前（复杂灵活模式）

```plaintext
项目根目录/
├── workers/
│   ├── asr/
│   │   ├── worker.json
│   │   ├── requirements.txt
│   │   ├── server.py
│   │   └── venv/          ← 可选：就地虚拟环境
│   └── ...
└── worker-envs/           ← 独立虚拟环境目录
    ├── asr_env/           ← 备选虚拟环境
    ├── tts_env/
    └── ocr_env/
```

**问题**：

- 两种模式共存，管理复杂
- 需要维护额外的 `worker-envs/` 目录
- 路径查找逻辑复杂（优先级判断）
- 不够"约定优于配置"

### 之后（简化就地模式）

```plaintext
项目根目录/
└── workers/
    ├── asr/
    │   ├── worker.json
    │   ├── requirements.txt
    │   ├── server.py
    │   └── venv/          ← 必需：就地虚拟环境
    ├── tts/
    │   ├── worker.json
    │   ├── requirements.txt
    │   ├── server.py
    │   └── venv/
    └── ocr/
        ├── worker.json
        ├── requirements.txt
        ├── server.py
        └── venv/
```

**优势**：

- ✅ 单一模式，简单清晰
- ✅ Worker 自包含，易于打包分发
- ✅ 源码与环境一体化管理
- ✅ 无需额外目录，符合约定优于配置
- ✅ 适合 LLM 生成 Worker

---

## 🔧 技术实现

### WorkerManager.ts 变更

**之前**（复杂查找逻辑）：

```typescript
private getVenvDir(name: string): string {
  const workerDir = this.getWorkerScriptsDir(name);

  // 优先级 1: {worker_dir}/venv/ (就地虚拟环境)
  const localVenv = path.join(workerDir, 'venv');
  if (fs.existsSync(localVenv)) {
    return localVenv;
  }

  // 优先级 2: worker-envs/{name}_env/ (独立虚拟环境)
  const sharedVenv = path.join(Env.paths.workerEnvsDir, `${name}_env`);
  if (fs.existsSync(sharedVenv)) {
    return sharedVenv;
  }

  // 默认：返回独立虚拟环境路径（将被自动创建）
  return sharedVenv;
}
```

**之后**（简化直接返回）：

```typescript
private getVenvDir(name: string): string {
  const workerDir = this.getWorkerScriptsDir(name);
  return path.join(workerDir, 'venv');
}
```

**代码行数变化**：28 行 → 4 行（减少 86% 复杂度）

---

## 🧪 测试结果

### 环境创建（使用项目 uv 工具）

| Worker | 虚拟环境路径        | 大小 | 关键依赖                  | 状态 |
| ------ | ------------------- | ---- | ------------------------- | ---- |
| ASR    | `workers/asr/venv/` | 966M | funasr, torch             | ✅   |
| TTS    | `workers/tts/venv/` | 22M  | fastapi, uvicorn          | ✅   |
| OCR    | `workers/ocr/venv/` | 598M | torch, transformers (dev) | ✅   |

### 启动测试

| Worker | 端口  | 模型加载         | 健康检查                                  | 耗时 |
| ------ | ----- | ---------------- | ----------------------------------------- | ---- |
| ASR    | 18100 | FunASR-Nano-2512 | ✅ `{"status":"ok","model_loaded":true}`  | ~15s |
| TTS    | 18101 | 无需模型         | ✅ `{"status":"ok","model_loaded":false}` | ~3s  |
| OCR    | 18102 | GLM-OCR          | ✅ `{"status":"ok","model_loaded":true}`  | 3.9s |

---

## 🐛 问题排查记录

### 问题 1：OCR Worker - transformers 版本兼容性

**现象**：

```
TypeError: argument of type 'NoneType' is not iterable
```

**尝试的版本**：

- ❌ `transformers==5.0.0` - 无法识别自定义 Processor
- ❌ `transformers==5.1.0` - 相同错误
- ❌ `transformers==5.2.0` - 相同错误
- ✅ `transformers==5.3.0.dev0` (GitHub 开发版) - **成功**

**解决方案**：

参考 `/Users/lifeng/git/git_taxai/catax-skills/.cursor/skills/ocr-batch-processor/` 项目，使用 GitHub 开发版：

```bash
./runtime/macos-arm64/uv pip install git+https://github.com/huggingface/transformers.git --python workers/ocr/venv/bin/python
```

**根本原因**：GLM-OCR 使用自定义 `Glm46VProcessor`，需要最新的 transformers 开发版支持。

---

## 📝 约定说明

### 虚拟环境创建工具

**优先使用项目自带的 `uv` 工具**：

```bash
# macOS ARM64 (M1/M2/M3)
./runtime/macos-arm64/uv venv workers/{name}/venv
./runtime/macos-arm64/uv pip install -r workers/{name}/requirements.txt --python workers/{name}/venv/bin/python

# 其他平台
./runtime/macos/uv venv ...          # macOS x64
./runtime/linux-x64/uv venv ...      # Linux x64
./runtime/linux-arm64/uv venv ...    # Linux ARM64
```

**备选方案**（如果 uv 不可用）：

```bash
cd workers/{name}
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

### 特殊依赖说明

| Worker  | 特殊依赖           | 说明                     |
| ------- | ------------------ | ------------------------ |
| **ASR** | funasr             | FunASR 语音识别引擎      |
| **TTS** | 无                 | 仅 FastAPI 基础依赖      |
| **OCR** | transformers (dev) | 必须从 GitHub 安装开发版 |

---

## 🎯 影响评估

### 代码变更

| 文件                           | 变更类型 | 说明                                       |
| ------------------------------ | -------- | ------------------------------------------ |
| `WorkerManager.ts`             | 简化     | getVenvDir() 方法从 28 行简化为 4 行       |
| `env.ts`                       | 废弃标记 | workerEnvsDir 标记为 @deprecated           |
| `workers/.gitignore`           | 简化     | 仅保留 `*/venv/`                           |
| `workers/CONVENTIONS.md`       | 更新     | 更新虚拟环境约定说明                       |
| `workers/ocr/requirements.txt` | 修复     | 添加 torchvision，固定 transformers 开发版 |

### 目录变更

| 操作 | 目录                | 说明                 |
| ---- | ------------------- | -------------------- |
| 删除 | `worker-envs/`      | 移除独立虚拟环境目录 |
| 创建 | `workers/asr/venv/` | ASR 就地虚拟环境     |
| 创建 | `workers/tts/venv/` | TTS 就地虚拟环境     |
| 创建 | `workers/ocr/venv/` | OCR 就地虚拟环境     |

---

## ✅ 验证清单

- [x] ASR Worker 虚拟环境创建成功
- [x] TTS Worker 虚拟环境创建成功
- [x] OCR Worker 虚拟环境创建成功（含开发版 transformers）
- [x] ASR Worker 启动和健康检查通过
- [x] TTS Worker 启动和健康检查通过
- [x] OCR Worker 启动和健康检查通过（模型加载 3.9s）
- [x] TypeScript 类型检查通过
- [x] 代码提交成功（通过 pre-commit hooks）
- [x] 文档更新完成

---

## 🚀 后续优化建议

1. **自动化安装脚本**：创建 `setup-workers.sh` 自动创建所有 Worker 的虚拟环境
2. **CI 集成**：在 CI 中验证每个 Worker 可正常启动
3. **依赖锁定**：考虑使用 `uv.lock` 或 `requirements.lock` 锁定精确版本
4. **模型分离**：考虑将大型模型文件与代码分离（使用 MODEL_DIR 环境变量）

---

**总结**：虚拟环境管理从"灵活但复杂"简化为"简单且统一"，完全符合"约定优于配置"原则。✅
