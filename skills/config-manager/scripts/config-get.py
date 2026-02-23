#!/usr/bin/env python3
"""
Config Get Script - 查看应用配置

用途：
    查看当前生效的配置（经过验证和默认值填充），支持查看完整配置或指定章节

使用方式：
    python config-get.py [key]

参数：
    key (可选): 配置章节 (models, security, tools, ui, logging)

示例：
    # 查看完整配置
    python config-get.py
    
    # 查看模型配置
    python config-get.py models
    
    # 查看安全配置
    python config-get.py security

输出格式（JSON5）：
    {
      models: {
        providers: { ... },
        defaults: { ... }
      }
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


def mask_api_keys(obj):
    """递归脱敏 API Key"""
    if obj is None or not isinstance(obj, (dict, list)):
        return obj
    
    if isinstance(obj, list):
        return [mask_api_keys(item) for item in obj]
    
    result = {}
    for key, value in obj.items():
        if key == 'apiKey' and isinstance(value, str) and value:
            result[key] = '****'
        elif isinstance(value, (dict, list)):
            result[key] = mask_api_keys(value)
        else:
            result[key] = value
    
    return result


def get_config(key=None):
    """获取配置"""
    try:
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
        
        # 读取配置文件
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json5.load(f)
        
        # 提取指定章节或返回全部
        result = config
        if key:
            valid_keys = ['models', 'security', 'tools', 'ui', 'logging']
            if key not in valid_keys:
                error_msg = {
                    "error": "Invalid config key",
                    "key": key,
                    "valid_keys": valid_keys
                }
                print(json.dumps(error_msg, ensure_ascii=False), file=sys.stderr)
                sys.exit(1)
            
            if key not in config:
                error_msg = {
                    "error": "Config key not found",
                    "key": key
                }
                print(json.dumps(error_msg, ensure_ascii=False), file=sys.stderr)
                sys.exit(1)
            
            result = config[key]
        
        # 脱敏 API Key
        sanitized = mask_api_keys(result)
        
        # 输出 JSON5 格式
        output = json.dumps(sanitized, ensure_ascii=False, indent=2)
        print(output)
    
    except Exception as e:
        error_msg = {
            "error": "Failed to get config",
            "message": str(e)
        }
        print(json.dumps(error_msg, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    key = sys.argv[1] if len(sys.argv) > 1 else None
    get_config(key)
