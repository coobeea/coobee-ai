import type { ProviderConfig } from '../types'

export const openaiProvider: ProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '${OPENAI_API_KEY}',
  api: 'openai-compatible',
  models: [
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      reasoning: false,
      input: ['text', 'image'],
      contextWindow: 128000,
      maxTokens: 16384,
      cost: { input: 2.5, output: 10 }
    },
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      reasoning: false,
      input: ['text', 'image'],
      contextWindow: 128000,
      maxTokens: 16384,
      cost: { input: 0.15, output: 0.6 }
    },
    {
      id: 'o3-mini',
      name: 'o3-mini',
      reasoning: true,
      input: ['text'],
      contextWindow: 200000,
      maxTokens: 100000,
      cost: { input: 1.1, output: 4.4 }
    }
  ],
  enabled: true
}
