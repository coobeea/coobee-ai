import type { ProviderConfig } from '../types'

export const minimaxProvider: ProviderConfig = {
  id: 'minimax',
  name: 'MiniMax',
  baseUrl: 'https://api.minimax.chat/v1',
  apiKey: '${MINIMAX_API_KEY}',
  api: 'openai-compatible',
  models: [
    {
      id: 'MiniMax-M1',
      name: 'MiniMax M1',
      reasoning: true,
      input: ['text'],
      contextWindow: 1000000,
      maxTokens: 16384,
      cost: { input: 1, output: 8 }
    }
  ],
  enabled: true
}
