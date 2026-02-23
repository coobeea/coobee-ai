#!/usr/bin/env python3
"""
查询酒馆任务列表

使用示例：
    python query_tasks.py --status pending --limit 10
"""

import subprocess
import json
import argparse


def query_tasks(status=None, limit=20, offset=0):
    """查询任务列表"""
    url = 'http://localhost:9010/api/tavern/tasks'
    
    params = []
    if status:
        params.append(f'status={status}')
    if limit:
        params.append(f'limit={limit}')
    if offset:
        params.append(f'offset={offset}')
    
    if params:
        url += '?' + '&'.join(params)
    
    result = subprocess.run([
        'curl', '-s', '-X', 'GET',
        url,
        '-H', 'Content-Type: application/json'
    ], capture_output=True, text=True)
    
    try:
        response = json.loads(result.stdout)
        return response
    except json.JSONDecodeError as e:
        print(f"解析响应失败: {e}")
        print(f"原始响应: {result.stdout}")
        return None


def main():
    parser = argparse.ArgumentParser(description='查询酒馆任务列表')
    parser.add_argument('--status', type=str, help='按状态筛选（pending/accepted/in-progress/completed/cancelled）')
    parser.add_argument('--limit', type=int, default=20, help='限制数量（默认 20）')
    parser.add_argument('--offset', type=int, default=0, help='偏移量（默认 0）')
    args = parser.parse_args()
    
    print(f"查询酒馆任务列表...")
    if args.status:
        print(f"  - 状态筛选: {args.status}")
    
    response = query_tasks(status=args.status, limit=args.limit, offset=args.offset)
    
    if not response:
        print("查询失败")
        return
    
    if not response.get('ok'):
        print(f"错误: {response.get('error')}")
        return
    
    data = response.get('data', {})
    tasks = data.get('tasks', [])
    total = data.get('total', 0)
    
    print(f"\n找到 {total} 个任务，显示 {len(tasks)} 个：\n")
    
    for i, task in enumerate(tasks, 1):
        print(f"{i}. {task.get('title')} (ID: {task.get('id')})")
        print(f"   金额: {task.get('amount')} 元")
        print(f"   状态: {task.get('status')}")
        print(f"   创建时间: {task.get('createdAt')}")
        print(f"   描述: {task.get('description', '')[:60]}...")
        print()


if __name__ == '__main__':
    main()
