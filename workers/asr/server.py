"""
ASR Worker — 语音识别服务

FastAPI + WebSocket 服务，封装 FunASR-Nano 模型。
由 RuntimeManager 管理生命周期。

启动方式（由 RuntimeManager 自动调用）：
    python server.py --port 18100

环境变量（由 RuntimeManager 注入）：
    MODEL_DIR          模型存储目录
    MODELSCOPE_CACHE   ModelScope 缓存目录

识别策略（增量式）：
    - 保留完整 webm buffer（容器格式需要头部）
    - 每 ~2s 只提取并识别 *新增* 音频段（通过 ffmpeg -ss 跳过已识别部分）
    - 识别结果追加到已确认文本，确保推理时间恒定 ~1.5s
    - 避免全量重新识别导致的 O(n) 性能退化和模型幻觉
"""

import argparse
import asyncio
import logging
import os
import subprocess
import sys
import tempfile
import time

# FastAPI / uvicorn
try:
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.responses import JSONResponse
    import uvicorn
except ImportError:
    print("[ASR Worker] 缺少依赖，请先安装: pip install fastapi uvicorn", file=sys.stderr)
    sys.exit(1)

# ==================== 配置 ====================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_NAME = "FunAudioLLM/Fun-ASR-Nano-2512"
MODEL_DIR = os.environ.get("MODEL_DIR", "/Users/lifeng/data/models")

# 每隔多少个 chunk（250ms/个）触发一次识别
CHUNKS_PER_RECOGNITION = 4  # ~1 秒（降低延迟）

# 每次识别最大音频时长（秒），防止模型输入过大导致幻觉
MAX_SEGMENT_SECONDS = 6.0

# 两次识别之间的重叠（秒），避免截断边界处丢词
OVERLAP_SECONDS = 0.3

logging.basicConfig(level=logging.INFO, format="[ASR] %(message)s")
log = logging.getLogger("asr")

app = FastAPI(title="ASR Worker", version="0.3.0")

# ==================== 全局状态 ====================

asr_engine = None
model_loaded = False


# ==================== 模型加载 ====================

def detect_device() -> str:
    """自动选择最佳计算设备"""
    import torch
    if torch.cuda.is_available():
        return "cuda:0"
    elif torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load_asr_model():
    """加载 FunASR 模型"""
    global asr_engine, model_loaded

    from funasr import AutoModel

    device = detect_device()
    model_py_path = os.path.join(SCRIPT_DIR, "model.py")

    log.info(f"加载模型: {MODEL_NAME}")
    log.info(f"设备: {device}")
    log.info(f"模型目录: {MODEL_DIR}")

    os.environ.setdefault("MODELSCOPE_CACHE", MODEL_DIR)
    os.environ.setdefault("HF_HOME", MODEL_DIR)
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", os.path.join(MODEL_DIR, "hub"))

    t0 = time.time()
    asr_engine = AutoModel(
        model=MODEL_NAME,
        trust_remote_code=True,
        remote_code=model_py_path,
        device=device,
        hub="ms",
        disable_update=True,
    )
    elapsed = time.time() - t0
    model_loaded = True
    log.info(f"模型加载完成，耗时 {elapsed:.1f}s")


@app.on_event("startup")
async def startup_event():
    """应用启动时加载模型（在线程池中执行，不阻塞事件循环）"""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, load_asr_model)


# ==================== HTTP 接口 ====================

@app.get("/health")
async def health():
    """健康检查"""
    return JSONResponse({
        "status": "ok",
        "model_loaded": model_loaded,
        "model_dir": MODEL_DIR,
    })


# ==================== 音频转码 ====================

def webm_to_wav(webm_bytes: bytes, tmp_dir: str,
                start_seconds: float = 0,
                max_duration: float = 0) -> str:
    """
    将 webm/opus 音频转码为 PCM WAV 16kHz mono。
    支持 -ss（跳过开头）和 -t（限制时长）来只提取指定片段。

    Args:
        webm_bytes: 完整的 webm 容器字节流（必须包含头部）
        tmp_dir: 临时目录
        start_seconds: 起始偏移（跳过前面已识别的部分）
        max_duration: 最大提取时长（0 = 不限）

    Returns:
        WAV 文件路径
    """
    webm_path = os.path.join(tmp_dir, "input.webm")
    wav_path = os.path.join(tmp_dir, "output.wav")

    with open(webm_path, "wb") as f:
        f.write(webm_bytes)

    cmd = ["ffmpeg", "-y"]
    if start_seconds > 0:
        cmd.extend(["-ss", f"{start_seconds:.3f}"])
    cmd.extend(["-i", webm_path])
    if max_duration > 0:
        cmd.extend(["-t", f"{max_duration:.3f}"])
    cmd.extend(["-ar", "16000", "-ac", "1", "-f", "wav", wav_path])

    result = subprocess.run(cmd, capture_output=True, timeout=30)

    if result.returncode != 0:
        stderr = result.stderr.decode(errors="replace")
        raise RuntimeError(f"ffmpeg 转码失败: {stderr[:500]}")

    # 检查输出文件是否有效（至少有 WAV 头 44 字节 + 一些数据）
    if not os.path.exists(wav_path) or os.path.getsize(wav_path) < 100:
        raise RuntimeError("ffmpeg 输出文件过小或为空")

    return wav_path


def transcribe_wav(wav_path: str) -> str:
    """对 WAV 文件执行 ASR 识别"""
    if asr_engine is None:
        return ""

    results = asr_engine.generate(
        input=[wav_path],
        cache={},
        batch_size=1,
        hotwords=[],
        language="中文",
        itn=True,
    )

    if results and len(results) > 0:
        text = results[0].get("text", "")
        return text.strip()
    return ""


def do_transcribe_segment(audio_buffer: bytes,
                          start_seconds: float = 0,
                          max_duration: float = 0) -> str:
    """
    同步版本：提取指定片段并识别。

    Args:
        audio_buffer: 完整 webm buffer（从会话开始）
        start_seconds: 从哪个时间点开始提取
        max_duration: 最多提取多少秒

    Returns:
        识别文本
    """
    if not audio_buffer or not model_loaded:
        return ""

    with tempfile.TemporaryDirectory(prefix="asr_") as tmp_dir:
        try:
            t0 = time.time()
            wav_path = webm_to_wav(audio_buffer, tmp_dir,
                                   start_seconds=start_seconds,
                                   max_duration=max_duration)
            ffmpeg_ms = int((time.time() - t0) * 1000)

            t1 = time.time()
            text = transcribe_wav(wav_path)
            infer_ms = int((time.time() - t1) * 1000)

            log.info(
                f"片段识别: ss={start_seconds:.1f}s dur={max_duration:.1f}s | "
                f"ffmpeg={ffmpeg_ms}ms infer={infer_ms}ms | "
                f"text=\"{text[:60]}\""
            )
            return text
        except Exception as e:
            log.warning(f"识别失败: {e}")
            return ""


async def transcribe_segment(audio_buffer: bytes,
                             start_seconds: float = 0,
                             max_duration: float = 0) -> str:
    """异步版本：在线程池中提取指定片段并识别"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, do_transcribe_segment, audio_buffer, start_seconds, max_duration
    )


# ==================== WebSocket 流式 ASR ====================

@app.websocket("/ws/asr")
async def asr_stream(ws: WebSocket):
    """
    流式 ASR 接口（长连接）— 增量识别策略

    核心思路：
    - buffer 持续累积所有 webm chunks（需要完整容器头）
    - 但每次识别只提取 "上次识别位置" 到 "当前位置" 的音频段
    - 通过 ffmpeg -ss 跳过已识别部分，只处理 ~2-4 秒新音频
    - 识别结果累加到 committed_text，发送给前端

    性能保证：
    - 每次模型推理固定 ~1.5s（不随会话时长增长）
    - ffmpeg seek 开销极小（即使 webm 文件较大）
    """
    await ws.accept()
    log.info("WebSocket 客户端已连接")

    if not model_loaded:
        await ws.send_json({"partial": "[模型加载中，请稍候...]"})
        while not model_loaded:
            await asyncio.sleep(1)
        await ws.send_json({"partial": "[模型已就绪]"})

    # ---- 共享状态 ----
    buffer = bytearray()          # 完整 webm buffer
    chunk_count = 0               # 总 chunk 数
    committed_text = ""           # 已确认的历史识别文本
    recognized_chunks = 0         # 已识别到的 chunk 位置
    connected = True
    pending_recognition = asyncio.Event()

    async def receive_chunks():
        """接收音频 chunks 并累积到 buffer"""
        nonlocal chunk_count, connected
        try:
            while True:
                audio_bytes = await ws.receive_bytes()
                buffer.extend(audio_bytes)
                chunk_count += 1

                # 每 N 个 chunk 通知识别协程
                if chunk_count % CHUNKS_PER_RECOGNITION == 0:
                    pending_recognition.set()

        except (WebSocketDisconnect, Exception) as e:
            log.info(f"WebSocket 断开: {type(e).__name__}")
            connected = False
            pending_recognition.set()

    async def recognize_loop():
        """增量识别：每次只处理新增的音频段"""
        nonlocal committed_text, recognized_chunks

        while connected:
            await pending_recognition.wait()
            pending_recognition.clear()

            if not connected:
                break

            if chunk_count <= recognized_chunks:
                continue

            # 计算本次识别的时间范围
            # 留一点 overlap 避免截断边界丢词
            overlap_chunks = int(OVERLAP_SECONDS / 0.25)
            start_chunk = max(0, recognized_chunks - overlap_chunks)
            start_sec = start_chunk * 0.25

            # 本次新增音频的时长
            new_chunks = chunk_count - recognized_chunks
            segment_sec = (new_chunks + overlap_chunks) * 0.25

            # 限制最大段长
            if segment_sec > MAX_SEGMENT_SECONDS:
                start_sec = chunk_count * 0.25 - MAX_SEGMENT_SECONDS
                segment_sec = MAX_SEGMENT_SECONDS

            snapshot = bytes(buffer)

            try:
                text = await transcribe_segment(
                    snapshot,
                    start_seconds=start_sec,
                    max_duration=segment_sec
                )

                # 更新已识别位置
                recognized_chunks = chunk_count

                if text:
                    # 追加到已确认文本
                    if committed_text:
                        committed_text = committed_text + " " + text
                    else:
                        committed_text = text

                    try:
                        await ws.send_json({"partial": committed_text})
                    except Exception:
                        log.info("发送 partial 失败（客户端可能已断开）")
                        break

            except Exception as e:
                log.warning(f"识别异常: {e}")

    # 并发运行
    recv_task = asyncio.create_task(receive_chunks())
    recog_task = asyncio.create_task(recognize_loop())

    await recv_task

    connected = False
    pending_recognition.set()
    recog_task.cancel()
    try:
        await recog_task
    except asyncio.CancelledError:
        pass

    # 最终识别（处理尚未识别的尾部）
    if chunk_count > recognized_chunks and buffer:
        try:
            start_sec = recognized_chunks * 0.25
            remaining_sec = (chunk_count - recognized_chunks) * 0.25
            if remaining_sec > 0.5:  # 至少 0.5 秒才值得识别
                final_segment = await transcribe_segment(
                    bytes(buffer),
                    start_seconds=max(0, start_sec - OVERLAP_SECONDS),
                    max_duration=remaining_sec + OVERLAP_SECONDS
                )
                if final_segment:
                    committed_text = (committed_text + " " + final_segment).strip()
        except Exception as e:
            log.warning(f"最终识别异常: {e}")

    if committed_text:
        log.info(f"最终文本: {committed_text[:200]}")
        try:
            await ws.send_json({"final": committed_text})
        except Exception:
            log.info("无法发送 final（客户端已断开）")

    log.info(f"会话结束: {chunk_count} chunks, {len(buffer)} bytes, "
             f"识别 {recognized_chunks} chunks")


# ==================== 启动 ====================

def main():
    parser = argparse.ArgumentParser(description="ASR Worker Server")
    parser.add_argument("--port", type=int, default=18100, help="服务端口")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="绑定地址")
    args = parser.parse_args()

    print(f"[ASR Worker] 启动服务 {args.host}:{args.port}")
    print(f"[ASR Worker] MODEL_DIR = {MODEL_DIR}")

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
