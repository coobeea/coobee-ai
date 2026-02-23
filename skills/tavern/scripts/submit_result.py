#!/usr/bin/env python3
"""
提交任务结果

使用示例：
    python submit_result.py --task-id task_abc123 --text "任务完成" --files output/report.pdf
"""

import subprocess
import json
import argparse


def submit_result(task_id, text_result, file_results=None):
    """提交任务结果"""
    url = f'http://localhost:9010/api/tavern/tasks/{task_id}/result'
    
    payload = {
        "textResult": text_result,
        "fileResults": file_results or []
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
    parser = argparse.ArgumentParser(description='提交任务结果')
    parser.add_argument('--task-id', type=str, required=True, help='任务 ID')
    parser.add_argument('--text', type=str, required=True, help='文本结果')
    parser.add_argument('--files', nargs='*', help='文件结果列表')
    args = parser.parse_args()
    
    print(f"提交任务结果: {args.task_id}")
    print(f"文本结果: {args.text}")
    if args.files:
        print(f"文件结果: {', '.join(args.files)}")
    
    response = submit_result(args.task_id, args.text, args.files)
    
    if not response:
        print("提交失败")
        return
    
    if not response.get('ok'):
        print(f"错误: {response.get('error')}")
        return
    
    task = response.get('data', {})
    print(f"\n✓ 任务 {task.get('id')} 结果已提交")
    print(f"  状态: {task.get('status')}")
    print(f"  完成时间: {task.get('completedAt')}")


if __name__ == '__main__':
    main()
