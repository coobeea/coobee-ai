# OCR Worker 快速启动指南

## 🎯 快速开始

### 1. 启用服务（推荐方式）

修改 `worker.json` 配置：

```json
{
  "enable": true,
  "autoStart": true
}
```

保存后，系统会自动启动 OCR Worker。

### 2. 手动启动（开发调试）

```bash
# 进入 OCR Worker 目录
cd /Users/lifeng/git/git_agents/coobee-ai/workers/ocr

# 启动服务
python server.py --port 18102
```

### 3. 健康检查

```bash
curl http://127.0.0.1:18102/health
```

预期响应：

```json
{
  "status": "ok",
  "model_loaded": true,
  "model_dir": "/Users/lifeng/data/models"
}
```

## 🧪 测试接口

### 使用测试客户端

```bash
# 安装测试依赖
pip install requests websockets

# 测试健康检查
python test_client.py health

# 测试同步接口
python test_client.py sync /path/to/image.png

# 测试 WebSocket 接口
python test_client.py ws /path/to/image.png
```

### 使用 curl 测试同步接口

```bash
# 准备图片的 base64 编码
IMAGE_BASE64=$(base64 -i /path/to/image.png)

# 调用 API (默认文本识别)
curl -X POST http://127.0.0.1:18102/api/ocr \
  -H "Content-Type: application/json" \
  -d "{\"image\": \"$IMAGE_BASE64\", \"task\": \"text\"}"
```

### 使用 Python 调用

```python
import base64
import requests

# 读取图片
with open("/path/to/image.png", "rb") as f:
    image_data = base64.b64encode(f.read()).decode()

# 调用 OCR API
response = requests.post(
    "http://127.0.0.1:18102/api/ocr",
    json={
        "image": image_data,
        "task": "text"  # 可选: text | formula | table
    },
    timeout=180
)

result = response.json()
if result["success"]:
    print("识别结果:")
    print(result["text"])
    print(f"耗时: {result['latency_ms']}ms")
else:
    print("识别失败:", result["error"])
```

## 📊 性能参考

| 指标     | 值                   |
| -------- | -------------------- |
| 启动时间 | 10-15 秒（加载模型） |
| 识别速度 | 80-95 秒/张（CPU）   |
| 准确率   | ⭐⭐⭐⭐⭐           |
| 内存占用 | 2-3GB                |
| 端口     | 18102                |
| 支持任务 | 文本/公式/表格识别   |

## ⚠️ 注意事项

### 1. 环境依赖

OCR Worker 需要 GLM-OCR 模型：

```bash
# 检查模型是否存在
ls /Users/lifeng/data/models/GLM-OCR

# 可选：自定义模型路径
export MODEL_DIR="/path/to/models"
```

如果模型不存在，需要先下载 GLM-OCR 模型到 `{MODEL_DIR}/GLM-OCR` 目录。

### 2. 超时设置

- 默认超时：2 分钟
- 首次识别较慢（模型加载）
- 后续识别会快很多

### 3. 内存要求

- 最低：2GB 可用内存
- 推荐：4GB+ 可用内存

## 🔧 故障排查

### 问题：服务启动失败

```bash
# 检查端口占用
lsof -i :18102

# 检查 Python 环境
python --version  # 需要 Python 3.8+
```

### 问题：模型加载失败

```bash
# 检查模型文件
ls -la /Users/lifeng/data/models/GLM-OCR

# 查看启动日志
# 确认 MODEL_DIR 环境变量是否正确
```

### 问题：识别超时

- 检查图片大小（建议 < 5MB）
- 首次运行需要加载模型，会较慢
- 可以增加超时时间

## 📚 更多文档

- [README.md](README.md) - 完整文档
- [worker.json](worker.json) - 配置文件
- [requirements.txt](requirements.txt) - 依赖列表

## 🎉 完成！

现在你可以：

1. ✅ 通过配置文件启用 OCR Worker
2. ✅ 使用 HTTP API 进行同步识别
3. ✅ 使用 WebSocket 进行流式识别
4. ✅ 集成到你的应用中

Happy OCR! 🚀
