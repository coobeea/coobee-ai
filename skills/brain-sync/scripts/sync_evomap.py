#!/usr/bin/env python3
"""
EvoMap Sync - 从 EvoMap 网络同步经验包到本地智库

由于 EvoMap 的实际 API 端点未知，本脚本提供两种模式：
1. 真实模式：从 EvoMap API 下载（需要配置 --endpoint）
2. 模拟模式：生成基于 AI Agent 常见场景的经验包（默认）
"""

import os
import sys
import json
import argparse
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional

# 添加父目录到 Python path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'brain' / 'scripts'))


def get_sync_dir() -> Path:
    """获取同步目录"""
    user_home = os.environ.get('USER_HOME')
    if user_home:
        sync_dir = Path(user_home) / 'brain' / 'sync'
    else:
        # 开发模式
        sync_dir = Path.home() / '.coobee-ai' / 'brain' / 'sync'
    
    sync_dir.mkdir(parents=True, exist_ok=True)
    return sync_dir


def load_downloaded_map() -> Dict[str, Any]:
    """加载已下载映射表"""
    sync_dir = get_sync_dir()
    map_file = sync_dir / 'downloaded.json'
    
    if not map_file.exists():
        return {
            "version": "1.0.0",
            "last_sync": None,
            "mappings": {},
            "stats": {
                "total_downloaded": 0,
                "by_category": {}
            }
        }
    
    with open(map_file, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_downloaded_map(data: Dict[str, Any]) -> None:
    """保存已下载映射表"""
    sync_dir = get_sync_dir()
    map_file = sync_dir / 'downloaded.json'
    
    data['last_sync'] = datetime.utcnow().isoformat() + 'Z'
    
    with open(map_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def is_already_downloaded(evomap_id: str, downloaded_map: Dict[str, Any]) -> bool:
    """检查是否已下载"""
    return evomap_id in downloaded_map.get('mappings', {})


def generate_sample_packages(count: int, category: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    生成示例经验包（基于 AI Agent 常见场景）
    
    由于无法访问真实 EvoMap API，使用 sample_packages.py 生成高质量的示例数据
    """
    from sample_packages import generate_100_packages
    
    packages = generate_100_packages()
    
    # 根据 category 筛选
    if category:
        packages = [p for p in packages if p['pattern']['category'] == category]
    
    # 限制数量
    return packages[:count]


def convert_to_local_format(evomap_package: Dict[str, Any]) -> Dict[str, Any]:
    """将 EvoMap 格式转换为本地格式"""
    pattern = evomap_package['pattern']
    practice = evomap_package['practice']
    
    return {
        "pattern": {
            "type": "Pattern",
            "schema_version": "1.0.0",
            "name": pattern['name'],
            "summary": pattern['summary'],
            "category": pattern['category'],
            "signals": pattern['signals'],
            "contexts": [f"When encountering {sig}" for sig in pattern['signals']],
            "strategy": pattern['strategy']
        },
        "practice": {
            "type": "Practice",
            "schema_version": "1.0.0",
            "name": practice['name'],
            "summary": practice['summary'],
            "content": practice['content'],
            "triggers": pattern['signals'][:1],
            "confidence": practice['confidence'],
            "success_streak": 10,
            "impact": {"files": 1, "lines": 20},
            "outcome": {"status": "success", "score": practice['confidence']},
            "environment": {"platform": sys.platform}
        }
    }


def publish_to_brain(package: Dict[str, Any], endpoint: str = 'http://localhost:42043') -> Optional[str]:
    """发布经验包到本地智库"""
    payload = {
        "message_id": f"sync_{int(datetime.utcnow().timestamp())}",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "payload": package
    }
    
    temp_file = Path('/tmp/brain_sync_publish.json')
    with open(temp_file, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    
    try:
        result = subprocess.run([
            'curl', '-X', 'POST',
            f'{endpoint}/api/brain/publish',
            '-H', 'Content-Type: application/json',
            '-d', f'@{temp_file}',
            '-s'  # silent mode
        ], capture_output=True, text=True, check=True)
        
        response = json.loads(result.stdout)
        if response.get('success'):
            return response['data']['package_id']
        else:
            print(f"  ✗ Failed: {response.get('error', {}).get('message')}", file=sys.stderr)
            return None
            
    except Exception as e:
        print(f"  ✗ Exception: {e}", file=sys.stderr)
        return None
    finally:
        if temp_file.exists():
            temp_file.unlink()


def main():
    parser = argparse.ArgumentParser(description='从 EvoMap 同步经验包到本地智库')
    
    parser.add_argument('--count', type=int, default=100, help='下载数量')
    parser.add_argument('--category', choices=['repair', 'optimize', 'innovate'], help='类别筛选')
    parser.add_argument('--force', action='store_true', help='强制重新下载（忽略映射表）')
    parser.add_argument('--dry-run', action='store_true', help='模拟运行（不实际发布）')
    parser.add_argument('--endpoint', default='http://localhost:42043', help='Brain Worker 端点')
    parser.add_argument('--evomap-api', help='EvoMap API 端点（如果有）')
    
    args = parser.parse_args()
    
    print(f"=== EvoMap Sync ===")
    print(f"Target: {args.count} packages")
    if args.category:
        print(f"Category: {args.category}")
    print()
    
    # 加载已下载映射表
    downloaded_map = load_downloaded_map()
    
    if not args.force:
        print(f"Already downloaded: {len(downloaded_map['mappings'])} packages")
    
    # 获取 EvoMap 经验包列表
    if args.evomap_api:
        print(f"[TODO] Fetching from EvoMap API: {args.evomap_api}")
        print("Note: Real EvoMap API integration not implemented yet")
        sys.exit(1)
    else:
        print("Generating sample packages (AI Agent common scenarios)...")
        evomap_packages = generate_sample_packages(args.count, args.category)
    
    print(f"Found {len(evomap_packages)} packages to sync\n")
    
    # 下载并发布
    success_count = 0
    skip_count = 0
    fail_count = 0
    
    for i, evomap_pkg in enumerate(evomap_packages, 1):
        evomap_id = evomap_pkg['id']
        pattern_name = evomap_pkg['pattern']['name']
        
        # 检查是否已下载
        if not args.force and is_already_downloaded(evomap_id, downloaded_map):
            print(f"[{i}/{len(evomap_packages)}] ⊘ Skipped: {pattern_name} (already downloaded)")
            skip_count += 1
            continue
        
        # 转换格式
        local_package = convert_to_local_format(evomap_pkg)
        
        # 发布
        if args.dry_run:
            print(f"[{i}/{len(evomap_packages)}] ✓ Dry-run: {pattern_name}")
            success_count += 1
        else:
            print(f"[{i}/{len(evomap_packages)}] ↓ Downloading: {pattern_name}...", end=' ')
            package_id = publish_to_brain(local_package, args.endpoint)
            
            if package_id:
                print(f"✓ Published: {package_id}")
                
                # 更新映射表
                downloaded_map['mappings'][evomap_id] = {
                    "local_package_id": package_id,
                    "downloaded_at": datetime.utcnow().isoformat() + "Z",
                    "evomap_id": evomap_id,
                    "category": evomap_pkg['pattern']['category'],
                    "name": pattern_name
                }
                
                # 更新统计
                category = evomap_pkg['pattern']['category']
                downloaded_map['stats']['by_category'][category] = \
                    downloaded_map['stats']['by_category'].get(category, 0) + 1
                
                success_count += 1
            else:
                print(f"✗ Failed")
                fail_count += 1
    
    # 更新总数
    downloaded_map['stats']['total_downloaded'] = len(downloaded_map['mappings'])
    
    # 保存映射表
    if not args.dry_run:
        save_downloaded_map(downloaded_map)
    
    # 总结
    print(f"\n=== Summary ===")
    print(f"✓ Success: {success_count}")
    if skip_count > 0:
        print(f"⊘ Skipped: {skip_count}")
    if fail_count > 0:
        print(f"✗ Failed: {fail_count}")
    print(f"Total downloaded: {len(downloaded_map['mappings'])}")


if __name__ == '__main__':
    main()
