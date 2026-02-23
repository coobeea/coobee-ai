#!/usr/bin/env python3
"""集成测试 - 测试完整的存储和索引功能"""

import sys
from pathlib import Path

# 添加项目路径
project_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(project_root / 'workers' / 'brain'))

from brain.storage import FileSystemStore
from brain.indexer import IndexManager


def test_search_by_signal():
    """测试按信号搜索"""
    storage_dir = project_root / '.home' / 'brain'
    
    store = FileSystemStore(str(storage_dir))
    indexer = IndexManager(str(storage_dir))
    
    # 搜索 TimeoutError
    print("=== Test: Search by signal 'TimeoutError' ===")
    package_ids = indexer.find_by_signals(['TimeoutError'])
    print(f"Found {len(package_ids)} packages")
    
    # 加载并显示前 3 个
    for i, pkg_id in enumerate(package_ids[:3], 1):
        pkg = store.load_package(pkg_id)
        if pkg:
            print(f"\n{i}. {pkg['pattern']['name']}")
            print(f"   Summary: {pkg['pattern']['summary']}")
            print(f"   Confidence: {pkg['practice']['confidence']}")
    
    assert len(package_ids) > 0, "Should find packages with TimeoutError signal"
    print("\n✓ Search by signal test passed")


def test_search_by_category():
    """测试按类别搜索"""
    storage_dir = project_root / '.home' / 'brain'
    
    indexer = IndexManager(str(storage_dir))
    
    # 搜索 repair 类别
    print("\n=== Test: Search by category 'repair' ===")
    repair_ids = indexer.find_by_category('repair')
    print(f"Found {len(repair_ids)} repair packages")
    
    # 搜索 optimize 类别
    optimize_ids = indexer.find_by_category('optimize')
    print(f"Found {len(optimize_ids)} optimize packages")
    
    assert len(repair_ids) > 0, "Should find repair packages"
    assert len(optimize_ids) > 0, "Should find optimize packages"
    print("\n✓ Search by category test passed")


def test_stats():
    """测试统计功能"""
    storage_dir = project_root / '.home' / 'brain'
    
    indexer = IndexManager(str(storage_dir))
    
    print("\n=== Test: Get statistics ===")
    stats = indexer.get_stats()
    
    print("By Category:")
    for cat, count in stats['byCategory'].items():
        print(f"  {cat}: {count}")
    
    print("\nBy Status:")
    for status, count in stats['byStatus'].items():
        print(f"  {status}: {count}")
    
    assert stats['byCategory'], "Should have category stats"
    assert stats['byStatus'], "Should have status stats"
    print("\n✓ Stats test passed")


if __name__ == '__main__':
    test_search_by_signal()
    test_search_by_category()
    test_stats()
    print("\n✓ All integration tests passed!")
