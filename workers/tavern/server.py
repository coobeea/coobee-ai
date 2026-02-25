"""
Tavern Worker - 酒馆任务系统 HTTP API 服务

为 Agent 提供查询、接取、提交任务的 HTTP API。
Agent 通过 Skill 主动调用这些接口，而不是被动接收推送。
"""

import os
import json
import argparse
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any
from flask import Flask, request, jsonify
import sys

app = Flask(__name__)


def log(level: str, message: str):
    """日志输出"""
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [{level}] {message}")
    sys.stdout.flush()


def get_tavern_dir() -> Path:
    """获取酒馆数据目录"""
    user_home = os.environ.get("USER_HOME")
    if not user_home:
        raise RuntimeError("USER_HOME environment variable not set")
    return Path(user_home) / "tavern"


def get_tasks_index_path() -> Path:
    """获取任务列表索引文件路径"""
    return get_tavern_dir() / "tasks.jsonl"


def get_task_dir(task_id: str) -> Path:
    """获取任务目录"""
    return get_tavern_dir() / "tasks" / task_id


# ==================== 任务操作 ====================


def read_tasks_index() -> List[Dict[str, Any]]:
    """读取任务列表索引"""
    index_path = get_tasks_index_path()
    
    if not index_path.exists():
        return []
    
    try:
        with open(index_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            tasks = []
            for line in lines:
                line = line.strip()
                if line:
                    tasks.append(json.loads(line))
            return tasks
    except Exception as e:
        log("ERROR", f"Failed to read tasks index: {str(e)}")
        return []


def read_task_meta(task_id: str) -> Optional[Dict[str, Any]]:
    """读取任务元数据"""
    meta_path = get_task_dir(task_id) / "meta.json"
    
    if not meta_path.exists():
        return None
    
    try:
        with open(meta_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        log("ERROR", f"Failed to read task meta {task_id}: {str(e)}")
        return None


def write_task_meta(task_id: str, task: Dict[str, Any]) -> bool:
    """写入任务元数据"""
    task_dir = get_task_dir(task_id)
    task_dir.mkdir(parents=True, exist_ok=True)
    
    meta_path = task_dir / "meta.json"
    
    try:
        with open(meta_path, 'w', encoding='utf-8') as f:
            json.dump(task, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        log("ERROR", f"Failed to write task meta {task_id}: {str(e)}")
        return False


def write_tasks_index(tasks: List[Dict[str, Any]]) -> bool:
    """写入任务列表索引"""
    tavern_dir = get_tavern_dir()
    tavern_dir.mkdir(parents=True, exist_ok=True)
    
    index_path = get_tasks_index_path()
    
    try:
        lines = [json.dumps(task, ensure_ascii=False) + '\n' for task in tasks]
        with open(index_path, 'w', encoding='utf-8') as f:
            f.writelines(lines)
        return True
    except Exception as e:
        log("ERROR", f"Failed to write tasks index: {str(e)}")
        return False


# ==================== HTTP API ====================


@app.route('/health', methods=['GET'])
def health_check():
    """健康检查"""
    return jsonify({"status": "ok"}), 200


@app.route('/api/tavern/tasks', methods=['GET'])
def list_tasks():
    """
    查询任务列表
    
    Query 参数：
      - status: 按状态筛选（pending/accepted/in-progress/completed/cancelled）
      - limit: 限制数量（默认 20）
      - offset: 偏移量（默认 0）
    """
    try:
        status = request.args.get('status')
        limit = int(request.args.get('limit', 20))
        offset = int(request.args.get('offset', 0))
        
        tasks = read_tasks_index()
        
        # 按状态筛选
        if status:
            tasks = [t for t in tasks if t.get('status') == status]
        
        # 按创建时间倒序排序
        tasks.sort(key=lambda t: t.get('createdAt', ''), reverse=True)
        
        # 分页
        total = len(tasks)
        paged_tasks = tasks[offset:offset + limit]
        
        log("INFO", f"[list_tasks] status={status}, total={total}, returned={len(paged_tasks)}")
        
        return jsonify({
            "ok": True,
            "data": {
                "tasks": paged_tasks,
                "total": total,
                "limit": limit,
                "offset": offset
            }
        }), 200
    
    except Exception as e:
        log("ERROR", f"[list_tasks] Error: {str(e)}")
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route('/api/tavern/tasks/<task_id>', methods=['GET'])
def get_task(task_id: str):
    """获取任务详情"""
    try:
        task = read_task_meta(task_id)
        
        if not task:
            log("WARN", f"[get_task] Task not found: {task_id}")
            return jsonify({"ok": False, "error": "Task not found"}), 404
        
        log("INFO", f"[get_task] Retrieved task: {task_id}")
        
        return jsonify({
            "ok": True,
            "data": task
        }), 200
    
    except Exception as e:
        log("ERROR", f"[get_task] Error: {str(e)}")
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route('/api/tavern/tasks/<task_id>/accept', methods=['POST'])
def accept_task(task_id: str):
    """
    接取任务
    
    Body:
      - agent_id: Agent ID（可选）
    """
    try:
        task = read_task_meta(task_id)
        
        if not task:
            return jsonify({"ok": False, "error": "Task not found"}), 404
        
        if task.get('status') != 'pending':
            return jsonify({"ok": False, "error": f"Task is not pending (current: {task.get('status')})"}), 400
        
        # 更新状态
        body = request.get_json() or {}
        agent_id = body.get('agent_id', 'unknown')
        
        task['status'] = 'accepted'
        task['acceptedBy'] = agent_id
        task['acceptedAt'] = datetime.utcnow().isoformat() + 'Z'
        task['updatedAt'] = datetime.utcnow().isoformat() + 'Z'
        
        # 保存任务元数据
        write_task_meta(task_id, task)
        
        # 更新索引
        tasks = read_tasks_index()
        for i, t in enumerate(tasks):
            if t.get('id') == task_id:
                tasks[i] = task
                break
        write_tasks_index(tasks)
        
        log("INFO", f"[accept_task] Task accepted: {task_id} by {agent_id}")
        
        return jsonify({
            "ok": True,
            "data": task
        }), 200
    
    except Exception as e:
        log("ERROR", f"[accept_task] Error: {str(e)}")
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route('/api/tavern/tasks/<task_id>/result', methods=['POST'])
def submit_result(task_id: str):
    """
    提交任务结果
    
    Body:
      - textResult: 文本结果
      - fileResults: 文件结果列表（可选）
    """
    try:
        task = read_task_meta(task_id)
        
        if not task:
            return jsonify({"ok": False, "error": "Task not found"}), 404
        
        body = request.get_json() or {}
        
        text_result = body.get('textResult', '')
        file_results = body.get('fileResults', [])
        
        # 更新任务
        task['status'] = 'completed'
        task['result'] = {
            "textResult": text_result,
            "fileResults": file_results
        }
        task['completedAt'] = datetime.utcnow().isoformat() + 'Z'
        task['updatedAt'] = datetime.utcnow().isoformat() + 'Z'
        
        # 保存任务元数据
        write_task_meta(task_id, task)
        
        # 更新索引
        tasks = read_tasks_index()
        for i, t in enumerate(tasks):
            if t.get('id') == task_id:
                tasks[i] = task
                break
        write_tasks_index(tasks)
        
        log("INFO", f"[submit_result] Task completed: {task_id}")
        
        return jsonify({
            "ok": True,
            "data": task
        }), 200
    
    except Exception as e:
        log("ERROR", f"[submit_result] Error: {str(e)}")
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route('/api/tavern/tasks/<task_id>/status', methods=['PATCH'])
def update_status(task_id: str):
    """
    更新任务状态
    
    Body:
      - status: 新状态
    """
    try:
        task = read_task_meta(task_id)
        
        if not task:
            return jsonify({"ok": False, "error": "Task not found"}), 404
        
        body = request.get_json() or {}
        new_status = body.get('status')
        
        if not new_status:
            return jsonify({"ok": False, "error": "status is required"}), 400
        
        # 更新状态
        task['status'] = new_status
        task['updatedAt'] = datetime.utcnow().isoformat() + 'Z'
        
        # 保存任务元数据
        write_task_meta(task_id, task)
        
        # 更新索引
        tasks = read_tasks_index()
        for i, t in enumerate(tasks):
            if t.get('id') == task_id:
                tasks[i] = task
                break
        write_tasks_index(tasks)
        
        log("INFO", f"[update_status] Task status updated: {task_id} -> {new_status}")
        
        return jsonify({
            "ok": True,
            "data": task
        }), 200
    
    except Exception as e:
        log("ERROR", f"[update_status] Error: {str(e)}")
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route('/api/tavern/stats', methods=['GET'])
def get_stats():
    """获取统计信息"""
    try:
        tasks = read_tasks_index()
        
        stats = {
            "total": len(tasks),
            "byStatus": {},
            "recentTasks": []
        }
        
        # 按状态统计
        for task in tasks:
            status = task.get('status', 'unknown')
            stats["byStatus"][status] = stats["byStatus"].get(status, 0) + 1
        
        # 最近的任务（前 5 个）
        sorted_tasks = sorted(tasks, key=lambda t: t.get('createdAt', ''), reverse=True)
        stats["recentTasks"] = [
            {
                "id": t.get('id'),
                "title": t.get('title'),
                "status": t.get('status'),
                "createdAt": t.get('createdAt')
            }
            for t in sorted_tasks[:5]
        ]
        
        log("INFO", f"[get_stats] Total tasks: {stats['total']}")
        
        return jsonify({
            "ok": True,
            "data": stats
        }), 200
    
    except Exception as e:
        log("ERROR", f"[get_stats] Error: {str(e)}")
        return jsonify({"ok": False, "error": str(e)}), 500


# ==================== Main ====================


def main():
    parser = argparse.ArgumentParser(description="Tavern Worker")
    parser.add_argument("--port", type=int, help="Port to run on", default=9010)
    args = parser.parse_args()
    
    port = args.port
    log("INFO", f"Tavern Worker starting on port {port}")
    
    # 禁用 Werkzeug 的请求日志（健康检查每 30s 一次会刷屏控制台）
    import logging
    werkzeug_logger = logging.getLogger('werkzeug')
    werkzeug_logger.setLevel(logging.ERROR)
    
    app.run(host="127.0.0.1", port=port, debug=False)


if __name__ == "__main__":
    main()
