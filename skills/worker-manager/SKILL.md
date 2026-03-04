---
name: worker-manager
description: Worker 服务管理指南。通过 Gateway IPC 查询、启动、停止、配置 Worker 子进程。Use when: (1) user asks to start/stop a service, (2) need to check if asr/tts/ocr/brain/tavern worker is running before using it, (3) managing worker lifecycle.
---

# Worker 服务管理 Skill

Worker 是后台服务进程（ASR/TTS/OCR/Brain/Tavern 等），由 WorkerManager 统一管理。  
**不要用 `exec` 直接 spawn 子进程**——始终通过 Gateway IPC 操作。

---

## 查询所有 Worker 状态

```
exec({ command: "curl -s -X POST http://localhost:8765/gateway/rpc -H 'Content-Type: application/json' -d '{\"method\":\"worker.list\",\"params\":{}}'" })
```

返回示例：

```json
{
  "workers": [
    { "name": "asr", "label": "语音识别", "status": "ready", "port": 18100 },
    { "name": "tts", "label": "语音合成", "status": "stopped", "port": null },
    { "name": "ocr", "label": "OCR识别", "status": "stopped", "port": null },
    { "name": "brain", "label": "智库", "status": "ready", "port": 18102 },
    { "name": "tavern", "label": "任务中心", "status": "ready", "port": 18103 }
  ]
}
```

`status` 含义：
| 值 | 说明 |
|----|------|
| `ready` | 就绪，可以调用 |
| `stopped` | 已停止，需要先启动 |
| `starting` / `initializing` | 启动中，等待就绪 |
| `error` | 启动失败，查看 `error` 字段 |

---

## 启动 Worker

```
exec({ command: "curl -s -X POST http://localhost:8765/gateway/rpc -H 'Content-Type: application/json' -d '{\"method\":\"worker.start\",\"params\":{\"name\":\"tts\"}}'" })
```

启动是**异步**的，接口立即返回 `{"ok":true}`，Worker 在后台初始化。  
需要轮询等待就绪（最多 2 分钟，每 5 秒检查一次）：

```
exec({ command: "curl -s -X POST http://localhost:8765/gateway/rpc -H 'Content-Type: application/json' -d '{\"method\":\"worker.list\",\"params\":{}}'" })
# 检查目标 worker 的 status 是否变为 "ready"
```

> 首次启动需安装 Python 依赖，可能需要 1-3 分钟。

---

## 停止 Worker

```
exec({ command: "curl -s -X POST http://localhost:8765/gateway/rpc -H 'Content-Type: application/json' -d '{\"method\":\"worker.stop\",\"params\":{\"name\":\"tts\"}}'" })
```

---

## 前置检查模板（使用 Worker 前必做）

在调用任何 Worker 的 API 前，先执行以下检查：

```
# 1. 查询状态
exec({ command: "curl -s -X POST http://localhost:8765/gateway/rpc -H 'Content-Type: application/json' -d '{\"method\":\"worker.list\",\"params\":{}}'" })

# 2. 如果 status 不是 "ready"，启动它
exec({ command: "curl -s -X POST http://localhost:8765/gateway/rpc -H 'Content-Type: application/json' -d '{\"method\":\"worker.start\",\"params\":{\"name\":\"<worker_name>\"}}'") })

# 3. 等待就绪（重复查询直到 status === "ready"）
```

---

## 修改 Worker 配置

某些 Worker 支持运行时配置（如 TTS 切换模型）：

```
exec({ command: "curl -s -X POST http://localhost:8765/gateway/rpc -H 'Content-Type: application/json' -d '{\"method\":\"worker.configUpdate\",\"params\":{\"name\":\"tts\",\"config\":{\"model_name\":\"edge-tts\"}}}'" })
```

修改关键配置（`model_name`、`api_key`）后 Worker 会**自动重启**。

---

## 已知 Worker 列表

| name     | label    | 端口  | autoStart | 说明                      |
| -------- | -------- | ----- | --------- | ------------------------- |
| `asr`    | 语音识别 | 18100 | ✓         | FunASR 实时转写           |
| `tts`    | 语音合成 | 18101 | ✗         | 支持 edge-tts / Qwen3-TTS |
| `ocr`    | 图像识别 | 18102 | ✗         | 图片文字识别              |
| `brain`  | 智库服务 | 42043 | ✓         | 知识库存储与检索          |
| `tavern` | 酒馆服务 | 9010  | ✓         | Tavern 任务队列           |

> 端口以各 Worker 的 `worker.json` 为准。新建 Worker 请参考 `worker-creator` Skill。
