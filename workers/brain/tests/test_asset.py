"""测试 asset.py 模块"""

import sys
from pathlib import Path

# 添加父目录到 Python path
sys.path.insert(0, str(Path(__file__).parent.parent))

from brain.asset import compute_asset_id, generate_package_id, validate_asset_id


def test_compute_asset_id():
    """测试 SHA256 计算"""
    pattern = {
        'type': 'Pattern',
        'name': 'test-pattern'
    }
    
    asset_id = compute_asset_id(pattern)
    
    # 验证格式
    assert asset_id.startswith('sha256:'), "asset_id should start with 'sha256:'"
    assert len(asset_id) == 71, f"asset_id length should be 71, got {len(asset_id)}"
    
    # 验证一致性（相同内容产生相同 ID）
    asset_id2 = compute_asset_id(pattern)
    assert asset_id == asset_id2, "Same content should produce same asset_id"
    
    # 验证不同内容产生不同 ID
    pattern2 = {
        'type': 'Pattern',
        'name': 'different-pattern'
    }
    asset_id3 = compute_asset_id(pattern2)
    assert asset_id != asset_id3, "Different content should produce different asset_id"
    
    print("✓ compute_asset_id tests passed")


def test_generate_package_id():
    """测试经验包 ID 生成"""
    pattern_id = "sha256:abc123def456" + "0" * 52
    practice_id = "sha256:789012ghi345" + "0" * 52
    
    package_id = generate_package_id(pattern_id, practice_id)
    
    # 验证格式
    assert package_id.startswith('pkg_'), "package_id should start with 'pkg_'"
    assert len(package_id) == 20, f"package_id length should be 20, got {len(package_id)}"
    
    # 验证一致性
    package_id2 = generate_package_id(pattern_id, practice_id)
    assert package_id == package_id2, "Same IDs should produce same package_id"
    
    print("✓ generate_package_id tests passed")


def test_validate_asset_id():
    """测试 asset_id 验证"""
    # 有效的 ID
    valid_id = "sha256:" + "a" * 64
    assert validate_asset_id(valid_id), "Valid ID should pass"
    
    # 无效的 ID
    invalid_ids = [
        "sha256:abc",  # 太短
        "invalid:" + "a" * 64,  # 错误前缀
        "sha256:" + "g" * 64,  # 非十六进制字符
        "sha256:" + "a" * 63,  # 长度不对
    ]
    
    for invalid_id in invalid_ids:
        assert not validate_asset_id(invalid_id), f"Invalid ID should fail: {invalid_id}"
    
    print("✓ validate_asset_id tests passed")


if __name__ == '__main__':
    test_compute_asset_id()
    test_generate_package_id()
    test_validate_asset_id()
    print("\n✓ All asset tests passed!")
