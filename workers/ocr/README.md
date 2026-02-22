# OCR Worker — 本地图像识别服务

本地 OCR Worker，基于 GLM-OCR 模型提供图像文字识别服务。

## 特性

- ✅ **本地运行** - 基于 GLM-OCR 本地模型，离线可用
- ✅ **高质量** - OmniDocBench V1.5 第一名（94.62 分）
- ✅ **FastAPI + WebSocket** - 支持同步和流式识别
- ✅ **独立环境** - 使用已配置的 GLM-OCR 虚拟环境
- ✅ **自动管理** - 由 RuntimeManager 管理生命周期

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
  "format": "png"
}
```

响应：

```json
{
  "success": true,
  "text": "识别的文本内容"
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
      format: 'png'
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

| 环境变量          | 说明             | 默认值                                     |
| ----------------- | ---------------- | ------------------------------------------ |
| `MODEL_DIR`       | 模型存储目录     | `/Users/lifeng/data/models`                |
| `AGENT_TOOLS_DIR` | Agent 工具目录   | `/Users/lifeng/git/git_agents/agent-tools` |
| `GLM_OCR_SCRIPT`  | GLM-OCR 脚本路径 | `{AGENT_TOOLS_DIR}/glm_ocr/ocr_image.sh`   |

### GLM-OCR 环境

- **位置**: `{AGENT_TOOLS_DIR}/glm_ocr`（默认: `/Users/lifeng/git/git_agents/agent-tools/glm_ocr`）
- **虚拟环境**: `glm_env`
- **模型路径**: `{MODEL_DIR}/GLM-OCR`（默认: `/Users/lifeng/data/models/GLM-OCR`）
- **Python**: 3.8+

### Worker 依赖

安装在独立的虚拟环境中（由 RuntimeManager 自动管理）：

```txt
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
websockets>=14.0
Pillow>=10.0.0
torch>=2.0.0
transformers>=4.30.0
```

## 性能说明

- **启动时间**: 约 5-10 秒（检查环境）
- **识别速度**: 80-95 秒/张（CPU 模式）
- **准确率**: ⭐⭐⭐⭐⭐（OmniDocBench 第一名）
- **内存占用**: 约 2-3GB

## 工作原理

```
1. Worker 启动时检查 GLM-OCR 环境是否可用
2. 接收图片数据（base64 编码）
3. 保存为临时文件
4. 调用 GLM-OCR shell 脚本进行识别
5. 读取识别结果
6. 返回文本内容
7. 清理临时文件
```

## 故障排查

### 问题 1: OCR 环境未就绪

**错误**: `OCR 环境未就绪`

**解决**:

```bash
# 检查 GLM-OCR 脚本是否存在
ls /Users/lifeng/git/git_agents/agent-tools/glm_ocr/ocr_image.sh

# 如果不存在，需要先配置 GLM-OCR 环境
```

### 问题 2: 识别超时

**错误**: `处理超时（超过2分钟）`

**解决**:

- 图片过大，压缩后再试
- 模型加载慢，首次运行需要更长时间
- 可以修改 `server.py` 中的 timeout 参数

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

### 添加 DeepSeek-OCR 支持

如果需要支持 DeepSeek-OCR 作为备选方案：

1. 修改 `server.py` 添加 OCR 引擎选择逻辑
2. 添加 DeepSeek-OCR 调用函数
3. 在 API 中添加 `engine` 参数

示例：

```python
# 请求
{
  "image": "base64_data",
  "format": "png",
  "engine": "glm" | "deepseek"  // 选择 OCR 引擎
}
```

### 优化性能

1. **模型缓存**: 考虑直接加载模型而不是每次调用 shell 脚本
2. **批量处理**: 支持一次识别多张图片
3. **GPU 加速**: 检测 GPU 可用性并自动切换

## 版本历史

- **v0.1.0** (2026-02-22)
  - 初始版本
  - 支持 GLM-OCR 本地识别
  - FastAPI + WebSocket 接口
  - 独立环境管理
