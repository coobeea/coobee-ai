---
name: asr
description: ASR 语音识别（转写）使用指南。调用 ASR Worker 将音频文件转写为文字。Use when: (1) user wants to transcribe audio/voice to text, (2) processing recorded audio files, (3) converting speech to text. Prerequisite: ASR Worker must be running (usually auto-starts, use worker-manager skill if needed).
---

# ASR 语音识别 Skill

将音频文件转写为文字。ASR Worker 运行在端口 **18100**，通常在应用启动时自动运行（`autoStart: true`）。

> **前置条件**：调用前确认 ASR Worker 已就绪（status = "ready"）。  
> 通常无需手动启动，如未就绪参考 `worker-manager` Skill。

---

## 方式一：WebSocket 实时转写（流式，推荐用于实时语音）

ASR Worker 提供 WebSocket 流式接口 `ws://localhost:18100/ws/asr`，前端已集成，**Agent 通常不需要直接调用此接口**。

流程：

1. 建立 WebSocket 连接
2. 持续发送 PCM Int16 LE 16kHz 字节流
3. 接收 VAD 触发的识别结果（停顿时推送）

收到的消息格式：

```json
{ "status": "ready", "message": "模型已就绪" }          // 连接成功
{ "partial": "你好，这是识别出的文字", "latency_ms": 380 } // 识别结果
```

---

## 方式二：对话式任务转写（Agent 调用，适合处理已录制的音频文件）

如果需要转写一个本地音频文件，使用 Python 脚本通过 WebSocket 发送音频：

```
exec({
  command: "python3 -c \"\
import asyncio, websockets, wave, sys

async def transcribe(path):
    async with websockets.connect('ws://localhost:18100/ws/asr') as ws:
        # 等待就绪
        msg = await ws.recv()
        import json; data = json.loads(msg)
        if data.get('status') != 'ready':
            print('ASR not ready', file=sys.stderr); return

        # 读取并发送音频（16kHz 单声道 PCM）
        with wave.open(path, 'rb') as wf:
            chunk_size = 3200  # 100ms at 16kHz
            while True:
                frames = wf.readframes(chunk_size // 2)
                if not frames: break
                await ws.send(frames)
                await asyncio.sleep(0.05)

        # 等待最终结果（最多 5 秒）
        import asyncio as aio
        try:
            while True:
                result = json.loads(await aio.wait_for(ws.recv(), timeout=5))
                if 'partial' in result:
                    print(result['partial'])
        except aio.TimeoutError:
            pass

asyncio.run(transcribe('{audio_file_path}'))
\""
})
```

将 `{audio_file_path}` 替换为实际音频文件路径（WAV 格式，16kHz 单声道）。

---

## 音频格式要求

| 项目   | 要求        |
| ------ | ----------- |
| 格式   | WAV（推荐） |
| 采样率 | **16kHz**   |
| 声道   | **单声道**  |
| 位深   | 16-bit PCM  |

如果音频不符合要求，先转换格式：

```
exec({ command: "ffmpeg -i {input_file} -ar 16000 -ac 1 -f wav {workspace}/user/output/converted.wav" })
```

---

## 健康检查

```
exec({ command: "curl -s http://localhost:18100/health" })
```

返回示例：

```json
{ "status": "ok", "model_loaded": true, "model_dir": "/path/to/models" }
```

`model_loaded: false` 表示模型仍在加载中，需等待（首次启动可能需要 1-2 分钟下载模型）。

---

## 识别结果字段（SenseVoice 模型）

当使用 SenseVoice 模型时，返回额外的元数据：

| 字段         | 说明             | 示例值                              |
| ------------ | ---------------- | ----------------------------------- |
| `partial`    | 识别出的文字     | `"你好，世界"`                      |
| `lang`       | 语言             | `"zh"` / `"en"` / `"ja"`            |
| `emotion`    | 情绪             | `"NEUTRAL"` / `"HAPPY"` / `"SAD"`   |
| `event`      | 音频事件         | `"Speech"` / `"Laughter"` / `"BGM"` |
| `latency_ms` | 识别延迟（毫秒） | `380`                               |
