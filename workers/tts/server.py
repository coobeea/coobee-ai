"""
TTS Worker — 语音合成服务

FastAPI + WebSocket 服务，封装 Qwen3-TTS 模型。
由 RuntimeManager 管理生命周期。

启动方式（由 RuntimeManager 自动调用）：
    python server.py --port 18101

环境变量（由 RuntimeManager 注入）：
    MODEL_DIR          模型存储目录
    MODELSCOPE_CACHE   ModelScope 缓存目录
"""

import argparse
import os
import sys

# FastAPI / uvicorn 按需导入（依赖安装后可用）
try:
    from fastapi import FastAPI, WebSocket
    from fastapi.responses import JSONResponse
    import uvicorn
except ImportError:
    print("[TTS Worker] 缺少依赖，请先安装: pip install fastapi uvicorn", file=sys.stderr)
    sys.exit(1)

app = FastAPI(title="TTS Worker", version="0.1.0")

# ==================== 全局状态 ====================

tts_engine = None  # 延迟初始化
model_loaded = False


# ==================== HTTP 接口 ====================

@app.get("/health")
async def health():
    """健康检查（RuntimeManager 轮询此接口判断是否就绪）"""
    return JSONResponse({
        "status": "ok",
        "model_loaded": model_loaded,
        "model_dir": os.environ.get("MODEL_DIR", "未设置"),
    })


@app.post("/api/tts")
async def tts_sync(request: dict):
    """
    同步 TTS 接口（整段合成后返回）

    请求体: { "text": "你好", "speaker": "Vivian", "language": "Chinese" }
    响应: WAV 二进制
    """
    # TODO: 集成 tts_wrapper.py 的 QwenTTS
    return JSONResponse({"error": "尚未实现"}, status_code=501)


@app.websocket("/ws/tts")
async def tts_stream(ws: WebSocket):
    """
    流式 TTS 接口（长连接）

    客户端发送: { "text": "你好", "speaker": "Vivian" }
    服务端返回: 二进制音频 chunks，最后发 { "done": true }

    连接保持直到客户端断开，可多次发送文本。
    """
    await ws.accept()
    print("[TTS] WebSocket 客户端已连接")
    try:
        while True:
            data = await ws.receive_json()
            text = data.get("text", "")
            if not text:
                await ws.send_json({"error": "缺少 text 字段"})
                continue
            # TODO: 集成流式 TTS 模型，生成 audio chunks
            await ws.send_json({"status": "processing", "text": text})
            await ws.send_json({"done": True})
    except Exception as e:
        # WebSocketDisconnect 或其他异常 → 客户端已断开
        print(f"[TTS] WebSocket 断开: {type(e).__name__}: {e}")


# ==================== 启动 ====================

def main():
    parser = argparse.ArgumentParser(description="TTS Worker Server")
    parser.add_argument("--port", type=int, default=18101, help="服务端口")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="绑定地址")
    args = parser.parse_args()

    print(f"[TTS Worker] 启动服务 {args.host}:{args.port}")
    print(f"[TTS Worker] MODEL_DIR = {os.environ.get('MODEL_DIR', '未设置')}")

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
