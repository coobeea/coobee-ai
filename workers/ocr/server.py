"""
OCR Worker — 本地图像识别服务

FastAPI + WebSocket 服务，封装本地 GLM-OCR 模型。
由 RuntimeManager 管理生命周期。

启动方式（由 RuntimeManager 自动调用）：
    python server.py --port 18102

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

# FastAPI / uvicorn 按需导入
try:
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.responses import JSONResponse
    import uvicorn
except ImportError:
    print("[OCR Worker] 缺少依赖，请先安装: pip install fastapi uvicorn", file=sys.stderr)
    sys.exit(1)

# ==================== 配置 ====================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_NAME = "GLM-OCR"

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
                # 支持相对路径
                p = config["model_dir"]
                if not os.path.isabs(p):
                    p = os.path.abspath(os.path.join(SCRIPT_DIR, p))
                MODEL_DIR = p
                print(f"[OCR Config] 已加载本地配置，MODEL_DIR -> {MODEL_DIR}")
    except Exception as e:
        print(f"[OCR Config] 读取本地配置失败: {e}", file=sys.stderr)

logging.basicConfig(level=logging.INFO, format="[OCR] %(message)s")
log = logging.getLogger("ocr")

app = FastAPI(title="OCR Worker", version="0.2.0")

# ==================== 全局状态 ====================

ocr_processor = None
ocr_model = None
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


def load_ocr_model():
    """加载 GLM-OCR 模型"""
    global ocr_processor, ocr_model, model_loaded
    
    import torch
    from transformers import AutoProcessor, AutoModelForImageTextToText
    
    device = detect_device()
    model_path = os.path.join(MODEL_DIR, MODEL_NAME)
    
    log.info(f"加载模型: {MODEL_NAME}")
    log.info(f"设备: {device}")
    log.info(f"模型路径: {model_path}")
    
    # 设置缓存目录
    os.environ.setdefault("MODELSCOPE_CACHE", MODEL_DIR)
    os.environ.setdefault("HF_HOME", MODEL_DIR)
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", os.path.join(MODEL_DIR, "hub"))
    
    t0 = time.time()
    
    # 加载处理器
    log.info("加载 Processor...")
    ocr_processor = AutoProcessor.from_pretrained(
        model_path,
        trust_remote_code=True
    )
    
    # 加载模型
    log.info("加载模型...")
    dtype = torch.bfloat16 if device == "cuda:0" else torch.float32
    ocr_model = AutoModelForImageTextToText.from_pretrained(
        model_path,
        torch_dtype=dtype,
        trust_remote_code=True
    )
    ocr_model.to(device)
    ocr_model.eval()
    
    elapsed = time.time() - t0
    model_loaded = True
    log.info(f"模型加载完成，耗时 {elapsed:.1f}s")


@app.on_event("startup")
async def startup_event():
    """应用启动时加载模型（在线程池中执行，不阻塞事件循环）"""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, load_ocr_model)


# ==================== HTTP 接口 ====================

@app.get("/health")
async def health():
    """健康检查（RuntimeManager 轮询此接口判断是否就绪）"""
    return JSONResponse({
        "status": "ok",
        "model_loaded": model_loaded,
        "model_dir": MODEL_DIR,
    })


@app.post("/api/ocr")
async def ocr_sync(request: dict):
    """
    同步 OCR 接口（整张图片识别后返回）
    
    请求体: { 
        "image": "base64_encoded_image_data",
        "task": "text|formula|table"  # 可选，默认 text
    }
    响应: { 
        "text": "识别的文本内容",
        "success": true|false,
        "error": "错误信息（如果有）"
    }
    """
    if not model_loaded:
        return JSONResponse({
            "success": False,
            "error": "模型加载中..."
        }, status_code=503)
    
    # 获取图片数据
    image_data = request.get("image", "")
    task = request.get("task", "text")
    
    if not image_data:
        return JSONResponse({
            "success": False,
            "error": "缺少 image 字段"
        }, status_code=400)
    
    try:
        # 解码 base64 图片
        image_bytes = base64.b64decode(image_data)
        
        # 调用 OCR
        text, latency_ms = await recognize_image_async(image_bytes, task)
        
        return JSONResponse({
            "success": True,
            "text": text,
            "latency_ms": latency_ms
        })
            
    except Exception as e:
        log.error(f"OCR 处理异常: {e}")
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)


@app.websocket("/ws/ocr")
async def ocr_stream(ws: WebSocket):
    """
    流式 OCR 接口（长连接）
    
    客户端发送: { 
        "image": "base64_encoded_image_data",
        "task": "text|formula|table"  # 可选，默认 text
    }
    服务端返回: 
        { "status": "processing", "message": "正在识别..." }
        { "status": "success", "text": "识别结果", "latency_ms": 1234 }
        或 { "status": "error", "error": "错误信息" }
    """
    await ws.accept()
    log.info("WebSocket 客户端已连接")
    
    if not model_loaded:
        await ws.send_json({
            "status": "loading",
            "message": "模型加载中..."
        })
        while not model_loaded:
            await asyncio.sleep(0.5)
    
    await ws.send_json({
        "status": "ready",
        "message": "OCR 服务已就绪"
    })
    
    try:
        while True:
            data = await ws.receive_json()
            
            image_data = data.get("image", "")
            task = data.get("task", "text")
            
            if not image_data:
                await ws.send_json({
                    "status": "error",
                    "error": "缺少 image 字段"
                })
                continue
            
            await ws.send_json({
                "status": "processing",
                "message": "正在识别..."
            })
            
            try:
                # 解码 base64 图片
                image_bytes = base64.b64decode(image_data)
                
                # 调用 OCR
                text, latency_ms = await recognize_image_async(image_bytes, task)
                
                await ws.send_json({
                    "status": "success",
                    "text": text,
                    "latency_ms": latency_ms
                })
                    
            except Exception as e:
                log.error(f"OCR 处理异常: {e}")
                await ws.send_json({
                    "status": "error",
                    "error": str(e)
                })
    
    except (WebSocketDisconnect, Exception) as e:
        log.info(f"WebSocket 断开: {type(e).__name__}")


# ==================== OCR 处理 ====================

# 任务提示词映射
TASK_PROMPTS = {
    "text": "Text Recognition:",
    "formula": "Formula Recognition:",
    "table": "Table Recognition:"
}


def do_recognize(image_bytes: bytes, task: str = "text") -> tuple[str, int]:
    """
    同步识别，返回 (文本, 推理耗时ms)
    
    Args:
        image_bytes: 图片字节流
        task: 任务类型 (text | formula | table)
    
    Returns:
        (识别文本, 推理耗时ms)
    """
    if not ocr_model or not ocr_processor:
        return "", 0
    
    import torch
    from PIL import Image
    
    # 从字节流加载图片
    image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
    
    # 获取任务提示词
    prompt = TASK_PROMPTS.get(task, "Text Recognition:")
    
    # 构建消息（虚拟路径，仅用于格式）
    messages = [{
        "role": "user",
        "content": [
            {"type": "image", "url": "image"},
            {"type": "text", "text": prompt}
        ]
    }]
    
    t0 = time.time()
    
    # 应用聊天模板
    inputs = ocr_processor.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_dict=True,
        return_tensors="pt"
    ).to(ocr_model.device)
    
    # 移除不需要的 token_type_ids
    inputs.pop("token_type_ids", None)
    
    # 推理
    with torch.no_grad():
        generated_ids = ocr_model.generate(**inputs, max_new_tokens=8192)
    
    # 解码结果
    text = ocr_processor.decode(
        generated_ids[0][inputs["input_ids"].shape[1]:],
        skip_special_tokens=True
    )
    
    infer_ms = int((time.time() - t0) * 1000)
    
    log.info(f'识别完成: {task} 任务 | 耗时={infer_ms}ms | 字符数={len(text)}')
    
    return text, infer_ms


async def recognize_image_async(image_bytes: bytes, task: str = "text") -> tuple[str, int]:
    """异步版本：在线程池中执行识别"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, do_recognize, image_bytes, task)


# ==================== 启动 ====================

def main():
    parser = argparse.ArgumentParser(description="OCR Worker Server")
    parser.add_argument("--port", type=int, default=18102, help="服务端口")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="绑定地址")
    args = parser.parse_args()

    print(f"[OCR Worker] 启动服务 {args.host}:{args.port}")
    print(f"[OCR Worker] MODEL_DIR = {MODEL_DIR}")

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
