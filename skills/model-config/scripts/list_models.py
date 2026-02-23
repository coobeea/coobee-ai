#!/usr/bin/env python3
"""
List Models Script - 列出已激活的模型清单

用途：
    安全地读取配置文件，提取所有 enabled: true 的模型信息

使用方式：
    python list_models.py

输出格式（JSON）：
    {
      "success": true,
      "count": 15,
      "models": [
        {
          "ref": "dashscope/qwen3.5-plus",
          "name": "Qwen3.5 Plus",
          "provider": "百炼",
          "providerId": "dashscope",
          "contextWindow": 1000000,
          "maxOutputTokens": 65536,
          "reasoning": true,
          "functionCalling": true,
          "webSearch": true,
          "features": ["上下文1M", "输出64k", "思考模型"]
        }
      ]
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


def list_models():
    """列出所有已激活的模型"""
    try:
        config_path = find_config_file()
        
        with open(config_path, "r", encoding="utf-8") as f:
            config = json5.load(f)

        # 提取模型信息
        models = []
        providers = config.get("models", {}).get("providers", {})

        for provider_id, provider in providers.items():
            # 只处理已启用的 Provider
            if not provider.get("enabled", False):
                continue

            provider_name = provider.get("name", provider_id)

            # 遍历该 Provider 的所有模型
            for model in provider.get("models", []):
                model_info = {
                    "ref": f"{provider_id}/{model['id']}",
                    "name": model.get("name", model["id"]),
                    "provider": provider_name,
                    "providerId": provider_id,
                    "contextWindow": model.get("contextWindow"),
                    "maxOutputTokens": model.get("maxOutputTokens"),
                    "maxThinkingTokens": model.get("maxThinkingTokens"),
                    "reasoning": model.get("reasoning", False),
                    "functionCalling": model.get("functionCalling", False),
                    "webSearch": model.get("webSearch", False),
                    "vision": model.get("vision", False),
                    "features": model.get("features", [])
                }
                models.append(model_info)

        # 输出结果
        result = {
            "success": True,
            "count": len(models),
            "models": models
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))

    except Exception as e:
        print(json.dumps({
            "error": "Failed to list models",
            "message": str(e)
        }), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    list_models()
