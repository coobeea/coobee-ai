#!/usr/bin/env python3
"""
Offline Sync - 离线模式同步经验包

直接写入文件系统，无需启动 Brain Worker。
适用于批量初始化智库。
"""

import os
import sys
import json
import argparse
from datetime import datetime
from pathlib import Path

# 添加 brain 模块到 path
brain_worker_dir = Path(__file__).parent.parent.parent.parent / 'workers' / 'brain'
sys.path.insert(0, str(brain_worker_dir))

from brain.storage import FileSystemStore
from brain.indexer import IndexManager
from brain.asset import compute_asset_id, generate_package_id
from sample_packages import generate_100_packages


def get_user_home() -> str:
    """获取用户主目录"""
    user_home = os.environ.get('USER_HOME')
    if not user_home:
        # 开发模式：查找项目根目录的 .home
        current = Path(__file__).resolve()
        for parent in current.parents:
            home_dir = parent / '.home'
            if home_dir.exists():
                return str(home_dir)
        
        # fallback
        return str(Path.home() / '.coobee-ai')
    return user_home


def get_sync_dir() -> Path:
    """获取同步目录"""
    user_home = get_user_home()
    sync_dir = Path(user_home) / 'brain' / 'sync'
    sync_dir.mkdir(parents=True, exist_ok=True)
    return sync_dir


def load_downloaded_map():
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


def save_downloaded_map(data):
    """保存已下载映射表"""
    sync_dir = get_sync_dir()
    map_file = sync_dir / 'downloaded.json'
    
    data['last_sync'] = datetime.utcnow().isoformat() + 'Z'
    
    with open(map_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def convert_to_local_package(evomap_pkg):
    """将示例格式转换为本地 Package 格式"""
    pattern_data = {
        "type": "Pattern",
        "schema_version": "1.0.0",
        **evomap_pkg['pattern']
    }
    
    practice_data = {
        "type": "Practice",
        "schema_version": "1.0.0",
        **evomap_pkg['practice'],
        "triggers": evomap_pkg['pattern']['signals'][:1],
        "success_streak": 10,
        "impact": {"files": 1, "lines": 20},
        "outcome": {
            "status": "success",
            "score": evomap_pkg['practice']['confidence']
        },
        "environment": {"platform": sys.platform}
    }
    
    # 计算 asset_id
    pattern_id = compute_asset_id(pattern_data)
    practice_id = compute_asset_id(practice_data)
    package_id = generate_package_id(pattern_id, practice_id)
    
    timestamp = datetime.utcnow().isoformat() + 'Z'
    
    return {
        'package_id': package_id,
        'pattern': {**pattern_data, 'asset_id': pattern_id, 'created_at': timestamp},
        'practice': {
            **practice_data,
            'asset_id': practice_id,
            'pattern_id': pattern_id,
            'created_at': timestamp
        },
        'status': 'promoted',  # EvoMap 同步的标记为已推广
        'usage_count': 0,
        'created_at': timestamp,
        'updated_at': timestamp
    }


def main():
    parser = argparse.ArgumentParser(description='离线同步 EvoMap 经验包')
    
    parser.add_argument('--count', type=int, default=100, help='同步数量')
    parser.add_argument('--category', choices=['repair', 'optimize', 'innovate'], help='类别筛选')
    parser.add_argument('--force', action='store_true', help='强制重新同步')
    
    args = parser.parse_args()
    
    print(f"=== Brain Offline Sync ===")
    print(f"Target: {args.count} packages")
    if args.category:
        print(f"Category: {args.category}")
    print()
    
    # 初始化存储
    user_home = get_user_home()
    storage_dir = Path(user_home) / 'brain'
    
    print(f"Storage directory: {storage_dir}")
    print()
    
    store = FileSystemStore(str(storage_dir))
    indexer = IndexManager(str(storage_dir))
    
    # 加载映射表
    downloaded_map = load_downloaded_map()
    
    if not args.force:
        print(f"Already downloaded: {len(downloaded_map['mappings'])} packages")
    
    # 生成示例包
    print("Generating sample packages...")
    evomap_packages = generate_100_packages()
    
    if args.category:
        evomap_packages = [p for p in evomap_packages if p['pattern']['category'] == args.category]
    
    evomap_packages = evomap_packages[:args.count]
    print(f"Found {len(evomap_packages)} packages to sync\n")
    
    # 同步
    success_count = 0
    skip_count = 0
    fail_count = 0
    
    for i, evomap_pkg in enumerate(evomap_packages, 1):
        evomap_id = evomap_pkg['id']
        pattern_name = evomap_pkg['pattern']['name']
        
        # 检查是否已下载
        if not args.force and evomap_id in downloaded_map['mappings']:
            print(f"[{i}/{len(evomap_packages)}] ⊘ Skipped: {pattern_name} (already synced)")
            skip_count += 1
            continue
        
        try:
            # 转换格式
            local_pkg = convert_to_local_package(evomap_pkg)
            package_id = local_pkg['package_id']
            
            # 检查是否已存在（基于 package_id）
            if not args.force and store.package_exists(package_id):
                print(f"[{i}/{len(evomap_packages)}] ⊘ Exists: {pattern_name} ({package_id})")
                
                # 更新映射表（记录关联）
                downloaded_map['mappings'][evomap_id] = {
                    "local_package_id": package_id,
                    "downloaded_at": datetime.utcnow().isoformat() + "Z",
                    "evomap_id": evomap_id,
                    "category": evomap_pkg['pattern']['category'],
                    "name": pattern_name
                }
                skip_count += 1
                continue
            
            # 保存
            print(f"[{i}/{len(evomap_packages)}] ↓ Syncing: {pattern_name}...", end=' ')
            store.save_package(local_pkg)
            indexer.add_package(local_pkg)
            
            print(f"✓ {package_id}")
            
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
            
        except Exception as e:
            print(f"✗ Failed: {e}")
            fail_count += 1
    
    # 更新总数
    downloaded_map['stats']['total_downloaded'] = len(downloaded_map['mappings'])
    
    # 保存映射表
    save_downloaded_map(downloaded_map)
    
    # 总结
    print(f"\n=== Summary ===")
    print(f"✓ Success: {success_count}")
    if skip_count > 0:
        print(f"⊘ Skipped: {skip_count}")
    if fail_count > 0:
        print(f"✗ Failed: {fail_count}")
    print(f"\nTotal downloaded: {len(downloaded_map['mappings'])}")
    print(f"Storage: {storage_dir}")


if __name__ == '__main__':
    main()
