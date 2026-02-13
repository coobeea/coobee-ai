/**
 * WebSocket 消息总线（WsHub）
 *
 * 通用的 WebSocket 消息中枢，负责：
 * 1. 管理底层 WsServer（连接、心跳、收发）
 * 2. 自动发现并加载 Channel（src/main/channels/*Channel.ts）
 * 3. 按前缀约定（prefix:action）路由客户端消息到对应 Channel
 * 4. 提供 broadcast/send API 供 Channel 调用
 *
 * 设计原则：
 * - 约定大于配置：消息类型 prefix:action 自动决定路由
 * - 自动发现：Channel 文件放在 channels/ 目录，WsHub 启动时自动扫描
 * - 解耦：AI、Runtime 等模块通过 Channel + EventBus 与 WsHub 交互
 * - 统一端口：WsServer 挂载到 HttpServer 的 http.Server 上（通过 HTTP Upgrade 共享端口）
 */

import type { WebSocket } from 'ws'
import { log } from '@main/common/logger'
import { WsServer, type WsClientMeta } from './wsServer'
import { HttpServer } from './httpServer'
import type { WsChannel, WsHubApi, WsClientMessage, WsServerMessage } from '@shared/stream-protocol'
import { scanWsChannels } from '@main/common/scan'

// ==================== WsHub ====================

export class WsHub implements WsHubApi {
  private server: WsServer | null = null
  private channels = new Map<string, WsChannel>()

  /**
   * 初始化消息总线
   *
   * 1. 从 HttpServer 单例获取 http.Server
   * 2. 创建 WsServer（挂载到 http.Server，共享端口）
   * 3. 自动发现并加载所有 Channel
   * 4. 调用每个 Channel 的 onInit()
   *
   * 前置条件：HttpServer 必须已经初始化（ReadyApiRegistrationHook 先执行）
   */
  initialize(): void {
    if (this.server?.isInitialized) return

    const httpServerInstance = HttpServer.getInstance()
    if (!httpServerInstance) {
      log.error(
        '[WsHub] HttpServer not initialized — WsHub requires HttpServer to be started first'
      )
      return
    }

    this.server = new WsServer({
      server: httpServerInstance.getHttpServer(),
      onConnect: (ws, meta) => {
        // 通知所有 Channel 有新连接
        for (const channel of this.channels.values()) {
          channel.onConnect?.(ws, meta)
        }
      },
      onDisconnect: (ws, meta) => {
        // 通知所有 Channel 连接断开
        for (const channel of this.channels.values()) {
          channel.onDisconnect?.(ws, meta)
        }
      },
      onMessage: (ws, data, meta) => {
        this.handleClientMessage(ws, data, meta).catch((error) => {
          log.error('[WsHub] Error handling message:', error)
        })
      }
    })

    this.server.start()

    // 自动发现并加载 Channel
    this.discoverChannels()

    log.info(`[WsHub] Initialized (shared port) with ${this.channels.size} channel(s)`)
  }

  // ==================== Channel 管理 ====================

  /**
   * 自动发现 Channel（扫描 src/main/channels/*Channel.ts）
   */
  private discoverChannels(): void {
    const discoveredModules = scanWsChannels()

    for (const discovered of discoveredModules) {
      const mod = discovered.module

      // 遍历模块导出，查找符合 WsChannel 接口的对象
      for (const [exportName, exportValue] of Object.entries(mod)) {
        if (this.isWsChannel(exportValue)) {
          this.registerChannel(exportValue as WsChannel)
          log.debug(`[WsHub] 自动发现 Channel: ${exportName} (来自 ${discovered.path})`)
        }
      }
    }

    log.info(
      `[WsHub] Channel 发现完成: ${this.channels.size} 个 [${[...this.channels.keys()].join(', ')}]`
    )
  }

  /**
   * 注册 Channel（也可手动调用）
   */
  registerChannel(channel: WsChannel): void {
    if (this.channels.has(channel.prefix)) {
      log.warn(`[WsHub] Channel 前缀冲突，覆盖已有: ${channel.prefix}`)
    }

    this.channels.set(channel.prefix, channel)
    channel.onInit(this)

    log.info(`[WsHub] Channel 注册: ${channel.prefix} (${channel.label})`)
  }

  /**
   * 类型守卫：判断导出值是否为 WsChannel
   */
  private isWsChannel(value: unknown): value is WsChannel {
    if (!value || typeof value !== 'object') return false
    const obj = value as Record<string, unknown>
    return (
      typeof obj.prefix === 'string' &&
      typeof obj.label === 'string' &&
      typeof obj.onInit === 'function' &&
      typeof obj.onMessage === 'function'
    )
  }

  // ==================== 消息路由 ====================

  /**
   * 处理客户端消息
   *
   * 路由逻辑：
   * 1. 解析 msg.type，提取 prefix 和 action
   * 2. 无前缀（如 ping）由 WsHub 自身处理
   * 3. 有前缀（如 stream:subscribe）路由到对应 Channel
   */
  private async handleClientMessage(
    ws: WebSocket,
    data: string,
    meta: WsClientMeta
  ): Promise<void> {
    try {
      const msg: WsClientMessage = JSON.parse(data)
      const { prefix, action } = this.parseType(msg.type)

      // 无前缀 → 内置处理
      if (!prefix) {
        this.handleBuiltinMessage(ws, action, msg)
        return
      }

      // 按前缀查找 Channel
      const channel = this.channels.get(prefix)
      if (!channel) {
        log.warn(`[WsHub] 未知频道前缀: ${prefix} (type: ${msg.type})`)
        this.send(ws, {
          type: 'error',
          data: { error: `Unknown channel: ${prefix}` }
        })
        return
      }

      // 路由到 Channel
      await channel.onMessage(ws, action, msg, meta)
    } catch (error) {
      log.error('[WsHub] Message handling error:', error)
      this.send(ws, {
        type: 'error',
        data: { error: error instanceof Error ? error.message : String(error) }
      })
    }
  }

  /**
   * 处理内置消息（无前缀）
   */
  private handleBuiltinMessage(ws: WebSocket, action: string, _msg: WsClientMessage): void {
    switch (action) {
      case 'ping':
        this.send(ws, { type: 'pong', data: {} })
        break
      default:
        log.warn(`[WsHub] 未知内置消息: ${action}`)
    }
  }

  /**
   * 解析消息类型：提取 prefix 和 action
   *
   * 'stream:subscribe' → { prefix: 'stream', action: 'subscribe' }
   * 'ping'             → { prefix: null, action: 'ping' }
   */
  private parseType(type: string): { prefix: string | null; action: string } {
    const colonIndex = type.indexOf(':')
    if (colonIndex === -1) {
      return { prefix: null, action: type }
    }
    return {
      prefix: type.substring(0, colonIndex),
      action: type.substring(colonIndex + 1)
    }
  }

  // ==================== WsHubApi 实现（供 Channel 调用） ====================

  send(ws: unknown, payload: WsServerMessage): void {
    if (!this.server) return
    this.server.send(ws as WebSocket, payload)
  }

  broadcast(payload: WsServerMessage): void {
    if (!this.server) return
    this.server.broadcast(payload)
  }

  broadcastIf(
    payload: WsServerMessage,
    predicate: (ws: unknown, meta: Record<string, unknown>) => boolean
  ): number {
    if (!this.server) return 0
    return this.server.broadcastIf(
      payload,
      predicate as (ws: WebSocket, meta: WsClientMeta) => boolean
    )
  }

  forEachClient(callback: (ws: unknown, meta: Record<string, unknown>) => void): void {
    this.server?.forEachClient(callback as (ws: WebSocket, meta: WsClientMeta) => void)
  }

  get clientCount(): number {
    return this.server?.clientCount ?? 0
  }

  // ==================== 生命周期 ====================

  close(): void {
    this.server?.close()
    this.channels.clear()
    log.info('[WsHub] Closed')
  }
}

/** 全局 WsHub 单例 */
export const wsHub = new WsHub()
