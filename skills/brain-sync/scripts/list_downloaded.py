#!/usr/bin/env python3
"""
List Downloaded - 查看已下载的 EvoMap 经验包
"""

import os
import json
import argparse
from pathlib import Path
from datetime import datetime


def get_sync_dir() -> Path:
    """获取同步目录"""
    user_home = os.environ.get('USER_HOME')
    if not user_home:
        # 开发模式：查找项目根目录的 .home
        current = Path(__file__).resolve()
        for parent in current.parents:
            home_dir = parent / '.home'
            if home_dir.exists():
                user_home = str(home_dir)
                break
        
        if not user_home:
            # fallback
            user_home = str(Path.home() / '.coobee-ai')
    
    sync_dir = Path(user_home) / 'brain' / 'sync'
    return sync_dir


def load_downloaded_map():
    """加载已下载映射表"""
    sync_dir = get_sync_dir()
    map_file = sync_dir / 'downloaded.json'
    
    if not map_file.exists():
        return None
    
    with open(map_file, 'r', encoding='utf-8') as f:
        return json.load(f)


def format_table(mappings, sort_by='downloaded_at'):
    """格式化为表格"""
    items = []
    for evomap_id, info in mappings.items():
        items.append({
            'category': info.get('category', 'unknown'),
            'name': info.get('name', 'unknown'),
            'local_id': info.get('local_package_id', 'unknown')[:15],
            'downloaded_at': info.get('downloaded_at', 'unknown')[:19].replace('T', ' ')
        })
    
    # 排序
    if sort_by == 'name':
        items.sort(key=lambda x: x['name'])
    elif sort_by == 'category':
        items.sort(key=lambda x: x['category'])
    else:  # downloaded_at
        items.sort(key=lambda x: x['downloaded_at'], reverse=True)
    
    # 打印表头
    print(f"{'Category':<10} | {'Name':<30} | {'Local ID':<15} | {'Downloaded At':<19}")
    print("-" * 80)
    
    # 打印数据
    for item in items:
        print(f"{item['category']:<10} | {item['name']:<30} | {item['local_id']:<15} | {item['downloaded_at']:<19}")


def main():
    parser = argparse.ArgumentParser(description='查看已下载的 EvoMap 经验包')
    
    parser.add_argument('--format', choices=['table', 'json'], default='table', help='输出格式')
    parser.add_argument('--category', help='按类别筛选')
    parser.add_argument('--sort', choices=['name', 'category', 'downloaded_at'], default='downloaded_at', help='排序字段')
    
    args = parser.parse_args()
    
    # 加载映射表
    downloaded_map = load_downloaded_map()
    
    if not downloaded_map:
        print("No packages downloaded yet.")
        print("\nRun: python skills/brain-sync/scripts/sync_evomap.py --count 100")
        return
    
    mappings = downloaded_map.get('mappings', {})
    stats = downloaded_map.get('stats', {})
    
    # 筛选
    if args.category:
        mappings = {k: v for k, v in mappings.items() if v.get('category') == args.category}
    
    # 输出
    print(f"=== Downloaded Packages ({len(mappings)} total) ===\n")
    
    if args.format == 'json':
        print(json.dumps(list(mappings.values()), ensure_ascii=False, indent=2))
    else:
        if not mappings:
            print("No packages match the filter.")
        else:
            format_table(mappings, args.sort)
    
    # 统计信息
    print(f"\n=== Statistics ===")
    print(f"Total downloaded: {stats.get('total_downloaded', 0)}")
    print(f"Last sync: {downloaded_map.get('last_sync', 'Never')}")
    
    by_category = stats.get('by_category', {})
    if by_category:
        print("\nBy category:")
        for cat, count in by_category.items():
            print(f"  {cat}: {count}")


if __name__ == '__main__':
    main()
