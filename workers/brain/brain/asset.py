"""
Asset - 资产 ID 计算

实现 SHA256 内容寻址，参考 EvoMap 规范。
"""

import hashlib
import json
from typing import Dict, Any


def compute_asset_id(asset: Dict[str, Any]) -> str:
    """
    计算资产的 SHA256 ID
    
    参考 EvoMap 规范：
    1. 移除 asset_id 字段
    2. 规范化 JSON（排序 keys）
    3. 计算 SHA256
    
    Args:
        asset: Pattern / Practice / Evolution 字典
        
    Returns:
        格式为 "sha256:{hex}" 的资产 ID
    """
    # 1. 移除 asset_id 字段（如果存在）
    content = {k: v for k, v in asset.items() if k != 'asset_id'}
    
    # 2. 规范化 JSON（排序 keys，不转义中文）
    canonical = json.dumps(content, sort_keys=True, ensure_ascii=False)
    
    # 3. 计算 SHA256
    hash_hex = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
    
    return f"sha256:{hash_hex}"


def generate_package_id(pattern_id: str, practice_id: str) -> str:
    """
    生成经验包 ID
    
    格式: pkg_{pattern_hash[:8]}{practice_hash[:8]}
    
    Args:
        pattern_id: Pattern 的 asset_id
        practice_id: Practice 的 asset_id
        
    Returns:
        经验包 ID
    """
    pattern_hash = pattern_id.replace('sha256:', '')[:8]
    practice_hash = practice_id.replace('sha256:', '')[:8]
    return f"pkg_{pattern_hash}{practice_hash}"


def validate_asset_id(asset_id: str) -> bool:
    """
    验证 asset_id 格式是否正确
    
    Args:
        asset_id: 要验证的 ID
        
    Returns:
        是否有效
    """
    if not asset_id.startswith('sha256:'):
        return False
    
    hash_part = asset_id[7:]  # 去掉 "sha256:" 前缀
    
    # 检查是否是 64 位十六进制字符串
    if len(hash_part) != 64:
        return False
    
    try:
        int(hash_part, 16)
        return True
    except ValueError:
        return False
