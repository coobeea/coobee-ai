# OCR Worker — 本地图像识别服务

本地 OCR Worker，基于 GLM-OCR 模型提供图像文字识别服务。

## 特性

- ✅ **本地运行** - 基于 GLM-OCR 本地模型，离线可用
- ✅ **高质量** - OmniDocBench V1.5 第一名（94.62 分）
- ✅ **FastAPI + WebSocket** - 支持同步和流式识别
- ✅ **独立服务** - 直接加载模型，不依赖外部脚本
- ✅ **自动管理** - 由 RuntimeManager 管理生命周期
- ✅ **多任务支持** - 支持文本、公式、表格识别

## 快速开始

### 1. 配置启动

修改 `worker.json` 启用服务：

```json
{
  "enable": true,
  "autoStart": true
}
```

保存后系统会自动启动 OCR Worker。

### 2. 手动测试

```bash
# 启动服务
cd /Users/lifeng/git/git_agents/coobee-ai/workers/ocr
python server.py --port 18102

# 健康检查
curl http://127.0.0.1:18102/health
```

## API 接口

### 1. 健康检查

```bash
GET /health
```

响应：

```json
{
  "status": "ok",
  "ocr_ready": true,
  "glm_ocr_script": "/Users/lifeng/git/git_agents/agent-tools/glm_ocr/ocr_image.sh"
}
```

### 2. 同步识别

```bash
POST /api/ocr
Content-Type: application/json

{
  "image": "base64_encoded_image_data",
  "task": "text"  // 可选: text | formula | table
}
```

响应：

```json
{
  "success": true,
  "text": "识别的文本内容",
  "latency_ms": 85000
}
```

### 3. 流式识别（WebSocket）

```javascript
const ws = new WebSocket('ws://127.0.0.1:18102/ws/ocr');

ws.onopen = () => {
  // 发送图片数据（base64 编码）
  ws.send(
    JSON.stringify({
      image: base64ImageData,
      task: 'text' // 可选: text | formula | table
    })
  );
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.status === 'ready') {
    console.log('OCR 服务已就绪');
  } else if (data.status === 'processing') {
    console.log('正在识别...');
  } else if (data.status === 'success') {
    console.log('识别结果:', data.text);
    console.log('耗时:', data.latency_ms, 'ms');
  } else if (data.status === 'error') {
    console.error('识别失败:', data.error);
  }
};
```

## 环境依赖

### 环境变量配置

OCR Worker 支持通过环境变量配置路径（由 RuntimeManager 注入）：

| 环境变量           | 说明            | 默认值                      |
| ------------------ | --------------- | --------------------------- |
| `MODEL_DIR`        | 模型存储目录    | `/Users/lifeng/data/models` |
| `MODELSCOPE_CACHE` | ModelScope 缓存 | `{MODEL_DIR}`               |

### 模型要求

- **模型名称**: GLM-OCR
- **模型路径**: `{MODEL_DIR}/GLM-OCR`（默认: `/Users/lifeng/data/models/GLM-OCR`）
- **模型大小**: ~900M 参数
- **Python**: 3.8+
- **PyTorch**: 2.0+

### Worker 依赖

安装在独立的虚拟环境中（由 RuntimeManager 自动管理）：

```txt
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
websockets>=14.0
torch>=2.0.0
transformers>=4.30.0
Pillow>=10.0.0
```

## 性能说明

- **启动时间**: 约 10-15 秒（加载模型）
- **识别速度**: 80-95 秒/张（CPU 模式）
- **准确率**: ⭐⭐⭐⭐⭐（OmniDocBench 第一名）
- **内存占用**: 约 2-3GB
- **支持任务**: 文本识别、公式识别、表格识别

## 工作原理

```
1. Worker 启动时加载 GLM-OCR 模型到内存
2. 接收图片数据（base64 编码）
3. 解码为图片字节流
4. 使用 transformers 模型进行推理
5. 返回识别的文本内容
6. 支持三种任务类型：文本、公式、表格
```

## 故障排查

### 问题 1: 模型加载失败

**错误**: `模型加载中...` 或模型加载异常

**解决**:

```bash
# 检查模型是否存在
ls /Users/lifeng/data/models/GLM-OCR

# 如果不存在，需要下载 GLM-OCR 模型
# 或设置正确的 MODEL_DIR 环境变量
```

### 问题 2: 识别速度慢

**现象**: 识别单张图片需要 80-95 秒

**说明**:

- CPU 模式下正常速度
- 首次识别可能更慢（模型预热）
- 如需加速，考虑使用 GPU（CUDA）

### 问题 3: 内存不足

**错误**: 进程崩溃或无响应

**解决**:

- 确保至少有 3GB 可用内存
- 关闭其他占用内存的应用
- 考虑使用 API OCR 代替

## 配置文件

### worker.json

```json
{
  "name": "ocr",
  "label": "图像识别",
  "enable": false, // 是否启用
  "entry": "server.py", // 入口脚本
  "port": 18102, // 服务端口
  "autoStart": false, // 开机自启
  "autoRestart": true, // 崩溃重启
  "maxRestarts": 3, // 最大重启次数
  "healthCheckTimeout": 120000 // 健康检查超时（毫秒）
}
```

## 与 TTS/ASR Worker 对比

| 特性     | TTS       | ASR          | OCR          |
| -------- | --------- | ------------ | ------------ |
| 端口     | 18101     | 18100        | 18102        |
| 输入     | 文本      | 音频流       | 图片         |
| 输出     | 音频流    | 文本         | 文本         |
| 模型     | Qwen3-TTS | FunASR-Nano  | GLM-OCR      |
| 延迟     | 低        | 极低         | 中等         |
| 使用场景 | 语音合成  | 实时语音识别 | 图像文字识别 |

## 开发说明

### 扩展功能

1. **添加其他 OCR 模型**：可以在 `load_ocr_model()` 中添加模型选择逻辑
2. **批量处理**: 支持一次识别多张图片（需修改 API）
3. **流式输出**: 对于超长文本，可以实现流式返回

### 优化性能

1. **GPU 加速**: 自动检测 CUDA，大幅提升速度
2. **模型量化**: 使用 int8/int4 量化减少内存占用
3. **批处理**: 一次处理多张图片

## 版本历史

- **v0.2.0** (2026-02-22)
  - 重构为独立服务，直接加载模型
  - 移除对外部脚本的依赖
  - 支持三种任务类型（文本、公式、表格）
  - 优化性能和内存管理
- **v0.1.0** (2026-02-22)
  - 初始版本
  - 基础 FastAPI + WebSocket 接口
