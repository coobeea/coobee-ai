"""测试 storage.py 模块"""

import sys
import tempfile
import shutil
from pathlib import Path

# 添加父目录到 Python path
sys.path.insert(0, str(Path(__file__).parent.parent))

from brain.storage import FileSystemStore
from brain.asset import compute_asset_id, generate_package_id


def create_test_package():
    """创建测试用的经验包"""
    pattern = {
        'type': 'Pattern',
        'schema_version': '1.0.0',
        'name': 'test-pattern',
        'summary': 'Test pattern summary',
        'category': 'repair',
        'signals': ['TestError'],
        'contexts': ['Test context'],
        'strategy': 'Test strategy'
    }
    
    practice = {
        'type': 'Practice',
        'schema_version': '1.0.0',
        'name': 'test-practice',
        'summary': 'Test practice summary',
        'content': 'Test content',
        'triggers': ['TestError'],
        'confidence': 0.85,
        'success_streak': 5,
        'impact': {'files': 1, 'lines': 10},
        'outcome': {'status': 'success', 'score': 0.85},
        'environment': {'platform': 'test'}
    }
    
    pattern_id = compute_asset_id(pattern)
    practice_id = compute_asset_id(practice)
    package_id = generate_package_id(pattern_id, practice_id)
    
    return {
        'package_id': package_id,
        'pattern': {**pattern, 'asset_id': pattern_id},
        'practice': {**practice, 'asset_id': practice_id, 'pattern_id': pattern_id},
        'status': 'candidate',
        'usage_count': 0,
        'created_at': '2026-02-23T10:00:00Z',
        'updated_at': '2026-02-23T10:00:00Z'
    }


def test_save_and_load():
    """测试保存和加载经验包"""
    # 创建临时目录
    temp_dir = tempfile.mkdtemp()
    
    try:
        store = FileSystemStore(temp_dir)
        pkg = create_test_package()
        
        # 保存
        store.save_package(pkg)
        
        # 验证文件存在
        pkg_dir = Path(temp_dir) / 'packages' / pkg['package_id']
        assert pkg_dir.exists(), "Package directory should exist"
        assert (pkg_dir / 'package.json').exists(), "package.json should exist"
        assert (pkg_dir / 'pattern.json').exists(), "pattern.json should exist"
        assert (pkg_dir / 'practice.json').exists(), "practice.json should exist"
        
        # 加载
        loaded = store.load_package(pkg['package_id'])
        assert loaded is not None, "Should load package"
        assert loaded['package_id'] == pkg['package_id'], "Package ID should match"
        assert loaded['pattern']['name'] == pkg['pattern']['name'], "Pattern name should match"
        
        print("✓ save_and_load test passed")
        
    finally:
        # 清理
        shutil.rmtree(temp_dir)


def test_delete_package():
    """测试删除经验包"""
    temp_dir = tempfile.mkdtemp()
    
    try:
        store = FileSystemStore(temp_dir)
        pkg = create_test_package()
        
        # 保存
        store.save_package(pkg)
        assert store.package_exists(pkg['package_id']), "Package should exist"
        
        # 删除
        result = store.delete_package(pkg['package_id'])
        assert result, "Delete should succeed"
        assert not store.package_exists(pkg['package_id']), "Package should not exist after delete"
        
        # 删除不存在的包
        result2 = store.delete_package('non-existent')
        assert not result2, "Delete non-existent should return False"
        
        print("✓ delete_package test passed")
        
    finally:
        shutil.rmtree(temp_dir)


def test_list_packages():
    """测试列出经验包"""
    temp_dir = tempfile.mkdtemp()
    
    try:
        store = FileSystemStore(temp_dir)
        
        # 初始为空
        packages = store.list_packages()
        assert len(packages) == 0, "Should be empty initially"
        
        # 添加几个包
        for i in range(3):
            pkg = create_test_package()
            pkg['package_id'] = f"pkg_test{i:03d}"
            store.save_package(pkg)
        
        # 列出
        packages = store.list_packages()
        assert len(packages) == 3, f"Should have 3 packages, got {len(packages)}"
        
        print("✓ list_packages test passed")
        
    finally:
        shutil.rmtree(temp_dir)


if __name__ == '__main__':
    test_save_and_load()
    test_delete_package()
    test_list_packages()
    print("\n✓ All storage tests passed!")
