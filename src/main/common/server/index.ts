import { ipcMain } from 'electron'

import { Env } from '@main/common/env'
import { log } from '@main/common/logger'
import { HttpServer } from './httpServer'
import { IpcServer } from './ipcServer'

// ==================== 统一的服务器模块初始化函数 ====================

export function initializeServerModules(): void {
  log.info('[ServerCore] Initializing server modules...')
  try {
    // 实例化 IPC 服务器
    new IpcServer(ipcMain)
    log.info('[ServerCore] IpcServer instance created.')

    // 根据环境变量决定是否启动 HTTP 服务器
    const enableHttp = Env.main.enableHttpServer?.toLowerCase() === 'true'
    log.info(
      `[ServerCore] Checking for HTTP Server enablement (VITE_ENABLE_HTTP_SERVER=${Env.main.enableHttpServer}). Enabled: ${enableHttp}`
    )

    if (enableHttp) {
      new HttpServer()
      log.info('[ServerCore] HttpServer instance created.')
    } else {
      log.info('[ServerCore] HTTP Server is disabled based on configuration.')
    }

    log.info('[ServerCore] Server modules initialized successfully.')
  } catch (error) {
    log.error('[ServerCore] Failed to initialize server modules:', error)
  }
}

// ==================== 导出 ====================

export { HttpServer } from './httpServer'
export { IpcServer } from './ipcServer'
export { type StreamChannel, streamChannelManager } from './streamChannelManager'
export type { ChannelConfig } from './streamChannelManager'
export { SSE, Get, Post, Stream, DecoratorType } from './decorators'
export { type RouteMetadata } from './decorators'
export { default as handlerAdapter, setServerMiddlewareManager } from './handlerAdapter'
