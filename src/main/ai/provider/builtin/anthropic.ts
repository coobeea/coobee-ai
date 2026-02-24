import type { ProviderConfig } from '../types';

export const anthropicProvider: ProviderConfig = {
  id: 'anthropic',
  name: 'Anthropic',
  baseUrl: 'https://api.anthropic.com',
  apiKey: '${ANTHROPIC_API_KEY}',
  api: 'anthropic',
  models: [
    {
      id: 'claude-sonnet-4-20250514',
      name: 'Claude Sonnet 4',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 200000,
      maxTokens: 16384,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
    },
    {
      id: 'claude-3-5-haiku-20241022',
      name: 'Claude 3.5 Haiku',
      reasoning: false,
      input: ['text', 'image'],
      contextWindow: 200000,
      maxTokens: 8192,
      cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 }
    }
  ],
  enabled: true
};
