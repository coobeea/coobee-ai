#!/usr/bin/env python3
"""
Brain Search - 搜索智库经验包的辅助脚本
"""

import json
import sys
import argparse
import subprocess
from datetime import datetime
from pathlib import Path


def search_brain(signals=None, category=None, status=None, limit=10, endpoint='http://localhost:42043'):
    """
    搜索智库经验包
    
    Args:
        signals: 触发信号列表
        category: 类别（repair/optimize/innovate）
        status: 状态（candidate/validated/promoted）
        limit: 结果数量限制
        endpoint: Brain Worker 端点
        
    Returns:
        API 响应
    """
    payload = {
        "message_id": f"msg_{int(datetime.utcnow().timestamp())}",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "payload": {
            "limit": limit
        }
    }
    
    if signals:
        payload["payload"]["signals"] = signals
    if category:
        payload["payload"]["category"] = category
    if status:
        payload["payload"]["status"] = status
    
    # 写入临时文件
    temp_file = Path('/tmp/brain_search.json')
    with open(temp_file, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    
    # 发送请求
    try:
        result = subprocess.run([
            'curl', '-X', 'POST',
            f'{endpoint}/api/brain/search',
            '-H', 'Content-Type: application/json',
            '-d', f'@{temp_file}'
        ], capture_output=True, text=True, check=True)
        
        response = json.loads(result.stdout)
        temp_file.unlink()  # 清理临时文件
        return response
        
    except subprocess.CalledProcessError as e:
        print(f"Error: Failed to call API: {e}", file=sys.stderr)
        return None
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON response: {e}", file=sys.stderr)
        print(f"Response: {result.stdout}", file=sys.stderr)
        return None


def main():
    parser = argparse.ArgumentParser(description='搜索智库经验包')
    
    parser.add_argument('--signals', '-s', nargs='+', help='触发信号列表')
    parser.add_argument('--category', '-c', choices=['repair', 'optimize', 'innovate'], help='类别筛选')
    parser.add_argument('--status', choices=['candidate', 'validated', 'promoted'], help='状态筛选')
    parser.add_argument('--limit', '-l', type=int, default=10, help='结果数量限制')
    parser.add_argument('--endpoint', default='http://localhost:42043', help='Brain Worker 端点')
    parser.add_argument('--json', action='store_true', help='输出 JSON 格式')
    
    args = parser.parse_args()
    
    # 搜索
    response = search_brain(
        signals=args.signals,
        category=args.category,
        status=args.status,
        limit=args.limit,
        endpoint=args.endpoint
    )
    
    if not response or not response.get('success'):
        print(f"✗ Search failed", file=sys.stderr)
        if response:
            print(f"  Error: {response.get('error', {}).get('message', 'Unknown error')}", file=sys.stderr)
        sys.exit(1)
    
    data = response['data']
    packages = data['packages']
    
    # JSON 输出
    if args.json:
        print(json.dumps(packages, ensure_ascii=False, indent=2))
        return
    
    # 人类可读输出
    print(f"Found {data['total']} package(s):\n")
    
    if not packages:
        print("No packages found.")
        return
    
    for i, pkg in enumerate(packages, 1):
        pattern = pkg['pattern']
        practice = pkg['practice']
        
        print(f"{i}. {pattern['name']} ({pattern['category']})")
        print(f"   Pattern: {pattern['summary']}")
        print(f"   Practice: {practice['name']}")
        print(f"   Summary: {practice['summary']}")
        print(f"   Confidence: {practice.get('confidence', 'N/A')}")
        print(f"   Status: {pkg['status']} | Usage: {pkg.get('usage_count', 0)}")
        print(f"   Package ID: {pkg['package_id']}")
        print()


if __name__ == '__main__':
    main()
