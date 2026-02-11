import { log } from '@main/common/logger'
import type { SSEStreamResult } from '@shared/types'
import { ipcMain } from 'electron'

// ==================== 类型定义 ====================

interface ManagedChannelInfo {
  id: string
  type: 'http' | 'ipc'
  createdAt: number
  lastDataSent: number
  lastHeartbeatReply: number
  heartbeatFailCount: number
  needsHeartbeat: boolean
  channel: StreamChannel
  window?: unknown
}

interface ChannelConfig {
  streamId: string
  type: 'http' | 'ipc'
  response?: unknown
  streamChannel?: string
  window?: unknown
}

/**
 * 流式写入通道接口
 */
export interface StreamChannel {
  write(data: SSEStreamResult): void
  writeRaw?(data: Buffer | string): void
  writeHeartbeat(): void
  end(): void
  getSignal(): AbortSignal
  abort(reason?: string): void
}

// ==================== HTTP SSE 通道 ====================

class HTTPSSEChannel implements StreamChannel {
  private isEnded = false
  private readonly abortController = new AbortController()

  constructor(
    private streamId: string,
    private response: {
      write: (data: string) => void
      end: () => void
      once: (event: string, fn: (...args: unknown[]) => void) => void
    },
    private manager: StreamChannelManager
  ) {
    this.setupConnectionListeners()
  }

  getSignal(): AbortSignal {
    return this.abortController.signal
  }

  abort(reason?: string): void {
    if (!this.abortController.signal.aborted) {
      this.abortController.abort(reason)
      log.info(`[HTTPSSEChannel] Aborted: ${this.streamId}, reason: ${reason || 'unknown'}`)
    }
    this.end()
  }

  private setupConnectionListeners(): void {
    this.response.once('close', () => {
      log.info(`[HTTPSSEChannel] Client disconnected: ${this.streamId}`)
      this.abort('client_disconnected')
    })

    this.response.once('error', (error: unknown) => {
      const err = error as Error
      log.error(`[HTTPSSEChannel] Connection error for ${this.streamId}:`, err)
      this.abort(`connection_error: ${err.message}`)
    })

    this.response.once('finish', () => {
      log.debug(`[HTTPSSEChannel] Response finished: ${this.streamId}`)
      this.abort('response_finished')
    })

    log.debug(`[HTTPSSEChannel] Connection listeners registered for: ${this.streamId}`)
  }

  write(data: SSEStreamResult): void {
    if (this.isEnded) return
    if (this.abortController.signal.aborted) {
      log.warn(`[HTTPSSEChannel] Attempt to write to aborted channel: ${this.streamId}`)
      return
    }

    this.manager.updateDataSent(this.streamId)

    try {
      this.response.write(`data: ${JSON.stringify(data)}\n\n`)
    } catch (error) {
      log.warn(`[HTTPSSEChannel] Write failed for ${this.streamId}:`, error)
      this.abort('write_failed')
    }
  }

  writeRaw(data: Buffer | string): void {
    if (this.isEnded) return
    if (this.abortController.signal.aborted) {
      log.warn(`[HTTPSSEChannel] Attempt to writeRaw to aborted channel: ${this.streamId}`)
      return
    }

    this.manager.updateDataSent(this.streamId)

    try {
      this.response.write(typeof data === 'string' ? data : data.toString())
    } catch (error) {
      log.warn(`[HTTPSSEChannel] WriteRaw failed for ${this.streamId}:`, error)
      this.abort('write_raw_failed')
    }
  }

  writeHeartbeat(): void {
    this.write({
      type: 'heartbeat',
      streamId: this.streamId,
      timestamp: Date.now()
    })
  }

  end(): void {
    if (this.isEnded) return
    this.isEnded = true

    if (!this.abortController.signal.aborted) {
      this.abortController.abort('channel_ended')
    }

    this.manager.removeChannel(this.streamId)
    log.info(`[HTTPSSEChannel] Ending response for ${this.streamId}`)

    try {
      this.response.end()
    } catch (error) {
      log.warn(`[HTTPSSEChannel] Error ending response for ${this.streamId}:`, error)
    }
  }
}

// ==================== IPC 流通道 ====================

class IPCStreamChannel implements StreamChannel {
  private isEnded = false
  private replyListener:
    | ((_event: unknown, message: { streamId: string; type: string }) => void)
    | null = null
  private readonly replyChannel: string
  private readonly abortController = new AbortController()

  constructor(
    private streamId: string,
    private streamChannel: string,
    private window: {
      webContents: {
        send: (channel: string, data: unknown) => void
        isDestroyed: () => boolean
        on: (event: string, fn: () => void) => void
        removeListener: (event: string, fn: () => void) => void
      }
    },
    private manager: StreamChannelManager
  ) {
    this.replyChannel = `${this.streamChannel}:reply`
    this.setupReplyListener()
  }

  getSignal(): AbortSignal {
    return this.abortController.signal
  }

  abort(reason?: string): void {
    if (!this.abortController.signal.aborted) {
      this.abortController.abort(reason)
      log.info(`[IPCStreamChannel] Aborted: ${this.streamId}, reason: ${reason || 'unknown'}`)
    }
    this.end()
  }

  private setupReplyListener(): void {
    this.replyListener = (_event: unknown, message: { streamId: string; type: string }) => {
      if (message.streamId !== this.streamId) return

      if (this.abortController.signal.aborted) {
        log.warn(
          `[IPCStreamChannel] Heartbeat reply received but channel aborted: ${this.streamId}`
        )
        return
      }

      if (message.type === 'heartbeat') {
        log.debug(`[IPCStreamChannel] Heartbeat reply received: ${this.streamId}`)
        this.manager.updateHeartbeatReply(this.streamId)
      } else if (message.type === 'close') {
        log.debug(`[IPCStreamChannel] Close received: ${this.streamId}`)
        this.abort()
      }
    }

    ipcMain.on(this.replyChannel, this.replyListener as (...args: unknown[]) => void)
    log.debug(`[IPCStreamChannel] Listening for reply messages on: ${this.replyChannel}`)
  }

  getWindow(): unknown {
    return this.window
  }

  write(data: SSEStreamResult): void {
    if (this.isEnded) return
    if (this.abortController.signal.aborted) {
      log.warn(`[IPCStreamChannel] Attempt to write to aborted channel: ${this.streamId}`)
      return
    }

    this.manager.updateDataSent(this.streamId)

    try {
      this.window?.webContents.send(this.streamChannel, {
        ...data,
        streamId: this.streamId
      })
    } catch (error) {
      log.warn(`[IPCStreamChannel] Send failed for ${this.streamId}:`, error)
      this.abort('send_failed')
    }
  }

  writeRaw(data: Buffer | string): void {
    if (this.isEnded) return
    if (this.abortController.signal.aborted) {
      log.warn(`[IPCStreamChannel] Attempt to writeRaw to aborted channel: ${this.streamId}`)
      return
    }

    this.manager.updateDataSent(this.streamId)

    try {
      this.window?.webContents.send(this.streamChannel, {
        type: 'raw-data',
        data: data instanceof Buffer ? data.toString('base64') : data,
        isBuffer: data instanceof Buffer,
        streamId: this.streamId,
        timestamp: Date.now()
      })
    } catch (error) {
      log.warn(`[IPCStreamChannel] WriteRaw failed for ${this.streamId}:`, error)
      this.abort('write_raw_failed')
    }
  }

  writeHeartbeat(): void {
    this.write({
      type: 'heartbeat',
      streamId: this.streamId,
      timestamp: Date.now()
    })
  }

  end(): void {
    if (this.isEnded) return
    this.isEnded = true

    if (!this.abortController.signal.aborted) {
      this.abortController.abort('channel_ended')
    }

    if (this.replyListener) {
      ipcMain.removeListener(this.replyChannel, this.replyListener as (...args: unknown[]) => void)
      this.replyListener = null
      log.debug(`[IPCStreamChannel] Removed reply listener: ${this.replyChannel}`)
    }

    this.manager.removeChannel(this.streamId)
    log.info(`[IPCStreamChannel] Ending stream for ${this.streamId}`)
  }
}

// ==================== 流通道管理器 ====================

class StreamChannelManager {
  private channels = new Map<string, ManagedChannelInfo>()
  private heartbeatTimeout?: ReturnType<typeof setTimeout>
  private readonly heartbeatInterval = 30000
  private readonly maxHeartbeatFailures = 3
  private isShutdown = false

  private windowListeners = new Map<
    unknown,
    { closedListener: () => void; destroyedListener: () => void }
  >()

  constructor() {
    this.scheduleNextHeartbeat()
  }

  createChannel(config: ChannelConfig): StreamChannel {
    let channel: StreamChannel

    if (config.type === 'http') {
      if (!config.response) {
        throw new Error('HTTP channel requires response parameter')
      }
      channel = new HTTPSSEChannel(
        config.streamId,
        config.response as ConstructorParameters<typeof HTTPSSEChannel>[1],
        this
      )
    } else {
      if (!config.streamChannel || !config.window) {
        throw new Error('IPC channel requires streamChannel and window parameters')
      }
      this.ensureWindowListeners(config.window)
      channel = new IPCStreamChannel(
        config.streamId,
        config.streamChannel,
        config.window as ConstructorParameters<typeof IPCStreamChannel>[2],
        this
      )
    }

    this.registerChannel(config.streamId, config.type, channel, config.window)
    return channel
  }

  private registerChannel(
    id: string,
    type: 'http' | 'ipc',
    channel: StreamChannel,
    window?: unknown
  ): void {
    const channelInfo: ManagedChannelInfo = {
      id,
      type,
      createdAt: Date.now(),
      lastDataSent: Date.now(),
      lastHeartbeatReply: Date.now(),
      heartbeatFailCount: 0,
      needsHeartbeat: false,
      channel,
      window: type === 'ipc' ? window : undefined
    }

    this.channels.set(id, channelInfo)
    log.info(`[StreamManager] Created ${type} channel: ${id}`)
  }

  updateDataSent(id: string): void {
    const channelInfo = this.channels.get(id)
    if (channelInfo) {
      channelInfo.lastDataSent = Date.now()
      channelInfo.needsHeartbeat = false
      channelInfo.heartbeatFailCount = 0
    }
  }

  removeChannel(id: string): void {
    const channelInfo = this.channels.get(id)

    if (this.channels.delete(id)) {
      log.info(`[StreamManager] Removed channel: ${id}`)

      if (channelInfo?.type === 'ipc' && channelInfo.window) {
        this.checkAndCleanupWindowListeners(channelInfo.window)
      }
    }
  }

  isChannelStale(id: string): boolean {
    const channelInfo = this.channels.get(id)
    if (!channelInfo) return true
    return channelInfo.heartbeatFailCount >= this.maxHeartbeatFailures
  }

  private scheduleNextHeartbeat(): void {
    if (this.isShutdown) return

    this.heartbeatTimeout = setTimeout(() => {
      this.performHeartbeatCheck()
      this.scheduleNextHeartbeat()
    }, this.heartbeatInterval)
  }

  private performHeartbeatCheck(): void {
    try {
      this.processAllChannels()
    } catch (error) {
      log.error('[StreamManager] Error during heartbeat check:', error)
    }
  }

  private processAllChannels(): void {
    const now = Date.now()
    const channelsToRemove: string[] = []

    for (const [id, channelInfo] of this.channels) {
      const timeSinceLastData = now - channelInfo.lastDataSent

      if (timeSinceLastData >= this.heartbeatInterval) {
        channelInfo.needsHeartbeat = true
      }

      if (
        channelInfo.needsHeartbeat &&
        channelInfo.heartbeatFailCount < this.maxHeartbeatFailures
      ) {
        const success = this.sendHeartbeatToChannel(channelInfo)
        if (!success) {
          channelInfo.heartbeatFailCount++
          log.warn(
            `[StreamManager] Heartbeat failed for ${id}, count: ${channelInfo.heartbeatFailCount}/${this.maxHeartbeatFailures}`
          )
        } else {
          channelInfo.heartbeatFailCount = 0
          channelInfo.needsHeartbeat = false
          log.debug(`[StreamManager] Heartbeat sent to channel: ${id}`)
        }
      }

      if (channelInfo.type === 'ipc') {
        const timeSinceLastReply = now - channelInfo.lastHeartbeatReply
        const replyTimeout = this.heartbeatInterval * 3

        if (timeSinceLastReply > replyTimeout) {
          log.error(
            `[StreamManager] No heartbeat reply for ${replyTimeout}ms from IPC channel ${id}, considering it dead`
          )
          channelsToRemove.push(id)
        }
      }

      if (this.isChannelStale(id)) {
        channelsToRemove.push(id)
      }
    }

    channelsToRemove.forEach((id) => {
      const channelInfo = this.channels.get(id)
      if (channelInfo) {
        log.error(`[StreamManager] Removing stale channel: ${id}`)
        channelInfo.channel.end()
      }
    })
  }

  private sendHeartbeatToChannel(channelInfo: ManagedChannelInfo): boolean {
    try {
      channelInfo.channel.writeHeartbeat()
      return true
    } catch (error) {
      log.warn(`[StreamManager] Failed to send heartbeat to ${channelInfo.id}:`, error)
      return false
    }
  }

  getStats(): { total: number; http: number; ipc: number; channels: string[] } {
    const httpCount = Array.from(this.channels.values()).filter((c) => c.type === 'http').length
    const ipcCount = Array.from(this.channels.values()).filter((c) => c.type === 'ipc').length

    return {
      total: this.channels.size,
      http: httpCount,
      ipc: ipcCount,
      channels: Array.from(this.channels.keys())
    }
  }

  updateHeartbeatReply(id: string): void {
    const channelInfo = this.channels.get(id)
    if (channelInfo) {
      channelInfo.lastHeartbeatReply = Date.now()
      channelInfo.heartbeatFailCount = 0
      channelInfo.needsHeartbeat = false
      log.debug(`[StreamManager] Heartbeat reply received for channel: ${id}`)
    }
  }

  private ensureWindowListeners(window: unknown): void {
    if (this.windowListeners.has(window)) return

    const win = window as {
      on: (event: string, fn: () => void) => void
      removeListener: (event: string, fn: () => void) => void
      webContents: {
        on: (event: string, fn: () => void) => void
        removeListener: (event: string, fn: () => void) => void
        isDestroyed: () => boolean
      }
    }

    const closedListener = (): void => {
      log.info('[StreamManager] Window closed, cleaning up all streams for this window')
      this.cleanupStreamsByWindow(window)
      this.windowListeners.delete(window)
    }

    const destroyedListener = (): void => {
      log.info('[StreamManager] WebContents destroyed, cleaning up all streams for this window')
      this.cleanupStreamsByWindow(window)
      this.windowListeners.delete(window)
    }

    win.on('closed', closedListener)

    if (win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.on('destroyed', destroyedListener)
    }

    this.windowListeners.set(window, { closedListener, destroyedListener })
    log.debug('[StreamManager] Window listeners registered')
  }

  private cleanupStreamsByWindow(window: unknown): void {
    const streamsToRemove: string[] = []

    for (const [id, channelInfo] of this.channels) {
      if (channelInfo.type === 'ipc' && channelInfo.window === window) {
        streamsToRemove.push(id)
      }
    }

    for (const id of streamsToRemove) {
      const channelInfo = this.channels.get(id)
      if (channelInfo) {
        log.info(`[StreamManager] Cleaning up stream ${id} due to window closure`)
        channelInfo.channel.end()
      }
    }
  }

  private checkAndCleanupWindowListeners(window: unknown): void {
    const hasOtherStreams = Array.from(this.channels.values()).some(
      (info) => info.type === 'ipc' && info.window === window
    )

    if (!hasOtherStreams) {
      const listeners = this.windowListeners.get(window)
      if (listeners) {
        const win = window as {
          removeListener: (event: string, fn: () => void) => void
          webContents: {
            removeListener: (event: string, fn: () => void) => void
            isDestroyed: () => boolean
          }
        }
        win.removeListener('closed', listeners.closedListener)
        if (win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.removeListener('destroyed', listeners.destroyedListener)
        }
        this.windowListeners.delete(window)
        log.debug('[StreamManager] Window listeners cleaned up (no more streams for this window)')
      }
    }
  }

  shutdown(): void {
    this.isShutdown = true

    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout)
      this.heartbeatTimeout = undefined
    }

    for (const [window, listeners] of this.windowListeners) {
      try {
        const win = window as {
          removeListener: (event: string, fn: () => void) => void
          webContents: {
            removeListener: (event: string, fn: () => void) => void
            isDestroyed: () => boolean
          }
        }
        win.removeListener('closed', listeners.closedListener)
        if (win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.removeListener('destroyed', listeners.destroyedListener)
        }
      } catch (error) {
        log.warn('[StreamManager] Error removing window listeners during shutdown:', error)
      }
    }
    this.windowListeners.clear()
    this.channels.clear()
    log.info('[StreamManager] Shutdown completed')
  }
}

/**
 * 单例实例
 */
export const streamChannelManager = new StreamChannelManager()
export type { ChannelConfig }
