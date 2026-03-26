/**
 * 全量默认配置模板
 *
 * 首次启动时用于生成 coobee.json5。
 * 包含所有预置供应商和模型，API Key 为空、供应商默认禁用。
 * 用户只需在界面上填入 API Key 并启用即可使用。
 */

export function generateDefaultConfig(): string {
  return `// Coobee AI 配置文件
// 所有供应商已预置，只需填入 API Key 并启用即可使用
// API Key 也可通过环境变量设置，格式: \${ENV_VAR_NAME}
// 敏感 Key 建议存放在 secrets.json5 中
{
  models: {
    providers: {

      // ═══════════════════════════════════════════════════
      // 阿里云百炼 — 按量付费
      // 获取 API Key: https://bailian.console.aliyun.com/?tab=model#/api-key
      // ═══════════════════════════════════════════════════
      dashscope: {
        id: "dashscope",
        name: "百炼",
        description: "阿里云百炼平台，提供企业级AI模型服务",
        api: "openai-compatible",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "",
        billingMode: "pay-as-you-go",
        enabled: false,
        websites: {
          official: "https://www.aliyun.com/product/bailian",
          apiKey: "https://bailian.console.aliyun.com/?tab=model#/api-key",
          docs: "https://help.aliyun.com/zh/model-studio/getting-started/",
          models: "https://bailian.console.aliyun.com/?tab=model#/model-market",
        },
        models: [
          {
            id: "qwen3.5-plus",
            name: "Qwen3.5 Plus",
            contextWindow: 1000000,
            maxInputTokens: 983616,
            maxOutputTokens: 65536,
            maxThinkingTokens: 81920,
            reasoning: true,
            functionCalling: true,
            webSearch: true,
            features: ["上下文1M", "输出64k", "思考模型", "MoE 397B/17B", "联网搜索"],
          },
          {
            id: "qwen3-max",
            name: "Qwen3 Max",
            contextWindow: 262144,
            maxInputTokens: 258048,
            maxOutputTokens: 65536,
            maxThinkingTokens: 81920,
            reasoning: true,
            functionCalling: true,
            webSearch: true,
            features: ["上下文256k", "输出64k", "思考模型", "工具调用", "联网搜索"],
          },
          {
            id: "qwen-plus-latest",
            name: "Qwen Plus",
            contextWindow: 1000000,
            maxInputTokens: 997952,
            maxOutputTokens: 65536,
            maxThinkingTokens: 81920,
            reasoning: true,
            features: ["上下文1M", "输出64k", "思考模型", "性价比高"],
          },
          {
            id: "qwen-max",
            name: "Qwen Max",
            contextWindow: 32768,
            maxInputTokens: 30720,
            maxOutputTokens: 8192,
            features: ["上下文32k", "输出8k"],
          },
          {
            id: "qwen-turbo-latest",
            name: "Qwen Turbo",
            contextWindow: 1000000,
            maxInputTokens: 1000000,
            maxOutputTokens: 8192,
            reasoning: true,
            features: ["上下文1M", "极速", "思考模型", "低成本"],
          },
          {
            id: "qwen-vl-plus",
            name: "Qwen VL Plus",
            contextWindow: 131072,
            maxInputTokens: 131072,
            maxOutputTokens: 8192,
            vision: true,
            features: ["上下文128k", "视觉理解"],
          },
          {
            id: "qwen-coder-plus",
            name: "Qwen Coder Plus",
            contextWindow: 131072,
            maxInputTokens: 131072,
            maxOutputTokens: 8192,
            functionCalling: true,
            features: ["上下文128k", "代码生成"],
          },
          {
            id: "text-embedding-v4",
            name: "Text Embedding V4",
            contextWindow: 8192,
            maxInputTokens: 8192,
            supportsEmbedding: true,
            embeddingDimensions: [2048, 1536, 1024, 768, 512, 256, 128, 64],
            defaultDimension: 1024,
            features: ["向量化", "100+语种", "灵活维度", "0.0005元/千Token"],
          },
          {
            id: "text-embedding-v3",
            name: "Text Embedding V3",
            contextWindow: 8192,
            maxInputTokens: 8192,
            supportsEmbedding: true,
            embeddingDimensions: [1024, 768, 512, 256, 128, 64],
            defaultDimension: 1024,
            features: ["向量化", "50+语种", "灵活维度"],
          },
          {
            id: "text-embedding-v2",
            name: "Text Embedding V2",
            contextWindow: 8192,
            maxInputTokens: 8192,
            supportsEmbedding: true,
            embeddingDimensions: [1536],
            defaultDimension: 1536,
            features: ["向量化", "10+语种", "0.0007元/千Token"],
          },
        ],
      },

      // ═══════════════════════════════════════════════════
      // 阿里云百炼 Coding Plan — 订阅套餐
      // 获取 API Key: https://bailian.console.aliyun.com/?tab=model#/api-key
      // ═══════════════════════════════════════════════════
      "dashscope-subscription": {
        id: "dashscope-subscription",
        name: "百炼订阅版",
        description: "阿里云百炼 Coding Plan 订阅套餐，固定月费 + 请求次数限额",
        api: "openai-compatible",
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        apiKey: "",
        billingMode: "subscription",
        enabled: false,
        websites: {
          official: "https://www.aliyun.com/product/bailian",
          apiKey: "https://bailian.console.aliyun.com/?tab=model#/api-key",
          docs: "https://help.aliyun.com/zh/model-studio/coding-plan",
          models: "https://bailian.console.aliyun.com/?tab=doc#/doc/?type=model&url=3005961",
        },
        models: [
          {
            id: "qwen3.5-plus",
            name: "Qwen3.5 Plus",
            contextWindow: 1000000,
            maxInputTokens: 983616,
            maxOutputTokens: 65536,
            maxThinkingTokens: 81920,
            reasoning: true,
            functionCalling: true,
            webSearch: true,
            features: ["订阅套餐", "上下文1M", "输出64k", "思考模型", "Coding Plan"],
          },
          {
            id: "qwen3-max-2026-01-23",
            name: "Qwen3 Max",
            contextWindow: 262144,
            maxInputTokens: 258048,
            maxOutputTokens: 65536,
            maxThinkingTokens: 81920,
            reasoning: true,
            functionCalling: true,
            webSearch: true,
            features: ["订阅套餐", "上下文256k", "输出64k", "思考模型", "Coding Plan"],
          },
          {
            id: "qwen3-coder-next",
            name: "Qwen3 Coder Next",
            contextWindow: 131072,
            maxInputTokens: 131072,
            maxOutputTokens: 8192,
            functionCalling: true,
            features: ["订阅套餐", "上下文128k", "代码旗舰", "Coding Plan"],
          },
          {
            id: "qwen3-coder-plus",
            name: "Qwen3 Coder Plus",
            contextWindow: 131072,
            maxInputTokens: 131072,
            maxOutputTokens: 8192,
            functionCalling: true,
            features: ["订阅套餐", "上下文128k", "代码生成", "Coding Plan"],
          },
          {
            id: "glm-4.7",
            name: "GLM-4.7",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 16384,
            reasoning: true,
            features: ["订阅套餐", "上下文128k", "输出16k", "推理", "Coding Plan"],
          },
          {
            id: "kimi-k2.5",
            name: "Kimi-K2.5",
            contextWindow: 262144,
            maxInputTokens: 262144,
            maxOutputTokens: 65536,
            features: ["订阅套餐", "上下文256k", "输出64k", "Coding Plan"],
          },
        ],
      },

      // ═══════════════════════════════════════════════════
      // 火山方舟 Coding Plan — 订阅套餐（豆包）
      // 获取 API Key: https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey
      // 注意: 不要与豆包按量付费(doubao)的 baseUrl 混淆
      // ═══════════════════════════════════════════════════
      "volcengine-plan": {
        id: "volcengine-plan",
        name: "火山方舟 Coding Plan",
        description: "字节跳动火山方舟 Coding Plan 订阅套餐，固定月费 + 请求次数限额，支持多模型自由切换",
        api: "openai-compatible",
        baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
        apiKey: "",
        billingMode: "subscription",
        enabled: false,
        websites: {
          official: "https://console.volcengine.com/ark/",
          apiKey: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
          docs: "https://www.volcengine.com/docs/82379/1925114",
          models: "https://www.volcengine.com/docs/82379/1925115",
        },
        models: [
          {
            id: "ark-code-latest",
            name: "Ark Code Latest",
            contextWindow: 131072,
            maxInputTokens: 131072,
            maxOutputTokens: 65536,
            reasoning: true,
            functionCalling: true,
            features: ["Coding Plan", "自动切换最优模型", "推理", "代码旗舰"],
          },
          {
            id: "doubao-seed-2.0-code",
            name: "Doubao Seed 2.0 Code",
            contextWindow: 131072,
            maxInputTokens: 131072,
            maxOutputTokens: 65536,
            reasoning: true,
            functionCalling: true,
            features: ["Coding Plan", "上下文128k", "输出64k", "代码专用"],
          },
          {
            id: "doubao-seed-2.0-pro",
            name: "Doubao Seed 2.0 Pro",
            contextWindow: 131072,
            maxInputTokens: 131072,
            maxOutputTokens: 65536,
            reasoning: true,
            features: ["Coding Plan", "上下文128k", "输出64k", "通用旗舰"],
          },
          {
            id: "doubao-seed-2.0-lite",
            name: "Doubao Seed 2.0 Lite",
            contextWindow: 131072,
            maxInputTokens: 131072,
            maxOutputTokens: 16384,
            features: ["Coding Plan", "上下文128k", "输出16k", "轻量快速"],
          },
          {
            id: "doubao-seed-code",
            name: "Doubao Seed Code",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 65536,
            functionCalling: true,
            features: ["Coding Plan", "上下文128k", "输出64k", "代码生成"],
          },
          {
            id: "minimax-m2.5",
            name: "MiniMax-M2.5",
            contextWindow: 204800,
            maxInputTokens: 204800,
            maxOutputTokens: 16384,
            functionCalling: true,
            features: ["Coding Plan", "上下文200k", "工具调用"],
          },
          {
            id: "glm-4.7",
            name: "GLM-4.7",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 16384,
            reasoning: true,
            features: ["Coding Plan", "上下文128k", "输出16k", "推理"],
          },
          {
            id: "deepseek-v3.2",
            name: "DeepSeek-V3.2",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 65536,
            reasoning: true,
            features: ["Coding Plan", "上下文128k", "输出64k", "深度推理"],
          },
          {
            id: "kimi-k2.5",
            name: "Kimi-K2.5",
            contextWindow: 262144,
            maxInputTokens: 262144,
            maxOutputTokens: 65536,
            features: ["Coding Plan", "上下文256k", "输出64k"],
          },
        ],
      },

      // ═══════════════════════════════════════════════════
      // SiliconFlow — 开放平台
      // 获取 API Key: https://cloud.siliconflow.cn/account/ak
      // ═══════════════════════════════════════════════════
      silicon: {
        id: "silicon",
        name: "Silicon",
        description: "SiliconFlow开放平台，提供高性能的AI模型服务",
        api: "openai-compatible",
        baseUrl: "https://api.siliconflow.cn",
        apiKey: "",
        enabled: false,
        websites: {
          official: "https://www.siliconflow.cn/",
          apiKey: "https://cloud.siliconflow.cn/account/ak",
          docs: "https://docs.siliconflow.cn/",
          models: "https://docs.siliconflow.cn/docs/model-names",
        },
        models: [
          {
            id: "deepseek-ai/DeepSeek-R1",
            name: "DeepSeek-R1",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 65536,
            reasoning: true,
            features: ["上下文128k", "输出64k", "深度推理"],
          },
          {
            id: "deepseek-ai/DeepSeek-V3.2",
            name: "DeepSeek-V3.2",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 8192,
            features: ["上下文128k", "输出8k", "最新V3"],
          },
          {
            id: "deepseek-ai/DeepSeek-V3",
            name: "DeepSeek-V3",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 8192,
            features: ["上下文128k", "输出8k"],
          },
          {
            id: "Qwen/Qwen3-235B-A22B-Thinking-2507",
            name: "Qwen3-235B Thinking",
            contextWindow: 131072,
            maxInputTokens: 131072,
            maxOutputTokens: 65536,
            reasoning: true,
            features: ["上下文128k", "输出64k", "深度推理", "235B MoE"],
          },
          {
            id: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
            name: "Qwen3-Coder-480B",
            contextWindow: 131072,
            maxInputTokens: 131072,
            maxOutputTokens: 65536,
            functionCalling: true,
            features: ["上下文128k", "输出64k", "代码旗舰", "480B MoE"],
          },
          {
            id: "moonshotai/Kimi-K2-Thinking",
            name: "Kimi-K2 Thinking",
            contextWindow: 131072,
            maxInputTokens: 131072,
            maxOutputTokens: 65536,
            reasoning: true,
            features: ["上下文128k", "输出64k", "推理"],
          },
          {
            id: "Qwen/Qwen3-32B",
            name: "Qwen3-32B",
            contextWindow: 131072,
            maxInputTokens: 131072,
            maxOutputTokens: 8192,
            reasoning: true,
            functionCalling: true,
            features: ["上下文128k", "推理", "工具调用", "32B"],
          },
          {
            id: "Qwen/QwQ-32B",
            name: "QwQ-32B",
            contextWindow: 131072,
            maxInputTokens: 131072,
            maxOutputTokens: 65536,
            reasoning: true,
            features: ["上下文128k", "输出64k", "深度推理", "32B"],
          },
          {
            id: "THUDM/GLM-Z1-32B-0414",
            name: "GLM-Z1-32B",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 16384,
            reasoning: true,
            features: ["上下文128k", "输出16k", "推理", "32B"],
          },
          {
            id: "Qwen/Qwen2.5-Coder-32B-Instruct",
            name: "Qwen2.5-Coder-32B",
            contextWindow: 32768,
            maxInputTokens: 32768,
            maxOutputTokens: 8192,
            functionCalling: true,
            features: ["上下文32k", "代码生成", "32B"],
          },
          {
            id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
            name: "DeepSeek-R1-Distill-32B",
            contextWindow: 32768,
            maxInputTokens: 32768,
            maxOutputTokens: 16384,
            reasoning: true,
            features: ["上下文32k", "推理蒸馏", "32B"],
          },
          {
            id: "Qwen/Qwen3-8B",
            name: "Qwen3-8B",
            contextWindow: 32768,
            maxInputTokens: 32768,
            maxOutputTokens: 8192,
            free: true,
            reasoning: true,
            features: ["上下文32k", "免费", "推理", "8B"],
          },
          {
            id: "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
            name: "DeepSeek-R1-0528-Qwen3-8B",
            contextWindow: 32768,
            maxInputTokens: 32768,
            maxOutputTokens: 8192,
            free: true,
            reasoning: true,
            features: ["上下文32k", "免费", "推理蒸馏", "8B"],
          },
          {
            id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
            name: "DeepSeek-R1-Distill-7B",
            contextWindow: 32768,
            maxInputTokens: 32768,
            maxOutputTokens: 8192,
            free: true,
            reasoning: true,
            features: ["上下文32k", "免费", "推理蒸馏", "7B"],
          },
          {
            id: "THUDM/GLM-4.1V-9B-Thinking",
            name: "GLM-4.1V-9B Thinking",
            contextWindow: 32768,
            maxInputTokens: 32768,
            maxOutputTokens: 4096,
            free: true,
            vision: true,
            reasoning: true,
            features: ["上下文32k", "免费", "视觉推理", "9B"],
          },
          {
            id: "THUDM/GLM-Z1-9B-0414",
            name: "GLM-Z1-9B",
            contextWindow: 32768,
            maxInputTokens: 32768,
            maxOutputTokens: 16384,
            free: true,
            reasoning: true,
            features: ["上下文32k", "免费", "推理", "9B"],
          },
          {
            id: "THUDM/GLM-4-9B-0414",
            name: "GLM-4-9B",
            contextWindow: 32768,
            maxInputTokens: 32768,
            maxOutputTokens: 4096,
            free: true,
            functionCalling: true,
            features: ["上下文32k", "免费", "工具调用", "9B"],
          },
          {
            id: "Qwen/Qwen2.5-7B-Instruct",
            name: "Qwen2.5-7B",
            contextWindow: 32768,
            maxInputTokens: 32768,
            maxOutputTokens: 8192,
            free: true,
            features: ["上下文32k", "免费", "通用", "7B"],
          },
          {
            id: "Qwen/Qwen2.5-Coder-7B-Instruct",
            name: "Qwen2.5-Coder-7B",
            contextWindow: 32768,
            maxInputTokens: 32768,
            maxOutputTokens: 8192,
            free: true,
            features: ["上下文32k", "免费", "代码生成", "7B"],
          },
          {
            id: "internlm/internlm2_5-7b-chat",
            name: "InternLM2.5-7B",
            contextWindow: 32768,
            maxInputTokens: 32768,
            maxOutputTokens: 8192,
            free: true,
            features: ["上下文32k", "免费", "通用", "7B"],
          },
          {
            id: "tencent/Hunyuan-MT-7B",
            name: "Hunyuan-MT-7B",
            contextWindow: 32768,
            maxInputTokens: 32768,
            maxOutputTokens: 8192,
            free: true,
            features: ["上下文32k", "免费", "翻译专用", "7B"],
          },
        ],
      },

      // ═══════════════════════════════════════════════════
      // 302.AI — 聚合平台
      // 获取 API Key: https://dash.302.ai/apis/list
      // ═══════════════════════════════════════════════════
      "302ai": {
        id: "302ai",
        name: "302.AI",
        description: "302.AI平台，提供多种先进的AI模型（Claude/Gemini/DeepSeek等）",
        api: "openai-compatible",
        baseUrl: "https://api.302.ai",
        apiKey: "",
        enabled: false,
        websites: {
          official: "https://302.ai",
          apiKey: "https://dash.302.ai/apis/list",
          docs: "https://302ai.apifox.cn/doc-3704971",
          models: "https://302.ai/pricing/",
        },
        models: [
          {
            id: "gemini-2.5-pro-preview-06-05",
            name: "Gemini 2.5 Pro",
            contextWindow: 1048576,
            maxInputTokens: 1048576,
            maxOutputTokens: 65536,
            reasoning: true,
            vision: true,
            functionCalling: true,
            features: ["上下文1M", "输出64k", "推理", "视觉", "工具调用"],
          },
          {
            id: "gemini-2.5-flash-preview-05-20",
            name: "Gemini 2.5 Flash",
            contextWindow: 1048576,
            maxInputTokens: 1048576,
            maxOutputTokens: 65536,
            reasoning: true,
            vision: true,
            features: ["上下文1M", "输出64k", "推理", "视觉", "极速"],
          },
          {
            id: "claude-sonnet-4-20250514",
            name: "Claude Sonnet 4",
            contextWindow: 200000,
            maxInputTokens: 200000,
            maxOutputTokens: 64000,
            reasoning: true,
            vision: true,
            functionCalling: true,
            features: ["上下文200k", "输出64k", "推理", "视觉", "工具调用"],
          },
          {
            id: "claude-opus-4-20250514",
            name: "Claude Opus 4",
            contextWindow: 200000,
            maxInputTokens: 200000,
            maxOutputTokens: 64000,
            reasoning: true,
            vision: true,
            functionCalling: true,
            features: ["上下文200k", "输出64k", "旗舰推理", "视觉"],
          },
          {
            id: "deepseek-reasoner",
            name: "DeepSeek Reasoner",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 65536,
            reasoning: true,
            features: ["上下文128k", "输出64k", "深度推理"],
          },
        ],
      },

      // ═══════════════════════════════════════════════════
      // DeepSeek — 官方
      // 获取 API Key: https://platform.deepseek.com/api_keys
      // ═══════════════════════════════════════════════════
      deepseek: {
        id: "deepseek",
        name: "DeepSeek",
        description: "DeepSeek AI，专注于深度推理和代码生成",
        api: "openai-compatible",
        baseUrl: "https://api.deepseek.com",
        apiKey: "",
        enabled: false,
        websites: {
          official: "https://deepseek.com/",
          apiKey: "https://platform.deepseek.com/api_keys",
          docs: "https://platform.deepseek.com/api-docs/",
          models: "https://platform.deepseek.com/api-docs/",
        },
        models: [
          {
            id: "deepseek-chat",
            name: "DeepSeek Chat",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 8192,
            functionCalling: true,
            features: ["上下文128k", "输出8k", "工具调用"],
          },
          {
            id: "deepseek-reasoner",
            name: "DeepSeek Reasoner",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 65536,
            reasoning: true,
            features: ["上下文128k", "输出64k", "深度推理"],
          },
        ],
      },

      // ═══════════════════════════════════════════════════
      // MiniMax — 开放平台
      // 获取 API Key: https://platform.minimaxi.com/user-center/basic-information/interface-key
      // ═══════════════════════════════════════════════════
      minimax: {
        id: "minimax",
        name: "MiniMax",
        description: "MiniMax开放平台，专为高效编码与Agent工作流设计",
        api: "openai-compatible",
        baseUrl: "https://api.minimaxi.com/v1",
        apiKey: "",
        billingMode: "subscription",
        enabled: false,
        websites: {
          official: "https://platform.minimaxi.com/",
          apiKey: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
          docs: "https://platform.minimaxi.com/docs/guides/quickstart",
          models: "https://platform.minimaxi.com/docs/api-reference/api-overview",
        },
        models: [
          {
            id: "MiniMax-M2.5",
            name: "MiniMax-M2.5",
            contextWindow: 204800,
            maxInputTokens: 204800,
            maxOutputTokens: 16384,
            functionCalling: true,
            features: ["上下文200k", "~60tps", "工具调用"],
          },
          {
            id: "MiniMax-M2.5-highspeed",
            name: "MiniMax-M2.5 极速版",
            contextWindow: 204800,
            maxInputTokens: 204800,
            maxOutputTokens: 16384,
            features: ["上下文200k", "~100tps", "极速"],
          },
          {
            id: "MiniMax-M2.1",
            name: "MiniMax-M2.1",
            contextWindow: 204800,
            maxInputTokens: 204800,
            maxOutputTokens: 16384,
            functionCalling: true,
            features: ["上下文200k", "多语言编程", "工具调用"],
          },
          {
            id: "MiniMax-M2",
            name: "MiniMax-M2",
            contextWindow: 204800,
            maxInputTokens: 204800,
            maxOutputTokens: 16384,
            functionCalling: true,
            features: ["上下文200k", "Agent工作流", "工具调用"],
          },
        ],
      },

      // ═══════════════════════════════════════════════════
      // 豆包 — 字节跳动（按量付费）
      // 获取 API Key: https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey
      // ═══════════════════════════════════════════════════
      doubao: {
        id: "doubao",
        name: "豆包",
        description: "字节跳动豆包大模型，提供强大的对话和创作能力",
        api: "openai-compatible",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        apiKey: "",
        enabled: false,
        websites: {
          official: "https://console.volcengine.com/ark/",
          apiKey: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
          docs: "https://www.volcengine.com/docs/82379/1182403",
        },
        models: [
          {
            id: "doubao-1-5-pro-32k-250115",
            name: "Doubao-1.5-pro-32k",
            contextWindow: 32768,
            maxInputTokens: 32768,
            maxOutputTokens: 4096,
            features: ["上下文32k", "输出4k"],
          },
          {
            id: "doubao-1-5-pro-256k-250115",
            name: "Doubao-1.5-pro-256k",
            contextWindow: 262144,
            maxInputTokens: 262144,
            maxOutputTokens: 4096,
            features: ["上下文256k", "输出4k", "长文本"],
          },
          {
            id: "doubao-1-5-vision-pro-32k-250115",
            name: "Doubao-1.5-vision-pro",
            contextWindow: 32768,
            maxInputTokens: 32768,
            maxOutputTokens: 4096,
            vision: true,
            features: ["上下文32k", "视觉理解"],
          },
          {
            id: "deepseek-r1-250120",
            name: "DeepSeek-R1 (豆包)",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 65536,
            reasoning: true,
            features: ["上下文128k", "输出64k", "深度推理"],
          },
          {
            id: "deepseek-v3-250324",
            name: "DeepSeek-V3 (豆包)",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 8192,
            features: ["上下文128k", "输出8k"],
          },
        ],
      },

      // ═══════════════════════════════════════════════════
      // Moonshot AI (Kimi)
      // 获取 API Key: https://platform.moonshot.cn/console/api-keys
      // ═══════════════════════════════════════════════════
      moonshot: {
        id: "moonshot",
        name: "Moonshot AI",
        description: "Moonshot AI (Kimi)，提供超长上下文的AI模型服务",
        api: "openai-compatible",
        baseUrl: "https://api.moonshot.cn",
        apiKey: "",
        enabled: false,
        websites: {
          official: "https://moonshot.ai/",
          apiKey: "https://platform.moonshot.cn/console/api-keys",
          docs: "https://platform.moonshot.cn/docs/",
        },
        models: [
          {
            id: "moonshot-v1-auto",
            name: "Moonshot V1 Auto",
            contextWindow: 262144,
            maxInputTokens: 262144,
            maxOutputTokens: 33000,
            features: ["上下文262k", "输出33k", "自动选型"],
          },
        ],
      },

      // ═══════════════════════════════════════════════════
      // 腾讯混元
      // 获取 API Key: https://console.cloud.tencent.com/hunyuan/api-key
      // ═══════════════════════════════════════════════════
      hunyuan: {
        id: "hunyuan",
        name: "混元",
        description: "腾讯混元大模型，具备强大的理解和生成能力",
        api: "openai-compatible",
        baseUrl: "https://api.hunyuan.cloud.tencent.com",
        apiKey: "",
        enabled: false,
        websites: {
          official: "https://cloud.tencent.com/product/hunyuan",
          apiKey: "https://console.cloud.tencent.com/hunyuan/api-key",
          docs: "https://cloud.tencent.com/document/product/1729/111007",
        },
        models: [
          {
            id: "hunyuan-turbos-latest",
            name: "Hunyuan TurboS",
            contextWindow: 256000,
            maxInputTokens: 256000,
            maxOutputTokens: 16384,
            reasoning: true,
            features: ["上下文256k", "自适应思维链", "极速"],
          },
          {
            id: "hunyuan-turbo",
            name: "Hunyuan Turbo",
            contextWindow: 32768,
            maxInputTokens: 32768,
            maxOutputTokens: 4096,
            features: ["上下文32k", "输出4k"],
          },
          {
            id: "hunyuan-pro",
            name: "Hunyuan Pro",
            contextWindow: 32768,
            maxInputTokens: 32768,
            maxOutputTokens: 4096,
            features: ["上下文32k", "输出4k", "高质量"],
          },
          {
            id: "hunyuan-vision",
            name: "Hunyuan Vision",
            contextWindow: 8192,
            maxInputTokens: 8192,
            maxOutputTokens: 4096,
            vision: true,
            features: ["视觉理解"],
          },
          {
            id: "hunyuan-code",
            name: "Hunyuan Code",
            contextWindow: 32768,
            maxInputTokens: 32768,
            maxOutputTokens: 4096,
            features: ["上下文32k", "代码生成"],
          },
        ],
      },

      // ═══════════════════════════════════════════════════
      // 百度云千帆
      // 获取 API Key: https://console.bce.baidu.com/iam/#/iam/apikey/list
      // ═══════════════════════════════════════════════════
      "baidu-cloud": {
        id: "baidu-cloud",
        name: "百度云",
        description: "百度智能云千帆平台，提供全面的AI能力",
        api: "openai-compatible",
        baseUrl: "https://qianfan.baidubce.com/v2",
        apiKey: "",
        enabled: false,
        websites: {
          official: "https://cloud.baidu.com/",
          apiKey: "https://console.bce.baidu.com/iam/#/iam/apikey/list",
          docs: "https://cloud.baidu.com/doc/index.html",
        },
        models: [
          {
            id: "ernie-4.0-turbo-8k-latest",
            name: "ERNIE 4.0 Turbo",
            contextWindow: 8192,
            maxInputTokens: 8192,
            maxOutputTokens: 4096,
            features: ["上下文8k", "输出4k", "极速"],
          },
          {
            id: "ernie-4.0-8k-latest",
            name: "ERNIE-4.0",
            contextWindow: 8192,
            maxInputTokens: 8192,
            maxOutputTokens: 4096,
            features: ["上下文8k", "输出4k", "旗舰"],
          },
          {
            id: "deepseek-r1",
            name: "DeepSeek R1 (百度)",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 65536,
            reasoning: true,
            features: ["上下文128k", "输出64k", "深度推理"],
          },
          {
            id: "deepseek-v3",
            name: "DeepSeek V3 (百度)",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 8192,
            features: ["上下文128k", "输出8k"],
          },
        ],
      },

      // ═══════════════════════════════════════════════════
      // 智谱 AI
      // 获取 API Key: https://open.bigmodel.cn/usercenter/apikeys
      // ═══════════════════════════════════════════════════
      zhipu: {
        id: "zhipu",
        name: "智谱",
        description: "智谱AI，提供强大的AI模型服务",
        api: "openai-compatible",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: "",
        enabled: false,
        websites: {
          official: "https://open.bigmodel.cn/",
          apiKey: "https://open.bigmodel.cn/usercenter/apikeys",
          docs: "https://open.bigmodel.cn/dev/howuse/introduction",
        },
        models: [
          {
            id: "glm-4-plus",
            name: "GLM-4-Plus",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 4096,
            functionCalling: true,
            features: ["上下文128k", "输出4k", "工具调用"],
          },
          {
            id: "glm-z1-airx",
            name: "GLM-Z1-AIRX",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 16384,
            reasoning: true,
            features: ["上下文128k", "输出16k", "深度推理"],
          },
          {
            id: "glm-z1-flash",
            name: "GLM-Z1-FLASH",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 16384,
            reasoning: true,
            features: ["上下文128k", "输出16k", "推理", "极速"],
          },
          {
            id: "glm-4v-plus-0111",
            name: "GLM-4V-Plus",
            contextWindow: 8192,
            maxInputTokens: 8192,
            maxOutputTokens: 4096,
            vision: true,
            features: ["视觉理解", "多模态"],
          },
          {
            id: "glm-4-alltools",
            name: "GLM-4-AllTools",
            contextWindow: 128000,
            maxInputTokens: 128000,
            maxOutputTokens: 4096,
            functionCalling: true,
            webSearch: true,
            features: ["上下文128k", "全工具调用", "联网搜索"],
          },
        ],
      },

      // ═══════════════════════════════════════════════════
      // Ollama — 本地部署（无需 API Key）
      // 安装: https://ollama.com/
      // ═══════════════════════════════════════════════════
      ollama: {
        id: "ollama",
        name: "Ollama",
        description: "本地部署的AI模型服务，支持私有化部署",
        api: "openai-compatible",
        baseUrl: "http://localhost:11434",
        apiKey: "",
        enabled: false,
        websites: {
          official: "https://ollama.com/",
          docs: "https://github.com/ollama/ollama/tree/main/docs",
          models: "https://ollama.com/library",
        },
        models: [],
      },

      // ═══════════════════════════════════════════════════
      // LM Studio — 本地模型运行（无需 API Key）
      // 安装: https://lmstudio.ai/
      // ═══════════════════════════════════════════════════
      lmstudio: {
        id: "lmstudio",
        name: "LM Studio",
        description: "LM Studio本地模型运行环境",
        api: "openai-compatible",
        baseUrl: "http://localhost:1234/v1",
        apiKey: "",
        enabled: false,
        websites: {
          official: "https://lmstudio.ai/docs/app",
          docs: "https://lmstudio.ai/docs/app",
          models: "https://lmstudio.ai/models",
        },
        models: [],
      },
    },

    // ─── 模型分组（启用供应商后可配置，通过 @group-name 引用） ───
    // 示例:
    // groups: {
    //   "fast-models": {
    //     name: "快速模型组",
    //     models: ["dashscope/qwen-turbo-latest", "dashscope/qwen-plus-latest"],
    //     strategy: "round-robin",
    //   },
    // },

    // ─── 默认模型 ──────────────────────────────────────
    // 启用供应商后请修改为实际可用的 provider/model
    defaults: {
      model: { primary: "dashscope/qwen-plus-latest" },
      embedding: { primary: "dashscope/text-embedding-v4" },
      thinkingLevel: "medium",
    },
  },

  ui: {
    theme: "auto",
    language: "zh-CN",
    soundEffects: true,
  },

  logging: {
    level: "info",
    file: true,
  },

  security: {
    sandbox: {
      mode: "path-only",
    },
    approvals: {
      exec: "auto",
    },
  },
}
`;
}
