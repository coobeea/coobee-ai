---
name: tts
description: TTS 语音合成使用指南。调用 TTS Worker HTTP API 将文本转为语音文件并保存到工作空间。Use when: (1) user asks to convert text to speech, (2) generating voice audio files, (3) reading out text content. Prerequisite: TTS Worker must be running (use worker-manager skill if needed).
---

# TTS 语音合成 Skill

将文本合成为语音文件。TTS Worker 运行在端口 **18101**。

> **前置条件**：调用前确认 TTS Worker 已就绪（status = "ready"）。  
> 如需启动，参考 `worker-manager` Skill。

---

## 合成语音并保存文件

```
exec({
  command: "curl -s -X POST http://localhost:18101/api/tts \
    -H 'Content-Type: application/json' \
    -d '{\"text\":\"你好，世界\",\"speaker\":\"xiaoxiao\"}' \
    -o {workspace}/user/output/speech.mp3"
})
```

将 `{workspace}` 替换为实际工作空间路径（从 `<runtime_paths>` 的 `workspace` 字段获取）。

---

## 请求参数

| 参数       | 类型   | 必填 | 说明                                                              |
| ---------- | ------ | ---- | ----------------------------------------------------------------- |
| `text`     | string | ✓    | 要合成的文字                                                      |
| `speaker`  | string | 否   | 音色名称（默认：`xiaoxiao`）                                      |
| `language` | string | 否   | 语言（仅本地模型）：`chinese` / `english` / `japanese` / `korean` |
| `instruct` | string | 否   | 风格指令（仅本地模型，如 `"用开心的语气说"`）                     |

---

## 可用音色

### edge-tts 模式（默认，无需 GPU）

| 音色名     | 描述                       |
| ---------- | -------------------------- |
| `xiaoxiao` | 温暖亲切的年轻女声（中文） |
| `xiaoyi`   | 清脆清晰的年轻女声（中文） |
| `yunyang`  | 专业自然的男声（中文）     |
| `yunjian`  | 沉稳低沉的男声（中文）     |
| `yunxi`    | 温和自然的男声（中文）     |

### 本地 Qwen3-TTS 模式（需 GPU / Apple Silicon）

| 音色名     | 描述                           |
| ---------- | ------------------------------ |
| `vivian`   | 明亮略带锐利的年轻女声（中文） |
| `serena`   | 温暖温柔的年轻女声（中文）     |
| `uncle_fu` | 低沉醇厚的成熟男声（中文）     |
| `ryan`     | 富有节奏感的动感男声（英文）   |
| `aiden`    | 阳光清朗的美式男声（英文）     |

查询完整列表：

```
exec({ command: "curl -s http://localhost:18101/api/speakers" })
```

---

## 输出文件约定

音频文件保存至 `{workspace}/user/output/`，前端可自动识别并渲染播放器。

推荐文件命名：`tts_{timestamp}.mp3` 或具有语义的名称（如 `summary.mp3`）。

---

## 切换后端模式

**切换到 edge-tts**（无需 GPU，推荐）：

```
exec({ command: "curl -s -X POST http://localhost:8765/gateway/rpc -H 'Content-Type: application/json' -d '{\"method\":\"worker.configUpdate\",\"params\":{\"name\":\"tts\",\"config\":{\"model_name\":\"edge-tts\"}}}'" })
```

**切换到本地 Qwen3 模型**：

```
exec({ command: "curl -s -X POST http://localhost:8765/gateway/rpc -H 'Content-Type: application/json' -d '{\"method\":\"worker.configUpdate\",\"params\":{\"name\":\"tts\",\"config\":{\"model_name\":\"Qwen3-TTS-12Hz-1.7B-CustomVoice\"}}}'" })
```

修改后 Worker 自动重启，等待重新就绪再调用。
