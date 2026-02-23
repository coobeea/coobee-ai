#!/usr/bin/env python3
"""
Context Inspect Script - LLM 调用上下文检查

用途：
    深入检查特定 LLM 调用的详细上下文：指令、Skills、工具、消息、输出等

使用方式：
    python context-inspect.py <filename>

参数：
    <filename>: 快照文件名（从 session-history 获取）

示例：
    python context-inspect.py 20240223_093042_abc123.json

输出格式（文本）：
    Context Snapshot: 20240223_093042_abc123.json
    ================================================================================
    
    模型: dashscope/qwen3.5-plus
    时间: 2024-02-23 09:30:42
    耗时: 2.3s
    
    === 系统指令 ===
    You are a helpful AI assistant...
    
    === 加载的 Skills ===
    - skill-creator: 创建 Skill 指南
    - model-config: 模型配置管理
    
    === 可用工具 ===
    - read: 读取文件
    - write: 写入文件
    - exec: 执行命令
    
    === 用户消息 ===
    帮我创建一个 test.txt 文件
    
    === 工具调用 ===
    1. write
       参数: {"path": "test.txt", "content": "Hello World"}
       结果: success
    
    === LLM 输出 ===
    我已经为你创建了 test.txt 文件...

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


def inspect_context(filename):
    """检查指定快照的详细上下文"""
    try:
        workspace = find_workspace_dir()
        contexts_dir = workspace / "contexts"
        
        # 检查目录是否存在
        if not contexts_dir.exists():
            error_msg = {
                "error": "Contexts directory not found",
                "path": str(contexts_dir)
            }
            print(json.dumps(error_msg, ensure_ascii=False), file=sys.stderr)
            sys.exit(1)
        
        # 读取快照文件
        snapshot_path = contexts_dir / filename
        if not snapshot_path.exists():
            error_msg = {
                "error": "Snapshot file not found",
                "filename": filename,
                "path": str(snapshot_path)
            }
            print(json.dumps(error_msg, ensure_ascii=False), file=sys.stderr)
            sys.exit(1)
        
        with open(snapshot_path, 'r', encoding='utf-8') as f:
            snap = json.load(f)
        
        # 输出快照详情
        print(f"Context Snapshot: {filename}")
        print("=" * 80)
        print()
        
        # 基本信息
        if 'config' in snap and 'model' in snap['config']:
            print(f"模型: {snap['config']['model']}")
        
        if 'timestamp' in snap:
            print(f"时间: {snap['timestamp']}")
        
        if 'duration' in snap:
            duration_s = snap['duration'] / 1000 if snap['duration'] >= 1000 else snap['duration']
            unit = 's' if snap['duration'] >= 1000 else 'ms'
            print(f"耗时: {duration_s:.1f}{unit}")
        
        print()
        
        # 系统指令
        if 'instructions' in snap:
            print("=== 系统指令 ===")
            instructions = snap['instructions']
            # 截取前 200 个字符
            if len(instructions) > 200:
                instructions = instructions[:200] + "..."
            print(instructions)
            print()
        
        # 加载的 Skills
        if 'skills' in snap and snap['skills']:
            print("=== 加载的 Skills ===")
            for skill in snap['skills']:
                if isinstance(skill, dict):
                    name = skill.get('name', 'unknown')
                    desc = skill.get('description', '')
                    if desc and len(desc) > 50:
                        desc = desc[:50] + "..."
                    print(f"- {name}: {desc}")
                else:
                    print(f"- {skill}")
            print()
        
        # 可用工具
        if 'tools' in snap and snap['tools']:
            print("=== 可用工具 ===")
            for tool in snap['tools']:
                if isinstance(tool, dict):
                    name = tool.get('name', 'unknown')
                    desc = tool.get('description', '')
                    if desc and len(desc) > 50:
                        desc = desc[:50] + "..."
                    print(f"- {name}: {desc}")
                elif isinstance(tool, str):
                    print(f"- {tool}")
            print()
        
        # 用户消息
        if 'messages' in snap and snap['messages']:
            print("=== 用户消息 ===")
            user_msgs = [m for m in snap['messages'] if m.get('role') == 'user']
            if user_msgs:
                for msg in user_msgs:
                    content = msg.get('content', '')
                    print(content)
            print()
        
        # 工具调用
        if 'toolCalls' in snap and snap['toolCalls']:
            print("=== 工具调用 ===")
            for idx, tool_call in enumerate(snap['toolCalls'], 1):
                name = tool_call.get('name', 'unknown')
                params = tool_call.get('params', {})
                result = tool_call.get('result', {})
                
                print(f"{idx}. {name}")
                
                # 参数
                if params:
                    params_str = json.dumps(params, ensure_ascii=False, indent=2)
                    # 截取前 100 个字符
                    if len(params_str) > 100:
                        params_str = params_str[:100] + "..."
                    print(f"   参数: {params_str}")
                
                # 结果
                if isinstance(result, dict):
                    success = result.get('success', False)
                    status = "success" if success else "failed"
                    print(f"   结果: {status}")
                    if 'error' in result:
                        print(f"   错误: {result['error']}")
                else:
                    print(f"   结果: {result}")
                
                print()
        
        # LLM 输出
        if 'output' in snap:
            print("=== LLM 输出 ===")
            output = snap['output']
            # 截取前 500 个字符
            if len(output) > 500:
                output = output[:500] + "..."
            print(output)
            print()
        
        # Token 使用
        if 'usage' in snap:
            print("=== Token 使用 ===")
            usage = snap['usage']
            if isinstance(usage, dict):
                for key, value in usage.items():
                    print(f"{key}: {value}")
            print()
        
        # 错误
        if 'error' in snap:
            print("=== ❌ 错误 ===")
            print(snap['error'])
            print()
    
    except Exception as e:
        error_msg = {
            "error": "Failed to inspect context",
            "message": str(e)
        }
        print(json.dumps(error_msg, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python context-inspect.py <filename>", file=sys.stderr)
        print("Example: python context-inspect.py 20240223_093042_abc123.json", file=sys.stderr)
        sys.exit(1)
    
    filename = sys.argv[1]
    inspect_context(filename)
