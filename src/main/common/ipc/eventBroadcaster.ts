/**
 * IPC 事件广播器
 * 负责将主进程的事件广播到前端
 *
 * ⚠️ 重要说明：事件广播范围定义
 * ============================================
 *
 * 本广播器只应处理【需要同步到前端】的事件，具体包括：
 *
 * 1. ✅ 应该广播的事件：
 *    - Window 事件（窗口创建、关闭、焦点、最小化、最大化等）
 *    - Tab 事件（Tab 创建、关闭、激活、更新、移动等）
 *    - App 事件（应用激活、焦点、第二实例、子进程崩溃等）
 *    - System 事件（系统错误等）
 *
 * 2. ❌ 不应该广播的事件：
 *    - Config 配置事件（CONFIG_*）
 *      理由：配置变更是后端内部事件，前端通过 IPC 调用获取配置即可
 *            如果广播配置事件会导致：
 *            - 前端状态和后端配置不同步的风险
 *            - 不必要的网络开销
 *            - 配置更新逻辑混乱（前端不应被动接收配置）
 *
 * 3. 📋 判断标准：
 *    问：这个事件是否需要前端主动响应或实时更新 UI？
 *    - 是 → 应该广播（例如：Tab 关闭需要更新 Tab 列表）
 *    - 否 → 不应该广播（例如：配置变更前端按需获取即可）
 *
 * 4. 🔧 配置事件的正确处理方式：
 *    - 后端：使用 EventBus 在主进程内部监听和响应
 *    - 前端：需要配置时通过 IPC 调用 `config.getXxx()` 获取
 *    - 示例：托盘管理器监听 CONFIG_SHOW_TRAY_ICON_CHANGED 是正确的
 *           但不应该将此事件广播到渲染进程
 *
 * ⚠️ 修改提醒：
 * 如果你正在考虑添加新的事件监听器，请先确认：
 * 1. 这个事件是否真的需要前端知道？
 * 2. 前端是否需要实时响应这个事件？
 * 3. 是否可以通过前端主动查询（IPC 调用）代替被动接收？
 *
 * 如果答案都是"是"，才应该添加到本广播器中。
 * ============================================
 */

import { BrowserWindow, WebContentsView, webContents } from 'electron'
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

    log.info('[IpcEventBroadcaster] Event listeners setup completed')
  }

  /**
   * 广播事件到所有窗口和 Tab
   * @param type 事件类型
   * @param payload 事件负载
   */
  broadcast<T extends keyof EventPayloads>(type: T, payload: EventPayloads[T]): void {
    const message: IpcEventMessage<T> = {
      type,
      payload,
      timestamp: Date.now()
    }

    // 获取所有的 WebContents（包括 shell 窗口和所有 Tab）
    const allWebContents = webContents.getAllWebContents()
    let sentCount = 0

    allWebContents.forEach((wc) => {
      if (!wc.isDestroyed()) {
        try {
          wc.send(IPC_EVENT_CHANNEL, message)
          sentCount++
        } catch (error) {
          log.warn(`[IpcEventBroadcaster] 发送事件失败: webContentsId=${wc.id}`, error)
        }
      }
    })

    log.info(`[IpcEventBroadcaster] Broadcast event: ${type} to ${sentCount} webContents`, payload)
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
