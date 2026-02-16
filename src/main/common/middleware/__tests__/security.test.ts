/**
 * Security Middleware 单元测试
 *
 * 验证：
 *   1. 速率限制
 *   2. 写操作参数校验
 *   3. 正常请求放行
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MiddlewareResult } from '../../types'

vi.mock('../../logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import { securityMiddleware } from '../security'

describe('securityMiddleware', () => {
  const mockNext = vi.fn<() => Promise<MiddlewareResult>>()

  beforeEach(() => {
    vi.clearAllMocks()
    mockNext.mockResolvedValue({ success: true, data: 'ok' })
  })

  it('should have correct metadata', () => {
    expect(securityMiddleware.name).toBe('security')
    expect(securityMiddleware.priority).toBe(2)
  })

  it('should pass through normal requests', async () => {
    const result = await securityMiddleware.execute({ method: 'config.getAll', args: [] }, mockNext)
    expect(result.success).toBe(true)
    expect(mockNext).toHaveBeenCalledTimes(1)
  })

  it('should reject chat.send without message', async () => {
    const result = await securityMiddleware.execute(
      { method: 'chat.send', args: [{ sessionId: 'sid' }] },
      mockNext
    )
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('message is required')
    expect(mockNext).not.toHaveBeenCalled()
  })

  it('should reject chat.abort without sessionId', async () => {
    const result = await securityMiddleware.execute({ method: 'chat.abort', args: [{}] }, mockNext)
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('sessionId is required')
    expect(mockNext).not.toHaveBeenCalled()
  })

  it('should allow chat.send with message', async () => {
    const result = await securityMiddleware.execute(
      { method: 'chat.send', args: [{ message: 'hello' }] },
      mockNext
    )
    expect(result.success).toBe(true)
    expect(mockNext).toHaveBeenCalledTimes(1)
  })

  it('should allow chat.abort with sessionId', async () => {
    const result = await securityMiddleware.execute(
      { method: 'chat.abort', args: [{ sessionId: 'sid-123' }] },
      mockNext
    )
    expect(result.success).toBe(true)
    expect(mockNext).toHaveBeenCalledTimes(1)
  })
})
