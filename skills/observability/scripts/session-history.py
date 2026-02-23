#!/usr/bin/env python3
"""
Session History Script - 对话历史时间线

用途：
    查看完整的对话历史时间线，每次 LLM 调用的概览信息

使用方式：
    python session-history.py

输出格式（文本）：
    Conversation History (15 calls)
    ================================================================================
    
    1. 20240223_093042_abc123.json
       时间: 2024-02-23 09:30:42
       模型: dashscope/qwen3.5-plus
       耗时: 2.3s
       用户: "帮我创建一个 test.txt 文件"
       工具: 1 个 (write)
    
    2. 20240223_093055_def456.json
       ...

作者：Coobee AI Team
"""

import json
import sys
from pathlib import Path


def find_workspace_dir() -> Path:
    """
    查找当前工作空间目录
    
    策略：
      1. 使用当前工作目录（假设脚本在工作空间内执行）
      2. 向上查找包含 contexts/ 目录的父目录
    """
    cwd = Path.cwd()
    if (cwd / "contexts").exists():
        return cwd
    
    for parent in list(cwd.parents):
        if (parent / "contexts").exists():
            return parent
    
    return cwd


def format_duration(ms):
    """格式化时长"""
    if ms < 1000:
        return f"{ms}ms"
    return f"{ms/1000:.1f}s"


def get_session_history():
    """获取会话历史"""
    try:
        workspace = find_workspace_dir()
        contexts_dir = workspace / "contexts"
        
        # 检查目录是否存在
        if not contexts_dir.exists():
            print("No conversation history found.")
            print("(contexts directory does not exist)")
            return
        
        # 列出所有 context JSON 文件（按时间排序）
        files = sorted([f for f in contexts_dir.iterdir() if f.suffix == '.json'])
        
        if not files:
            print("No conversation history found.")
            print("(no snapshot files)")
            return
        
        print(f"Conversation History ({len(files)} calls)")
        print("=" * 80)
        print()
        
        # 遍历所有快照
        for idx, file_path in enumerate(files, 1):
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    snap = json.load(f)
                
                print(f"{idx}. {file_path.name}")
                
                # 时间戳
                if 'timestamp' in snap:
                    print(f"   时间: {snap['timestamp']}")
                
                # 模型
                if 'config' in snap and 'model' in snap['config']:
                    print(f"   模型: {snap['config']['model']}")
                
                # 耗时
                if 'duration' in snap:
                    print(f"   耗时: {format_duration(snap['duration'])}")
                
                # 用户消息摘要
                if 'messages' in snap and snap['messages']:
                    user_msgs = [m for m in snap['messages'] if m.get('role') == 'user']
                    if user_msgs:
                        last_user_msg = user_msgs[-1]
                        content = last_user_msg.get('content', '')
                        # 截取前 50 个字符
                        if len(content) > 50:
                            content = content[:50] + "..."
                        print(f"   用户: \"{content}\"")
                
                # 工具调用
                if 'toolCalls' in snap and snap['toolCalls']:
                    tool_names = [tc.get('name', 'unknown') for tc in snap['toolCalls']]
                    tool_summary = ', '.join(tool_names)
                    print(f"   工具: {len(snap['toolCalls'])} 个 ({tool_summary})")
                
                # 错误
                if 'error' in snap:
                    print(f"   ❌ 错误: {snap['error']}")
                
                print()  # 空行分隔
                
            except Exception as e:
                print(f"{idx}. {file_path.name}")
                print(f"   ❌ 解析失败: {e}")
                print()
    
    except Exception as e:
        error_msg = {
            "error": "Failed to get session history",
            "message": str(e)
        }
        print(json.dumps(error_msg, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    get_session_history()
