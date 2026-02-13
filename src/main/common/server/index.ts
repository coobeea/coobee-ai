import { ipcMain } from 'electron'

import { log } from '@main/common/logger'
import { HttpServer } from './httpServer'
import { IpcServer } from './ipcServer'

// ==================== 统一的服务器模块初始化函数 ====================

/**
 * 初始化服务器模块
 *
 * 创建 HttpServer（统一端口，HTTP + WebSocket 共享）和 IpcServer（Electron IPC）。
 * HttpServer 必须在 Gateway 之前初始化，因为 GatewayServer 需要挂载到 HttpServer 的 http.Server 上。
 */
export function initializeServerModules(): void {
  log.info('[ServerCore] Initializing server modules...')
  try {
    // HTTP 服务器（统一端口，供 Gateway 挂载 WebSocket）
    new HttpServer()
    log.info('[ServerCore] HttpServer instance created (unified port).')

    // IPC 服务器（Electron 进程间通信）
    new IpcServer(ipcMain)
    log.info('[ServerCore] IpcServer instance created.')

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
