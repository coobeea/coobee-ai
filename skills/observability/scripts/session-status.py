#!/usr/bin/env python3
"""
Session Status Script - 会话状态查询

用途：
    查看当前会话的运行状态：会话 ID、快照数量、最后一次 LLM 调用信息

使用方式：
    python session-status.py

输出格式（文本）：
    Session: abc123-def456-...
    Snapshots: 15
    
    Last call: 2024-02-23T09:30:42.123Z
    Model: dashscope/qwen3.5-plus
    Duration: 2345ms
    Tool calls: 3

作者：Coobee AI Team
"""

import json
import os
import sys
from pathlib import Path


def get_session_status():
    """获取会话状态"""
    try:
        # 从环境变量获取工作空间目录
        workspace = os.environ.get("COOBEE_WORKSPACE")
        
        if not workspace:
            # 降级方案：使用当前工作目录
            workspace = str(Path.cwd())
        
        session_id = os.environ.get("COOBEE_SESSION_ID", "unknown")
        
        contexts_dir = Path(workspace) / "contexts"
        
        # 检查目录是否存在
        if not contexts_dir.exists():
            print(f"Session: {session_id}")
            print("Snapshots: 0")
            print("\nNo LLM calls recorded yet.")
            return
        
        # 列出所有 context JSON 文件
        files = sorted([f for f in contexts_dir.iterdir() if f.suffix == '.json'])
        snapshot_count = len(files)
        
        print(f"Session: {session_id}")
        print(f"Snapshots: {snapshot_count}")
        
        # 读取最近一次快照
        if files:
            try:
                last_file = files[-1]
                with open(last_file, 'r', encoding='utf-8') as f:
                    snap = json.load(f)
                
                print()  # 空行
                
                # 提取信息
                if 'timestamp' in snap:
                    print(f"Last call: {snap['timestamp']}")
                else:
                    print(f"Last call: {last_file.name}")
                
                if 'config' in snap and 'model' in snap['config']:
                    print(f"Model: {snap['config']['model']}")
                
                if 'duration' in snap:
                    print(f"Duration: {snap['duration']}ms")
                
                if 'toolCalls' in snap and snap['toolCalls']:
                    print(f"Tool calls: {len(snap['toolCalls'])}")
                
                if 'error' in snap:
                    print(f"Error: {snap['error']}")
                    
            except Exception as e:
                print(f"\nFailed to parse last snapshot: {e}")
        else:
            print("\nNo snapshots available.")
    
    except Exception as e:
        error_msg = {
            "error": "Failed to get session status",
            "message": str(e)
        }
        print(json.dumps(error_msg, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    get_session_status()
