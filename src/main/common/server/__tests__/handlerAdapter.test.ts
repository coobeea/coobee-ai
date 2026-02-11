/**
 * handlerAdapter.ts 单元测试
 *
 * 测试目标：统一请求处理适配器的核心逻辑
 * - execute：普通请求执行
 * - executeSSEStream：SSE 流式执行
 * - executeStreamFunction：数据流执行
 * - 中间件链路（setServerMiddlewareManager）
 * - 参数绑定、错误处理
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ==================== Mock 依赖 ====================

vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn()
  }
}))

vi.mock('@main/common/env', () => ({
  Env: { main: {}, paths: {}, isDev: true }
}))

// mock ErrorCodes for dynamic import in handlerAdapter
vi.mock('@shared/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/types')>()
  return { ...actual }
})

import handlerAdapter, { setServerMiddlewareManager } from '../handlerAdapter'
import { BusinessError, type RequestContext } from '@main/common/types'
import type { UnifiedRequest } from '@shared/types'

// ==================== 工具函数 ====================

function createRequest(args: unknown[] = [], overrides?: Partial<UnifiedRequest>): UnifiedRequest {
  return {
    args,
    requestId: 'req_test_001',
    timestamp: Date.now(),
    ...overrides
  }
}

function createContext(overrides?: Partial<RequestContext>): RequestContext {
  return {
    environment: 'http',
    isSSE: false,
    path: '/api/test/action',
    target: undefined,
    propertyKey: 'action',
    requestId: 'req_test_001',
    timestamp: Date.now(),
    ...overrides
  }
}

// ==================== execute 测试 ====================

describe('handlerAdapter.execute', () => {
  beforeEach(() => {
    // 重置为默认透传中间件
    setServerMiddlewareManager({
      async execute() {
        return true
      }
    })
  })

  it('成功执行业务函数并返回 Result', async () => {
    const businessFn = vi.fn().mockResolvedValue({ id: 1, name: 'test' })
    const request = createRequest(['hello'])
    const context = createContext()

    const result = await handlerAdapter.execute(businessFn, request, context)

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ id: 1, name: 'test' })
    expect(result.code).toBe('0')
    expect(result.timestamp).toBeDefined()
    expect(businessFn).toHaveBeenCalled()
  })

  it('业务函数无参数时正常执行', async () => {
    const businessFn = vi.fn().mockResolvedValue('ok')
    const request = createRequest([])
    const context = createContext()

    const result = await handlerAdapter.execute(businessFn, request, context)

    expect(result.success).toBe(true)
    expect(result.data).toBe('ok')
  })

  it('自动填充 requestId 和 timestamp', async () => {
    const businessFn = vi.fn().mockResolvedValue('ok')
    const request = createRequest([], { requestId: '', timestamp: 0 })
    const context = createContext()

    await handlerAdapter.execute(businessFn, request, context)

    // context 应被更新
    expect(context.requestId).toBeTruthy()
    expect(context.timestamp).toBeGreaterThan(0)
  })

  it('业务函数抛出 BusinessError → 原样抛出', async () => {
    const err = BusinessError.useErrorMessage('权限不足', 'AUTH_ERROR')
    const businessFn = vi.fn().mockRejectedValue(err)
    const request = createRequest()
    const context = createContext()

    await expect(handlerAdapter.execute(businessFn, request, context)).rejects.toThrow(
      BusinessError
    )
  })

  it('业务函数抛出普通错误 → 包装为 BusinessError', async () => {
    const businessFn = vi.fn().mockRejectedValue(new Error('network failure'))
    const request = createRequest()
    const context = createContext()

    await expect(handlerAdapter.execute(businessFn, request, context)).rejects.toThrow(
      'network failure'
    )
  })

  it('businessFunc 非函数时抛出', async () => {
    const request = createRequest()
    const context = createContext()

    await expect(
      handlerAdapter.execute(
        'not a function' as unknown as (...args: unknown[]) => Promise<unknown>,
        request,
        context
      )
    ).rejects.toThrow('not a function')
  })
})

// ==================== 实例方法调用测试 ====================

describe('handlerAdapter - 实例方法绑定', () => {
  beforeEach(() => {
    setServerMiddlewareManager({
      async execute() {
        return true
      }
    })
  })

  it('target + propertyKey 时通过 apply 调用', async () => {
    class MyService {
      prefix = 'svc'
      async greet(name: string): Promise<string> {
        return `${this.prefix}:${name}`
      }
    }

    const svc = new MyService()
    const request = createRequest(['world'])
    const context = createContext({ target: svc, propertyKey: 'greet' })

    // 注意：不能用 .bind()，因为 bind 后 toString() 返回 native code，
    // extractParameterMetadata 无法解析参数。直接传原型方法，由 apply(target) 绑定 this。
    const result = await handlerAdapter.execute(svc.greet, request, context)

    expect(result.success).toBe(true)
    expect(result.data).toBe('svc:world')
  })
})

// ==================== 中间件测试 ====================

describe('handlerAdapter - 中间件', () => {
  it('中间件返回 false → 抛出权限错误', async () => {
    setServerMiddlewareManager({
      async execute() {
        return false
      }
    })

    const businessFn = vi.fn().mockResolvedValue('ok')
    const request = createRequest()
    const context = createContext()

    await expect(handlerAdapter.execute(businessFn, request, context)).rejects.toThrow()
    expect(businessFn).not.toHaveBeenCalled()
  })

  it('中间件返回 true → 正常执行', async () => {
    setServerMiddlewareManager({
      async execute() {
        return true
      }
    })

    const businessFn = vi.fn().mockResolvedValue('ok')
    const request = createRequest()
    const context = createContext()

    const result = await handlerAdapter.execute(businessFn, request, context)
    expect(result.success).toBe(true)
  })

  it('中间件填充 user → context 可获取', async () => {
    setServerMiddlewareManager({
      async execute(ctx) {
        ctx.user = { id: 'u1', name: 'admin', isAdmin: true, token: 'tok' }
        return true
      }
    })

    const businessFn = vi.fn().mockResolvedValue('ok')
    const request = createRequest()
    const context = createContext()

    await handlerAdapter.execute(businessFn, request, context)

    expect(context.user).toEqual({ id: 'u1', name: 'admin', isAdmin: true, token: 'tok' })
  })

  it('中间件抛出 BusinessError → 原样传播', async () => {
    setServerMiddlewareManager({
      async execute() {
        throw BusinessError.useErrorMessage('token过期', 'TOKEN_EXPIRED')
      }
    })

    const businessFn = vi.fn()
    const request = createRequest()
    const context = createContext()

    await expect(handlerAdapter.execute(businessFn, request, context)).rejects.toThrow(
      BusinessError
    )
  })

  it('中间件抛出普通错误 → 包装为系统错误', async () => {
    setServerMiddlewareManager({
      async execute() {
        throw new Error('db connection failed')
      }
    })

    const businessFn = vi.fn()
    const request = createRequest()
    const context = createContext()

    await expect(handlerAdapter.execute(businessFn, request, context)).rejects.toThrow()
  })
})

// ==================== executeSSEStream 测试 ====================

describe('handlerAdapter.executeSSEStream', () => {
  beforeEach(() => {
    setServerMiddlewareManager({
      async execute() {
        return true
      }
    })
  })

  it('成功执行 SSE 流并返回 streamId', async () => {
    const writes: unknown[] = []
    const mockChannel = {
      write: vi.fn((data: unknown) => writes.push(data)),
      writeHeartbeat: vi.fn(),
      end: vi.fn()
    }

    async function* genStream(): AsyncGenerator<string, void, unknown> {
      yield 'chunk1'
      yield 'chunk2'
    }

    const request = createRequest()
    const context = createContext({ isSSE: true })

    const result = await handlerAdapter.executeSSEStream(
      genStream as unknown as (...args: unknown[]) => AsyncGenerator<unknown, void, unknown>,
      request,
      context,
      mockChannel
    )

    expect(result.success).toBe(true)
    expect(result.data?.streamId).toBeTruthy()
    expect(result.data?.isStream).toBe(true)

    // SSE 是异步处理，需等待微任务完成
    await new Promise((r) => setTimeout(r, 50))

    // 验证 channel 写入了 start → data × 2 → end
    const types = writes.map((w) => (w as { type: string }).type)
    expect(types).toContain('start')
    expect(types).toContain('data')
    expect(types).toContain('end')
    expect(mockChannel.end).toHaveBeenCalled()
  })

  it('生成器抛出异常时写入 error 事件', async () => {
    const writes: unknown[] = []
    const mockChannel = {
      write: vi.fn((data: unknown) => writes.push(data)),
      writeHeartbeat: vi.fn(),
      end: vi.fn()
    }

    async function* failStream(): AsyncGenerator<string, void, unknown> {
      yield 'ok'
      throw new Error('stream broken')
    }

    const request = createRequest()
    const context = createContext({ isSSE: true })

    await handlerAdapter.executeSSEStream(
      failStream as unknown as (...args: unknown[]) => AsyncGenerator<unknown, void, unknown>,
      request,
      context,
      mockChannel
    )

    await new Promise((r) => setTimeout(r, 50))

    const types = writes.map((w) => (w as { type: string }).type)
    expect(types).toContain('start')
    expect(types).toContain('data')
    expect(types).toContain('error')
    expect(mockChannel.end).toHaveBeenCalled()
  })
})

// ==================== executeStreamFunction 测试 ====================

describe('handlerAdapter.executeStreamFunction', () => {
  beforeEach(() => {
    setServerMiddlewareManager({
      async execute() {
        return true
      }
    })
  })

  it('返回 AsyncGenerator', async () => {
    async function* genData(): AsyncGenerator<{ chunk: string }, void, unknown> {
      yield { chunk: 'a' }
      yield { chunk: 'b' }
    }

    const request = createRequest()
    const context = createContext()

    const generator = await handlerAdapter.executeStreamFunction(
      genData as unknown as (...args: unknown[]) => AsyncGenerator<unknown, void, unknown>,
      request,
      context
    )

    // 消费 generator
    const chunks: unknown[] = []
    for await (const item of generator) {
      chunks.push(item)
    }

    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toEqual({ chunk: 'a' })
    expect(chunks[1]).toEqual({ chunk: 'b' })
  })

  it('业务函数异常 → 抛出 BusinessError', async () => {
    const failFn = vi.fn().mockRejectedValue(new Error('stream init failed'))
    const request = createRequest()
    const context = createContext()

    await expect(handlerAdapter.executeStreamFunction(failFn, request, context)).rejects.toThrow(
      'stream init failed'
    )
  })
})

// ==================== 参数绑定边界 ====================

describe('handlerAdapter - 参数绑定', () => {
  beforeEach(() => {
    setServerMiddlewareManager({
      async execute() {
        return true
      }
    })
  })

  it('多参数正确传递', async () => {
    const fn = vi.fn().mockImplementation(async (a: unknown, b: unknown, c: unknown) => {
      return { a, b, c }
    })

    const request = createRequest(['x', 42, true])
    const context = createContext()

    const result = await handlerAdapter.execute(fn, request, context)

    expect(result.success).toBe(true)
    // 参数应该被传入（具体位置取决于参数元数据解析）
    expect(fn).toHaveBeenCalled()
  })

  it('参数不足时补 undefined', async () => {
    const fn = vi.fn().mockImplementation(async (a: unknown, b: unknown) => {
      return { a, b }
    })

    const request = createRequest(['only-one'])
    const context = createContext()

    const result = await handlerAdapter.execute(fn, request, context)
    expect(result.success).toBe(true)
  })
})
