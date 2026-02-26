"""
ASR Worker — 实时语音识别服务

FastAPI + WebSocket 服务，封装 FunASR-Nano 模型。
由 RuntimeManager 管理生命周期。

启动方式（由 RuntimeManager 自动调用）：
    python server.py --port 18100

环境变量（由 RuntimeManager 注入）：
    MODEL_DIR          模型存储目录
    MODELSCOPE_CACHE   ModelScope 缓存目录

识别策略（PCM 直传 + VAD 触发）：
    - 浏览器端发送 PCM Int16 LE 16kHz 字节流
    - 服务端用 wave 模块写 WAV 头（<1ms，无需 ffmpeg）
    - VAD 检测说话停顿才触发识别，保证句子完整性
    - 幻觉检测：输出字数超音频时长合理范围则截断
"""

import argparse
import asyncio
import logging
import os
import re
import struct
import sys
import tempfile
import time
import wave

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

# 默认路径
DEFAULT_MODEL_DIR = os.path.join(os.environ.get("HOME", ""), ".cache", "modelscope", "hub")
MODEL_DIR = os.environ.get("MODEL_DIR", DEFAULT_MODEL_DIR)

# 尝试读取本地配置覆盖 (local_config.json)
local_config_path = os.path.join(SCRIPT_DIR, "local_config.json")
if os.path.exists(local_config_path):
    try:
        import json
        with open(local_config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
        if isinstance(config, dict):
            if "model_dir" in config and isinstance(config["model_dir"], str):
                p = config["model_dir"]
                if not os.path.isabs(p):
                    p = os.path.abspath(os.path.join(SCRIPT_DIR, p))
                MODEL_DIR = p
                print(f"[ASR Config] MODEL_DIR -> {MODEL_DIR}")
            
            if "model_name" in config and isinstance(config["model_name"], str) and config["model_name"].strip():
                MODEL_NAME = config["model_name"].strip()
                print(f"[ASR Config] MODEL_NAME -> {MODEL_NAME}")
    except Exception as e:
        print(f"[ASR Config] 读取本地配置失败: {e}", file=sys.stderr)

# PCM 音频参数
SAMPLE_RATE = 16000
BYTES_PER_SAMPLE = 2  # Int16
BYTES_PER_SEC = SAMPLE_RATE * BYTES_PER_SAMPLE  # 32000

# ---- VAD（语音活动检测）参数 ----
SILENCE_THRESHOLD = 300       # Int16 振幅阈值，低于此视为静音
SILENCE_DURATION_SEC = 1.2    # 连续静音多久才算"说完一句"
MAX_UTTERANCE_SEC = 20.0      # 不间断说话的安全上限（超过强制识别）
MIN_UTTERANCE_SEC = 0.3       # 最短有效语段（低于此不值得识别）

logging.basicConfig(level=logging.INFO, format="[ASR] %(message)s")
log = logging.getLogger("asr")

# 模型类型检测：SenseVoice 系列需要不同的参数和后处理
_is_sensevoice = "sensevoice" in MODEL_NAME.lower().replace("-", "").replace("_", "")

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

    log.info(f"加载模型: {MODEL_NAME}")
    log.info(f"设备: {device}")
    log.info(f"模型目录: {MODEL_DIR}")

    os.environ.setdefault("MODELSCOPE_CACHE", MODEL_DIR)
    os.environ.setdefault("HF_HOME", MODEL_DIR)
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", os.path.join(MODEL_DIR, "hub"))

    model_path = os.path.join(MODEL_DIR, MODEL_NAME)
    if os.path.exists(model_path):
        log.info(f"使用本地模型路径: {model_path}")
        model_arg = model_path
    else:
        model_arg = MODEL_NAME

    # remote_code 仅用于 Fun-ASR-Nano（自定义模型实现）
    needs_remote_code = "fun-asr-nano" in MODEL_NAME.lower().replace("_", "-")
    model_kwargs = dict(
        model=model_arg,
        trust_remote_code=True,
        device=device,
        hub="ms",
        disable_update=True,
        log_level="ERROR",
    )
    if needs_remote_code:
        model_py_path = os.path.join(SCRIPT_DIR, "model.py")
        model_kwargs["remote_code"] = model_py_path

    t0 = time.time()
    asr_engine = AutoModel(**model_kwargs)
    
    # 屏蔽 FunASR 的繁琐日志
    logging.getLogger("funasr").setLevel(logging.ERROR)
    
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


# ==================== 音频处理 ====================

def pcm_to_wav(pcm_bytes: bytes, tmp_dir: str) -> str:
    """
    PCM Int16 LE → WAV 文件（极快，无需 ffmpeg）
    
    Args:
        pcm_bytes: PCM Int16 LE 字节流（16kHz 单声道）
        tmp_dir: 临时目录
    
    Returns:
        WAV 文件路径
    """
    wav_path = os.path.join(tmp_dir, "segment.wav")
    
    with wave.open(wav_path, "wb") as wf:
        wf.setnchannels(1)          # 单声道
        wf.setsampwidth(BYTES_PER_SAMPLE)  # 2 bytes (Int16)
        wf.setframerate(SAMPLE_RATE)       # 16000 Hz
        wf.writeframes(pcm_bytes)
    
    return wav_path


_SENSEVOICE_TAG_RE = re.compile(r"<\|([^|]*)\|>")

# SenseVoice 标签值域映射
_LANG_TAGS = {"zh", "en", "yue", "ja", "ko", "nospeech"}
_EMOTION_TAGS = {"NEUTRAL", "HAPPY", "SAD", "ANGRY", "EMO_UNKNOWN"}
_EVENT_TAGS = {"Speech", "BGM", "Applause", "Laughter", "Crying", "Coughing", "Sneezing"}
_ITN_TAGS = {"withitn", "woitn"}


def parse_sensevoice_output(raw_text: str) -> dict:
    """
    解析 SenseVoice 模型输出，提取结构化元数据。
    
    Returns:
        {
            "text": "纯文本内容",
            "lang": "zh" | "en" | "yue" | "ja" | "ko" | "nospeech" | None,
            "emotion": "NEUTRAL" | "HAPPY" | "SAD" | "ANGRY" | None,
            "event": "Speech" | "BGM" | "Laughter" | ... | None,
        }
    """
    meta = {"lang": None, "emotion": None, "event": None}
    
    for match in _SENSEVOICE_TAG_RE.finditer(raw_text):
        tag = match.group(1)
        if tag in _LANG_TAGS:
            meta["lang"] = tag
        elif tag in _EMOTION_TAGS:
            meta["emotion"] = tag if tag != "EMO_UNKNOWN" else None
        elif tag in _EVENT_TAGS:
            meta["event"] = tag
        # ITN 标签忽略，不需要传给前端

    text = _SENSEVOICE_TAG_RE.sub("", raw_text).strip()
    return {"text": text, **meta}


def clean_asr_output(text: str, audio_sec: float) -> str:
    """幻觉检测：输出字数超音频时长合理范围则截断"""
    if not text:
        return text
    
    max_chars = max(int(audio_sec * 15), 10)
    if len(text) > max_chars:
        log.warning(
            f"幻觉检测: {len(text)} 字/{audio_sec:.1f}s 音频 → 截断到 {max_chars} 字"
        )
        text = text[:max_chars]
    
    return text


def check_chunk_energy(data: bytes) -> int:
    """
    快速检测音频 chunk 的峰值振幅（采样 50 个点）
    
    Args:
        data: PCM Int16 LE 字节流
    
    Returns:
        峰值振幅（0-32767）
    """
    n_samples = len(data) // BYTES_PER_SAMPLE
    if n_samples == 0:
        return 0
    
    check_count = min(50, n_samples)
    step = max(1, n_samples // check_count)
    max_amp = 0
    
    for i in range(0, n_samples, step):
        val = abs(struct.unpack_from("<h", data, i * BYTES_PER_SAMPLE)[0])
        if val > max_amp:
            max_amp = val
    
    return max_amp


def do_transcribe(pcm_bytes: bytes) -> dict:
    """
    同步识别，返回结构化结果。
    
    Returns:
        {
            "text": str,          # 纯文本
            "latency_ms": int,
            "lang": str | None,   # SenseVoice: 语言
            "emotion": str | None,# SenseVoice: 情感
            "event": str | None,  # SenseVoice: 声音事件
        }
    """
    empty = {"text": "", "latency_ms": 0, "lang": None, "emotion": None, "event": None}
    if not asr_engine or not pcm_bytes:
        return empty
    
    seg_sec = len(pcm_bytes) / BYTES_PER_SEC
    log.info(f"音频片段: {seg_sec:.1f}s, {len(pcm_bytes)} bytes")
    
    with tempfile.TemporaryDirectory(prefix="asr_") as tmp:
        t0 = time.time()
        wav_path = pcm_to_wav(pcm_bytes, tmp)
        wav_ms = int((time.time() - t0) * 1000)
        
        t1 = time.time()
        if _is_sensevoice:
            results = asr_engine.generate(
                input=wav_path,
                cache={},
                language="auto",
                use_itn=True,
                batch_size_s=0,
                disable_pbar=True,
            )
        else:
            results = asr_engine.generate(
                input=[wav_path],
                cache={},
                batch_size=1,
                hotwords=[],
                language="中文",
                itn=True,
                disable_pbar=True,
                log_level="ERROR",
            )
        infer_ms = int((time.time() - t1) * 1000)
        
        raw_text = ""
        if results and len(results) > 0:
            raw_text = results[0].get("text", "").strip()
        
        meta = {"lang": None, "emotion": None, "event": None}
        if _is_sensevoice and raw_text:
            parsed = parse_sensevoice_output(raw_text)
            text = parsed["text"]
            meta = {"lang": parsed["lang"], "emotion": parsed["emotion"], "event": parsed["event"]}
        else:
            text = raw_text
        
        text = clean_asr_output(text, seg_sec)
        
        total_ms = wav_ms + infer_ms
        meta_str = ""
        if _is_sensevoice:
            meta_str = f" lang={meta['lang']} emo={meta['emotion']} evt={meta['event']}"
        log.info(
            f"识别: {seg_sec:.1f}s 音频 | wav={wav_ms}ms 推理={infer_ms}ms |{meta_str} "
            f'"{text[:80]}"'
        )
        return {"text": text, "latency_ms": total_ms, **meta}


async def transcribe_async(pcm_bytes: bytes) -> dict:
    """异步版本：在线程池中执行识别"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, do_transcribe, pcm_bytes)


# ==================== WebSocket 流式 ASR ====================

# 预计算常量
MAX_UTTERANCE_BYTES = int(MAX_UTTERANCE_SEC * BYTES_PER_SEC)
MIN_UTTERANCE_BYTES = int(MIN_UTTERANCE_SEC * BYTES_PER_SEC)
SILENCE_BYTES = int(SILENCE_DURATION_SEC * BYTES_PER_SEC)


@app.websocket("/ws/asr")
async def asr_stream(ws: WebSocket):
    """
    流式 ASR — VAD 触发识别
    
    策略：检测说话停顿才触发识别，保证句子完整性。
    - 持续接收 PCM Int16 LE 音频，跟踪每个 chunk 的音量
    - 当检测到"有说话 → 静音超过阈值"时，将整段语音送去识别
    - 安全阀：连续说话超过 MAX_UTTERANCE_SEC 时强制切一次
    """
    await ws.accept()
    log.info("WebSocket 客户端已连接")
    
    if not model_loaded:
        await ws.send_json({"status": "loading", "message": "模型加载中..."})
        while not model_loaded:
            await asyncio.sleep(0.5)
    await ws.send_json({"status": "ready", "message": "模型已就绪"})
    
    # ---- 会话状态 ----
    buffer = bytearray()
    recognized_pos = 0
    committed_text = ""
    connected = True
    pending = asyncio.Event()
    
    # VAD 状态
    speech_start_pos = -1      # 当前语音段的起始位置（-1=没在说话）
    silence_start_pos = -1     # 静音开始的位置
    
    async def receive_chunks():
        """接收 PCM 字节流，做 VAD 检测，在停顿时触发识别"""
        nonlocal connected, speech_start_pos, silence_start_pos, recognized_pos
        
        try:
            while True:
                data = await ws.receive_bytes()
                buf_pos_before = len(buffer)
                buffer.extend(data)
                
                energy = check_chunk_energy(data)
                is_speech = energy > SILENCE_THRESHOLD
                
                if is_speech:
                    # 正在说话
                    if speech_start_pos < 0:
                        speech_start_pos = buf_pos_before
                        # 跳过前面的静音，把 recognized_pos 推进到语音起始前 0.2s
                        margin = int(0.2 * BYTES_PER_SEC)
                        skip_to = max(recognized_pos, buf_pos_before - margin)
                        if skip_to > recognized_pos:
                            skipped_sec = (skip_to - recognized_pos) / BYTES_PER_SEC
                            recognized_pos = skip_to
                            log.info(
                                f"[VAD] 开始说话 pos={speech_start_pos}, "
                                f"跳过 {skipped_sec:.1f}s 静音"
                            )
                        else:
                            log.info(f"[VAD] 开始说话 pos={speech_start_pos}")
                    silence_start_pos = -1
                    
                    # 安全阀：连续说话太久，强制触发识别
                    speech_len = len(buffer) - speech_start_pos
                    if speech_len >= MAX_UTTERANCE_BYTES:
                        log.info(
                            f"[VAD] 连续说话 {speech_len / BYTES_PER_SEC:.1f}s，"
                            f"强制触发识别"
                        )
                        pending.set()
                else:
                    # 静音
                    if silence_start_pos < 0:
                        silence_start_pos = buf_pos_before
                    
                    # 如果之前在说话，检查静音是否够长
                    if speech_start_pos >= 0:
                        silence_len = len(buffer) - silence_start_pos
                        if silence_len >= SILENCE_BYTES:
                            # 停顿够长 → 一句话说完了
                            utterance_bytes = silence_start_pos - recognized_pos
                            log.info(
                                f"[VAD] 检测到停顿 "
                                f"(语音 {utterance_bytes / BYTES_PER_SEC:.1f}s, "
                                f"静音 {silence_len / BYTES_PER_SEC:.1f}s)"
                            )
                            if utterance_bytes >= MIN_UTTERANCE_BYTES:
                                pending.set()
                            else:
                                # 太短的语音（如清嗓子），跳过
                                recognized_pos = len(buffer)
                                log.info("[VAD] 语音太短，跳过")
                            speech_start_pos = -1
                            silence_start_pos = -1
        
        except (WebSocketDisconnect, Exception) as e:
            log.info(f"连接断开: {type(e).__name__}")
            connected = False
            pending.set()
    
    async def recognize_loop():
        """等待 VAD 触发，识别完整语段"""
        nonlocal committed_text, recognized_pos, speech_start_pos
        
        while connected:
            await pending.wait()
            pending.clear()
            
            if not connected:
                break
            
            # 确定识别范围
            available = len(buffer) - recognized_pos
            if available < MIN_UTTERANCE_BYTES:
                continue
            
            # 取音频段（含少量尾部静音没关系，模型能处理）
            end = min(recognized_pos + MAX_UTTERANCE_BYTES, len(buffer))
            segment = bytes(buffer[recognized_pos:end])
            
            try:
                result = await transcribe_async(segment)
                recognized_pos = end
                
                if speech_start_pos >= 0 and speech_start_pos < end:
                    speech_start_pos = end
                
                text = result["text"]
                if text:
                    committed_text = (
                        committed_text + text if committed_text else text
                    )
                    msg = {
                        "partial": committed_text,
                        "latency_ms": result["latency_ms"],
                    }
                    if result.get("lang"):
                        msg["lang"] = result["lang"]
                    if result.get("emotion"):
                        msg["emotion"] = result["emotion"]
                    if result.get("event"):
                        msg["event"] = result["event"]
                    try:
                        await ws.send_json(msg)
                    except Exception:
                        break
            
            except Exception as e:
                log.warning(f"识别异常: {e}")
    
    # 并发运行
    recv_task = asyncio.create_task(receive_chunks())
    recog_task = asyncio.create_task(recognize_loop())
    
    await recv_task
    connected = False
    pending.set()
    recog_task.cancel()
    try:
        await recog_task
    except asyncio.CancelledError:
        pass
    
    # 最终识别：处理断开时尚未识别的尾部
    remaining = len(buffer) - recognized_pos
    if remaining > MIN_UTTERANCE_BYTES:
        segment = bytes(buffer[recognized_pos:])
        try:
            result = await transcribe_async(segment)
            if result["text"]:
                committed_text = (committed_text + result["text"]).strip()
        except Exception:
            pass
    
    if committed_text:
        try:
            await ws.send_json({"final": committed_text})
        except Exception:
            pass
    
    log.info(
        f"会话结束: {len(buffer)} bytes, "
        f"已识别到 {recognized_pos} bytes"
    )


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
