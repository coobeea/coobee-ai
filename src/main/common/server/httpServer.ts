import http from 'node:http'
import path from 'node:path'

import { is } from '@electron-toolkit/utils'
import cors from '@koa/cors'
import Router from '@koa/router'
import { createErrorResponse, createRequestId } from '@main/utils'
import { BusinessError, RequestContext } from '@main/common/types'
import type { StreamData, UnifiedRequest } from '@shared/api'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import KoaStatic from 'koa-static'
import { PassThrough } from 'stream'

import { Env } from '@main/common/env'
import { log } from '@main/common/logger'
import { toKebabCase } from '@main/utils'
import { getHttpMethod, getRouteMetadata, isSSEDecorator, isStreamDecorator } from './decorators'
import handlerAdapter from './handlerAdapter'
import { discoverApiModules } from './loader'
import { StreamChannel, streamChannelManager } from './streamChannelManager'

/** 统一服务端口（HTTP + WebSocket 共享） */
const SERVER_PORT = Env.main.serverPort ? parseInt(Env.main.serverPort, 10) : 8765

/**
 * 解析 GET 请求的查询参数值
 */
function parseGetQueryParam(argValue: string): unknown {
  const trimmedValue = argValue.trim()
  const firstChar = trimmedValue[0]

  if (firstChar === '{' || firstChar === '[') {
    try {
      return JSON.parse(trimmedValue)
    } catch {
      return argValue
    }
  }

  if (trimmedValue === 'true') return true
  if (trimmedValue === 'false') return false
  if (trimmedValue === 'null') return null

  return argValue
}

export class HttpServer {
  private static _instance: HttpServer | null = null

  private app: Koa
  private router: Router
  private httpServer!: http.Server
  private registeredRoutes = new Set<string>()

  constructor() {
    if (HttpServer._instance) {
      throw new Error('[HttpServer] Already initialized (singleton)')
    }

    this.app = new Koa()
    this.router = new Router()

    log.info('[HttpServer] Initializing...')
    this._setupMiddleware()
    this._registerHttpRoutes()
    this._startServer()

    HttpServer._instance = this
  }

  /** 获取单例 */
  static getInstance(): HttpServer | null {
    return HttpServer._instance
  }

  /** 获取底层 http.Server（供 GatewayServer 挂载 WebSocket） */
  getHttpServer(): http.Server {
    return this.httpServer
  }

  /** 获取 Koa 应用实例（供 GatewayServer 挂载额外路由） */
  getApp(): Koa {
    return this.app
  }

  private _setupMiddleware(): void {
    log.info('[HttpServer] Setting up middleware...')

    let staticPath = path.join(__dirname, '../renderer')
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      staticPath = process.env['ELECTRON_RENDERER_URL']
    }
    this.app.use(
      KoaStatic(staticPath, {
        index: 'index.html',
        maxAge: 0,
        gzip: true
      })
    )

    this.app.use(cors({ origin: '*' }))
    this.app.use(bodyParser())
    this.app.use(this.router.routes()).use(this.router.allowedMethods())
    log.info('[HttpServer] Middleware setup complete.')
  }

  private _registerHttpRoutes(): void {
    log.info('[HttpServer] Starting to register HTTP routes from API modules...')
    const discoveredModules = discoverApiModules()
    let routesRegisteredCount = 0

    if (discoveredModules.length === 0) {
      log.info('[HttpServer] No API modules found.')
      return
    }

    log.info(`[HttpServer] Processing ${discoveredModules.length} discovered modules...`)

    for (const { path: relativePath, module } of discoveredModules) {
      const channelPrefix = this._generateChannelPrefix(relativePath)
      if (!channelPrefix) continue

      let moduleRegisteredCount = 0

      // 模式1: export default class (带装饰器)
      if (
        module.default &&
        typeof module.default === 'function' &&
        (module.default as { prototype: unknown }).prototype
      ) {
        moduleRegisteredCount += this._registerClassRoutes(
          module.default as new (...args: unknown[]) => unknown,
          channelPrefix,
          relativePath
        )
      }

      // 模式2: export async function
      moduleRegisteredCount += this._registerFunctionRoutes(
        module as Record<string, unknown>,
        channelPrefix
      )

      routesRegisteredCount += moduleRegisteredCount

      if (moduleRegisteredCount > 0) {
        log.info(`[HttpServer] Registered ${moduleRegisteredCount} routes from ${relativePath}`)
      }
    }

    log.info(`[HttpServer] Total HTTP routes registered: ${routesRegisteredCount}`)
    log.debug('[HttpServer] Registered routes:', Array.from(this.registeredRoutes).sort())
  }

  private _generateChannelPrefix(relativePath: string): string | null {
    const prefixToRemove = '../../api/'
    if (!relativePath.startsWith(prefixToRemove)) {
      log.warn(`[HttpServer] Invalid module path: ${relativePath}`)
      return null
    }

    const corePath = relativePath.substring(prefixToRemove.length)
    const parsed = path.parse(corePath.replace(/\\/g, '/'))
    const dirParts = parsed.dir ? parsed.dir.split('/') : []
    const filePart = parsed.name

    return ['api', ...dirParts, filePart]
      .filter((part) => part)
      .map(toKebabCase)
      .join('/')
  }

  private _registerClassRoutes(
    ClassConstructor: new (...args: unknown[]) => unknown,
    channelPrefix: string,
    relativePath: string
  ): number {
    const metadata = getRouteMetadata(ClassConstructor)
    if (metadata.length === 0) return 0

    log.debug(
      `[HttpServer] Found ${metadata.length} decorated methods in class from ${relativePath}`
    )

    const instance = new ClassConstructor()
    let registeredCount = 0

    for (const route of metadata) {
      const operationName = toKebabCase(route.propertyKey)
      const routePath = `/${channelPrefix}/${operationName}`

      if (isSSEDecorator(route.decoratorType)) {
        if (
          this._createSSERoute(
            routePath,
            route.handler as (...args: unknown[]) => AsyncGenerator<unknown, void, unknown>,
            instance,
            route.propertyKey
          )
        ) {
          registeredCount++
        }
      } else if (isStreamDecorator(route.decoratorType)) {
        const httpMethod = route.method || 'POST'
        if (
          this._createStreamRoute(
            httpMethod,
            routePath,
            route.handler as (...args: unknown[]) => AsyncGenerator<unknown, void, unknown>,
            instance,
            route.propertyKey
          )
        ) {
          registeredCount++
        }
      } else {
        const httpMethod = getHttpMethod(route.decoratorType)
        if (
          this._createKoaRoute(
            routePath,
            route.handler as (...args: unknown[]) => Promise<unknown>,
            httpMethod,
            instance,
            route.propertyKey
          )
        ) {
          registeredCount++
        }
      }
    }

    return registeredCount
  }

  private _registerFunctionRoutes(module: Record<string, unknown>, channelPrefix: string): number {
    let registeredCount = 0

    for (const exportKey in module) {
      if (exportKey === 'default' || !Object.prototype.hasOwnProperty.call(module, exportKey)) {
        continue
      }

      const exportedValue = module[exportKey]
      if (typeof exportedValue !== 'function') continue

      const operationName = toKebabCase(exportKey)
      const routePath = `/${channelPrefix}/${operationName}`

      if (
        this._createKoaRoute(
          routePath,
          exportedValue as (...args: unknown[]) => Promise<unknown>,
          'POST'
        )
      ) {
        registeredCount++
      }
    }

    return registeredCount
  }

  private _createKoaRoute(
    routePath: string,
    businessFunc: (...args: unknown[]) => Promise<unknown>,
    method: string = 'POST',
    target?: unknown,
    propertyKey?: string
  ): boolean {
    const routeKey = `${method} ${routePath}`

    if (this.registeredRoutes.has(routeKey)) {
      log.error(
        `[HttpServer] Duplicate HTTP route registration detected for "${routeKey}". Registration skipped.`
      )
      return false
    }

    try {
      log.info(`[HttpServer] Registering ${method} route: ${routePath}`)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const routeHandler = async (ctx: any): Promise<void> => {
        try {
          log.debug(`[HttpServer] ${method} ${routePath} invoked`)

          let requestData: UnifiedRequest

          if (method === 'GET') {
            const query = ctx.query
            log.debug('[HttpServer] GET request query params:', query)

            const args: unknown[] = []
            let argIndex = 0
            while (query[`args[${argIndex}]`] !== undefined) {
              const argValue = query[`args[${argIndex}]`]
              args.push(parseGetQueryParam(argValue))
              argIndex++
            }

            requestData = {
              args,
              requestId: query.requestId || createRequestId('http'),
              timestamp: query.timestamp || Date.now(),
              token: query.token,
              options: query.options ? JSON.parse(query.options) : undefined
            }
          } else {
            requestData = ctx.request.body as UnifiedRequest
          }

          requestData.requestId = requestData.requestId || createRequestId('http')
          requestData.timestamp = requestData.timestamp || Date.now()

          const context: RequestContext = {
            environment: 'http',
            isSSE: false,
            path: routePath,
            target,
            propertyKey: propertyKey || 'unknown',
            requestId: requestData.requestId,
            timestamp: requestData.timestamp,
            rawRequest: requestData,
            rawResponse: ctx.response
          }

          const response = await handlerAdapter.execute(businessFunc, requestData, context)
          ctx.body = response
          log.debug(`[HttpServer] ${method} ${routePath} executed successfully`)
        } catch (error: unknown) {
          const err = error as Error & { status?: number }
          log.error(`[HttpServer] Error in ${method} route ${routePath}:`, err)
          if (err instanceof BusinessError) {
            const errorCode = err.errorCode
            ctx.status = err.status || 500
            ctx.body = createErrorResponse(errorCode.message, errorCode.code)
          } else {
            ctx.status = err.status || 500
            ctx.body = createErrorResponse(err.message || 'Execution failed')
          }
        }
      }

      if (method === 'GET') {
        this.router.get(routePath, routeHandler)
      } else {
        this.router.post(routePath, routeHandler)
      }

      this.registeredRoutes.add(routeKey)
      return true
    } catch (error) {
      log.error(`[HttpServer] Failed to register ${method} route ${routePath}:`, error)
      return false
    }
  }

  private _createSSERoute(
    routePath: string,
    streamFunc: (...args: unknown[]) => AsyncGenerator<unknown, void, unknown>,
    instance: unknown,
    propertyKey: string
  ): boolean {
    const routeKey = `POST ${routePath}`

    if (this.registeredRoutes.has(routeKey)) {
      log.error(
        `[HttpServer] Duplicate SSE route registration detected for "${routeKey}". Registration skipped.`
      )
      return false
    }

    try {
      log.info(`[HttpServer] Registering SSE route: POST ${routePath}`)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.router.post(routePath, async (ctx: any) => {
        log.debug(`[HttpServer] POST ${routePath} invoked`)

        ctx.set({
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Cache-Control'
        })

        const stream = new PassThrough()
        ctx.body = stream

        const requestData = ctx.request.body as UnifiedRequest

        requestData.requestId = requestData.requestId || createRequestId('http')
        requestData.timestamp = requestData.timestamp || Date.now()

        let channel: StreamChannel | null = null
        try {
          channel = streamChannelManager.createChannel({
            streamId: requestData.requestId,
            type: 'http',
            response: stream
          })

          const context: RequestContext = {
            environment: 'http',
            isSSE: true,
            path: routePath,
            target: instance,
            propertyKey,
            requestId: requestData.requestId,
            timestamp: requestData.timestamp,
            streamChannel: requestData.requestId,
            rawRequest: requestData,
            rawResponse: ctx.response,
            signal: channel.getSignal()
          }

          await handlerAdapter.executeSSEStream(streamFunc, requestData, context, channel)

          log.debug(`[HttpServer] POST ${routePath} executed successfully`)
        } catch (error: unknown) {
          channel?.end()

          const err = error as Error & { status?: number }
          log.error(`[HttpServer] Error in SSE route ${routePath}:`, err)
          if (err instanceof BusinessError) {
            const errorCode = err.errorCode
            ctx.status = err.status || 500
            ctx.body = createErrorResponse(errorCode.message, errorCode.code)
          } else {
            ctx.status = err.status || 500
            ctx.body = createErrorResponse(err.message || 'SSE execution failed')
          }
        }
      })

      this.registeredRoutes.add(routeKey)
      return true
    } catch (error) {
      log.error(`[HttpServer] Failed to register SSE route ${routePath}:`, error)
      return false
    }
  }

  private _createStreamRoute(
    method: string,
    routePath: string,
    streamFunc: (...args: unknown[]) => AsyncGenerator<unknown, void, unknown>,
    instance: unknown,
    propertyKey: string
  ): boolean {
    const routeKey = `${method} ${routePath}`

    if (this.registeredRoutes.has(routeKey)) {
      log.error(
        `[HttpServer] Duplicate Stream route registration detected for "${routeKey}". Registration skipped.`
      )
      return false
    }

    try {
      log.info(`[HttpServer] Registering Stream route: ${method} ${routePath}`)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const routeHandler = async (ctx: any): Promise<void> => {
        log.debug(`[HttpServer] ${method} ${routePath} invoked`)

        try {
          let requestData: UnifiedRequest

          if (method === 'GET') {
            const query = ctx.query
            const args: unknown[] = []
            let argIndex = 0
            while (query[`args[${argIndex}]`] !== undefined) {
              const argValue = query[`args[${argIndex}]`]
              args.push(parseGetQueryParam(argValue))
              argIndex++
            }

            requestData = {
              args,
              requestId: query.requestId || createRequestId('http'),
              timestamp: query.timestamp || Date.now(),
              token: query.token,
              options: query.options ? JSON.parse(query.options) : undefined
            }
          } else {
            requestData = ctx.request.body as UnifiedRequest
            requestData.requestId = requestData.requestId || createRequestId('http')
            requestData.timestamp = requestData.timestamp || Date.now()
          }

          log.debug('[HttpServer] Stream request data:', requestData)

          const context: RequestContext = {
            environment: 'http',
            isSSE: false,
            path: routePath,
            target: instance,
            propertyKey,
            requestId: requestData.requestId,
            timestamp: requestData.timestamp,
            rawRequest: requestData,
            rawResponse: ctx.response
          }

          const generator = await handlerAdapter.executeStreamFunction(
            streamFunc,
            requestData,
            context
          )
          log.debug('[HttpServer] Generator obtained successfully')

          await this.processStreamToHTTP(generator, ctx)

          log.debug(`[HttpServer] ${method} ${routePath} executed successfully`)
        } catch (error: unknown) {
          const err = error as Error & { status?: number }
          log.error(`[HttpServer] Error in Stream route ${routePath}:`, err)
          if (err instanceof BusinessError) {
            const errorCode = err.errorCode
            ctx.status = err.status || 500
            ctx.body = createErrorResponse(errorCode.message, errorCode.code)
          } else {
            ctx.status = err.status || 500
            ctx.body = createErrorResponse(err.message || 'Stream execution failed')
          }
        }
      }

      if (method === 'GET') {
        this.router.get(routePath, routeHandler)
      } else {
        this.router.post(routePath, routeHandler)
      }

      this.registeredRoutes.add(routeKey)
      return true
    } catch (error) {
      log.error(`[HttpServer] Failed to register Stream route ${routePath}:`, error)
      return false
    }
  }

  private async processStreamToHTTP<T>(
    generator: AsyncGenerator<T, void, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx: any
  ): Promise<void> {
    let hasSetHeaders = false
    let chunkCount = 0
    let totalBytes = 0

    log.debug('[HttpServer] Starting stream processing')

    try {
      for await (const streamData of generator) {
        chunkCount++
        log.debug(`[HttpServer] Processing chunk ${chunkCount}:`, {
          hasChunk:
            streamData && typeof streamData === 'object' && 'chunk' in (streamData as object),
          dataType: typeof streamData,
          dataKeys:
            streamData && typeof streamData === 'object' ? Object.keys(streamData as object) : 'N/A'
        })

        if (!streamData || typeof streamData !== 'object' || !('chunk' in (streamData as object))) {
          log.error('[HttpServer] Invalid StreamData format:', streamData)
          throw new Error('Stream data must be in StreamData format with chunk property')
        }

        const data = streamData as unknown as StreamData<T>

        if (!hasSetHeaders) {
          const headers: Record<string, string> = {
            'Content-Type': (data.metadata?.contentType as string) || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*',
            'Transfer-Encoding': 'chunked'
          }

          if (data.metadata?.cacheControl) {
            headers['Cache-Control'] = data.metadata.cacheControl as string
          } else {
            const disposition = data.metadata?.contentDisposition || 'attachment'
            headers['Cache-Control'] =
              disposition === 'inline'
                ? 'public, max-age=31536000, immutable'
                : 'no-cache, no-store, must-revalidate'
          }

          if (data.metadata?.etag) {
            headers['ETag'] = data.metadata.etag as string
          }

          if (data.metadata?.filename) {
            const disposition = data.metadata?.contentDisposition || 'attachment'
            const filename = data.metadata.filename as string

            // eslint-disable-next-line no-control-regex
            const hasNonAscii = /[^\x00-\x7F]/.test(filename)

            if (hasNonAscii) {
              const encodedFilename = encodeURIComponent(filename)
              // eslint-disable-next-line no-control-regex
              const fallbackFilename = filename.replace(/[^\x00-\x7F]/g, '_')
              headers['Content-Disposition'] =
                `${disposition}; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`
            } else {
              headers['Content-Disposition'] = `${disposition}; filename="${filename}"`
            }

            log.debug(`[HttpServer] Set Content-Disposition: ${headers['Content-Disposition']}`)
          }

          if (data.metadata?.contentRange) {
            headers['Content-Range'] = data.metadata.contentRange as string
            ctx.status = 206
          } else {
            ctx.status = (data.metadata?.statusCode as number) || 200
          }

          if (data.metadata?.customHeaders) {
            Object.assign(headers, data.metadata.customHeaders)
          }

          ctx.set(headers)

          if (data.metadata?.size) {
            log.debug(`[HttpServer] Expected file size: ${data.metadata.size} bytes`)
          }

          hasSetHeaders = true
          log.debug('[HttpServer] Headers set successfully:', headers)
        }

        if (data.chunk instanceof Buffer) {
          const chunkSize = data.chunk.length
          totalBytes += chunkSize
          ctx.res.write(data.chunk)
          log.debug(`[HttpServer] Wrote Buffer chunk: ${chunkSize} bytes (total: ${totalBytes})`)
        } else {
          const streamDataJson = JSON.stringify(data) + '\n'
          const chunkSize = Buffer.byteLength(streamDataJson)
          totalBytes += chunkSize
          ctx.res.write(streamDataJson)
          log.debug(`[HttpServer] Wrote StreamData JSON: ${chunkSize} bytes (total: ${totalBytes})`)
        }
      }

      log.info(
        `[HttpServer] Stream processing completed: ${chunkCount} chunks, ${totalBytes} bytes total`
      )
    } catch (error: unknown) {
      const err = error as Error & { status?: number }
      log.error('[HttpServer] Error in Stream route:', err)
      if (err instanceof BusinessError) {
        const errorCode = err.errorCode
        ctx.status = err.status || 500
        ctx.body = createErrorResponse(errorCode.message, errorCode.code)
      } else {
        ctx.status = err.status || 500
        ctx.body = createErrorResponse(err.message || 'Stream execution failed')
      }
    } finally {
      log.debug('[HttpServer] Ending response stream')
      ctx.res.end()
    }
  }

  private _startServer(): void {
    this.app.on('error', (err, ctx) => {
      log.error('[HttpServer] Server error:', err, ctx)
    })

    // 显式创建 http.Server，供 GatewayServer 挂载 WebSocket（共享端口）
    this.httpServer = http.createServer(this.app.callback())

    // 监听 server 级别错误（如端口占用 EADDRINUSE）
    this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.error(
          `[HttpServer] 端口 ${SERVER_PORT} 已被占用，请关闭占用该端口的程序或更改 VITE_HTTP_PORT 配置`
        )
      } else {
        log.error('[HttpServer] Server error:', err)
      }
    })

    this.httpServer.listen(SERVER_PORT, '127.0.0.1', () => {
      log.info(`[HttpServer] Listening on http://127.0.0.1:${SERVER_PORT} (HTTP + WebSocket)`)
    })
  }
}
