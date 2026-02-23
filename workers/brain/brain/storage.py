"""
Storage - 文件系统存储管理

管理经验包的持久化存储。
"""

import os
import json
from pathlib import Path
from typing import Optional, Dict, Any, List


class FileSystemStore:
    """文件系统存储管理器"""
    
    def __init__(self, storage_dir: str):
        """
        初始化存储管理器
        
        Args:
            storage_dir: 存储根目录（.home/brain/）
        """
        self.storage_dir = Path(storage_dir)
        self.packages_dir = self.storage_dir / 'packages'
        self.packages_dir.mkdir(parents=True, exist_ok=True)
    
    def save_package(self, pkg: Dict[str, Any]) -> None:
        """
        保存经验包
        
        文件结构：
            packages/{package_id}/
                ├── package.json      # 完整经验包
                ├── pattern.json      # 方案模板
                ├── practice.json     # 实践案例
                └── evolution.json    # 演进记录（可选）
        
        Args:
            pkg: 经验包字典
        """
        pkg_dir = self.packages_dir / pkg['package_id']
        pkg_dir.mkdir(parents=True, exist_ok=True)
        
        # 写入主文件
        self._write_json(pkg_dir / 'package.json', pkg)
        self._write_json(pkg_dir / 'pattern.json', pkg['pattern'])
        self._write_json(pkg_dir / 'practice.json', pkg['practice'])
        
        if 'evolution' in pkg and pkg['evolution']:
            self._write_json(pkg_dir / 'evolution.json', pkg['evolution'])
    
    def load_package(self, package_id: str) -> Optional[Dict[str, Any]]:
        """
        加载经验包
        
        Args:
            package_id: 经验包 ID
            
        Returns:
            经验包字典，不存在则返回 None
        """
        pkg_path = self.packages_dir / package_id / 'package.json'
        
        if not pkg_path.exists():
            return None
        
        with open(pkg_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def delete_package(self, package_id: str) -> bool:
        """
        删除经验包
        
        Args:
            package_id: 经验包 ID
            
        Returns:
            是否成功删除
        """
        pkg_dir = self.packages_dir / package_id
        
        if not pkg_dir.exists():
            return False
        
        # 删除所有文件
        for file_path in pkg_dir.iterdir():
            if file_path.is_file():
                file_path.unlink()
        
        # 删除目录
        pkg_dir.rmdir()
        return True
    
    def list_packages(self) -> List[str]:
        """
        列出所有经验包 ID
        
        Returns:
            经验包 ID 列表
        """
        if not self.packages_dir.exists():
            return []
        
        return [d.name for d in self.packages_dir.iterdir() if d.is_dir()]
    
    def package_exists(self, package_id: str) -> bool:
        """
        检查经验包是否存在
        
        Args:
            package_id: 经验包 ID
            
        Returns:
            是否存在
        """
        pkg_dir = self.packages_dir / package_id
        return pkg_dir.exists() and (pkg_dir / 'package.json').exists()
    
    def _write_json(self, path: Path, data: Dict[str, Any]) -> None:
        """
        写入 JSON 文件
        
        Args:
            path: 文件路径
            data: 要写入的数据
        """
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
