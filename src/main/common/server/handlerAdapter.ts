import { log } from '@main/common/logger'
import { createSuccessResponse } from '@main/utils'
import { BusinessError, RequestContext, ServerMiddlewareContext } from '@main/common/types'
import type { SSEStreamResult, Result, UnifiedRequest } from '@shared/types'

/**
 * 方法参数元数据接口
 */
interface MethodMetadata {
  parameterNames: string[]
  parameterCount: number
  hasContext: boolean
}

/**
 * 流式写入通道接口
 */
export interface StreamChannel {
  write(data: SSEStreamResult): void
  writeRaw?(data: Buffer | string): void
  writeHeartbeat(): void
  end(): void
}

// ==================== 中间件适配 ====================

/**
 * 中间件管理器接口（服务端专用）
 *
 * 与 common/middleware/manager 的区别：
 * - 这里使用 ServerMiddlewareContext，包含 HTTP/IPC 请求上下文
 * - execute 方法签名不同：接受 ServerMiddlewareContext，返回 boolean
 */
interface IServerMiddlewareManager {
  execute(context: ServerMiddlewareContext): Promise<boolean>
}

/**
 * 默认的服务端中间件管理器（透传模式）
 * 可通过 setMiddlewareManager 替换为实际实现
 */
let serverMiddlewareManager: IServerMiddlewareManager = {
  async execute(_context: ServerMiddlewareContext): Promise<boolean> {
    // 默认直接通过，不做任何中间件处理
    return true
  }
}

/**
 * 设置服务端中间件管理器
 */
export function setServerMiddlewareManager(manager: IServerMiddlewareManager): void {
  serverMiddlewareManager = manager
}

// ==================== 工具函数 ====================

const methodMetadata = new Map<string, MethodMetadata>()

function registerMethodMetadata(
  context: RequestContext,
  func: (...args: unknown[]) => unknown
): void {
  const key = generateMethodKey(context)
  const metadata = extractParameterMetadata(func)
  methodMetadata.set(key, metadata)
}

function ensureAndGetMethodMetadata(
  context: RequestContext,
  func: (...args: unknown[]) => unknown
): MethodMetadata | null {
  const methodKey = generateMethodKey(context)

  if (!methodMetadata.has(methodKey)) {
    registerMethodMetadata(context, func)
  }

  return getMethodMetadata(context)
}

function extractParameterMetadata(func: (...args: unknown[]) => unknown): MethodMetadata {
  const funcStr = func.toString()
  const paramMatch = funcStr.match(/\(([^)]*)\)/)

  if (!paramMatch || !paramMatch[1].trim()) {
    return { parameterNames: [], parameterCount: 0, hasContext: false }
  }

  const paramStr = paramMatch[1]
  const parameters = paramStr
    .split(',')
    .map((p) => p.trim().split(/[=:]/)[0].trim())
    .filter((p) => p.length > 0)

  const lastParam = parameters[parameters.length - 1]
  const hasContext = Boolean(
    lastParam &&
    (lastParam.includes('context') ||
      lastParam.includes('ctx') ||
      lastParam.toLowerCase().includes('requestcontext'))
  )

  return { parameterNames: parameters, parameterCount: parameters.length, hasContext }
}

function generateMethodKey(context: RequestContext): string {
  if (context.target && context.propertyKey) {
    return `${(context.target as { constructor: { name: string } }).constructor.name}.${context.propertyKey}`
  }
  return context.path || 'unknown'
}

function getMethodMetadata(context: RequestContext): MethodMetadata | null {
  const key = generateMethodKey(context)
  return methodMetadata.get(key) || null
}

function buildParameterArray(
  businessArgs: unknown[],
  metadata: MethodMetadata | null,
  context: RequestContext
): unknown[] {
  if (!metadata) {
    log.debug('[HandlerAdapter] No metadata found, using fallback logic')
    return [...businessArgs, context]
  }

  const { parameterCount, hasContext } = metadata
  const fullArgs = new Array(parameterCount)

  for (let i = 0; i < parameterCount; i++) {
    if (hasContext && i === parameterCount - 1) {
      fullArgs[i] = context
    } else if (i < businessArgs.length) {
      fullArgs[i] = businessArgs[i]
    } else {
      fullArgs[i] = undefined
    }
  }

  return fullArgs
}

/**
 * 处理 SSE 流式数据
 */
async function processSSEStream<T>(
  generator: AsyncGenerator<T, void, unknown>,
  channel: StreamChannel
): Promise<void> {
  try {
    channel.write({ type: 'start', timestamp: Date.now() })

    for await (const chunk of generator) {
      channel.write({ type: 'data', data: chunk, timestamp: Date.now() })
    }

    channel.write({ type: 'end', timestamp: Date.now() })
  } catch (error: unknown) {
    const err = error as Error
    log.error('[HandlerAdapter] SSE stream processing failed:', err)
    channel.write({
      type: 'error',
      error: err.message || 'Stream processing failed',
      timestamp: Date.now()
    })
  } finally {
    channel.end()
  }
}

// ==================== HandlerAdapter 类 ====================

class HandlerAdapter {
  async innerInvoke<T = unknown>(
    businessFunc: (...args: unknown[]) => Promise<T> | AsyncGenerator<T, void, unknown>,
    request: UnifiedRequest,
    context: RequestContext
  ): Promise<{
    result: Promise<T> | AsyncGenerator<T, void, unknown>
    requestMeta: { requestId: string; timestamp: number; options?: UnifiedRequest['options'] }
  }> {
    const identifier = context.path || 'unknown'

    if (typeof businessFunc !== 'function') {
      throw new Error(`Business function is not a function, got: ${typeof businessFunc}`)
    }

    const { args, requestId, timestamp, options } = request

    const finalRequestId =
      requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
    const finalTimestamp = timestamp || Date.now()

    context.requestId = finalRequestId
    context.timestamp = finalTimestamp

    const requestMeta = { requestId: finalRequestId, timestamp: finalTimestamp, options }

    // 构造中间件上下文
    const middlewareContext: ServerMiddlewareContext = {
      requestContext: context,
      request,
      shared: {}
    }

    // 执行中间件处理
    try {
      const shouldContinue = await serverMiddlewareManager.execute(middlewareContext)
      if (!shouldContinue) {
        throw BusinessError.useErrorCode(
          (await import('@shared/types')).ErrorCodes.AUTH_PERMISSION_DENIED
        )
      }

      if (middlewareContext.user) {
        context.user = middlewareContext.user
      }
    } catch (error) {
      if (error instanceof BusinessError) {
        throw error
      }
      log.error(`[HandlerAdapter] Unexpected middleware error for ${identifier}:`, error)
      throw BusinessError.useErrorMessage('System error')
    }

    log.debug(`[HandlerAdapter] Executing ${identifier}...`)
    log.debug(`[HandlerAdapter] Request ID: ${finalRequestId}`)

    const metadata = ensureAndGetMethodMetadata(context, businessFunc)
    const fullArgs = buildParameterArray(args, metadata, context)

    let result: Promise<T> | AsyncGenerator<T, void, unknown>
    const { target, propertyKey } = context
    if (target && propertyKey) {
      result = (businessFunc as (...a: unknown[]) => Promise<T>).apply(target, fullArgs)
    } else {
      result = businessFunc(...fullArgs)
    }

    return { result, requestMeta }
  }

  async execute<T = unknown>(
    businessFunc: (...args: unknown[]) => Promise<T>,
    request: UnifiedRequest,
    context: RequestContext
  ): Promise<Result<T>> {
    const { path } = context

    try {
      const { result } = await this.innerInvoke(businessFunc, request, context)
      const finalResult = await (result as Promise<T>)

      log.debug(`[HandlerAdapter] ${path} executed successfully`)
      return createSuccessResponse(finalResult)
    } catch (error: unknown) {
      const err = error as Error
      log.error(`[HandlerAdapter] Error executing ${path}:`, err)
      if (err instanceof BusinessError) {
        throw err
      }
      throw BusinessError.useErrorMessage(err.message || 'Execution failed')
    }
  }

  async executeStreamFunction<T>(
    streamFunc: (...args: unknown[]) => AsyncGenerator<T, void, unknown>,
    request: UnifiedRequest,
    context: RequestContext
  ): Promise<AsyncGenerator<T, void, unknown>> {
    const { path } = context
    try {
      const { result } = await this.innerInvoke(streamFunc, request, context)
      log.debug(`[HandlerAdapter] ${path} stream executed successfully`)
      return result as AsyncGenerator<T, void, unknown>
    } catch (error: unknown) {
      const err = error as Error
      log.error(`[HandlerAdapter] Error executing ${path}:`, err)
      if (err instanceof BusinessError) {
        throw err
      }
      throw BusinessError.useErrorMessage(err.message || 'Execution failed')
    }
  }

  async executeSSEStream<T>(
    streamFunc: (...args: unknown[]) => AsyncGenerator<T, void, unknown>,
    request: UnifiedRequest,
    context: RequestContext,
    channel: StreamChannel
  ): Promise<Result<{ streamId: string; isStream: true }>> {
    const { path } = context
    try {
      const { result, requestMeta } = await this.innerInvoke(streamFunc, request, context)
      const streamId = requestMeta.requestId
      const generator = result as AsyncGenerator<T, void, unknown>
      log.debug(`[HandlerAdapter] ${path} SSE stream execution started`)

      // SSE 处理：异步执行流处理
      processSSEStream(generator, channel)

      return createSuccessResponse({ streamId, isStream: true as const })
    } catch (error: unknown) {
      const err = error as Error
      log.error(`[HandlerAdapter] Error executing ${path}:`, err)
      if (err instanceof BusinessError) {
        throw err
      }
      throw BusinessError.useErrorMessage(err.message || 'Execution failed')
    }
  }
}

/**
 * 单例实例
 */
const handlerAdapter = new HandlerAdapter()

export default handlerAdapter
