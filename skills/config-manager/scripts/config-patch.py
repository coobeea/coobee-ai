#!/usr/bin/env python3
"""
Config Patch Script - 修改应用配置

用途：
    修改应用配置，支持深度合并（deep merge），修改立即生效（热重载）

使用方式：
    python config-patch.py '<patch-json>'

参数：
    <patch-json>: JSON5 格式的 patch 对象

示例：
    # 切换沙箱模式
    python config-patch.py '{ security: { sandbox: { mode: "docker" } } }'
    
    # 修改默认模型
    python config-patch.py '{ models: { defaults: { model: { primary: "deepseek/deepseek-v3" } } } }'
    
    # 调整审批策略
    python config-patch.py '{ security: { approvals: { exec: "ask" } } }'

输出格式（JSON）：
    {
      "success": true,
      "message": "Configuration updated successfully"
    }

作者：Coobee AI Team
"""

import json
import os
import sys
from pathlib import Path

try:
    import json5
except ImportError:
    print(json.dumps({
        "error": "Missing dependency",
        "message": "Please install json5: pip install json5"
    }), file=sys.stderr)
    sys.exit(1)


def deep_merge(base, patch):
    """深度合并两个字典（patch 合并到 base）"""
    if not isinstance(base, dict) or not isinstance(patch, dict):
        return patch
    
    result = base.copy()
    for key, value in patch.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    
    return result


def patch_config(patch_str):
    """修改配置"""
    try:
        # 解析 patch 对象
        try:
            patch = json5.loads(patch_str)
        except Exception as e:
            error_msg = {
                "error": "Invalid JSON5 format",
                "message": str(e)
            }
            print(json.dumps(error_msg, ensure_ascii=False), file=sys.stderr)
            sys.exit(1)
        
        if not isinstance(patch, dict):
            error_msg = {
                "error": "Invalid patch format",
                "message": "patch must be a JSON5 object (not array or primitive)"
            }
            print(json.dumps(error_msg, ensure_ascii=False), file=sys.stderr)
            sys.exit(1)
        
        # 从环境变量获取配置目录
        config_dir = os.environ.get("COOBEE_CONFIG_DIR")
        
        if not config_dir:
            # 降级方案：使用相对路径（开发环境）
            config_dir = str(Path.cwd() / ".home" / "config")
        
        config_path = Path(config_dir) / "coobee.json5"
        
        # 检查文件是否存在
        if not config_path.exists():
            error_msg = {
                "error": "Configuration file not found",
                "path": str(config_path)
            }
            print(json.dumps(error_msg, ensure_ascii=False), file=sys.stderr)
            sys.exit(1)
        
        # 读取当前配置
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json5.load(f)
        
        # 深度合并
        merged = deep_merge(config, patch)
        
        # 写回配置文件（保留 JSON5 格式）
        with open(config_path, 'w', encoding='utf-8') as f:
            json5.dump(merged, f, indent=2, ensure_ascii=False)
        
        # 输出成功结果
        result = {
            "success": True,
            "message": "Configuration updated successfully"
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
    
    except Exception as e:
        error_msg = {
            "error": "Failed to patch config",
            "message": str(e)
        }
        print(json.dumps(error_msg, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python config-patch.py '<patch-json>'", file=sys.stderr)
        print("Example: python config-patch.py '{ security: { sandbox: { mode: \"docker\" } } }'", file=sys.stderr)
        sys.exit(1)
    
    patch_str = sys.argv[1]
    patch_config(patch_str)
