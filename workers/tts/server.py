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
            if "model_dir" in config:
                p = config["model_dir"]
                if not os.path.isabs(p):
                    p = os.path.abspath(os.path.join(SCRIPT_DIR, p))
                MODEL_DIR = p
                print(f"[TTS Config] 已加载本地配置，MODEL_DIR -> {MODEL_DIR}")

            if "model_name" in config:
                MODEL_NAME = config["model_name"]
                print(f"[TTS Config] MODEL_NAME -> {MODEL_NAME}")
    except Exception as e:
        print(f"[TTS Config] 读取本地配置失败: {e}", file=sys.stderr)

logging.basicConfig(level=logging.INFO, format="[TTS] %(message)s")
log = logging.getLogger("tts")

app = FastAPI(title="TTS Worker", version="0.2.0")

# ==================== 全局状态 ====================

tts_model = None
model_loaded = False

# 音色和语言配置
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
    """执行语音合成
    
    Args:
        text: 要合成的文本
        speaker: 音色名
        language: 语言
        instruct: 情绪/风格指令（可选）
    
    Returns:
        tuple: (wav_data_np_array, sample_rate)
    """
    if not model_loaded or tts_model is None:
        raise RuntimeError("TTS 模型未加载")
    
    log.info(f"合成: \"{text[:50]}{'...' if len(text) > 50 else ''}\"")
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


# ==================== HTTP 接口 ====================

@app.get("/health")
async def health():
    """健康检查（RuntimeManager 轮询此接口判断是否就绪）"""
    return JSONResponse({
        "status": "ok",
        "model_loaded": model_loaded,
        "model_dir": MODEL_DIR,
    })


@app.post("/api/tts")
async def tts_sync(request: dict):
    """
    同步 TTS 接口（整段合成后返回）

    请求体: { 
        "text": "你好", 
        "speaker": "vivian",  # 可选，默认 vivian
        "language": "chinese",  # 可选，默认 chinese
        "instruct": ""  # 可选，情绪指令
    }
    响应: WAV 二进制（audio/wav）
    """
    if not model_loaded:
        return JSONResponse({"error": "模型未加载"}, status_code=503)
    
    text = request.get("text", "")
    if not text:
        return JSONResponse({"error": "缺少 text 字段"}, status_code=400)
    
    speaker = request.get("speaker", "vivian").lower()
    language = request.get("language", "chinese").lower()
    instruct = request.get("instruct", "")
    
    # 规范化语言
    language = LANG_MAP.get(language, language)
    
    # 验证音色
    if speaker not in SPEAKER_INFO:
        return JSONResponse({
            "error": f"未知音色 '{speaker}'",
            "available": list(SPEAKER_INFO.keys())
        }, status_code=400)
    
    try:
        import soundfile as sf
        
        # 执行合成
        wav_data, sr = synthesize_audio(text, speaker, language, instruct)
        
        # 转换为 WAV 格式
        wav_buffer = io.BytesIO()
        sf.write(wav_buffer, wav_data, sr, format='WAV')
        wav_buffer.seek(0)
        
        return Response(
            content=wav_buffer.read(),
            media_type="audio/wav",
            headers={
                "Content-Disposition": "attachment; filename=tts_output.wav"
            }
        )
    except Exception as e:
        log.error(f"合成失败: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.websocket("/ws/tts")
async def tts_stream(ws: WebSocket):
    """
    流式 TTS 接口（长连接）

    客户端发送: { 
        "text": "你好", 
        "speaker": "vivian",
        "language": "chinese",
        "instruct": ""
    }
    服务端返回: 
        1. {"status": "processing"}
        2. {"audio": "<base64_wav>", "duration": 2.5}
        3. {"done": true}

    连接保持直到客户端断开，可多次发送文本。
    """
    await ws.accept()
    log.info("WebSocket 客户端已连接")
    
    try:
        while True:
            data = await ws.receive_json()
            
            if not model_loaded:
                await ws.send_json({"error": "模型未加载"})
                continue
            
            text = data.get("text", "")
            if not text:
                await ws.send_json({"error": "缺少 text 字段"})
                continue
            
            speaker = data.get("speaker", "vivian").lower()
            language = data.get("language", "chinese").lower()
            instruct = data.get("instruct", "")
            
            # 规范化语言
            language = LANG_MAP.get(language, language)
            
            # 验证音色
            if speaker not in SPEAKER_INFO:
                await ws.send_json({
                    "error": f"未知音色 '{speaker}'",
                    "available": list(SPEAKER_INFO.keys())
                })
                continue
            
            try:
                import soundfile as sf
                
                # 通知开始处理
                await ws.send_json({"status": "processing", "text": text[:50]})
                
                # 在线程池中执行合成（避免阻塞事件循环）
                loop = asyncio.get_event_loop()
                wav_data, sr = await loop.run_in_executor(
                    None, 
                    synthesize_audio, 
                    text, speaker, language, instruct
                )
                
                # 转换为 WAV 格式
                wav_buffer = io.BytesIO()
                sf.write(wav_buffer, wav_data, sr, format='WAV')
                wav_buffer.seek(0)
                
                # 编码为 base64 发送
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
    return JSONResponse({
        "speakers": SPEAKER_INFO,
        "languages": sorted(set(LANG_MAP.values()))
    })


# ==================== 启动事件 ====================

@app.on_event("startup")
async def startup_event():
    """应用启动时加载模型"""
    log.info("应用启动，准备加载模型...")
    
    # 在后台线程加载模型（避免阻塞启动）
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
