#!/usr/bin/env python3
"""
Brain Worker - 智库服务 HTTP Server

提供两套 API：
1. Agent API (42043) - 供 AI Agent 使用
2. Gateway API (42043) - 供前端管理系统使用（通过 Gateway 转发）
"""

import os
import sys
import argparse
from datetime import datetime
from flask import Flask, request, jsonify
from typing import Dict, Any, List, Optional

# 添加当前目录到 Python path
sys.path.insert(0, os.path.dirname(__file__))

from brain.storage import FileSystemStore
from brain.indexer import IndexManager
from brain.asset import compute_asset_id, generate_package_id, validate_asset_id

app = Flask(__name__)

# 全局存储（从环境变量获取路径）
storage_dir: Optional[str] = None
store: Optional[FileSystemStore] = None
indexer: Optional[IndexManager] = None


def log(level: str, message: str):
    """日志输出（标准输出，由 WorkerManager 捕获）"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{timestamp}] [{level}] {message}", flush=True)


# ==================== 健康检查 ====================

@app.route('/health', methods=['GET'])
def health():
    """健康检查端点（WorkerManager 轮询）"""
    return jsonify({'status': 'ok'})


# ==================== Agent API ====================

@app.route('/api/brain/publish', methods=['POST'])
def publish():
    """
    发布经验包（供 Agent 使用）
    
    Request:
        {
            "message_id": "msg_xxx",
            "timestamp": "2026-02-23T10:00:00Z",
            "payload": {
                "pattern": { ... },
                "practice": { ... },
                "evolution": { ... } (可选)
            }
        }
    
    Response:
        {
            "success": true,
            "data": {
                "package_id": "pkg_xxx",
                "pattern_id": "sha256:...",
                "practice_id": "sha256:...",
                "evolution_id": "sha256:..." (可选),
                "status": "candidate"
            }
        }
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'error': {
                    'code': 'INVALID_REQUEST',
                    'message': '请求体不能为空'
                }
            }), 400
        
        message_id = data.get('message_id')
        timestamp = data.get('timestamp')
        payload = data.get('payload', {})
        
        pattern = payload.get('pattern')
        practice = payload.get('practice')
        evolution = payload.get('evolution')
        
        # 验证必需字段
        if not pattern or not practice:
            return jsonify({
                'success': False,
                'error': {
                    'code': 'BUNDLE_REQUIRED',
                    'message': '必须同时提供 pattern 和 practice'
                }
            }), 400
        
        # 计算 asset_id
        pattern_id = compute_asset_id(pattern)
        practice_id = compute_asset_id(practice)
        evolution_id = compute_asset_id(evolution) if evolution else None
        
        # 生成 package_id
        package_id = generate_package_id(pattern_id, practice_id)
        
        # 检查是否已存在
        if store.package_exists(package_id):
            log('WARN', f'Package already exists: {package_id}')
            return jsonify({
                'success': False,
                'error': {
                    'code': 'PACKAGE_EXISTS',
                    'message': f'经验包已存在: {package_id}'
                }
            }), 409
        
        # 构建 Package
        pkg: Dict[str, Any] = {
            'package_id': package_id,
            'pattern': {**pattern, 'asset_id': pattern_id},
            'practice': {
                **practice,
                'asset_id': practice_id,
                'pattern_id': pattern_id
            },
            'status': 'candidate',
            'usage_count': 0,
            'created_at': timestamp or datetime.utcnow().isoformat() + 'Z',
            'updated_at': timestamp or datetime.utcnow().isoformat() + 'Z'
        }
        
        if evolution:
            pkg['evolution'] = {
                **evolution,
                'asset_id': evolution_id,
                'practice_id': practice_id,
                'patterns_used': [pattern_id]
            }
        
        # 存储
        store.save_package(pkg)
        
        # 更新索引
        indexer.add_package(pkg)
        
        log('INFO', f'Published package: {package_id}')
        
        return jsonify({
            'success': True,
            'data': {
                'package_id': package_id,
                'pattern_id': pattern_id,
                'practice_id': practice_id,
                'evolution_id': evolution_id,
                'status': 'candidate',
                'message': '经验包已发布'
            }
        })
        
    except Exception as e:
        log('ERROR', f'Publish failed: {str(e)}')
        return jsonify({
            'success': False,
            'error': {
                'code': 'INTERNAL_ERROR',
                'message': str(e)
            }
        }), 500


@app.route('/api/brain/search', methods=['POST'])
def search():
    """
    搜索经验包（供 Agent 使用）
    
    Request:
        {
            "message_id": "msg_xxx",
            "timestamp": "2026-02-23T10:00:00Z",
            "payload": {
                "signals": ["TimeoutError"],
                "category": "repair" (可选),
                "status": "promoted" (可选),
                "limit": 10
            }
        }
    
    Response:
        {
            "success": true,
            "data": {
                "packages": [
                    {
                        "package_id": "pkg_xxx",
                        "pattern": { "name": "...", "summary": "..." },
                        "practice": { "name": "...", "summary": "...", "confidence": 0.85 },
                        "status": "promoted",
                        "usage_count": 42
                    }
                ],
                "total": 1
            }
        }
    """
    try:
        data = request.get_json()
        payload = data.get('payload', {}) if data else {}
        
        signals = payload.get('signals', [])
        category = payload.get('category')
        status = payload.get('status')
        limit = payload.get('limit', 10)
        
        # 根据信号查找
        package_ids: List[str] = []
        if signals:
            package_ids = indexer.find_by_signals(signals)
        else:
            # 返回所有
            package_ids = store.list_packages()
        
        # 加载完整 Package 并过滤
        packages: List[Dict[str, Any]] = []
        for pkg_id in package_ids:
            pkg = store.load_package(pkg_id)
            if not pkg:
                continue
            
            # 按类别过滤
            if category and pkg['pattern'].get('category') != category:
                continue
            
            # 按状态过滤
            if status and pkg.get('status') != status:
                continue
            
            # 只返回摘要信息（不含完整 content）
            packages.append({
                'package_id': pkg['package_id'],
                'pattern': {
                    'name': pkg['pattern'].get('name'),
                    'summary': pkg['pattern'].get('summary'),
                    'category': pkg['pattern'].get('category')
                },
                'practice': {
                    'name': pkg['practice'].get('name'),
                    'summary': pkg['practice'].get('summary'),
                    'confidence': pkg['practice'].get('confidence')
                },
                'status': pkg.get('status'),
                'usage_count': pkg.get('usage_count', 0),
                'created_at': pkg.get('created_at')
            })
        
        # 限制数量
        packages = packages[:limit]
        
        log('INFO', f'Search found {len(packages)} packages')
        
        return jsonify({
            'success': True,
            'data': {
                'packages': packages,
                'total': len(packages)
            }
        })
        
    except Exception as e:
        log('ERROR', f'Search failed: {str(e)}')
        return jsonify({
            'success': False,
            'error': {
                'code': 'INTERNAL_ERROR',
                'message': str(e)
            }
        }), 500


@app.route('/api/brain/fetch', methods=['POST'])
def fetch():
    """
    获取完整经验包（供 Agent 和 Gateway 使用）
    
    Request:
        {
            "message_id": "msg_xxx",
            "timestamp": "2026-02-23T10:00:00Z",
            "payload": {
                "package_id": "pkg_xxx"
            }
        }
    
    Response:
        {
            "success": true,
            "data": {
                "package": { ... 完整的 Package ... }
            }
        }
    """
    try:
        data = request.get_json()
        payload = data.get('payload', {}) if data else {}
        
        package_id = payload.get('package_id')
        if not package_id:
            return jsonify({
                'success': False,
                'error': {
                    'code': 'INVALID_PARAMS',
                    'message': '缺少参数: package_id'
                }
            }), 400
        
        pkg = store.load_package(package_id)
        if not pkg:
            return jsonify({
                'success': False,
                'error': {
                    'code': 'NOT_FOUND',
                    'message': f'经验包不存在: {package_id}'
                }
            }), 404
        
        # 增加使用计数
        pkg['usage_count'] = pkg.get('usage_count', 0) + 1
        store.save_package(pkg)
        
        log('INFO', f'Fetched package: {package_id}')
        
        return jsonify({
            'success': True,
            'data': {
                'package': pkg
            }
        })
        
    except Exception as e:
        log('ERROR', f'Fetch failed: {str(e)}')
        return jsonify({
            'success': False,
            'error': {
                'code': 'INTERNAL_ERROR',
                'message': str(e)
            }
        }), 500


# ==================== Gateway API ====================

@app.route('/api/brain/stats', methods=['GET'])
def stats():
    """
    获取统计信息（供 Gateway 使用）
    
    Response:
        {
            "success": true,
            "data": {
                "total": 156,
                "byCategory": { "repair": 89, ... },
                "byStatus": { "candidate": 23, ... },
                "recentPackages": [...]
            }
        }
    """
    try:
        # 获取所有经验包
        all_packages = store.list_packages()
        total = len(all_packages)
        
        # 统计信息
        stats_data = indexer.get_stats()
        
        # 最近添加的经验包（最多 10 个）
        recent_packages: List[Dict[str, Any]] = []
        for pkg_id in all_packages[:10]:
            pkg = store.load_package(pkg_id)
            if pkg:
                recent_packages.append({
                    'package_id': pkg['package_id'],
                    'pattern_name': pkg['pattern'].get('name'),
                    'created_at': pkg.get('created_at')
                })
        
        return jsonify({
            'success': True,
            'data': {
                'total': total,
                'byCategory': stats_data.get('byCategory', {}),
                'byStatus': stats_data.get('byStatus', {}),
                'recentPackages': recent_packages
            }
        })
        
    except Exception as e:
        log('ERROR', f'Stats failed: {str(e)}')
        return jsonify({
            'success': False,
            'error': {
                'code': 'INTERNAL_ERROR',
                'message': str(e)
            }
        }), 500


@app.route('/api/brain/packages', methods=['GET', 'POST'])
def list_packages():
    """
    列出经验包（供 Gateway 使用，带分页）
    
    Request:
        {
            "limit": 20,
            "offset": 0,
            "category": "repair" (可选),
            "status": "promoted" (可选),
            "signals": ["TimeoutError"] (可选)
        }
    
    Response:
        {
            "success": true,
            "data": {
                "packages": [...],
                "total": 156,
                "limit": 20,
                "offset": 0
            }
        }
    """
    try:
        # 支持 GET (query params) 和 POST (body)
        if request.method == 'GET':
            limit = int(request.args.get('limit', 20))
            offset = int(request.args.get('offset', 0))
            category = request.args.get('category')
            status = request.args.get('status')
            signals = request.args.getlist('signals')
        else:
            data = request.get_json() or {}
            limit = data.get('limit', 20)
            offset = data.get('offset', 0)
            category = data.get('category')
            status = data.get('status')
            signals = data.get('signals', [])
        
        # 查找匹配的经验包
        if signals:
            package_ids = indexer.find_by_signals(signals)
        elif category:
            package_ids = indexer.find_by_category(category)
        elif status:
            package_ids = indexer.find_by_status(status)
        else:
            package_ids = store.list_packages()
        
        # 加载并过滤
        packages: List[Dict[str, Any]] = []
        for pkg_id in package_ids:
            pkg = store.load_package(pkg_id)
            if not pkg:
                continue
            
            # 额外过滤
            if category and pkg['pattern'].get('category') != category:
                continue
            if status and pkg.get('status') != status:
                continue
            
            packages.append({
                'package_id': pkg['package_id'],
                'pattern': {
                    'name': pkg['pattern'].get('name'),
                    'summary': pkg['pattern'].get('summary'),
                    'category': pkg['pattern'].get('category')
                },
                'practice': {
                    'name': pkg['practice'].get('name'),
                    'summary': pkg['practice'].get('summary'),
                    'confidence': pkg['practice'].get('confidence')
                },
                'status': pkg.get('status'),
                'usage_count': pkg.get('usage_count', 0),
                'created_at': pkg.get('created_at')
            })
        
        # 分页
        total = len(packages)
        packages_page = packages[offset:offset + limit]
        
        return jsonify({
            'success': True,
            'data': {
                'packages': packages_page,
                'total': total,
                'limit': limit,
                'offset': offset
            }
        })
        
    except Exception as e:
        log('ERROR', f'List packages failed: {str(e)}')
        return jsonify({
            'success': False,
            'error': {
                'code': 'INTERNAL_ERROR',
                'message': str(e)
            }
        }), 500


@app.route('/api/brain/packages/<package_id>', methods=['GET'])
def get_package(package_id: str):
    """
    获取经验包详情（供 Gateway 使用）
    
    Response:
        {
            "success": true,
            "data": {
                "package_id": "pkg_xxx",
                "pattern": { ... },
                "practice": { ... },
                "evolution": { ... },
                "status": "...",
                "usage_count": ...,
                "created_at": "...",
                "updated_at": "..."
            }
        }
    """
    try:
        pkg = store.load_package(package_id)
        
        if not pkg:
            return jsonify({
                'success': False,
                'error': {
                    'code': 'NOT_FOUND',
                    'message': f'经验包不存在: {package_id}'
                }
            }), 404
        
        return jsonify({
            'success': True,
            'data': pkg
        })
        
    except Exception as e:
        log('ERROR', f'Get package failed: {str(e)}')
        return jsonify({
            'success': False,
            'error': {
                'code': 'INTERNAL_ERROR',
                'message': str(e)
            }
        }), 500


@app.route('/api/brain/packages/<package_id>', methods=['DELETE'])
def delete_package(package_id: str):
    """
    删除经验包（供 Gateway 使用）
    
    Response:
        {
            "success": true,
            "data": {
                "package_id": "pkg_xxx",
                "message": "经验包已删除"
            }
        }
    """
    try:
        if not store.package_exists(package_id):
            return jsonify({
                'success': False,
                'error': {
                    'code': 'NOT_FOUND',
                    'message': f'经验包不存在: {package_id}'
                }
            }), 404
        
        # 删除存储
        store.delete_package(package_id)
        
        # 从索引中移除
        indexer.remove_package(package_id)
        
        log('INFO', f'Deleted package: {package_id}')
        
        return jsonify({
            'success': True,
            'data': {
                'package_id': package_id,
                'message': '经验包已删除'
            }
        })
        
    except Exception as e:
        log('ERROR', f'Delete package failed: {str(e)}')
        return jsonify({
            'success': False,
            'error': {
                'code': 'INTERNAL_ERROR',
                'message': str(e)
            }
        }), 500


# ==================== 启动 ====================

def main():
    global storage_dir, store, indexer
    
    parser = argparse.ArgumentParser(description='Brain Worker')
    parser.add_argument('--port', type=int, default=42043, help='Port to run on')
    parser.add_argument('--host', type=str, default='127.0.0.1', help='绑定地址')
    args = parser.parse_args()
    
    # 获取存储目录（从环境变量）
    user_home = os.environ.get('USER_HOME')
    if not user_home:
        log('ERROR', 'USER_HOME environment variable not set')
        sys.exit(1)
    
    storage_dir = os.path.join(user_home, 'brain')
    store = FileSystemStore(storage_dir)
    indexer = IndexManager(storage_dir)
    
    log('INFO', f'Brain Worker starting on port {args.port}')
    log('INFO', f'Storage directory: {storage_dir}')
    
    # 禁用 Flask/Werkzeug 的请求日志（仅保留错误日志）
    import logging
    werkzeug_logger = logging.getLogger('werkzeug')
    werkzeug_logger.setLevel(logging.ERROR)
    
    # 启动 Flask 服务
    app.run(host=args.host, port=args.port, debug=False)


if __name__ == '__main__':
    main()
