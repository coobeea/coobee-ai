/**
 * IPC 事件广播器
 * 负责将主进程的事件广播到前端
 */

import { BrowserWindow, WebContentsView } from 'electron'
import { eventBus } from '@main/common/eventbus'
import { log } from '@main/common/logger'
import { EventTypes, type IpcEventMessage, type EventPayloads } from '@shared/ipc/events'

/**
 * IPC 事件通道常量
 */
export const IPC_EVENT_CHANNEL = 'ipc:event' as const

class IpcEventBroadcaster {
  private initialized = false

  /**
   * 初始化事件广播器
   * 监听主进程 EventBus 的事件，转发到前端
   */
  init(): void {
    if (this.initialized) {
      log.warn('[IpcEventBroadcaster] Already initialized')
      return
    }

    this.setupEventListeners()
    this.initialized = true
    log.info('[IpcEventBroadcaster] Initialized')
  }

  /**
   * 设置事件监听器
   * 监听主进程 EventBus 的事件
   */
  private setupEventListeners(): void {
    // ==================== Window 事件 ====================
    eventBus.on(EventTypes.WINDOW_CREATED, (data: unknown) => {
      this.broadcast(EventTypes.WINDOW_CREATED, data as EventPayloads['window:created'])
    })

    eventBus.on(EventTypes.WINDOW_READY, (data: unknown) => {
      this.broadcast(EventTypes.WINDOW_READY, data as EventPayloads['window:ready'])
    })

    eventBus.on(EventTypes.WINDOW_SHOW, (data: unknown) => {
      this.broadcast(EventTypes.WINDOW_SHOW, data as EventPayloads['window:show'])
    })

    eventBus.on(EventTypes.WINDOW_HIDE, (data: unknown) => {
      this.broadcast(EventTypes.WINDOW_HIDE, data as EventPayloads['window:hide'])
    })

    eventBus.on(EventTypes.WINDOW_CLOSE, (data: unknown) => {
      this.broadcast(EventTypes.WINDOW_CLOSE, data as EventPayloads['window:close'])
    })

    eventBus.on(EventTypes.WINDOW_CLOSED, (data: unknown) => {
      this.broadcast(EventTypes.WINDOW_CLOSED, data as EventPayloads['window:closed'])
    })

    eventBus.on(EventTypes.WINDOW_FOCUSED, (data: unknown) => {
      this.broadcast(EventTypes.WINDOW_FOCUSED, data as EventPayloads['window:focused'])
    })

    eventBus.on(EventTypes.WINDOW_BLURRED, (data: unknown) => {
      this.broadcast(EventTypes.WINDOW_BLURRED, data as EventPayloads['window:blurred'])
    })

    eventBus.on(EventTypes.WINDOW_MINIMIZED, (data: unknown) => {
      this.broadcast(EventTypes.WINDOW_MINIMIZED, data as EventPayloads['window:minimized'])
    })

    eventBus.on(EventTypes.WINDOW_MAXIMIZED, (data: unknown) => {
      this.broadcast(EventTypes.WINDOW_MAXIMIZED, data as EventPayloads['window:maximized'])
    })

    eventBus.on(EventTypes.WINDOW_UNMAXIMIZED, (data: unknown) => {
      this.broadcast(EventTypes.WINDOW_UNMAXIMIZED, data as EventPayloads['window:unmaximized'])
    })

    eventBus.on(EventTypes.WINDOW_RESTORED, (data: unknown) => {
      this.broadcast(EventTypes.WINDOW_RESTORED, data as EventPayloads['window:restored'])
    })

    eventBus.on(EventTypes.WINDOW_ENTER_FULL_SCREEN, (data: unknown) => {
      this.broadcast(
        EventTypes.WINDOW_ENTER_FULL_SCREEN,
        data as EventPayloads['window:enter-full-screen']
      )
    })

    eventBus.on(EventTypes.WINDOW_LEAVE_FULL_SCREEN, (data: unknown) => {
      this.broadcast(
        EventTypes.WINDOW_LEAVE_FULL_SCREEN,
        data as EventPayloads['window:leave-full-screen']
      )
    })

    eventBus.on(EventTypes.WINDOW_RESIZED, (data: unknown) => {
      this.broadcast(EventTypes.WINDOW_RESIZED, data as EventPayloads['window:resized'])
    })

    // ==================== Tab 事件 ====================
    eventBus.on(EventTypes.TAB_CREATED, (data: unknown) => {
      this.broadcast(EventTypes.TAB_CREATED, data as EventPayloads['tab:created'])
    })

    eventBus.on(EventTypes.TAB_CLOSED, (data: unknown) => {
      this.broadcast(EventTypes.TAB_CLOSED, data as EventPayloads['tab:closed'])
    })

    eventBus.on(EventTypes.TAB_ACTIVATED, (data: unknown) => {
      this.broadcast(EventTypes.TAB_ACTIVATED, data as EventPayloads['tab:activated'])
    })

    eventBus.on(EventTypes.TAB_UPDATED, (data: unknown) => {
      this.broadcast(EventTypes.TAB_UPDATED, data as EventPayloads['tab:updated'])
    })

    eventBus.on(EventTypes.TAB_MOVED, (data: unknown) => {
      this.broadcast(EventTypes.TAB_MOVED, data as EventPayloads['tab:moved'])
    })

    eventBus.on(EventTypes.TABS_REORDERED, (data: unknown) => {
      this.broadcast(EventTypes.TABS_REORDERED, data as EventPayloads['tabs:reordered'])
    })

    eventBus.on(EventTypes.TAB_MOVED_TO_WINDOW, (data: unknown) => {
      this.broadcast(EventTypes.TAB_MOVED_TO_WINDOW, data as EventPayloads['tab:moved-to-window'])
    })

    eventBus.on(EventTypes.TAB_DUPLICATED, (data: unknown) => {
      this.broadcast(EventTypes.TAB_DUPLICATED, data as EventPayloads['tab:duplicated'])
    })

    eventBus.on(EventTypes.TAB_RELOADED, (data: unknown) => {
      this.broadcast(EventTypes.TAB_RELOADED, data as EventPayloads['tab:reloaded'])
    })

    // ==================== App 事件 ====================
    eventBus.on(EventTypes.APP_ACTIVATED, (data: unknown) => {
      this.broadcast(EventTypes.APP_ACTIVATED, data as EventPayloads['app:activated'])
    })

    eventBus.on(EventTypes.APP_FOCUS, (data: unknown) => {
      this.broadcast(EventTypes.APP_FOCUS, data as EventPayloads['app:focus'])
    })

    eventBus.on(EventTypes.APP_BEFORE_QUIT, (data: unknown) => {
      this.broadcast(EventTypes.APP_BEFORE_QUIT, data as EventPayloads['app:before-quit'])
    })

    eventBus.on(EventTypes.APP_SECOND_INSTANCE, (data: unknown) => {
      this.broadcast(EventTypes.APP_SECOND_INSTANCE, data as EventPayloads['app:second-instance'])
    })

    eventBus.on(EventTypes.APP_CHILD_PROCESS_GONE, (data: unknown) => {
      this.broadcast(
        EventTypes.APP_CHILD_PROCESS_GONE,
        data as EventPayloads['app:child-process-gone']
      )
    })

    eventBus.on(EventTypes.THEME_CHANGED, (data: unknown) => {
      this.broadcast(EventTypes.THEME_CHANGED, data as EventPayloads['theme:changed'])
    })

    eventBus.on(EventTypes.CONFIG_UPDATED, (data: unknown) => {
      this.broadcast(EventTypes.CONFIG_UPDATED, data as EventPayloads['config:updated'])
    })

    eventBus.on(EventTypes.SYSTEM_ERROR, (data: unknown) => {
      this.broadcast(EventTypes.SYSTEM_ERROR, data as EventPayloads['system:error'])
    })

    log.info('[IpcEventBroadcaster] Event listeners setup completed')
  }

  /**
   * 广播事件到所有窗口
   * @param type 事件类型
   * @param payload 事件负载
   */
  broadcast<T extends keyof EventPayloads>(type: T, payload: EventPayloads[T]): void {
    const message: IpcEventMessage<T> = {
      type,
      payload,
      timestamp: Date.now()
    }

    const windows = BrowserWindow.getAllWindows()
    let sentCount = 0

    windows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_EVENT_CHANNEL, message)
        sentCount++
      }
    })

    log.debug(`[IpcEventBroadcaster] Broadcast event: ${type} to ${sentCount} windows`, payload)
  }

  /**
   * 发送事件到指定窗口
   * @param windowId 窗口 ID
   * @param type 事件类型
   * @param payload 事件负载
   */
  sendToWindow<T extends keyof EventPayloads>(
    windowId: number,
    type: T,
    payload: EventPayloads[T]
  ): void {
    const win = BrowserWindow.fromId(windowId)
    if (!win || win.isDestroyed()) {
      log.warn(`[IpcEventBroadcaster] Window ${windowId} not found or destroyed`)
      return
    }

    const message: IpcEventMessage<T> = {
      type,
      payload,
      timestamp: Date.now()
    }

    win.webContents.send(IPC_EVENT_CHANNEL, message)
    log.debug(`[IpcEventBroadcaster] Send event to window ${windowId}: ${type}`, payload)
  }

  /**
   * 发送事件到指定窗口的所有 Tab（WebContentsView）
   * @param windowId 窗口 ID
   * @param type 事件类型
   * @param payload 事件负载
   */
  sendToWindowTabs<T extends keyof EventPayloads>(
    windowId: number,
    type: T,
    payload: EventPayloads[T]
  ): void {
    const win = BrowserWindow.fromId(windowId)
    if (!win || win.isDestroyed()) {
      log.warn(`[IpcEventBroadcaster] Window ${windowId} not found or destroyed`)
      return
    }

    const message: IpcEventMessage<T> = {
      type,
      payload,
      timestamp: Date.now()
    }

    // 发送到窗口主 WebContents
    win.webContents.send(IPC_EVENT_CHANNEL, message)

    // 发送到所有 WebContentsView
    const views = win.contentView.children
    views.forEach((view) => {
      if (view instanceof WebContentsView && !view.webContents.isDestroyed()) {
        view.webContents.send(IPC_EVENT_CHANNEL, message)
      }
    })

    log.debug(
      `[IpcEventBroadcaster] Send event to window ${windowId} and its tabs: ${type}`,
      payload
    )
  }
}

// 创建单例
export const ipcEventBroadcaster = new IpcEventBroadcaster()
