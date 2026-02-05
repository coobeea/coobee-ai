/**
 * 窗口事件处理器
 *
 * 职责：监听窗口事件，处理窗口相关业务逻辑
 */
import { EventTypes, type EventPayloads } from '@shared/ipc/events'
import eventBus from '@/eventbus'
import { useWindowStore } from '@/stores/window'
import { useLogStore } from '@/stores/log'

/**
 * 记录事件日志
 */
function logEvent(message: string, data?: unknown): void {
  const logStore = useLogStore()
  logStore.info('window', message, data)
}

/**
 * 刷新窗口信息
 */
async function refreshWindowInfo(): Promise<void> {
  const windowStore = useWindowStore()
  await windowStore.refreshWindowInfo()
}

/**
 * 处理窗口创建事件
 */
async function handleWindowCreated(payload: EventPayloads['window:created']): Promise<void> {
  logEvent('窗口创建', payload)
  await refreshWindowInfo()
}

/**
 * 处理窗口准备就绪事件
 */
async function handleWindowReady(payload: EventPayloads['window:ready']): Promise<void> {
  logEvent('窗口准备就绪', payload)
  await refreshWindowInfo()
}

/**
 * 处理窗口显示事件
 */
function handleWindowShow(payload: EventPayloads['window:show']): void {
  logEvent('窗口显示', payload)
}

/**
 * 处理窗口隐藏事件
 */
function handleWindowHide(payload: EventPayloads['window:hide']): void {
  logEvent('窗口隐藏', payload)
}

/**
 * 处理窗口即将关闭事件
 */
async function handleWindowClose(payload: EventPayloads['window:close']): Promise<void> {
  logEvent('窗口即将关闭', payload)
  await refreshWindowInfo()
}

/**
 * 处理窗口已关闭事件
 */
async function handleWindowClosed(payload: EventPayloads['window:closed']): Promise<void> {
  logEvent('窗口已关闭', payload)
  await refreshWindowInfo()
}

/**
 * 处理窗口聚焦事件
 */
function handleWindowFocused(payload: EventPayloads['window:focused']): void {
  logEvent('窗口聚焦', payload)
}

/**
 * 处理窗口失焦事件
 */
function handleWindowBlurred(payload: EventPayloads['window:blurred']): void {
  logEvent('窗口失焦', payload)
}

/**
 * 处理窗口最小化事件
 */
function handleWindowMinimized(payload: EventPayloads['window:minimized']): void {
  logEvent('窗口最小化', payload)
}

/**
 * 处理窗口最大化事件
 */
function handleWindowMaximized(payload: EventPayloads['window:maximized']): void {
  logEvent('窗口最大化', payload)
}

/**
 * 处理窗口取消最大化事件
 */
function handleWindowUnmaximized(payload: EventPayloads['window:unmaximized']): void {
  logEvent('窗口取消最大化', payload)
}

/**
 * 处理窗口恢复事件
 */
function handleWindowRestored(payload: EventPayloads['window:restored']): void {
  logEvent('窗口恢复', payload)
}

/**
 * 处理窗口进入全屏事件
 */
function handleWindowEnterFullScreen(payload: EventPayloads['window:enter-full-screen']): void {
  logEvent('窗口进入全屏', payload)
}

/**
 * 处理窗口离开全屏事件
 */
function handleWindowLeaveFullScreen(payload: EventPayloads['window:leave-full-screen']): void {
  logEvent('窗口离开全屏', payload)
}

/**
 * 处理窗口大小变化事件
 */
function handleWindowResized(payload: EventPayloads['window:resized']): void {
  logEvent('窗口大小变化', payload)
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
