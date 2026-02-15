import { describe, expect, it } from 'vitest'

import { ModelFallback } from '../ModelFallback'
import type { ModelRef } from '../types'

describe('ModelFallback', () => {
  const fallback = new ModelFallback()

  it('should succeed on first candidate', async () => {
    const result = await fallback.run(['openai/gpt-4o'], async (ref) => `ok-${ref.model}`)
    expect(result.result).toBe('ok-gpt-4o')
    expect(result.attempts).toBe(1)
    expect(result.failedModels).toEqual([])
  })

  it('should fall back to second candidate on retryable error', async () => {
    let callCount = 0
    const result = await fallback.run(['openai/gpt-4o', 'aliyun/qwen3-max'], async (ref) => {
      callCount++
      if (ref.model === 'gpt-4o') {
        throw new Error('429 rate limit exceeded')
      }
      return `ok-${ref.model}`
    })
    expect(result.result).toBe('ok-qwen3-max')
    expect(result.attempts).toBe(2)
    expect(result.failedModels).toEqual(['openai/gpt-4o'])
    expect(callCount).toBe(2)
  })

  it('should throw on non-retryable error', async () => {
    await expect(
      fallback.run(['openai/gpt-4o', 'aliyun/qwen3-max'], async (ref) => {
        if (ref.model === 'gpt-4o') {
          throw new Error('Invalid API key')
        }
        return ref.model
      })
    ).rejects.toThrow('Invalid API key')
  })

  it('should stop immediately on abort error', async () => {
    const abortErr = new Error('Request aborted')
    abortErr.name = 'AbortError'

    await expect(
      fallback.run(['openai/gpt-4o', 'aliyun/qwen3-max'], async () => {
        throw abortErr
      })
    ).rejects.toThrow('Request aborted')
  })

  it('should throw last error when all candidates fail', async () => {
    await expect(
      fallback.run(['openai/gpt-4o', 'aliyun/qwen3-max'], async (ref) => {
        throw new Error(`rate limit 429 - ${ref.model}`)
      })
    ).rejects.toThrow('rate limit 429 - qwen3-max')
  })

  it('should accept ModelRef objects', async () => {
    const refs: ModelRef[] = [
      { provider: 'openai', model: 'gpt-4o' },
      { provider: 'aliyun', model: 'qwen3-max' }
    ]
    const result = await fallback.run(refs, async (ref) => ref.model)
    expect(result.result).toBe('gpt-4o')
  })

  it('should throw when no candidates provided', async () => {
    await expect(fallback.run([], async () => 'test')).rejects.toThrow('No candidates')
  })

  it('should use custom isRetryable', async () => {
    const result = await fallback.run(
      ['openai/gpt-4o', 'aliyun/qwen3-max'],
      async (ref) => {
        if (ref.model === 'gpt-4o') {
          throw new Error('custom retryable')
        }
        return ref.model
      },
      { isRetryable: (err) => (err as Error).message.includes('custom retryable') }
    )
    expect(result.result).toBe('qwen3-max')
  })

  it('should handle retryable 500/502/503/timeout/overloaded errors', async () => {
    const retryableMessages = [
      '500 Internal Server Error',
      '502 Bad Gateway',
      '503 Service Unavailable',
      'Request timed out',
      'Server overloaded'
    ]

    for (const msg of retryableMessages) {
      const result = await fallback.run(['openai/gpt-4o', 'aliyun/qwen3-max'], async (ref) => {
        if (ref.model === 'gpt-4o') throw new Error(msg)
        return ref.model
      })
      expect(result.result).toBe('qwen3-max')
    }
  })
})
