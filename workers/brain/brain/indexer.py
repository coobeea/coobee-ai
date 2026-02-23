"""
Indexer - 索引管理

提供快速查找功能的索引系统。
"""

import json
from pathlib import Path
from typing import List, Set, Dict, Any, Optional


class IndexManager:
    """索引管理器"""
    
    def __init__(self, storage_dir: str):
        """
        初始化索引管理器
        
        Args:
            storage_dir: 存储根目录
        """
        self.storage_dir = Path(storage_dir)
        self.index_dir = self.storage_dir / 'index'
        self.index_dir.mkdir(parents=True, exist_ok=True)
    
    def add_package(self, pkg: Dict[str, Any]) -> None:
        """
        添加经验包到索引
        
        索引类型：
            - by-signal.jsonl: 按触发信号索引
            - by-category.jsonl: 按类别索引
            - by-status.jsonl: 按状态索引
        
        Args:
            pkg: 经验包字典
        """
        pattern = pkg['pattern']
        package_id = pkg['package_id']
        timestamp = pkg['created_at']
        
        # 按信号索引
        for signal in pattern.get('signals', []):
            self._append_index('by-signal', {
                'signal': signal,
                'package_id': package_id,
                'timestamp': timestamp
            })
        
        # 按类别索引
        self._append_index('by-category', {
            'category': pattern.get('category'),
            'package_id': package_id,
            'timestamp': timestamp
        })
        
        # 按状态索引
        self._append_index('by-status', {
            'status': pkg.get('status'),
            'package_id': package_id,
            'timestamp': timestamp
        })
    
    def remove_package(self, package_id: str) -> None:
        """
        从索引中移除经验包
        
        Args:
            package_id: 经验包 ID
        """
        # 重建所有索引（简单实现，后续可优化）
        for index_name in ['by-signal', 'by-category', 'by-status']:
            self._rebuild_index(index_name, package_id)
    
    def find_by_signals(self, signals: List[str]) -> List[str]:
        """
        根据信号查找经验包 ID
        
        Args:
            signals: 触发信号列表
            
        Returns:
            匹配的经验包 ID 列表
        """
        index_path = self.index_dir / 'by-signal.jsonl'
        if not index_path.exists():
            return []
        
        matches: Set[str] = set()
        with open(index_path, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                entry = json.loads(line)
                if entry.get('signal') in signals:
                    matches.add(entry['package_id'])
        
        return list(matches)
    
    def find_by_category(self, category: str) -> List[str]:
        """
        根据类别查找经验包 ID
        
        Args:
            category: 类别（repair/optimize/innovate）
            
        Returns:
            匹配的经验包 ID 列表
        """
        index_path = self.index_dir / 'by-category.jsonl'
        if not index_path.exists():
            return []
        
        matches: List[str] = []
        with open(index_path, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                entry = json.loads(line)
                if entry.get('category') == category:
                    matches.append(entry['package_id'])
        
        return matches
    
    def find_by_status(self, status: str) -> List[str]:
        """
        根据状态查找经验包 ID
        
        Args:
            status: 状态（candidate/validated/promoted）
            
        Returns:
            匹配的经验包 ID 列表
        """
        index_path = self.index_dir / 'by-status.jsonl'
        if not index_path.exists():
            return []
        
        matches: List[str] = []
        with open(index_path, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                entry = json.loads(line)
                if entry.get('status') == status:
                    matches.append(entry['package_id'])
        
        return matches
    
    def get_stats(self) -> Dict[str, Any]:
        """
        获取统计信息
        
        Returns:
            统计数据字典
        """
        stats = {
            'byCategory': {},
            'byStatus': {}
        }
        
        # 统计类别
        category_path = self.index_dir / 'by-category.jsonl'
        if category_path.exists():
            with open(category_path, 'r', encoding='utf-8') as f:
                for line in f:
                    if not line.strip():
                        continue
                    entry = json.loads(line)
                    category = entry.get('category')
                    if category:
                        stats['byCategory'][category] = stats['byCategory'].get(category, 0) + 1
        
        # 统计状态
        status_path = self.index_dir / 'by-status.jsonl'
        if status_path.exists():
            with open(status_path, 'r', encoding='utf-8') as f:
                for line in f:
                    if not line.strip():
                        continue
                    entry = json.loads(line)
                    status = entry.get('status')
                    if status:
                        stats['byStatus'][status] = stats['byStatus'].get(status, 0) + 1
        
        return stats
    
    def _append_index(self, index_name: str, entry: Dict[str, Any]) -> None:
        """
        追加索引条目
        
        Args:
            index_name: 索引名称
            entry: 索引条目
        """
        index_path = self.index_dir / f'{index_name}.jsonl'
        with open(index_path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry, ensure_ascii=False) + '\n')
    
    def _rebuild_index(self, index_name: str, exclude_package_id: str) -> None:
        """
        重建索引（排除指定经验包）
        
        Args:
            index_name: 索引名称
            exclude_package_id: 要排除的经验包 ID
        """
        index_path = self.index_dir / f'{index_name}.jsonl'
        if not index_path.exists():
            return
        
        # 读取所有条目
        entries: List[Dict[str, Any]] = []
        with open(index_path, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                entry = json.loads(line)
                if entry.get('package_id') != exclude_package_id:
                    entries.append(entry)
        
        # 重写索引
        with open(index_path, 'w', encoding='utf-8') as f:
            for entry in entries:
                f.write(json.dumps(entry, ensure_ascii=False) + '\n')
