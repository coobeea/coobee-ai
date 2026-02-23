#!/usr/bin/env python3
"""
Add Model Script - 添加新模型到配置文件

用途：
    安全地向指定 Provider 添加新模型，带严格的格式验证

使用方式：
    python add_model.py <provider-id> '<model-json>'

示例：
    python add_model.py dashscope '{
      "id": "qwen-test",
      "name": "Qwen Test",
      "contextWindow": 32768,
      "maxOutputTokens": 8192,
      "reasoning": true,
      "features": ["测试模型"]
    }'

模型定义格式：
    {
      "id": "model-id",              # 必需：模型 ID
      "name": "Model Name",          # 必需：模型显示名称
      "contextWindow": 32768,        # 可选：上下文窗口大小
      "maxInputTokens": 30720,       # 可选：最大输入 tokens
      "maxOutputTokens": 8192,       # 可选：最大输出 tokens
      "maxThinkingTokens": 4096,     # 可选：最大思考 tokens
      "reasoning": true,             # 可选：是否支持推理
      "functionCalling": false,      # 可选：是否支持工具调用
      "webSearch": false,            # 可选：是否支持联网搜索
      "vision": false,               # 可选：是否支持视觉理解
      "features": ["特性1", "特性2"] # 可选：特性标签列表
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


def validate_model(model):
    """验证模型定义格式"""
    if not isinstance(model, dict):
        raise ValueError("Model must be a dictionary")

    # 必需字段
    if "id" not in model or not isinstance(model["id"], str) or not model["id"]:
        raise ValueError('Model must have a valid "id" (non-empty string)')

    if "name" not in model or not isinstance(model["name"], str) or not model["name"]:
        raise ValueError('Model must have a valid "name" (non-empty string)')

    # 可选字段类型检查
    numeric_fields = ["contextWindow", "maxInputTokens", "maxOutputTokens", "maxThinkingTokens"]
    for field in numeric_fields:
        if field in model and not isinstance(model[field], (int, float)):
            raise ValueError(f'"{field}" must be a number')

    boolean_fields = ["reasoning", "functionCalling", "webSearch", "vision"]
    for field in boolean_fields:
        if field in model and not isinstance(model[field], bool):
            raise ValueError(f'"{field}" must be a boolean')

    if "features" in model:
        if not isinstance(model["features"], list):
            raise ValueError('"features" must be an array')
        if not all(isinstance(f, str) for f in model["features"]):
            raise ValueError('"features" must be an array of strings')


def add_model(provider_id, model_json):
    """添加模型到配置文件"""
    try:
        # 解析模型定义
        try:
            model = json.loads(model_json)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON format: {e}")

        # 验证格式
        validate_model(model)

        # 配置文件路径
        config_path = Path.cwd() / ".home" / "config" / "coobee.json5"

        # 检查文件是否存在
        if not config_path.exists():
            raise FileNotFoundError(f"Configuration file not found: {config_path}")

        # 读取并解析配置文件
        with open(config_path, "r", encoding="utf-8") as f:
            config = json5.load(f)

        # 检查 Provider 是否存在
        providers = config.get("models", {}).get("providers", {})
        if provider_id not in providers:
            raise ValueError(f'Provider "{provider_id}" not found in configuration')

        provider = providers[provider_id]

        # 检查模型是否已存在
        existing_models = provider.get("models", [])
        if any(m["id"] == model["id"] for m in existing_models):
            raise ValueError(f'Model "{model["id"]}" already exists in provider "{provider_id}"')

        # 添加模型
        if "models" not in provider:
            provider["models"] = []
        provider["models"].append(model)

        # 写回配置文件（保留 JSON5 格式）
        with open(config_path, "w", encoding="utf-8") as f:
            # 使用 json5 库的默认格式化
            json5.dump(config, f, indent=2, ensure_ascii=False)

        # 输出成功结果
        result = {
            "success": True,
            "message": f'Model "{model["id"]}" added to provider "{provider_id}"',
            "model": {
                "ref": f"{provider_id}/{model['id']}",
                "name": model["name"],
                "provider": provider.get("name", provider_id)
            }
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))

    except Exception as e:
        print(json.dumps({
            "error": "Failed to add model",
            "message": str(e)
        }), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({
            "error": "Invalid arguments",
            "usage": "python add_model.py <provider-id> '<model-json>'"
        }), file=sys.stderr)
        sys.exit(1)

    provider_id = sys.argv[1]
    model_json = sys.argv[2]

    add_model(provider_id, model_json)
