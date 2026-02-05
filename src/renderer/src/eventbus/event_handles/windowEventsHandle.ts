/**
 * 窗口事件处理器
 */
import { EventTypes, type EventPayloads } from '@shared/ipc/events'
import eventBus from '@/eventbus'

/**
 * 处理窗口创建事件
 */
function handleWindowCreated(payload: EventPayloads['window:created']): void {
  console.log('[WindowEvents] 窗口创建:', payload)
  console.log(`  - 窗口 ID: ${payload.windowId}`)
  console.log(`  - 窗口类型: ${payload.type}`)
  // 这里可以更新 WindowStore - 添加窗口到列表
}

/**
 * 处理窗口准备就绪事件
 */
function handleWindowReady(payload: EventPayloads['window:ready']): void {
  console.log('[WindowEvents] 窗口准备就绪:', payload)
  console.log(`  - 窗口 ID: ${payload.windowId}`)
  // 这里可以更新 WindowStore - 标记窗口为可交互状态
}

/**
 * 处理窗口显示事件
 */
function handleWindowShow(payload: EventPayloads['window:show']): void {
  console.log('[WindowEvents] 窗口显示:', payload)
  console.log(`  - 窗口 ID: ${payload.windowId}`)
  // 这里可以更新 WindowStore - 标记窗口为可见
}

/**
 * 处理窗口隐藏事件
 */
function handleWindowHide(payload: EventPayloads['window:hide']): void {
  console.log('[WindowEvents] 窗口隐藏:', payload)
  console.log(`  - 窗口 ID: ${payload.windowId}`)
  // 这里可以更新 WindowStore - 标记窗口为隐藏
}

/**
 * 处理窗口即将关闭事件
 */
function handleWindowClose(payload: EventPayloads['window:close']): void {
  console.log('[WindowEvents] 窗口即将关闭:', payload)
  console.log(`  - 窗口 ID: ${payload.windowId}`)
  // 这里可以显示确认对话框或保存未保存的数据
  // 注意：这个事件在后端可以被阻止
}

/**
 * 处理窗口已关闭事件
 */
function handleWindowClosed(payload: EventPayloads['window:closed']): void {
  console.log('[WindowEvents] 窗口已关闭:', payload)
  console.log(`  - 窗口 ID: ${payload.windowId}`)
  // 这里可以更新 WindowStore - 从列表中移除窗口
}

/**
 * 处理窗口聚焦事件
 */
function handleWindowFocused(payload: EventPayloads['window:focused']): void {
  console.log('[WindowEvents] 窗口聚焦:', payload)
  console.log(`  - 窗口 ID: ${payload.windowId}`)
  // 这里可以更新 WindowStore 中的 focusedWindowId
}

/**
 * 处理窗口失焦事件
 */
function handleWindowBlurred(payload: EventPayloads['window:blurred']): void {
  console.log('[WindowEvents] 窗口失焦:', payload)
  console.log(`  - 窗口 ID: ${payload.windowId}`)
  // 这里可以更新 WindowStore
}

/**
 * 处理窗口最小化事件
 */
function handleWindowMinimized(payload: EventPayloads['window:minimized']): void {
  console.log('[WindowEvents] 窗口最小化:', payload)
  console.log(`  - 窗口 ID: ${payload.windowId}`)
  // 这里可以更新 WindowStore 中的窗口状态
}

/**
 * 处理窗口最大化事件
 */
function handleWindowMaximized(payload: EventPayloads['window:maximized']): void {
  console.log('[WindowEvents] 窗口最大化:', payload)
  console.log(`  - 窗口 ID: ${payload.windowId}`)
  // 这里可以更新 WindowStore 中的窗口状态
}

/**
 * 处理窗口取消最大化事件
 */
function handleWindowUnmaximized(payload: EventPayloads['window:unmaximized']): void {
  console.log('[WindowEvents] 窗口取消最大化:', payload)
  console.log(`  - 窗口 ID: ${payload.windowId}`)
  // 这里可以更新 WindowStore 中的窗口状态
}

/**
 * 处理窗口恢复事件
 */
function handleWindowRestored(payload: EventPayloads['window:restored']): void {
  console.log('[WindowEvents] 窗口恢复:', payload)
  console.log(`  - 窗口 ID: ${payload.windowId}`)
  // 这里可以更新 WindowStore 中的窗口状态
}

/**
 * 处理窗口进入全屏事件
 */
function handleWindowEnterFullScreen(payload: EventPayloads['window:enter-full-screen']): void {
  console.log('[WindowEvents] 窗口进入全屏:', payload)
  console.log(`  - 窗口 ID: ${payload.windowId}`)
  // 这里可以更新 WindowStore 中的窗口状态
}

/**
 * 处理窗口离开全屏事件
 */
function handleWindowLeaveFullScreen(payload: EventPayloads['window:leave-full-screen']): void {
  console.log('[WindowEvents] 窗口离开全屏:', payload)
  console.log(`  - 窗口 ID: ${payload.windowId}`)
  // 这里可以更新 WindowStore 中的窗口状态
}

/**
 * 处理窗口大小变化事件
 */
function handleWindowResized(payload: EventPayloads['window:resized']): void {
  console.log('[WindowEvents] 窗口大小变化:', payload)
  console.log(`  - 窗口 ID: ${payload.windowId}`)
  console.log(`  - 新尺寸: ${payload.bounds.width}x${payload.bounds.height}`)
  console.log(`  - 新位置: (${payload.bounds.x}, ${payload.bounds.y})`)
  // 这里可以更新 WindowStore 中的窗口边界
}

/**
 * 设置窗口事件监听
 */
export function setup(): void {
  eventBus.on(EventTypes.WINDOW_CREATED, handleWindowCreated)
  eventBus.on(EventTypes.WINDOW_READY, handleWindowReady)
  eventBus.on(EventTypes.WINDOW_SHOW, handleWindowShow)
  eventBus.on(EventTypes.WINDOW_HIDE, handleWindowHide)
  eventBus.on(EventTypes.WINDOW_CLOSE, handleWindowClose)
  eventBus.on(EventTypes.WINDOW_CLOSED, handleWindowClosed)
  eventBus.on(EventTypes.WINDOW_FOCUSED, handleWindowFocused)
  eventBus.on(EventTypes.WINDOW_BLURRED, handleWindowBlurred)
  eventBus.on(EventTypes.WINDOW_MINIMIZED, handleWindowMinimized)
  eventBus.on(EventTypes.WINDOW_MAXIMIZED, handleWindowMaximized)
  eventBus.on(EventTypes.WINDOW_UNMAXIMIZED, handleWindowUnmaximized)
  eventBus.on(EventTypes.WINDOW_RESTORED, handleWindowRestored)
  eventBus.on(EventTypes.WINDOW_ENTER_FULL_SCREEN, handleWindowEnterFullScreen)
  eventBus.on(EventTypes.WINDOW_LEAVE_FULL_SCREEN, handleWindowLeaveFullScreen)
  eventBus.on(EventTypes.WINDOW_RESIZED, handleWindowResized)

  console.log('[WindowEvents] 窗口事件处理器已注册')
}
