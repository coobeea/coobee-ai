#!/usr/bin/env python3
"""
Brain Publish - 发布经验包到智库的辅助脚本
"""

import json
import sys
import argparse
import subprocess
from datetime import datetime
from pathlib import Path


def publish_to_brain(pattern, practice, evolution=None, endpoint='http://localhost:42043'):
    """
    发布经验包到智库
    
    Args:
        pattern: Pattern 字典
        practice: Practice 字典
        evolution: Evolution 字典（可选）
        endpoint: Brain Worker 端点
        
    Returns:
        API 响应
    """
    payload = {
        "message_id": f"msg_{int(datetime.utcnow().timestamp())}",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "payload": {
            "pattern": pattern,
            "practice": practice
        }
    }
    
    if evolution:
        payload["payload"]["evolution"] = evolution
    
    # 写入临时文件
    temp_file = Path('/tmp/brain_publish.json')
    with open(temp_file, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    
    # 发送请求
    try:
        result = subprocess.run([
            'curl', '-X', 'POST',
            f'{endpoint}/api/brain/publish',
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
    parser = argparse.ArgumentParser(description='发布经验包到智库')
    
    # 从文件加载
    parser.add_argument('--file', '-f', help='JSON 文件路径（包含完整的 pattern, practice, evolution）')
    
    # 快速发布（简化参数）
    parser.add_argument('--pattern-name', help='方案名称')
    parser.add_argument('--pattern-summary', help='方案摘要')
    parser.add_argument('--pattern-category', choices=['repair', 'optimize', 'innovate'], default='repair', help='方案类别')
    parser.add_argument('--signals', nargs='+', help='触发信号列表')
    
    parser.add_argument('--practice-name', help='实践案例名称')
    parser.add_argument('--practice-summary', help='实践案例摘要')
    parser.add_argument('--practice-content', help='实践内容（完整实现）')
    parser.add_argument('--confidence', type=float, default=0.8, help='置信度（0-1）')
    
    parser.add_argument('--endpoint', default='http://localhost:42043', help='Brain Worker 端点')
    
    args = parser.parse_args()
    
    # 从文件加载
    if args.file:
        file_path = Path(args.file)
        if not file_path.exists():
            print(f"Error: File not found: {args.file}", file=sys.stderr)
            sys.exit(1)
        
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        pattern = data.get('pattern')
        practice = data.get('practice')
        evolution = data.get('evolution')
        
        if not pattern or not practice:
            print("Error: File must contain 'pattern' and 'practice'", file=sys.stderr)
            sys.exit(1)
    
    # 快速发布
    elif args.pattern_name and args.practice_name:
        if not args.signals:
            print("Error: --signals is required for quick publish", file=sys.stderr)
            sys.exit(1)
        
        pattern = {
            "type": "Pattern",
            "schema_version": "1.0.0",
            "name": args.pattern_name,
            "summary": args.pattern_summary or args.pattern_name,
            "category": args.pattern_category,
            "signals": args.signals,
            "contexts": [f"When encountering {sig}" for sig in args.signals],
            "strategy": args.pattern_summary or "Strategy not specified"
        }
        
        practice = {
            "type": "Practice",
            "schema_version": "1.0.0",
            "name": args.practice_name,
            "summary": args.practice_summary or args.practice_name,
            "content": args.practice_content or "Content not specified",
            "triggers": args.signals[:1],  # 使用第一个信号
            "confidence": args.confidence,
            "success_streak": 1,
            "impact": {"files": 0, "lines": 0},
            "outcome": {"status": "success", "score": args.confidence},
            "environment": {"platform": sys.platform}
        }
        
        evolution = None
    
    else:
        print("Error: Either --file or (--pattern-name + --practice-name + --signals) is required", file=sys.stderr)
        parser.print_help()
        sys.exit(1)
    
    # 发布
    print(f"Publishing to {args.endpoint}...", file=sys.stderr)
    response = publish_to_brain(pattern, practice, evolution, args.endpoint)
    
    if response and response.get('success'):
        data = response['data']
        print(f"✓ Published successfully!")
        print(f"  Package ID: {data['package_id']}")
        print(f"  Pattern ID: {data['pattern_id']}")
        print(f"  Practice ID: {data['practice_id']}")
        if data.get('evolution_id'):
            print(f"  Evolution ID: {data['evolution_id']}")
    else:
        print(f"✗ Failed to publish", file=sys.stderr)
        if response:
            print(f"  Error: {response.get('error', {}).get('message', 'Unknown error')}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
