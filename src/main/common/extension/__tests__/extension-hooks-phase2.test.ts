/**
 * Phase 2 Extension Hooks 测试
 *
 * 测试新增的 5 个钩子：
 * - message_queued / message_dequeued / queue_drain_start（Pipeline）
 * - model_resolved / model_fallback（Provider）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { ExtensionHookRunner } from '../ExtensionHookRunner'
import { ExtensionManager } from '../ExtensionManager'
import { ExtensionRegistry } from '../ExtensionRegistry'
import {
  EXTENSION_HOOK_MODE,
  type MessageQueuedEvent,
  type MessageDequeuedEvent,
  type QueueDrainStartEvent,
  type ModelResolvedEvent,
  type ModelFallbackEvent
} from '../types'

describe('Phase 2 Extension Hooks', () => {
  let registry: ExtensionRegistry
  let runner: ExtensionHookRunner

  beforeEach(() => {
    registry = new ExtensionRegistry()
    runner = new ExtensionHookRunner(registry)
    ExtensionManager.initialize(registry)
  })

  afterEach(() => {
    ExtensionManager.reset()
  })

  // ─── Hook 注册检查 ─────────────────────────

  it('should have all 5 new hooks defined as void mode', () => {
    const newHooks = [
      'message_queued',
      'message_dequeued',
      'queue_drain_start',
      'model_resolved',
      'model_fallback'
    ] as const

    for (const hook of newHooks) {
      expect(EXTENSION_HOOK_MODE[hook]).toBe('void')
    }
  })

  // ─── message_queued ─────────────────────────

  it('should fire message_queued hook', async () => {
    const handler = vi.fn()
    registry.registerHook({
      extensionId: 'test-ext',
      hookName: 'message_queued',
      handler,
      priority: 100
    })

    const event: MessageQueuedEvent = {
      sessionId: 'sess-1',
      message: 'Hello',
      mode: 'followup',
      queueLength: 1
    }

    await runner.runVoidHook('message_queued', event)

    expect(handler).toHaveBeenCalledWith(event)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  // ─── message_dequeued ───────────────────────

  it('should fire message_dequeued hook', async () => {
    const handler = vi.fn()
    registry.registerHook({
      extensionId: 'test-ext',
      hookName: 'message_dequeued',
      handler,
      priority: 100
    })

    const event: MessageDequeuedEvent = {
      sessionId: 'sess-1',
      message: 'Hello',
      remainingLength: 0
    }

    await runner.runVoidHook('message_dequeued', event)

    expect(handler).toHaveBeenCalledWith(event)
  })

  // ─── queue_drain_start ──────────────────────

  it('should fire queue_drain_start hook', async () => {
    const handler = vi.fn()
    registry.registerHook({
      extensionId: 'test-ext',
      hookName: 'queue_drain_start',
      handler,
      priority: 100
    })

    const event: QueueDrainStartEvent = {
      sessionId: 'sess-1',
      strategy: 'followup',
      pendingCount: 3
    }

    await runner.runVoidHook('queue_drain_start', event)

    expect(handler).toHaveBeenCalledWith(event)
  })

  // ─── model_resolved ─────────────────────────

  it('should fire model_resolved hook', async () => {
    const handler = vi.fn()
    registry.registerHook({
      extensionId: 'test-ext',
      hookName: 'model_resolved',
      handler,
      priority: 100
    })

    const event: ModelResolvedEvent = {
      sessionId: 'sess-1',
      providerId: 'openai',
      modelId: 'gpt-4o',
      source: 'global'
    }

    await runner.runVoidHook('model_resolved', event)

    expect(handler).toHaveBeenCalledWith(event)
  })

  // ─── model_fallback ─────────────────────────

  it('should fire model_fallback hook', async () => {
    const handler = vi.fn()
    registry.registerHook({
      extensionId: 'test-ext',
      hookName: 'model_fallback',
      handler,
      priority: 100
    })

    const event: ModelFallbackEvent = {
      sessionId: 'sess-1',
      failedRef: 'openai/gpt-4o',
      fallbackRef: 'anthropic/claude-sonnet-4-20250514',
      error: 'Rate limit exceeded',
      attemptIndex: 1
    }

    await runner.runVoidHook('model_fallback', event)

    expect(handler).toHaveBeenCalledWith(event)
  })

  // ─── 多 handler 并行执行 ────────────────────

  it('should run multiple handlers in parallel for void hooks', async () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    registry.registerHook({
      extensionId: 'ext-1',
      hookName: 'message_queued',
      handler: handler1,
      priority: 100
    })
    registry.registerHook({
      extensionId: 'ext-2',
      hookName: 'message_queued',
      handler: handler2,
      priority: 50
    })

    await runner.runVoidHook('message_queued', {
      sessionId: 'sess-1',
      message: 'test',
      mode: 'collect',
      queueLength: 1
    })

    expect(handler1).toHaveBeenCalledTimes(1)
    expect(handler2).toHaveBeenCalledTimes(1)
  })

  // ─── handler 错误隔离 ──────────────────────

  it('should isolate handler errors (one failing does not block others)', async () => {
    const failHandler = vi.fn().mockRejectedValue(new Error('boom'))
    const successHandler = vi.fn()

    registry.registerHook({
      extensionId: 'ext-fail',
      hookName: 'model_resolved',
      handler: failHandler,
      priority: 100
    })
    registry.registerHook({
      extensionId: 'ext-ok',
      hookName: 'model_resolved',
      handler: successHandler,
      priority: 50
    })

    // 不应抛错
    await runner.runVoidHook('model_resolved', {
      sessionId: 'sess-1',
      providerId: 'openai',
      modelId: 'gpt-4o',
      source: 'global'
    })

    expect(failHandler).toHaveBeenCalledTimes(1)
    expect(successHandler).toHaveBeenCalledTimes(1)
  })

  // ─── 无注册 handler 时安全返回 ──────────────

  it('should safely return when no handlers registered', async () => {
    // 没有注册任何 handler
    await expect(
      runner.runVoidHook('message_queued', {
        sessionId: 'sess-1',
        message: 'test',
        mode: 'followup',
        queueLength: 0
      })
    ).resolves.toBeUndefined()
  })
})
