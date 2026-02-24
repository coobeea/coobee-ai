# TTS Worker 集成 Qwen3-TTS 模型

> **日期**: 2026-02-22  
> **模型**: Qwen3-TTS-12Hz-1.7B-CustomVoice  
> **参考**: /Users/lifeng/git/git_deep/deep-study/stt/scripts/synthesize.py

---

## 📊 集成概览

### 模型特性

| 特性         | 说明                                                             |
| ------------ | ---------------------------------------------------------------- |
| **模型名称** | Qwen3-TTS-12Hz-1.7B-CustomVoice                                  |
| **参数量**   | 1.7B                                                             |
| **音色数量** | 9 种（中英日韩等）                                               |
| **语言支持** | 11 种（中英日韩德法俄葡西意）                                    |
| **特殊功能** | 情绪指令控制（如"用兴奋的语气说"）                               |
| **采样率**   | 24kHz                                                            |
| **模型路径** | `/Users/lifeng/data/models/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` |

### 可用音色

| 音色         | 描述                   | 语言        |
| ------------ | ---------------------- | ----------- |
| **vivian**   | 明亮略带锐利的年轻女声 | 中文        |
| **serena**   | 温暖温柔的年轻女声     | 中文        |
| **uncle_fu** | 低沉醇厚的成熟男声     | 中文        |
| **dylan**    | 清亮自然的北京男声     | 中文/北京话 |
| **eric**     | 活泼微沙的成都男声     | 中文/四川话 |
| **ryan**     | 富有节奏感的动感男声   | 英文        |
| **aiden**    | 阳光清朗的美式男声     | 英文        |
| **ono_anna** | 灵动俏皮的日本女声     | 日文        |
| **sohee**    | 情感丰富的温暖韩国女声 | 韩文        |

---

## 🔧 技术实现

### 核心代码（参考 synthesize.py）

```python
# 模型加载
from qwen_tts import Qwen3TTSModel

tts_model = Qwen3TTSModel.from_pretrained(
    model_path,
    device_map=device,  # "mps" / "cuda:0" / "cpu"
    dtype=torch.float32,  # CPU 用 float32，GPU 用 bfloat16
)

# 语音合成
wavs, sr = tts_model.generate_custom_voice(
    text=text,
    language=language,
    speaker=speaker,
    instruct=instruct  # 可选：情绪指令
)
```

### 关键依赖

```txt
torch>=2.0.0
torchaudio>=2.0.0
transformers>=4.57.3
modelscope>=1.9.0
qwen-tts>=0.1.0
soundfile>=0.12.0
numpy>=1.21.0
```

---

## 🌐 API 接口

### 1. 健康检查 - GET /health

```bash
curl http://127.0.0.1:18101/health
```

响应：

```json
{
  "status": "ok",
  "model_loaded": true,
  "model_dir": "/Users/lifeng/data/models"
}
```

### 2. 同步合成 - POST /api/tts

```bash
curl -X POST http://127.0.0.1:18101/api/tts \
  -H "Content-Type: application/json" \
  -d '{
    "text": "你好，这是一个测试",
    "speaker": "vivian",
    "language": "chinese",
    "instruct": ""
  }' \
  -o output.wav
```

**参数**：

- `text` (必需): 要合成的文本
- `speaker` (可选): 音色名，默认 `vivian`
- `language` (可选): 语言，默认 `chinese`
- `instruct` (可选): 情绪指令，如 "用温柔的语气说"

**响应**: WAV 二进制文件（audio/wav）

### 3. 流式合成 - WebSocket /ws/tts

```javascript
const ws = new WebSocket('ws://127.0.0.1:18101/ws/tts');

ws.onopen = () => {
  ws.send(
    JSON.stringify({
      text: '你好世界',
      speaker: 'vivian',
      language: 'chinese'
    })
  );
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.status === 'processing') {
    console.log('正在合成...');
  } else if (data.audio) {
    // data.audio 是 base64 编码的 WAV
    const audioBlob = base64ToBlob(data.audio);
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.play();
  } else if (data.done) {
    console.log('合成完成');
  }
};
```

### 4. 列出音色 - GET /api/speakers

```bash
curl http://127.0.0.1:18101/api/speakers
```

响应：

```json
{
  "speakers": {
    "vivian": "明亮略带锐利的年轻女声（中文）",
    "serena": "温暖温柔的年轻女声（中文）",
    ...
  },
  "languages": ["auto", "chinese", "english", "french", ...]
}
```

---

## 🧪 测试结果

### 启动测试

```bash
$ workers/tts/venv/bin/python workers/tts/server.py --port 18101

[TTS] 启动服务 127.0.0.1:18101
[TTS] MODEL_DIR = /Users/lifeng/data/models
[TTS] 加载模型: Qwen3-TTS-12Hz-1.7B-CustomVoice
[TTS] 设备: mps
[TTS] 模型加载完成，耗时 6.9s
```

### 合成测试

```bash
# 测试文本
"你好，这是一个测试"

# 合成结果
✅ 生成 WAV 文件: 113K
✅ 音频时长: 2.4s
✅ 采样率: 24000 Hz
✅ 格式: 16-bit PCM mono
✅ 合成耗时: 8.9s (RTF: 3.71)
```

**RTF (Real-Time Factor)**: 3.71 表示合成 1 秒音频需要 3.71 秒（MPS 设备）。

---

## 📦 虚拟环境对比

| Worker  | 虚拟环境大小 | 关键依赖                    | 状态 |
| ------- | ------------ | --------------------------- | ---- |
| **ASR** | 965M         | funasr, torch               | ✅   |
| **TTS** | 1.0G         | qwen-tts, torch, torchaudio | ✅   |
| **OCR** | 598M         | transformers (dev), torch   | ✅   |

---

## 🎯 功能对比

### 之前（空壳框架）

- ❌ 无模型加载
- ❌ 接口返回 501（未实现）
- ✅ 仅健康检查可用
- 📦 虚拟环境: 22M（仅 FastAPI）

### 之后（完整功能）

- ✅ Qwen3-TTS 模型集成
- ✅ HTTP 同步合成接口
- ✅ WebSocket 流式接口
- ✅ 支持 9 种音色、11 种语言
- ✅ 支持情绪指令控制
- ✅ 自动设备检测（MPS/CUDA/CPU）
- 📦 虚拟环境: 1.0G（含完整 TTS 依赖）

---

## ⚡ 性能指标

| 指标         | 值           | 说明                    |
| ------------ | ------------ | ----------------------- |
| **模型加载** | ~7s          | 首次启动时间（MPS）     |
| **合成速度** | RTF 3.71     | 2.4s 音频需 8.9s（MPS） |
| **音频质量** | 24kHz 16-bit | 高质量语音输出          |
| **内存占用** | ~2GB         | 模型推理时              |

---

## 📝 使用示例

### 示例 1：基本合成

```bash
curl -X POST http://127.0.0.1:18101/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"你好世界"}' \
  -o hello.wav
```

### 示例 2：指定音色和语言

```bash
curl -X POST http://127.0.0.1:18101/api/tts \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello world",
    "speaker": "ryan",
    "language": "english"
  }' \
  -o hello_en.wav
```

### 示例 3：带情绪指令

```bash
curl -X POST http://127.0.0.1:18101/api/tts \
  -H "Content-Type: application/json" \
  -d '{
    "text": "太好了！终于完成了！",
    "speaker": "vivian",
    "instruct": "用特别兴奋的语气说"
  }' \
  -o excited.wav
```

---

## 🔍 对比 synthesize.py 实现

| 特性           | synthesize.py (CLI) | TTS Worker (Web 服务) |
| -------------- | ------------------- | --------------------- |
| **模型**       | Qwen3-TTS ✅        | Qwen3-TTS ✅          |
| **音色**       | 9 种 ✅             | 9 种 ✅               |
| **语言**       | 11 种 ✅            | 11 种 ✅              |
| **情绪指令**   | ✅                  | ✅                    |
| **长文本分段** | ✅ (>200字符)       | ❌ (待实现)           |
| **接口**       | 命令行              | HTTP + WebSocket      |
| **并发**       | 单任务              | 多任务异步处理        |

---

## ⚠️ 注意事项

### 1. flash-attn 警告

```
Warning: flash-attn is not installed. Will only run the manual PyTorch version.
```

这个警告可以忽略，flash-attn 仅用于加速推理，不影响功能。

### 2. 模型加载时间

首次启动需要加载模型（~7s），建议：

- 使用健康检查等待 `model_loaded: true`
- 前端显示"模型加载中"提示

### 3. RTF（实时因子）

当前 RTF: 3.71（MPS 设备），表示生成 1 秒音频需要 3.71 秒。

**优化建议**：

- GPU (CUDA): 预计 RTF < 1.0
- 安装 flash-attn: 可提速 2-3x

---

## ✅ 验证清单

- [x] Qwen3-TTS 模型集成完成
- [x] requirements.txt 更新（添加 torch/qwen-tts 等）
- [x] 虚拟环境重建（1.0G，含完整依赖）
- [x] 模型加载测试通过（耗时 6.9s）
- [x] HTTP 合成接口测试通过（生成 113K WAV）
- [x] WebSocket 接口实现完成
- [x] 音色列表接口实现完成
- [x] TypeScript 类型检查通过
- [x] 代码提交成功

---

**总结**：TTS Worker 从"空壳框架"升级为"完整功能服务"，支持多音色、多语言、情绪控制的高质量语音合成！🎉
