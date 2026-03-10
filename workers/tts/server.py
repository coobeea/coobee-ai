"""
TTS Worker — 语音合成服务

FastAPI + WebSocket 服务，支持两种后端：
  1. 本地 Qwen3-TTS 模型（需要 GPU / Apple Silicon）
  2. Microsoft Edge TTS（免费在线，无需 API Key）

通过 local_config.json 的 model_name 切换：
  - "Qwen3-TTS-*"  → 本地模型
  - "edge-tts"      → 微软 Edge TTS

启动方式（由 RuntimeManager 自动调用）：
    python server.py --port 18101

环境变量（由 RuntimeManager 注入）：
    MODEL_DIR          模型存储目录
    MODELSCOPE_CACHE   ModelScope 缓存目录
"""

import argparse
import asyncio
import base64
import io
import logging
import os
import sys
import time

# FastAPI / uvicorn 按需导入（依赖安装后可用）
try:
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.responses import JSONResponse, Response
    import uvicorn
except ImportError:
    print("[TTS Worker] 缺少依赖，请先安装: pip install fastapi uvicorn", file=sys.stderr)
    sys.exit(1)

# ==================== 配置 ====================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_NAME = "Qwen3-TTS-12Hz-1.7B-CustomVoice"

DEFAULT_MODEL_DIR = os.path.join(os.environ.get("HOME", ""), ".cache", "modelscope", "hub")
MODEL_DIR = os.environ.get("MODEL_DIR", DEFAULT_MODEL_DIR)

API_KEY = os.environ.get("DASHSCOPE_API_KEY", "")
API_URL = ""

# 一次性读取 local_config.json（所有配置项）
local_config_path = os.path.join(SCRIPT_DIR, "local_config.json")
if os.path.exists(local_config_path):
    try:
        import json
        with open(local_config_path, "r", encoding="utf-8") as f:
            _cfg = json.load(f)

        if isinstance(_cfg, dict):
            if "model_dir" in _cfg and isinstance(_cfg["model_dir"], str):
                p = _cfg["model_dir"]
                if not os.path.isabs(p):
                    p = os.path.abspath(os.path.join(SCRIPT_DIR, p))
                MODEL_DIR = p
                print(f"[TTS Config] MODEL_DIR -> {MODEL_DIR}")

            if "model_name" in _cfg and isinstance(_cfg["model_name"], str) and _cfg["model_name"].strip():
                MODEL_NAME = _cfg["model_name"].strip()
                print(f"[TTS Config] MODEL_NAME -> {MODEL_NAME}")

            if "api_key" in _cfg and isinstance(_cfg["api_key"], str) and _cfg["api_key"].strip():
                API_KEY = _cfg["api_key"].strip()
                print("[TTS Config] API_KEY loaded from local_config")

            if "api_url" in _cfg and isinstance(_cfg["api_url"], str) and _cfg["api_url"].strip():
                API_URL = _cfg["api_url"].strip()
                print(f"[TTS Config] API_URL -> {API_URL}")
    except Exception as e:
        print(f"[TTS Config] 读取本地配置失败: {e}", file=sys.stderr)

logging.basicConfig(level=logging.INFO, format="[TTS] %(message)s")
log = logging.getLogger("tts")

app = FastAPI(title="TTS Worker", version="0.2.0")

# 模式检测（strip + lower 容错）
_model_lower = MODEL_NAME.lower()
USE_EDGE_TTS = _model_lower == "edge-tts"
USE_COSYVOICE = _model_lower.startswith("aliyun/cosyvoice")
COSYVOICE_MODEL = MODEL_NAME.split("/", 1)[1] if USE_COSYVOICE and "/" in MODEL_NAME else ""

# ==================== 全局状态 ====================

tts_model = None
model_loaded = False

# Qwen3 TTS 音色
SPEAKER_INFO = {
    "vivian": "明亮略带锐利的年轻女声（中文）",
    "serena": "温暖温柔的年轻女声（中文）",
    "uncle_fu": "低沉醇厚的成熟男声（中文）",
    "dylan": "清亮自然的北京男声（中文/北京话）",
    "eric": "活泼微沙的成都男声（中文/四川话）",
    "ryan": "富有节奏感的动感男声（英文）",
    "aiden": "阳光清朗的美式男声（英文）",
    "ono_anna": "灵动俏皮的日本女声（日文）",
    "sohee": "情感丰富的温暖韩国女声（韩文）",
}

# Edge TTS 音色映射
EDGE_VOICE_MAP = {
    "xiaoxiao": "zh-CN-XiaoxiaoNeural",
    "xiaoyi": "zh-CN-XiaoyiNeural",
    "yunyang": "zh-CN-YunyangNeural",
    "yunjian": "zh-CN-YunjianNeural",
    "yunxi": "zh-CN-YunxiNeural",
    # 向前兼容：Qwen3 音色名映射到 Edge TTS 最接近的音色
    "vivian": "zh-CN-XiaoxiaoNeural",
    "serena": "zh-CN-XiaoyiNeural",
    "uncle_fu": "zh-CN-YunjianNeural",
    "dylan": "zh-CN-YunxiNeural",
    "eric": "zh-CN-YunxiNeural",
    "ryan": "en-US-GuyNeural",
    "aiden": "en-US-GuyNeural",
    "ono_anna": "ja-JP-NanamiNeural",
    "sohee": "ko-KR-SunHiNeural",
}

EDGE_SPEAKER_INFO = {
    "xiaoxiao": "温暖亲切的年轻女声（中文）",
    "xiaoyi": "清脆清晰的年轻女声（中文）",
    "yunyang": "专业自然的男声（中文）",
    "yunjian": "沉稳低沉的男声（中文）",
    "yunxi": "温和自然的男声（中文）",
}

LANG_MAP = {
    "zh": "chinese", "cn": "chinese", "中文": "chinese", "chinese": "chinese",
    "en": "english", "英文": "english", "english": "english",
    "ja": "japanese", "日文": "japanese", "japanese": "japanese",
    "ko": "korean", "韩文": "korean", "korean": "korean",
    "de": "german", "德文": "german", "german": "german",
    "fr": "french", "法文": "french", "french": "french",
    "ru": "russian", "俄文": "russian", "russian": "russian",
    "pt": "portuguese", "葡文": "portuguese", "portuguese": "portuguese",
    "es": "spanish", "西文": "spanish", "spanish": "spanish",
    "it": "italian", "意文": "italian", "italian": "italian",
    "auto": "auto",
}


# ==================== 模型加载 ====================

def detect_device() -> str:
    """自动选择最佳计算设备，并进行环境优化"""
    import torch
    
    device = "cpu"
    
    if torch.cuda.is_available():
        device = "cuda:0"
        # CUDA 优化: 开启 CuDNN Benchmark
        torch.backends.cudnn.benchmark = True
        log.info("[优化] 已开启 CUDA CuDNN Benchmark")
    elif torch.backends.mps.is_available():
        device = "mps"
        # macOS MPS 优化: 允许回退到 CPU (防止某些算子不支持导致崩溃)
        os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
        log.info("[优化] 已开启 MPS Fallback")
    
    # CPU 线程优化: 默认设为物理核心数的一半 (避免过度抢占)
    # 对于 TTS 这种计算密集型任务，过多的线程反而会增加上下文切换开销
    if device == "cpu":
        try:
            num_cores = os.cpu_count() or 4
            # 经验值：设置为物理核数（通常是 cpu_count / 2）
            num_threads = max(1, num_cores // 2)
            torch.set_num_threads(num_threads)
            log.info(f"[优化] CPU 线程数设置为: {num_threads}")
        except Exception as e:
            log.warning(f"CPU 线程优化失败: {e}")
            
    return device


def load_tts_model():
    """加载 Qwen3-TTS 模型"""
    global tts_model, model_loaded
    
    import torch
    from qwen_tts import Qwen3TTSModel
    
    device = detect_device()
    # 兼容性调整：不再硬编码 "Qwen" 子目录，直接在 MODEL_DIR 下查找
    # 如果用户遵循 ModelScope 结构 (MODEL_DIR/Qwen/MODEL_NAME)，需要将 MODEL_DIR 设为 MODEL_DIR/Qwen
    model_path = os.path.join(MODEL_DIR, MODEL_NAME)
    
    # 向后兼容：如果直接拼接找不到，尝试加一层 "Qwen" (适配旧配置)
    if not os.path.exists(model_path):
        fallback_path = os.path.join(MODEL_DIR, "Qwen", MODEL_NAME)
        if os.path.exists(fallback_path):
            model_path = fallback_path

    log.info(f"加载模型: {MODEL_NAME}")
    log.info(f"设备: {device}")
    log.info(f"模型路径: {model_path}")
    
    t0 = time.time()
    
    # 精度优化策略
    if device == "cuda:0":
        # GPU (NVIDIA): 使用 bfloat16 (如果硬件支持) 或 float16
        dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    elif device == "mps":
        # GPU (macOS): 强制使用 float16 (Apple Silicon 对 fp16 优化极佳)
        dtype = torch.float16
    else:
        # CPU: 默认 float32 (bfloat16 在某些 CPU 上也支持，暂保守使用 fp32)
        dtype = torch.float32
        
    log.info(f"[优化] 使用计算精度: {dtype}")
    
    tts_model = Qwen3TTSModel.from_pretrained(
        model_path,
        device_map=device,
        dtype=dtype,
    )
    
    elapsed = time.time() - t0
    log.info(f"模型加载完成，耗时 {elapsed:.1f}s")
    
    model_loaded = True


def synthesize_audio(text: str, speaker: str = "vivian", language: str = "chinese", instruct: str = ""):
    """执行本地模型语音合成（Qwen3-TTS）"""
    if not model_loaded or tts_model is None:
        raise RuntimeError("TTS 模型未加载")
    
    log.info(f"[Local] 合成: \"{text[:50]}{'...' if len(text) > 50 else ''}\"")
    log.info(f"  音色: {speaker} | 语言: {language}")
    if instruct:
        log.info(f"  指令: {instruct}")
    
    t0 = time.time()
    
    kwargs = {
        "text": text,
        "language": language,
        "speaker": speaker,
    }
    if instruct:
        kwargs["instruct"] = instruct
    
    wavs, sr = tts_model.generate_custom_voice(**kwargs)
    
    elapsed = time.time() - t0
    duration = len(wavs[0]) / sr
    log.info(f"  完成: {duration:.1f}s 音频, 耗时 {elapsed:.1f}s (RTF: {elapsed/duration:.2f})")
    
    return wavs[0], sr


ONLINE_TTS_TIMEOUT = 30  # seconds
MAX_RETRIES = 2


async def _edge_tts_once(text: str, voice_id: str) -> bytes:
    """单次 Edge TTS 调用（带超时）"""
    import edge_tts

    communicate = edge_tts.Communicate(text, voice_id)
    audio_buffer = io.BytesIO()

    async for chunk in communicate.stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            audio_buffer.write(chunk["data"])

    return audio_buffer.getvalue()


async def synthesize_edge_tts(text: str, speaker: str = "xiaoxiao") -> bytes:
    """使用 Microsoft Edge TTS 合成音频（免费在线，带超时和重试）"""
    try:
        import edge_tts  # noqa: F401
    except ImportError:
        raise RuntimeError("edge-tts 未安装，请运行: pip install edge-tts")

    voice_id = EDGE_VOICE_MAP.get(speaker or "xiaoxiao", "zh-CN-XiaoxiaoNeural")
    log.info(f"[Edge TTS] 合成: \"{text[:50]}{'...' if len(text) > 50 else ''}\"")
    log.info(f"  音色: {speaker} -> {voice_id}")

    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        t0 = time.time()
        try:
            audio_bytes = await asyncio.wait_for(
                _edge_tts_once(text, voice_id),
                timeout=ONLINE_TTS_TIMEOUT
            )

            if not audio_bytes:
                raise RuntimeError("Edge TTS 返回了空音频数据")

            elapsed = time.time() - t0
            log.info(f"  完成: {len(audio_bytes)} bytes, 耗时 {elapsed:.1f}s")
            return audio_bytes

        except asyncio.TimeoutError:
            elapsed = time.time() - t0
            last_err = f"请求超时 ({ONLINE_TTS_TIMEOUT}s)"
            log.warning(f"  [尝试 {attempt}/{MAX_RETRIES}] Edge TTS 超时 ({elapsed:.1f}s)")
        except Exception as e:
            elapsed = time.time() - t0
            last_err = str(e)
            log.warning(f"  [尝试 {attempt}/{MAX_RETRIES}] Edge TTS 失败 ({elapsed:.1f}s): {e}")

        if attempt < MAX_RETRIES:
            wait = attempt * 1.0
            log.info(f"  {wait}s 后重试...")
            await asyncio.sleep(wait)

    raise RuntimeError(f"Edge TTS 合成失败（已重试 {MAX_RETRIES} 次）: {last_err}")


# CosyVoice 默认音色（阿里云百炼）
COSYVOICE_VOICE_MAP = {
    "longanyang": "longanyang",          # 阳光大男孩
    "longanhuan": "longanhuan",          # 欢脱元气女
    "longxiaochun": "longxiaochun",      # 温柔知性女
    "longxiaobai": "longxiaobai",        # 活泼女声
    "longshu": "longshu",                # 知性女声
    "longhua": "longhua",                # 标准男声
    "longshuo": "longshuo",              # 温和男声
    "longwan": "longwan",                # 清新女声
    "longfei": "longfei",                # 激昂朗诵男声
    "longyue": "longyue",                # 女声朗诵
    # 向前兼容 Qwen3-TTS 音色名
    "vivian": "longxiaochun",
    "serena": "longwan",
    "uncle_fu": "longhua",
    "dylan": "longshu",
    "xiaoxiao": "longxiaochun",
}

COSYVOICE_SPEAKER_INFO = {
    "longanyang": "阳光大男孩（20-30岁，中文/英文）",
    "longanhuan": "欢脱元气女（20-30岁，中文/英文）",
    "longxiaochun": "温柔知性女声（中文）",
    "longxiaobai": "活泼俏皮女声（中文）",
    "longshu": "知性女声（中文）",
    "longhua": "标准男声（中文）",
    "longshuo": "温和男声（中文）",
    "longwan": "清新女声（中文）",
    "longfei": "激昂朗诵男声（中文）",
    "longyue": "女声朗诵（中文）",
}


def _cosyvoice_once(text: str, voice: str) -> bytes:
    """单次 CosyVoice SDK 调用"""
    import dashscope
    from dashscope.audio.tts_v2 import SpeechSynthesizer

    dashscope.api_key = API_KEY
    if API_URL:
        dashscope.base_websocket_api_url = API_URL
    else:
        dashscope.base_websocket_api_url = "wss://dashscope.aliyuncs.com/api-ws/v1/inference"

    synthesizer = SpeechSynthesizer(model=COSYVOICE_MODEL, voice=voice)
    audio = synthesizer.call(text)

    try:
        log.info(f"  requestId: {synthesizer.get_last_request_id()}, "
                 f"首包延迟: {synthesizer.get_first_package_delay()} ms")
    except Exception:
        pass

    return audio


def synthesize_cosyvoice_sync(text: str, speaker: str = "longxiaochun") -> bytes:
    """使用阿里云 CosyVoice 合成音频（带重试）"""
    try:
        import dashscope  # noqa: F401
    except ImportError:
        raise RuntimeError("dashscope SDK 未安装，请运行: pip install dashscope")

    if not API_KEY:
        raise RuntimeError("未配置 API Key，请在设置中配置阿里云 DashScope API Key")

    if not COSYVOICE_MODEL:
        raise RuntimeError("CosyVoice 模型名无效，请检查 model_name 配置")

    voice = COSYVOICE_VOICE_MAP.get(speaker, speaker) if speaker else "longxiaochun"
    log.info(f"[CosyVoice] 合成: \"{text[:50]}{'...' if len(text) > 50 else ''}\"")
    log.info(f"  模型: {COSYVOICE_MODEL} | 音色: {voice}")

    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        t0 = time.time()
        try:
            audio = _cosyvoice_once(text, voice)

            if not audio or not isinstance(audio, (bytes, bytearray)):
                raise RuntimeError("CosyVoice 返回了空音频数据")

            elapsed = time.time() - t0
            log.info(f"  完成: {len(audio)} bytes, 耗时 {elapsed:.1f}s")
            return bytes(audio)

        except Exception as e:
            elapsed = time.time() - t0
            last_err = str(e)
            log.warning(f"  [尝试 {attempt}/{MAX_RETRIES}] CosyVoice 失败 ({elapsed:.1f}s): {e}")

        if attempt < MAX_RETRIES:
            wait = attempt * 1.5
            log.info(f"  {wait}s 后重试...")
            time.sleep(wait)

    raise RuntimeError(f"CosyVoice 合成失败（已重试 {MAX_RETRIES} 次）: {last_err}")


# ==================== HTTP 接口 ====================

@app.get("/health")
async def health():
    """健康检查（RuntimeManager 轮询此接口判断是否就绪）"""
    backend = "cosyvoice" if USE_COSYVOICE else ("edge-tts" if USE_EDGE_TTS else "local")
    resp = {
        "status": "ok",
        "model_loaded": model_loaded,
        "backend": backend,
        "model_name": MODEL_NAME,
    }
    if USE_COSYVOICE:
        resp["api_key_configured"] = bool(API_KEY)
        resp["cosyvoice_model"] = COSYVOICE_MODEL
    elif not USE_EDGE_TTS:
        resp["model_dir"] = MODEL_DIR
    return JSONResponse(resp)


@app.post("/api/tts")
async def tts_sync(request: dict):
    """
    同步 TTS 接口（整段合成后返回）

    请求体: { 
        "text": "你好", 
        "speaker": "vivian",  # 可选
        "language": "chinese",  # 可选，仅本地模型使用
        "instruct": ""  # 可选，仅本地模型使用
    }
    响应: audio/wav 或 audio/mpeg
    """
    text = request.get("text", "")
    if not text:
        return JSONResponse({"error": "缺少 text 字段"}, status_code=400)
    
    default_speaker = "longxiaochun" if USE_COSYVOICE else ("xiaoxiao" if USE_EDGE_TTS else "vivian")
    speaker = (request.get("speaker") or default_speaker).strip().lower()

    if USE_COSYVOICE:
        try:
            loop = asyncio.get_event_loop()
            audio_bytes = await loop.run_in_executor(None, synthesize_cosyvoice_sync, text, speaker)
            return Response(
                content=audio_bytes,
                media_type="audio/mpeg",
                headers={"Content-Disposition": "attachment; filename=tts_output.mp3"}
            )
        except Exception as e:
            log.error(f"CosyVoice 合成失败: {e}")
            return JSONResponse({"error": str(e)}, status_code=500)
    elif USE_EDGE_TTS:
        try:
            audio_bytes = await synthesize_edge_tts(text, speaker)
            return Response(
                content=audio_bytes,
                media_type="audio/mpeg",
                headers={"Content-Disposition": "attachment; filename=tts_output.mp3"}
            )
        except Exception as e:
            log.error(f"Edge TTS 合成失败: {e}")
            return JSONResponse({"error": str(e)}, status_code=500)
    else:
        if not model_loaded:
            return JSONResponse({"error": "模型未加载"}, status_code=503)

        language = request.get("language", "chinese").lower()
        instruct = request.get("instruct", "")
        language = LANG_MAP.get(language, language)

        if speaker not in SPEAKER_INFO:
            return JSONResponse({
                "error": f"未知音色 '{speaker}'",
                "available": list(SPEAKER_INFO.keys())
            }, status_code=400)

        try:
            import soundfile as sf
            wav_data, sr = synthesize_audio(text, speaker, language, instruct)
            wav_buffer = io.BytesIO()
            sf.write(wav_buffer, wav_data, sr, format='WAV')
            wav_buffer.seek(0)
            return Response(
                content=wav_buffer.read(),
                media_type="audio/wav",
                headers={"Content-Disposition": "attachment; filename=tts_output.wav"}
            )
        except Exception as e:
            log.error(f"合成失败: {e}")
            return JSONResponse({"error": str(e)}, status_code=500)


@app.websocket("/ws/tts")
async def tts_stream(ws: WebSocket):
    """
    流式 TTS 接口（长连接）

    客户端发送: { "text": "你好", "speaker": "vivian", "language": "chinese", "instruct": "" }
    服务端返回:
        1. {"status": "processing"}
        2. {"audio": "<base64>", "duration": 2.5}  (Edge TTS 无 duration)
        3. {"done": true}
    """
    await ws.accept()
    log.info("WebSocket 客户端已连接")
    
    try:
        while True:
            data = await ws.receive_json()
            
            text = data.get("text", "")
            if not text:
                await ws.send_json({"error": "缺少 text 字段"})
                continue
            
            default_spk = "longxiaochun" if USE_COSYVOICE else ("xiaoxiao" if USE_EDGE_TTS else "vivian")
            speaker = data.get("speaker", default_spk).lower()

            if USE_COSYVOICE:
                try:
                    await ws.send_json({"status": "processing", "text": text[:50]})
                    loop = asyncio.get_event_loop()
                    audio_bytes = await loop.run_in_executor(
                        None, synthesize_cosyvoice_sync, text, speaker
                    )
                    audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
                    await ws.send_json({"audio": audio_b64, "format": "mp3"})
                    await ws.send_json({"done": True})
                except Exception as e:
                    log.error(f"CosyVoice 合成失败: {e}")
                    await ws.send_json({"error": str(e)})
            elif USE_EDGE_TTS:
                try:
                    await ws.send_json({"status": "processing", "text": text[:50]})
                    audio_bytes = await synthesize_edge_tts(text, speaker)
                    audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
                    await ws.send_json({"audio": audio_b64, "format": "mp3"})
                    await ws.send_json({"done": True})
                except Exception as e:
                    log.error(f"Edge TTS 合成失败: {e}")
                    await ws.send_json({"error": str(e)})
            else:
                if not model_loaded:
                    await ws.send_json({"error": "模型未加载"})
                    continue

                language = data.get("language", "chinese").lower()
                instruct = data.get("instruct", "")
                language = LANG_MAP.get(language, language)

                if speaker not in SPEAKER_INFO:
                    await ws.send_json({
                        "error": f"未知音色 '{speaker}'",
                        "available": list(SPEAKER_INFO.keys())
                    })
                    continue

                try:
                    import soundfile as sf
                    await ws.send_json({"status": "processing", "text": text[:50]})
                    loop = asyncio.get_event_loop()
                    wav_data, sr = await loop.run_in_executor(
                        None, synthesize_audio, text, speaker, language, instruct
                    )
                    wav_buffer = io.BytesIO()
                    sf.write(wav_buffer, wav_data, sr, format='WAV')
                    wav_buffer.seek(0)
                    audio_b64 = base64.b64encode(wav_buffer.read()).decode('utf-8')
                    duration = len(wav_data) / sr
                    await ws.send_json({
                        "audio": audio_b64,
                        "duration": round(duration, 2),
                        "sample_rate": sr
                    })
                    await ws.send_json({"done": True})
                except Exception as e:
                    log.error(f"合成失败: {e}")
                    await ws.send_json({"error": str(e)})
                
    except WebSocketDisconnect:
        log.info("WebSocket 客户端断开")
    except Exception as e:
        log.error(f"WebSocket 异常: {type(e).__name__}: {e}")


@app.get("/api/speakers")
async def list_speakers():
    """列出所有可用音色"""
    if USE_COSYVOICE:
        return JSONResponse({
            "speakers": COSYVOICE_SPEAKER_INFO,
            "backend": "cosyvoice",
            "model": COSYVOICE_MODEL,
            "languages": ["chinese", "english", "japanese", "korean", "french", "german", "russian"]
        })
    if USE_EDGE_TTS:
        return JSONResponse({
            "speakers": EDGE_SPEAKER_INFO,
            "backend": "edge-tts",
            "languages": ["chinese", "english", "japanese", "korean"]
        })
    return JSONResponse({
        "speakers": SPEAKER_INFO,
        "backend": "local",
        "languages": sorted(set(LANG_MAP.values()))
    })


# ==================== 启动事件 ====================

@app.on_event("startup")
async def startup_event():
    """应用启动时加载模型"""
    global model_loaded

    if USE_COSYVOICE:
        log.info(f"使用阿里云 CosyVoice（{COSYVOICE_MODEL}），跳过本地模型加载")
        try:
            import dashscope  # noqa: F401
            log.info("dashscope SDK 已就绪")
            if not API_KEY:
                log.warning("未配置 API Key！合成请求将会失败，请在设置中配置 DashScope API Key")
            if not COSYVOICE_MODEL:
                log.error("CosyVoice 模型名无效！请检查 model_name 配置格式: aliyun/cosyvoice-v3-flash")
            model_loaded = True
        except ImportError:
            log.error("dashscope SDK 未安装！请运行: pip install dashscope")
    elif USE_EDGE_TTS:
        log.info("使用 Microsoft Edge TTS（免费在线），跳过本地模型加载")
        try:
            import edge_tts  # noqa: F401
            log.info("edge-tts 库已就绪")
            model_loaded = True
        except ImportError:
            log.error("edge-tts 未安装！请运行: pip install edge-tts")
    else:
        log.info("使用本地模型，准备加载...")
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, load_tts_model)
    
    log.info("应用启动完成")


# ==================== 启动 ====================

def main():
    parser = argparse.ArgumentParser(description="TTS Worker Server")
    parser.add_argument("--port", type=int, default=18101, help="服务端口")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="绑定地址")
    args = parser.parse_args()

    log.info(f"启动服务 {args.host}:{args.port}")
    log.info(f"MODEL_DIR = {MODEL_DIR}")

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
