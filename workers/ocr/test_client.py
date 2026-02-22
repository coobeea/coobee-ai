#!/usr/bin/env python3
"""
OCR Worker 测试客户端

用于测试 OCR Worker 的 HTTP 和 WebSocket 接口
"""

import asyncio
import base64
import sys
import json
from pathlib import Path

try:
    import requests
    import websockets
except ImportError:
    print("请先安装依赖: pip install requests websockets")
    sys.exit(1)


def test_health():
    """测试健康检查接口"""
    print("=" * 70)
    print("测试健康检查")
    print("=" * 70)
    
    try:
        response = requests.get("http://127.0.0.1:18102/health")
        print(f"状态码: {response.status_code}")
        print(f"响应: {json.dumps(response.json(), indent=2, ensure_ascii=False)}")
        return response.status_code == 200
    except Exception as e:
        print(f"❌ 失败: {e}")
        return False


def test_sync_ocr(image_path: str):
    """测试同步 OCR 接口"""
    print("=" * 70)
    print("测试同步 OCR")
    print("=" * 70)
    print(f"图片: {image_path}")
    
    # 读取图片
    if not Path(image_path).exists():
        print(f"❌ 文件不存在: {image_path}")
        return False
    
    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode()
    
    # 获取图片格式
    image_format = Path(image_path).suffix[1:]  # 去掉点号
    
    print(f"格式: {image_format}")
    print("正在识别...")
    
    try:
        response = requests.post(
            "http://127.0.0.1:18102/api/ocr",
            json={
                "image": image_data,
                "format": image_format
            },
            timeout=180  # 3分钟超时
        )
        
        print(f"状态码: {response.status_code}")
        
        result = response.json()
        if result.get("success"):
            text = result.get("text", "")
            print(f"✅ 成功")
            print(f"识别结果 ({len(text)} 字符):")
            print("-" * 70)
            print(text[:500])  # 只显示前500个字符
            if len(text) > 500:
                print(f"... (还有 {len(text) - 500} 个字符)")
            print("-" * 70)
            return True
        else:
            print(f"❌ 失败: {result.get('error', '未知错误')}")
            return False
            
    except Exception as e:
        print(f"❌ 失败: {e}")
        return False


async def test_websocket_ocr(image_path: str):
    """测试 WebSocket OCR 接口"""
    print("=" * 70)
    print("测试 WebSocket OCR")
    print("=" * 70)
    print(f"图片: {image_path}")
    
    # 读取图片
    if not Path(image_path).exists():
        print(f"❌ 文件不存在: {image_path}")
        return False
    
    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode()
    
    # 获取图片格式
    image_format = Path(image_path).suffix[1:]
    
    print(f"格式: {image_format}")
    print("连接 WebSocket...")
    
    try:
        async with websockets.connect("ws://127.0.0.1:18102/ws/ocr") as ws:
            print("✅ 已连接")
            
            # 接收就绪消息
            ready_msg = await ws.recv()
            ready_data = json.loads(ready_msg)
            print(f"服务端: {ready_data.get('message', '')}")
            
            # 发送图片
            print("发送图片...")
            await ws.send(json.dumps({
                "image": image_data,
                "format": image_format
            }))
            
            # 接收结果
            while True:
                msg = await ws.recv()
                data = json.loads(msg)
                
                status = data.get("status")
                
                if status == "processing":
                    print(f"服务端: {data.get('message', '')}")
                elif status == "success":
                    text = data.get("text", "")
                    latency_ms = data.get("latency_ms", 0)
                    print(f"✅ 成功")
                    print(f"耗时: {latency_ms} ms ({latency_ms / 1000:.1f} 秒)")
                    print(f"识别结果 ({len(text)} 字符):")
                    print("-" * 70)
                    print(text[:500])
                    if len(text) > 500:
                        print(f"... (还有 {len(text) - 500} 个字符)")
                    print("-" * 70)
                    return True
                elif status == "error":
                    print(f"❌ 失败: {data.get('error', '未知错误')}")
                    return False
                    
    except Exception as e:
        print(f"❌ 失败: {e}")
        return False


def main():
    """主函数"""
    if len(sys.argv) < 2:
        print("OCR Worker 测试客户端")
        print()
        print("用法:")
        print("  python test_client.py health          # 测试健康检查")
        print("  python test_client.py sync <图片>     # 测试同步接口")
        print("  python test_client.py ws <图片>       # 测试 WebSocket 接口")
        print()
        print("示例:")
        print("  python test_client.py health")
        print("  python test_client.py sync /path/to/image.png")
        print("  python test_client.py ws /path/to/image.png")
        print()
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "health":
        success = test_health()
        sys.exit(0 if success else 1)
        
    elif command == "sync":
        if len(sys.argv) < 3:
            print("❌ 缺少图片路径参数")
            sys.exit(1)
        image_path = sys.argv[2]
        success = test_sync_ocr(image_path)
        sys.exit(0 if success else 1)
        
    elif command == "ws":
        if len(sys.argv) < 3:
            print("❌ 缺少图片路径参数")
            sys.exit(1)
        image_path = sys.argv[2]
        success = asyncio.run(test_websocket_ocr(image_path))
        sys.exit(0 if success else 1)
        
    else:
        print(f"❌ 未知命令: {command}")
        print("支持的命令: health, sync, ws")
        sys.exit(1)


if __name__ == "__main__":
    main()
