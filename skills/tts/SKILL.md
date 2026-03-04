---
name: tts
description: TTS（语音合成）使用指南。通过 Gateway IPC 启动 tts Worker，再调用其 HTTP API 合成语音并保存到工作空间。Use when: (1) user asks to convert text to speech, (2) generating voice output, (3) creating audio files from text.
---

# TTS（语音合成）Skill

## 重要：正确的启动方式

**不要用 `exec` 工具直接启动子进程。** TTS Worker 由 WorkerManager 统一管理，通过 Gateway IPC 控制。

---

## Step 1：检查 TTS Worker 状态

```
exec({ command: "curl -s http://localhost:8765/gateway/rpc", input: '{"method":"worker.list","params":{}}' })
```

在返回的 `workers` 数组中找到 `name === "tts"` 的条目，检查其 `status` 字段：

- `"ready"` → Worker 已就绪，直接进入 Step 3
- `"stopped"` / `"error"` → 需要先启动，进入 Step 2
- `"starting"` / `"initializing"` → 等待就绪，轮询直到 `ready`

---

## Step 2：启动 TTS Worker

```
exec({ command: "curl -s -X POST http://localhost:8765/gateway/rpc", input: '{"method":"worker.start","params":{"name":"tts"}}' })
```

启动是**异步**的（后台初始化），需要轮询等待就绪（最多等 2 分钟）：

```
# 轮询检查（每 5 秒一次）
exec({ command: "curl -s http://localhost:18101/health" })
```

返回 `{"status": "ok"}` 即为就绪。

> **注意**：首次启动需要安装依赖（自动完成），可能需要 1-2 分钟。

---

## Step 3：合成语音

TTS Worker 运行在端口 **18101**，提供两种接口：

### 方式 A：直接返回音频字节（保存到文件）

```
exec({ command: "curl -s -X POST http://localhost:18101/api/tts -H 'Content-Type: application/json' -d '{\"text\":\"你好，世界\",\"speaker\":\"xiaoxiao\"}' -o {workspace}/user/output/tts_output.mp3" })
```

### 方式 B：检查支持的音色列表

```
exec({ command: "curl -s http://localhost:18101/api/speakers" })
```

---

## 请求参数

| 参数       | 类型   | 必填 | 说明                                                        |
| ---------- | ------ | ---- | ----------------------------------------------------------- |
| `text`     | string | ✓    | 要合成的文字                                                |
| `speaker`  | string | 否   | 音色名称（见下方列表）                                      |
| `language` | string | 否   | 语言（`chinese`/`english`/`japanese`/`korean`，仅本地模型） |
| `instruct` | string | 否   | 风格指令（仅本地模型，如"用开心的语气说"）                  |

### edge-tts 模式音色（无需 GPU，推荐）

| 音色名     | 描述                       |
| ---------- | -------------------------- |
| `xiaoxiao` | 温暖亲切的年轻女声（中文） |
| `xiaoyi`   | 清脆清晰的年轻女声（中文） |
| `yunyang`  | 专业自然的男声（中文）     |
| `yunjian`  | 沉稳低沉的男声（中文）     |

### 本地 Qwen3-TTS 模式音色（需要 GPU）

| 音色名     | 描述                           |
| ---------- | ------------------------------ |
| `vivian`   | 明亮略带锐利的年轻女声（中文） |
| `serena`   | 温暖温柔的年轻女声（中文）     |
| `uncle_fu` | 低沉醇厚的成熟男声（中文）     |
| `ryan`     | 富有节奏感的动感男声（英文）   |

---

## Step 4：保存音频文件到工作空间

音频文件必须保存到 `{workspace}/user/output/` 目录，才能被前端正确识别和播放：

```
exec({
  command: "curl -s -X POST http://localhost:18101/api/tts -H 'Content-Type: application/json' -d '{\"text\":\"合成内容\",\"speaker\":\"xiaoxiao\"}' -o {workspace}/user/output/speech.mp3"
})
```

然后用 `write` 工具记录文件路径（供前端生成播放器）：

```
write({ path: "{workspace}/user/output/speech.mp3.meta", content: "{workspace}/user/output/speech.mp3" })
```

> **注意**：将 `{workspace}` 替换为实际工作空间路径（从 `<runtime_paths>` 中的 `workspace` 字段获取）。

---

## 切换后端模式

TTS Worker 支持两种后端，通过配置切换：

**edge-tts（默认，推荐）**：无需 GPU，使用微软在线 TTS：

```
exec({ command: "curl -s -X POST http://localhost:8765/gateway/rpc", input: '{"method":"worker.configUpdate","params":{"name":"tts","config":{"model_name":"edge-tts"}}}' })
```

**本地 Qwen3 模型**（需要 GPU / Apple Silicon）：

```
exec({ command: "curl -s -X POST http://localhost:8765/gateway/rpc", input: '{"method":"worker.configUpdate","params":{"name":"tts","config":{"model_name":"Qwen3-TTS-12Hz-1.7B-CustomVoice"}}}' })
```

更改配置后 Worker 会自动重启。

---

## 完整示例

```
# 1. 检查状态
exec({ command: "curl -s http://localhost:8765/gateway/rpc", input: '{"method":"worker.list","params":{}}' })

# 2. 若未就绪则启动
exec({ command: "curl -s -X POST http://localhost:8765/gateway/rpc", input: '{"method":"worker.start","params":{"name":"tts"}}' })

# 3. 等待就绪（轮询）
exec({ command: "curl -s http://localhost:18101/health" })

# 4. 合成语音并保存文件
exec({ command: "curl -s -X POST http://localhost:18101/api/tts -H 'Content-Type: application/json' -d '{\"text\":\"你好，欢迎使用语音合成\",\"speaker\":\"xiaoxiao\"}' -o /path/to/workspace/user/output/hello.mp3" })
```
