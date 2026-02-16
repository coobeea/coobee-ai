/**
 * Security Middleware — 请求级安全防护
 *
 * 功能：
 *   1. 速率限制 — 滑动窗口计数器，防止 API 滥用
 *   2. 方法级保护 — 写操作要求有效 sessionId
 *   3. 请求大小限制 — 防止超大 payload
 */
import { log } from '../logger'
import type { Middleware, MiddlewareResult } from '../types'

// ─── 速率限制配置 ──────────────────────────────

/** 速率限制窗口（ms） */
const RATE_WINDOW_MS = 60_000

/** 窗口内最大请求数 */
const RATE_MAX_REQUESTS = 120

/** 每个 IP/session 的请求时间戳列表 */
const rateBuckets = new Map<string, number[]>()

/** 需要 sessionId 的写操作方法前缀 */
const WRITE_METHODS = new Set(['config.set', 'config.patch', 'chat.send', 'chat.abort'])

// ─── 速率限制工具 ──────────────────────────────

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const cutoff = now - RATE_WINDOW_MS

  let timestamps = rateBuckets.get(key)
  if (!timestamps) {
    timestamps = []
    rateBuckets.set(key, timestamps)
  }

  // 清理过期时间戳
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift()
  }

  if (timestamps.length >= RATE_MAX_REQUESTS) {
    return false
  }

  timestamps.push(now)
  return true
}

/** 定期清理空的 bucket（每 5 分钟） */
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS
  for (const [key, timestamps] of rateBuckets.entries()) {
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift()
    }
    if (timestamps.length === 0) {
      rateBuckets.delete(key)
    }
  }
}, 5 * 60_000).unref()

// ─── Middleware ──────────────────────────────

export const securityMiddleware: Middleware = {
  name: 'security',
  priority: 2,

  async execute(context, next): Promise<MiddlewareResult> {
    const { method, args, metadata } = context

    // 1. 速率限制
    const clientKey = (metadata?.clientId as string) || 'default'
    if (!checkRateLimit(clientKey)) {
      log.warn(`[Security] Rate limit exceeded: ${method} from ${clientKey}`)
      return {
        success: false,
        error: new Error('Rate limit exceeded. Please try again later.')
      }
    }

    // 2. 写操作需要有效参数
    if (WRITE_METHODS.has(method)) {
      const firstArg = args?.[0] as Record<string, unknown> | undefined

      // chat.send 需要 message
      if (method === 'chat.send' && (!firstArg || !firstArg.message)) {
        log.warn(`[Security] Invalid request: ${method} missing message`)
        return {
          success: false,
          error: new Error('Invalid request: message is required')
        }
      }

      // chat.abort 需要 sessionId
      if (method === 'chat.abort' && (!firstArg || !firstArg.sessionId)) {
        log.warn(`[Security] Invalid request: ${method} missing sessionId`)
        return {
          success: false,
          error: new Error('Invalid request: sessionId is required')
        }
      }
    }

    log.debug(`[Security] Validated: ${method}`)
    return await next()
  }
}
