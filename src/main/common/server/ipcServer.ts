import path from 'node:path'

import { createErrorResponse, createRequestId } from '@main/utils'
import { BusinessError, RequestContext } from '@main/common/types'
import type { UnifiedRequest } from '@shared/api'
import { BrowserWindow, IpcMain } from 'electron'

import { log } from '@main/common/logger'
import { toKebabCase } from '@main/utils'
import { getRouteMetadata, isSSEDecorator, isStreamDecorator } from './decorators'
import handlerAdapter from './handlerAdapter'
import { discoverApiModules } from './loader'
import { StreamChannel, streamChannelManager } from './streamChannelManager'

export class IpcServer {
  private ipcMain: IpcMain
  private registeredChannels = new Set<string>()

  constructor(ipcMainInstance: IpcMain) {
    this.ipcMain = ipcMainInstance
    log.info('[IpcServer] Initializing...')
    this._registerIpcHandlers()
  }

  private _registerIpcHandlers(): void {
    log.info('[IpcServer] Starting to register IPC handlers from API modules...')
    const discoveredModules = discoverApiModules()
    let handlersRegisteredCount = 0

    if (discoveredModules.length === 0) {
      log.warn('[IpcServer] No API modules found.')
      return
    }

    log.info(`[IpcServer] Processing ${discoveredModules.length} discovered modules...`)

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
        moduleRegisteredCount += this._registerClassHandlers(
          module.default as new (...args: unknown[]) => unknown,
          channelPrefix,
          relativePath
        )
      }

      // 模式2: export async function
      moduleRegisteredCount += this._registerFunctionHandlers(
        module as Record<string, unknown>,
        channelPrefix
      )

      handlersRegisteredCount += moduleRegisteredCount

      if (moduleRegisteredCount > 0) {
        log.info(`[IpcServer] Registered ${moduleRegisteredCount} handlers from ${relativePath}`)
      }
    }

    log.info(`[IpcServer] Total IPC handlers registered: ${handlersRegisteredCount}`)
    log.debug('[IpcServer] Registered channels:', Array.from(this.registeredChannels).sort())
  }

  private _generateChannelPrefix(relativePath: string): string | null {
    const prefixToRemove = '../../api/'
    if (!relativePath.startsWith(prefixToRemove)) {
      log.warn(`[IpcServer] Invalid module path: ${relativePath}`)
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

  private _registerClassHandlers(
    ClassConstructor: new (...args: unknown[]) => unknown,
    channelPrefix: string,
    relativePath: string
  ): number {
    const metadata = getRouteMetadata(ClassConstructor)
    if (metadata.length === 0) return 0

    log.debug(
      `[IpcServer] Found ${metadata.length} decorated methods in class from ${relativePath}`
    )

    const instance = new ClassConstructor()
    let registeredCount = 0

    for (const route of metadata) {
      const operationName = toKebabCase(route.propertyKey)
      const channel = `/${channelPrefix}/${operationName}`

      if (isSSEDecorator(route.decoratorType)) {
        if (
          this._registerSSEHandler(
            channel,
            route.handler as (...args: unknown[]) => AsyncGenerator<unknown, void, unknown>,
            instance,
            route.propertyKey
          )
        ) {
          registeredCount++
        }
      } else if (isStreamDecorator(route.decoratorType)) {
        this._registerStreamHandler(
          channel,
          route.handler as (...args: unknown[]) => AsyncGenerator<unknown, void, unknown>,
          instance,
          route.propertyKey
        )
        registeredCount++
      } else {
        if (
          this._registerHandler(
            channel,
            route.handler as (...args: unknown[]) => Promise<unknown>,
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

  private _registerFunctionHandlers(
    module: Record<string, unknown>,
    channelPrefix: string
  ): number {
    let registeredCount = 0

    for (const exportKey in module) {
      if (exportKey === 'default' || !Object.prototype.hasOwnProperty.call(module, exportKey)) {
        continue
      }

      const exportedValue = module[exportKey]
      if (typeof exportedValue !== 'function') continue

      const operationName = toKebabCase(exportKey)
      const channel = `/${channelPrefix}/${operationName}`

      if (
        this._registerHandler(channel, exportedValue as (...args: unknown[]) => Promise<unknown>)
      ) {
        registeredCount++
      }
    }

    return registeredCount
  }

  private _registerHandler(
    channel: string,
    businessFunc: (...args: unknown[]) => Promise<unknown>,
    target?: unknown,
    propertyKey?: string
  ): boolean {
    if (this.registeredChannels.has(channel)) {
      log.error(
        `[IpcServer] Duplicate channel registration detected for "${channel}". Registration skipped.`
      )
      return false
    }

    try {
      log.info(`[IpcServer] Registering IPC handler for channel: "${channel}"`)

      this.ipcMain.handle(channel, async (_event, requestInput) => {
        log.debug(`[IpcServer] IPC Channel "${channel}" invoked`)

        try {
          const requestData = requestInput as UnifiedRequest

          requestData.requestId = requestData.requestId || createRequestId('ipc')
          requestData.timestamp = requestData.timestamp || Date.now()

          const context: RequestContext = {
            environment: 'ipc',
            isSSE: false,
            path: channel,
            target,
            propertyKey: propertyKey || 'unknown',
            requestId: requestData.requestId,
            timestamp: requestData.timestamp,
            rawRequest: requestData,
            rawResponse: _event
          }

          const response = await handlerAdapter.execute(businessFunc, requestData, context)

          log.debug(`[IpcServer] IPC Channel "${channel}" executed successfully`)
          return response
        } catch (error: unknown) {
          const err = error as Error & { errorCode?: { message: string; code: string } }
          if (err instanceof BusinessError) {
            const errorCode = err.errorCode
            return createErrorResponse(errorCode.message, errorCode.code)
          }

          log.error(`[IpcServer] Error in channel ${channel}:`, err)
          return createErrorResponse(err.message || 'Execution failed')
        }
      })

      this.registeredChannels.add(channel)
      return true
    } catch (error) {
      log.error(`[IpcServer] Failed to register handler for channel "${channel}":`, error)
      return false
    }
  }

  private _registerSSEHandler(
    channel: string,
    streamFunc: (...args: unknown[]) => AsyncGenerator<unknown, void, unknown>,
    instance: unknown,
    propertyKey: string
  ): boolean {
    if (this.registeredChannels.has(channel)) {
      log.error(
        `[IpcServer] Duplicate SSE handler registration detected for "${channel}". Registration skipped.`
      )
      return false
    }

    try {
      log.info(`[IpcServer] Registering SSE handler: ${channel}`)

      this.ipcMain.handle(channel, async (event, rawInput) => {
        log.debug(`[IpcServer] IPC Channel "${channel}" invoked`)
        log.debug(`[IpcServer] Using data`, rawInput)

        const requestData = rawInput as UnifiedRequest

        requestData.requestId = requestData.requestId || createRequestId('ipc')
        requestData.timestamp = requestData.timestamp || Date.now()

        const streamChannelName = `sse_${requestData.requestId}`
        const window = BrowserWindow.fromWebContents(event.sender)

        let ipcChannel: StreamChannel | null = null

        try {
          ipcChannel = streamChannelManager.createChannel({
            streamId: requestData.requestId,
            type: 'ipc',
            streamChannel: streamChannelName,
            window
          })

          const context: RequestContext = {
            environment: 'ipc',
            isSSE: true,
            path: channel,
            target: instance,
            propertyKey,
            requestId: requestData.requestId,
            timestamp: requestData.timestamp,
            streamChannel: streamChannelName,
            rawRequest: requestData,
            rawResponse: event,
            signal: ipcChannel.getSignal()
          }

          const result = await handlerAdapter.executeSSEStream(
            streamFunc,
            requestData,
            context,
            ipcChannel
          )

          log.debug(`[IpcServer] IPC Channel "${channel}" executed successfully`)
          return result
        } catch (error: unknown) {
          ipcChannel?.end()

          const err = error as Error
          if (err instanceof BusinessError) {
            const errorCode = err.errorCode
            return createErrorResponse(errorCode.message, errorCode.code)
          }

          log.error(`[IpcServer] Error in SSE channel ${channel}:`, err)
          return createErrorResponse(err.message || 'SSE execution failed')
        }
      })

      this.registeredChannels.add(channel)
      return true
    } catch (error) {
      log.error(`[IpcServer] Failed to register SSE handler ${channel}:`, error)
      return false
    }
  }

  private _registerStreamHandler(
    channelName: string,
    streamFunc: (...args: unknown[]) => AsyncGenerator<unknown, void, unknown>,
    instance: unknown,
    propertyKey: string
  ): void {
    const streamChannel = channelName

    if (this.registeredChannels.has(streamChannel)) {
      log.error(
        `[IpcServer] Duplicate Stream channel registration detected for "${streamChannel}". Registration skipped.`
      )
      return
    }

    log.info(`[IpcServer] Registering Stream channel: ${streamChannel}`)

    this.ipcMain.handle(streamChannel, async (_event, requestInput) => {
      log.debug(`[IpcServer] Stream channel ${streamChannel} invoked`)

      try {
        const requestData = requestInput as UnifiedRequest

        requestData.requestId = requestData.requestId || createRequestId('ipc')
        requestData.timestamp = requestData.timestamp || Date.now()

        const context: RequestContext = {
          environment: 'ipc',
          isSSE: false,
          path: channelName,
          target: instance,
          propertyKey,
          requestId: requestData.requestId,
          timestamp: requestData.timestamp,
          rawRequest: requestData,
          rawResponse: _event
        }

        const generator = await handlerAdapter.executeStreamFunction(
          streamFunc,
          requestData,
          context
        )

        const streamData: unknown[] = []
        for await (const data of generator) {
          if (!data || typeof data !== 'object' || !('chunk' in (data as object))) {
            throw new Error('Stream data must be in StreamData format with chunk property')
          }
          streamData.push((data as { chunk: unknown }).chunk)
        }

        log.debug(`[IpcServer] Stream channel ${streamChannel} executed successfully`)
        return streamData
      } catch (error: unknown) {
        const err = error as Error
        if (err instanceof BusinessError) {
          const errorCode = err.errorCode
          return createErrorResponse(errorCode.message, errorCode.code)
        }

        log.error(`[IpcServer] Error in Stream channel ${streamChannel}:`, err)
        return createErrorResponse(err.message || 'Stream execution failed')
      }
    })

    this.registeredChannels.add(streamChannel)
  }
}
