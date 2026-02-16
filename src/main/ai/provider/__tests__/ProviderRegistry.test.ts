import { describe, expect, it, beforeEach } from 'vitest'

import type { CoobeeConfig } from '@main/common/config/schema'

import { ProviderRegistry } from '../ProviderRegistry'
import { builtinProviders } from '../builtin'
import type { ProviderConfig } from '../types'

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry

  beforeEach(() => {
    registry = new ProviderRegistry()
  })

  // ─── 基础 CRUD ──────────────────────────────────

  it('should start empty', () => {
    expect(registry.size).toBe(0)
    expect(registry.getAll()).toEqual([])
  })

  it('should register and retrieve a provider', () => {
    const provider = makeProvider('test-provider')
    registry.register(provider)

    expect(registry.size).toBe(1)
    expect(registry.get('test-provider')).toEqual(provider)
    expect(registry.has('test-provider')).toBe(true)
  })

  it('should overwrite provider with same id', () => {
    const v1 = makeProvider('test', 'https://v1.example.com')
    const v2 = makeProvider('test', 'https://v2.example.com')

    registry.register(v1)
    registry.register(v2)

    expect(registry.size).toBe(1)
    expect(registry.get('test')?.baseUrl).toBe('https://v2.example.com')
  })

  it('should unregister a provider', () => {
    registry.register(makeProvider('test'))
    expect(registry.unregister('test')).toBe(true)
    expect(registry.size).toBe(0)
    expect(registry.get('test')).toBeUndefined()
  })

  it('should return false when unregistering non-existent provider', () => {
    expect(registry.unregister('non-existent')).toBe(false)
  })

  it('should clear all providers', () => {
    registry.register(makeProvider('a'))
    registry.register(makeProvider('b'))
    registry.clear()
    expect(registry.size).toBe(0)
  })

  // ─── 过滤 ──────────────────────────────────────

  it('should filter enabled providers', () => {
    registry.register(makeProvider('enabled-1'))
    registry.register({ ...makeProvider('disabled'), enabled: false })
    registry.register(makeProvider('enabled-2'))

    const enabled = registry.getEnabled()
    expect(enabled).toHaveLength(2)
    expect(enabled.map((p) => p.id)).toEqual(['enabled-1', 'enabled-2'])
  })

  // ─── loadFromConfig ────────────────────────────

  it('should load providers from CoobeeConfig', () => {
    const config: CoobeeConfig = {
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
                vision: false,
                functionCalling: false,
                webSearch: false,
                free: false,
                input: ['text']
              }
            ],
            enabled: true
          },
          aliyun: {
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            api: 'openai-compatible',
            models: [
              {
                id: 'qwen3-max',
                name: 'Qwen3 Max',
                reasoning: true,
                vision: false,
                functionCalling: false,
                webSearch: false,
                free: false,
                input: ['text', 'image']
              }
            ],
            enabled: true
          }
        }
      }
    }

    registry.loadFromConfig(config)
    expect(registry.size).toBe(2)
    expect(registry.get('openai')?.apiKey).toBe('sk-test')
    expect(registry.get('aliyun')?.models).toHaveLength(1)
  })

  it('should handle empty config gracefully', () => {
    registry.loadFromConfig({})
    expect(registry.size).toBe(0)
  })

  it('should clear existing providers before loading', () => {
    registry.register(makeProvider('old-provider'))
    registry.loadFromConfig({
      models: {
        providers: {
          new: {
            baseUrl: 'https://new.example.com',
            api: 'openai-compatible',
            models: [
              {
                id: 'm1',
                name: 'M1',
                reasoning: false,
                vision: false,
                functionCalling: false,
                webSearch: false,
                free: false,
                input: ['text']
              }
            ],
            enabled: true
          }
        }
      }
    })

    expect(registry.has('old-provider')).toBe(false)
    expect(registry.has('new')).toBe(true)
  })

  // ─── 内置 Provider ─────────────────────────────

  it('should have valid builtin providers', () => {
    expect(builtinProviders.length).toBeGreaterThanOrEqual(4)
    for (const provider of builtinProviders) {
      expect(provider.id).toBeTruthy()
      expect(provider.baseUrl).toBeTruthy()
      expect(provider.models.length).toBeGreaterThan(0)
      expect(provider.enabled).toBe(true)
    }
  })

  it('should register all builtin providers', () => {
    for (const provider of builtinProviders) {
      registry.register(provider)
    }
    expect(registry.size).toBe(builtinProviders.length)
  })
})

// ─── 辅助函数 ────────────────────────────────────

function makeProvider(id: string, baseUrl = 'https://api.example.com/v1'): ProviderConfig {
  return {
    id,
    name: id,
    baseUrl,
    api: 'openai-compatible',
    models: [{ id: 'model-1', name: 'Test Model' }],
    enabled: true
  }
}
