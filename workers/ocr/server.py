"""
OCR Worker — 本地图像识别服务

FastAPI + WebSocket 服务，封装本地 GLM-OCR 模型。
由 RuntimeManager 管理生命周期。

启动方式（由 RuntimeManager 自动调用）：
    python server.py --port 18102

环境变量（由 RuntimeManager 注入）：
    MODEL_DIR          模型存储目录

识别策略（调用已配置的 GLM-OCR 环境）：
    - 支持同步和异步识别
    - 通过 WebSocket 提供实时进度反馈
    - 调用已配置好的 GLM-OCR shell 脚本
"""

import argparse
import asyncio
import base64
import logging
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# FastAPI / uvicorn
try:
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.responses import JSONResponse
    import uvicorn
except ImportError:
    print("[OCR Worker] 缺少依赖，请先安装: pip install fastapi uvicorn", file=sys.stderr)
    sys.exit(1)

# ==================== 配置 ====================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# GLM-OCR 脚本路径
GLM_OCR_SCRIPT = "/Users/lifeng/git/git_agents/agent-tools/glm_ocr/ocr_image.sh"

logging.basicConfig(level=logging.INFO, format="[OCR] %(message)s")
log = logging.getLogger("ocr")

app = FastAPI(title="OCR Worker", version="0.1.0")

# ==================== 全局状态 ====================

ocr_ready = False


# ==================== 启动检查 ====================

def check_ocr_availability():
    """检查 OCR 环境是否可用"""
    global ocr_ready
    
    if not Path(GLM_OCR_SCRIPT).exists():
        log.error(f"GLM-OCR 脚本不存在: {GLM_OCR_SCRIPT}")
        log.error("请确保已配置 GLM-OCR 环境:")
        log.error("  位置: /Users/lifeng/git/git_agents/agent-tools/glm_ocr")
        ocr_ready = False
        return False
    
    log.info(f"✅ GLM-OCR 脚本已找到: {GLM_OCR_SCRIPT}")
    ocr_ready = True
    return True


@app.on_event("startup")
async def startup_event():
    """应用启动时检查 OCR 环境"""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, check_ocr_availability)


# ==================== HTTP 接口 ====================

@app.get("/health")
async def health():
    """健康检查"""
    return JSONResponse({
        "status": "ok",
        "ocr_ready": ocr_ready,
        "glm_ocr_script": GLM_OCR_SCRIPT,
    })


@app.post("/api/ocr")
async def ocr_sync(request: dict):
    """
    同步 OCR 接口（整张图片识别后返回）
    
    请求体: { 
        "image": "base64_encoded_image_data",
        "format": "png|jpg|jpeg"
    }
    响应: { 
        "text": "识别的文本内容",
        "success": true|false,
        "error": "错误信息（如果有）"
    }
    """
    if not ocr_ready:
        return JSONResponse({
            "success": False,
            "error": "OCR 环境未就绪"
        }, status_code=503)
    
    # 获取图片数据
    image_data = request.get("image", "")
    image_format = request.get("format", "png")
    
    if not image_data:
        return JSONResponse({
            "success": False,
            "error": "缺少 image 字段"
        }, status_code=400)
    
    try:
        # 解码 base64 图片
        image_bytes = base64.b64decode(image_data)
        
        # 创建临时文件
        with tempfile.NamedTemporaryFile(
            suffix=f".{image_format}", 
            delete=False
        ) as tmp_img:
            tmp_img.write(image_bytes)
            tmp_img_path = tmp_img.name
        
        with tempfile.NamedTemporaryFile(
            mode='w', 
            suffix='.md', 
            delete=False
        ) as tmp_out:
            tmp_out_path = tmp_out.name
        
        # 调用 OCR
        success, text, error = await call_glm_ocr_async(tmp_img_path, tmp_out_path)
        
        # 清理临时文件
        Path(tmp_img_path).unlink(missing_ok=True)
        Path(tmp_out_path).unlink(missing_ok=True)
        
        if success:
            return JSONResponse({
                "success": True,
                "text": text
            })
        else:
            return JSONResponse({
                "success": False,
                "error": error
            }, status_code=500)
            
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
        "format": "png|jpg|jpeg"
    }
    服务端返回: 
        { "status": "processing", "message": "正在识别..." }
        { "status": "success", "text": "识别结果", "latency_ms": 1234 }
        或 { "status": "error", "error": "错误信息" }
    """
    await ws.accept()
    log.info("WebSocket 客户端已连接")
    
    if not ocr_ready:
        await ws.send_json({
            "status": "error",
            "error": "OCR 环境未就绪"
        })
        return
    
    await ws.send_json({
        "status": "ready",
        "message": "OCR 服务已就绪"
    })
    
    try:
        while True:
            data = await ws.receive_json()
            
            image_data = data.get("image", "")
            image_format = data.get("format", "png")
            
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
                
                # 创建临时文件
                with tempfile.NamedTemporaryFile(
                    suffix=f".{image_format}", 
                    delete=False
                ) as tmp_img:
                    tmp_img.write(image_bytes)
                    tmp_img_path = tmp_img.name
                
                with tempfile.NamedTemporaryFile(
                    mode='w', 
                    suffix='.md', 
                    delete=False
                ) as tmp_out:
                    tmp_out_path = tmp_out.name
                
                # 调用 OCR
                t0 = time.time()
                success, text, error = await call_glm_ocr_async(
                    tmp_img_path, 
                    tmp_out_path
                )
                latency_ms = int((time.time() - t0) * 1000)
                
                # 清理临时文件
                Path(tmp_img_path).unlink(missing_ok=True)
                Path(tmp_out_path).unlink(missing_ok=True)
                
                if success:
                    await ws.send_json({
                        "status": "success",
                        "text": text,
                        "latency_ms": latency_ms
                    })
                else:
                    await ws.send_json({
                        "status": "error",
                        "error": error
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

def call_glm_ocr(image_path: str, output_path: str) -> tuple:
    """
    调用 GLM-OCR shell 脚本（同步）
    
    Args:
        image_path: 输入图片路径
        output_path: 输出文件路径
        
    Returns:
        (success: bool, result: str, error: str)
    """
    try:
        # 调用 GLM-OCR shell 脚本
        result = subprocess.run(
            [GLM_OCR_SCRIPT, image_path, output_path],
            capture_output=True,
            text=True,
            timeout=120  # 2分钟超时
        )
        
        if result.returncode == 0:
            # 读取输出文件
            if Path(output_path).exists():
                with open(output_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                return (True, content, "")
            else:
                return (False, "", "输出文件未生成")
        else:
            return (False, "", result.stderr or result.stdout)
            
    except subprocess.TimeoutExpired:
        return (False, "", "处理超时（超过2分钟）")
    except Exception as e:
        return (False, "", str(e))


async def call_glm_ocr_async(image_path: str, output_path: str) -> tuple:
    """异步版本：在线程池中执行 OCR 识别"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, call_glm_ocr, image_path, output_path)


# ==================== 启动 ====================

def main():
    parser = argparse.ArgumentParser(description="OCR Worker Server")
    parser.add_argument("--port", type=int, default=18102, help="服务端口")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="绑定地址")
    args = parser.parse_args()

    print(f"[OCR Worker] 启动服务 {args.host}:{args.port}")
    print(f"[OCR Worker] GLM_OCR_SCRIPT = {GLM_OCR_SCRIPT}")

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
