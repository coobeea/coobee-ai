import type { ProviderConfig } from '../types'

export const aliyunProvider: ProviderConfig = {
  id: 'aliyun',
  name: '阿里云 DashScope',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '${DASHSCOPE_API_KEY}',
  api: 'openai-compatible',
  models: [
    {
      id: 'qwen3-max',
      name: '通义千问 3 Max',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 131072,
      maxTokens: 8192,
      cost: { input: 2, output: 8, cacheRead: 0.2 }
    },
    {
      id: 'qwen3-plus',
      name: '通义千问 3 Plus',
      reasoning: true,
      input: ['text'],
      contextWindow: 131072,
      maxTokens: 8192,
      cost: { input: 0.8, output: 2, cacheRead: 0.08 }
    },
    {
      id: 'qwen3-mini',
      name: '通义千问 3 Mini',
      reasoning: true,
      input: ['text'],
      contextWindow: 131072,
      maxTokens: 8192,
      cost: { input: 0.16, output: 0.64, cacheRead: 0.016 }
    }
  ],
  enabled: true
}
