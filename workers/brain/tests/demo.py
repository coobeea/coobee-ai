#!/usr/bin/env python3
"""
Brain System Demo - 智库系统演示

展示完整的工作流程：
1. 搜索经验包
2. 获取完整内容
3. 查看统计信息
"""

import sys
from pathlib import Path

# 添加项目路径
project_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(project_root / 'workers' / 'brain'))

from brain.storage import FileSystemStore
from brain.indexer import IndexManager


def demo():
    """演示智库系统功能"""
    storage_dir = project_root / '.home' / 'brain'
    
    print("=" * 60)
    print("智库（Brain）系统演示")
    print("=" * 60)
    print()
    
    store = FileSystemStore(str(storage_dir))
    indexer = IndexManager(str(storage_dir))
    
    # 1. 统计信息
    print("📊 统计信息：")
    print("-" * 60)
    
    all_packages = store.list_packages()
    print(f"  总经验包数: {len(all_packages)}")
    
    stats = indexer.get_stats()
    print(f"\n  按类别统计:")
    for cat, count in stats['byCategory'].items():
        print(f"    - {cat}: {count}")
    
    print(f"\n  按状态统计:")
    for status, count in stats['byStatus'].items():
        print(f"    - {status}: {count}")
    
    print()
    
    # 2. 搜索演示
    print("🔍 搜索演示：")
    print("-" * 60)
    
    # 场景：遇到 TimeoutError
    print("  场景: 遇到 TimeoutError，搜索解决方案\n")
    
    package_ids = indexer.find_by_signals(['TimeoutError'])
    print(f"  找到 {len(package_ids)} 个相关方案\n")
    
    # 显示前 5 个
    print("  前 5 个推荐方案：")
    for i, pkg_id in enumerate(package_ids[:5], 1):
        pkg = store.load_package(pkg_id)
        if pkg:
            pattern = pkg['pattern']
            practice = pkg['practice']
            print(f"\n  {i}. {pattern['name']}")
            print(f"     类别: {pattern['category']}")
            print(f"     摘要: {pattern['summary']}")
            print(f"     置信度: {practice['confidence']}")
    
    print()
    
    # 3. 获取完整内容演示
    print("📄 获取完整内容演示：")
    print("-" * 60)
    
    if package_ids:
        first_pkg_id = package_ids[0]
        pkg = store.load_package(first_pkg_id)
        
        if pkg:
            print(f"  经验包 ID: {pkg['package_id']}")
            print(f"  方案名称: {pkg['pattern']['name']}")
            print(f"  实践名称: {pkg['practice']['name']}")
            print(f"\n  完整实现:\n")
            
            # 显示实现内容（截取前 20 行）
            content = pkg['practice']['content']
            lines = content.split('\n')[:20]
            for line in lines:
                print(f"    {line}")
            
            if len(content.split('\n')) > 20:
                print(f"    ... (共 {len(content.split('\\n'))} 行)")
    
    print()
    
    # 4. 类别筛选演示
    print("🏷️  类别筛选演示：")
    print("-" * 60)
    
    repair_ids = indexer.find_by_category('repair')
    optimize_ids = indexer.find_by_category('optimize')
    
    print(f"  repair 类别: {len(repair_ids)} 个")
    print(f"  optimize 类别: {len(optimize_ids)} 个")
    
    print()
    
    # 5. 总结
    print("=" * 60)
    print("✅ 演示完成！智库系统工作正常。")
    print("=" * 60)
    print()
    print("下一步：")
    print("  1. 启动 Coobee 应用: pnpm dev")
    print("  2. 在 Settings 中启动 Brain Worker")
    print("  3. 使用 HTTP API 或 Gateway 访问智库")
    print("  4. 阅读文档: docs/7.brain/05-使用指南.md")


if __name__ == '__main__':
    demo()
