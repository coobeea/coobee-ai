#!/usr/bin/env python3
"""
接取酒馆任务

使用示例：
    python accept_task.py --task-id task_abc123 --agent-id app-copilot
"""

import subprocess
import json
import argparse


def accept_task(task_id, agent_id):
    """接取任务"""
    url = f'http://localhost:9010/api/tavern/tasks/{task_id}/accept'
    
    payload = {
        "agent_id": agent_id
    }
    
    result = subprocess.run([
        'curl', '-s', '-X', 'POST',
        url,
        '-H', 'Content-Type: application/json',
        '-d', json.dumps(payload)
    ], capture_output=True, text=True)
    
    try:
        response = json.loads(result.stdout)
        return response
    except json.JSONDecodeError as e:
        print(f"解析响应失败: {e}")
        print(f"原始响应: {result.stdout}")
        return None


def main():
    parser = argparse.ArgumentParser(description='接取酒馆任务')
    parser.add_argument('--task-id', type=str, required=True, help='任务 ID')
    parser.add_argument('--agent-id', type=str, default='unknown', help='Agent ID（默认 unknown）')
    args = parser.parse_args()
    
    print(f"接取任务: {args.task_id}")
    print(f"Agent ID: {args.agent_id}")
    
    response = accept_task(args.task_id, args.agent_id)
    
    if not response:
        print("接取失败")
        return
    
    if not response.get('ok'):
        print(f"错误: {response.get('error')}")
        return
    
    task = response.get('data', {})
    print(f"\n✓ 任务 {task.get('id')} 已接取")
    print(f"  状态: {task.get('status')}")
    print(f"  接取时间: {task.get('acceptedAt')}")


if __name__ == '__main__':
    main()
