# Worker 虚拟环境目录

此目录存放每个 Worker 独立的 Python 虚拟环境。

## 目录结构

```
worker-envs/
├── asr_env/       # ASR Worker 虚拟环境
├── tts_env/       # TTS Worker 虚拟环境
├── ocr_env/       # OCR Worker 虚拟环境
└── ...           # 其他 Worker 虚拟环境
```

## 特点

1. **独立隔离**：每个 Worker 有自己的虚拟环境，互不干扰
2. **自动管理**：WorkerManager 会自动检测并创建虚拟环境
3. **使用 uv**：使用 uv 工具创建和管理虚拟环境（比 pip 快 10-100 倍）

## 虚拟环境创建

虚拟环境由 WorkerManager 自动创建，无需手动操作：

1. 启动应用时，WorkerManager 检测虚拟环境是否存在
2. 如不存在，自动使用 uv 创建虚拟环境
3. 自动安装 requirements.txt 中的依赖

## 手动创建（仅调试用）

如需手动创建某个 Worker 的虚拟环境：

```bash
# 使用 uv（推荐）
cd /Users/lifeng/git/git_agents/coobee-ai
./runtime/darwin-arm64/uv venv worker-envs/asr_env
./runtime/darwin-arm64/uv pip install -r workers/asr/requirements.txt

# 或使用 Python 自带 venv
python3 -m venv worker-envs/asr_env
worker-envs/asr_env/bin/pip install -r workers/asr/requirements.txt
```

## 清理

删除某个虚拟环境（Worker 下次启动会重新创建）：

```bash
rm -rf worker-envs/asr_env
```

清理所有虚拟环境：

```bash
rm -rf worker-envs/*_env
```

## 注意事项

- 此目录已添加到 `.gitignore`，不会提交到 Git
- 开发环境：虚拟环境在项目根目录的 `worker-envs/`
- 生产环境：虚拟环境在 `~/.coobee-ai/worker-envs/`
