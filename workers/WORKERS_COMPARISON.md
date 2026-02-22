# Workers 对比说明

## 概述

当前项目包含 4 个 Worker 服务，均采用 FastAPI + WebSocket 架构，提供不同的 AI 能力。

## Worker 列表

| Worker        | 端口  | 功能     | 模型        | 状态      |
| ------------- | ----- | -------- | ----------- | --------- |
| ASR           | 18100 | 语音识别 | FunASR-Nano | ✅ 已实现 |
| TTS           | 18101 | 语音合成 | Qwen3-TTS   | 🚧 开发中 |
| OCR           | 18102 | 图像识别 | GLM-OCR     | ✅ 已实现 |
| Tavern Poller | 9010  | 任务扫描 | N/A         | ✅ 已实现 |

## 架构对比

### 1. ASR Worker（实时语音识别）

**特点**:

- ✅ 完全实现，生产就绪
- ✅ 实时流式识别（WebSocket）
- ✅ VAD 语音活动检测
- ✅ PCM 音频直传，无需 ffmpeg

**技术栈**:

```python
fastapi + uvicorn + websockets
torch + funasr + modelscope
```

**核心接口**:

- `GET /health` - 健康检查
- `WS /ws/asr` - 实时语音识别

**识别流程**:

```
音频流 → VAD 检测 → 语音段切分 → 模型识别 → 返回文本
```

### 2. TTS Worker（语音合成）

**特点**:

- 🚧 基础框架完成
- 🚧 模型集成开发中
- ✅ 支持同步和流式合成

**技术栈**:

```python
fastapi + uvicorn + websockets
torch + transformers + qwen-tts (待集成)
```

**核心接口**:

- `GET /health` - 健康检查
- `POST /api/tts` - 同步合成（待实现）
- `WS /ws/tts` - 流式合成（待实现）

**合成流程**:

```
文本 → 分句 → 模型合成 → 音频流 → 返回 WAV
```

### 3. OCR Worker（图像识别）

**特点**:

- ✅ 完全实现，测试就绪
- ✅ 同步和流式识别
- ✅ 集成 GLM-OCR 本地模型
- ✅ Base64 图片传输

**技术栈**:

```python
fastapi + uvicorn + websockets
torch + transformers + Pillow
调用 GLM-OCR shell 脚本
```

**核心接口**:

- `GET /health` - 健康检查
- `POST /api/ocr` - 同步识别
- `WS /ws/ocr` - 流式识别

**识别流程**:

```
图片(Base64) → 解码 → 临时文件 → GLM-OCR 识别 → 返回文本
```

### 4. Tavern Poller（任务扫描）

**特点**:

- ✅ 周期性任务扫描
- ✅ 后台服务
- ❌ 无 WebSocket

**技术栈**:

```python
fastapi + uvicorn
```

**核心接口**:

- `GET /health` - 健康检查

## 共同特性

### 1. 统一架构

所有 Worker 都遵循相同的架构模式：

```
workers/
├── <worker-name>/
│   ├── worker.json          # 配置文件（统一格式）
│   ├── requirements.txt     # Python 依赖
│   ├── server.py            # FastAPI 服务入口
│   ├── README.md            # 完整文档
│   └── test_client.py       # 测试客户端（可选）
```

### 2. 配置文件格式（worker.json）

```json
{
  "name": "worker-name",
  "label": "显示名称",
  "enable": false,          // 是否启用
  "entry": "server.py",     // 入口脚本
  "port": 18XXX,           // 服务端口
  "autoStart": false,      // 开机自启
  "autoRestart": true,     // 崩溃重启
  "maxRestarts": 3,        // 最大重启次数
  "healthCheckTimeout": 120000  // 健康检查超时
}
```

### 3. 健康检查接口

所有 Worker 都提供统一的健康检查接口：

```python
@app.get("/health")
async def health():
    return JSONResponse({
        "status": "ok",
        "model_loaded": True,
        # ... 其他状态信息
    })
```

### 4. 环境管理

- ✅ 独立虚拟环境（由 RuntimeManager 管理）
- ✅ 独立的 requirements.txt
- ✅ 环境变量注入（MODEL_DIR, MODELSCOPE_CACHE 等）

### 5. 启动方式

```bash
# 方式 1：通过 RuntimeManager（推荐）
# 修改 worker.json: enable=true, autoStart=true

# 方式 2：手动启动（开发调试）
python server.py --port <port>
```

## 技术对比

### 输入输出对比

| Worker | 输入         | 输出     | 格式           |
| ------ | ------------ | -------- | -------------- |
| ASR    | PCM 音频流   | 文本     | WebSocket 流式 |
| TTS    | 文本         | WAV 音频 | HTTP/WebSocket |
| OCR    | 图片(Base64) | 文本     | HTTP/WebSocket |

### 性能对比

| Worker | 延迟            | 吞吐量 | 资源占用      |
| ------ | --------------- | ------ | ------------- |
| ASR    | 极低（实时）    | 高     | CPU 2-3GB     |
| TTS    | 低              | 中等   | CPU/GPU 2-4GB |
| OCR    | 中等（80-95秒） | 低     | CPU 2-3GB     |

### 使用场景

| Worker | 典型场景           | 实时性  | 批量处理    |
| ------ | ------------------ | ------- | ----------- |
| ASR    | 语音输入、会议记录 | ✅ 实时 | ❌ 不适合   |
| TTS    | 播报、语音助手     | ✅ 较快 | ✅ 可批量   |
| OCR    | 文档识别、票据处理 | ❌ 较慢 | ✅ 适合批量 |

## 开发指南

### 添加新 Worker

参考 ASR/TTS/OCR 的实现，创建新 Worker：

1. **创建目录结构**

   ```bash
   mkdir workers/new-worker
   ```

2. **创建配置文件**（worker.json）

   ```json
   {
     "name": "new-worker",
     "label": "新 Worker",
     "enable": false,
     "entry": "server.py",
     "port": 18XXX,
     "autoStart": false,
     "autoRestart": true,
     "maxRestarts": 3,
     "healthCheckTimeout": 120000
   }
   ```

3. **创建入口脚本**（server.py）

   ```python
   from fastapi import FastAPI
   import uvicorn

   app = FastAPI(title="New Worker")

   @app.get("/health")
   async def health():
       return {"status": "ok"}

   if __name__ == "__main__":
       uvicorn.run(app, host="127.0.0.1", port=18XXX)
   ```

4. **创建依赖文件**（requirements.txt）

   ```txt
   fastapi>=0.115.0
   uvicorn[standard]>=0.32.0
   websockets>=14.0
   ```

5. **创建文档**（README.md）

6. **测试和提交**

### 最佳实践

1. **接口设计**
   - ✅ 提供健康检查接口
   - ✅ 同步接口用于简单场景
   - ✅ WebSocket 用于流式/实时场景

2. **错误处理**
   - ✅ 捕获所有异常
   - ✅ 返回有意义的错误信息
   - ✅ 记录详细日志

3. **性能优化**
   - ✅ 使用异步 I/O
   - ✅ 模型懒加载（startup 事件）
   - ✅ 线程池处理 CPU 密集任务

4. **资源管理**
   - ✅ 临时文件及时清理
   - ✅ 内存及时释放
   - ✅ 连接及时关闭

## 总结

三个 Worker 的设计遵循相同的架构模式，具有良好的一致性和可维护性：

- ✅ **ASR Worker**: 实时语音识别，生产就绪
- 🚧 **TTS Worker**: 语音合成，基础框架完成
- ✅ **OCR Worker**: 图像识别，测试就绪

新增 Worker 时，参考现有实现即可快速上手！🚀
