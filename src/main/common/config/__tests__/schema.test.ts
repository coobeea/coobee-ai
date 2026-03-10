import { describe, expect, it } from 'vitest';

import { CoobeeConfigSchema, ProviderConfigSchema, QueueSettingsSchema } from '../schema';

describe('CoobeeConfigSchema', () => {
  it('should accept an empty object and apply defaults', () => {
    const result = CoobeeConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });

  it('should accept a minimal valid config', () => {
    const input = {
      ui: { theme: 'dark' },
      logging: { level: 'debug' }
    };
    const result = CoobeeConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ui?.theme).toBe('dark');
      expect(result.data.logging?.level).toBe('debug');
    }
  });

  it('should accept full config with providers', () => {
    const input = {
      models: {
        providers: {
          openai: {
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-test',
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
              }
            ]
          }
        }
      },
      agents: {
        defaults: {
          model: { primary: 'openai/gpt-4o', fallbacks: ['anthropic/claude-3'] }
        },
        list: [{ agentId: 'coder', model: 'openai/gpt-4o' }]
      },
      messages: {
        queue: { mode: 'collect', debounceMs: 300, cap: 10, dropPolicy: 'old' }
      },
      tools: {
        exec: { timeout: 60000, blacklist: ['rm -rf /'] }
      },
      security: {
        sandbox: { mode: 'docker' },
        approvals: { exec: 'always' }
      },
      ui: { theme: 'light', language: 'en-US', soundEffects: false },
      logging: { level: 'warn', file: false }
    };

    const result = CoobeeConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      const providers = result.data.models?.providers;
      expect(providers?.openai?.models).toHaveLength(1);
      expect(providers?.openai?.models[0].id).toBe('gpt-4o');
      expect(result.data.messages?.queue?.mode).toBe('collect');
    }
  });

  it('should reject invalid theme value', () => {
    const input = { ui: { theme: 'neon' } };
    const result = CoobeeConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject invalid queue mode', () => {
    const input = { messages: { queue: { mode: 'unknown' } } };
    const result = CoobeeConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject invalid logging level', () => {
    const input = { logging: { level: 'trace' } };
    const result = CoobeeConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe('ProviderConfigSchema', () => {
  it('should accept valid provider with models', () => {
    const input = {
      baseUrl: 'https://api.example.com/v1',
      api: 'openai-compatible',
      models: [{ id: 'model-1', name: 'Model One' }]
    };
    const result = ProviderConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true); // default
      expect(result.data.models[0].reasoning).toBe(false); // default
    }
  });

  it('should reject provider without models array', () => {
    const input = {
      baseUrl: 'https://api.example.com/v1',
      api: 'openai-compatible'
    };
    const result = ProviderConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should accept provider with ${VAR} apiKey', () => {
    const input = {
      baseUrl: 'https://api.example.com/v1',
      apiKey: '${MY_API_KEY}',
      api: 'openai-compatible',
      models: [{ id: 'model-1', name: 'Model One' }]
    };
    const result = ProviderConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

describe('QueueSettingsSchema', () => {
  it('should apply all defaults for empty object', () => {
    const result = QueueSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('collect');
      expect(result.data.debounceMs).toBe(500);
      expect(result.data.cap).toBe(20);
      expect(result.data.dropPolicy).toBe('summarize');
    }
  });

  it('should accept partial overrides', () => {
    const result = QueueSettingsSchema.safeParse({ mode: 'interrupt', cap: 5 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('interrupt');
      expect(result.data.cap).toBe(5);
      expect(result.data.debounceMs).toBe(500); // default preserved
    }
  });
});
