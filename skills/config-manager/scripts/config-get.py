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


def find_config_file() -> Path:
    """
    查找 coobee.json5 配置文件
    
    策略：
      1. 向上查找 .home 目录（开发环境）
      2. 回退到用户主目录（生产环境）
    """
    current = Path(__file__).resolve()
    for parent in [current] + list(current.parents):
        config_path = parent / ".home" / "config" / "coobee.json5"
        if config_path.exists():
            return config_path
    
    home_config = Path.home() / ".coobee-ai" / "config" / "coobee.json5"
    if home_config.exists():
        return home_config
    
    raise FileNotFoundError(
        "无法定位 coobee.json5。\n"
        "请确认：\n"
        "  - 开发环境：项目根目录存在 .home/config/coobee.json5\n"
        "  - 生产环境：~/.coobee-ai/config/coobee.json5 已创建"
    )


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
        config_path = find_config_file()
        
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
