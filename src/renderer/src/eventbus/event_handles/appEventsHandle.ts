/**
 * 应用事件处理器
 *
 * 职责：监听应用级事件，处理全局业务逻辑
 */
import { EventTypes, type EventPayloads } from '@shared/ipc/events'
import eventBus from '@/eventbus'
import { useLogStore } from '@/stores/log'

/**
 * 记录事件日志
 */
function logEvent(
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
  data?: unknown
): void {
  const logStore = useLogStore()
  logStore[level]('app', message, data)
}

/**
 * 处理应用激活事件（macOS Dock 图标点击）
 */
function handleAppActivated(payload: EventPayloads['app:activated']): void {
  logEvent(`应用激活 (hasWindows: ${payload.hasWindows})`, 'info', payload)
}

/**
 * 处理应用获得焦点事件
 */
function handleAppFocus(payload: EventPayloads['app:focus']): void {
  logEvent('应用获得焦点', 'info', payload)
}

/**
 * 处理应用即将退出事件
 */
function handleAppBeforeQuit(payload: EventPayloads['app:before-quit']): void {
  logEvent('应用即将退出', 'warn', payload)
}

/**
 * 处理第二个实例启动事件
 */
function handleAppSecondInstance(payload: EventPayloads['app:second-instance']): void {
  logEvent(`第二个实例启动 (hasWindows: ${payload.hasWindows})`, 'info', payload)
}

/**
 * 处理子进程崩溃事件
 */
function handleAppChildProcessGone(payload: EventPayloads['app:child-process-gone']): void {
  logEvent(
    `子进程崩溃 (type: ${payload.type}, reason: ${payload.reason}, exitCode: ${payload.exitCode})`,
    'error',
    payload
  )
}

/**
 * 设置应用事件监听
 */
export function setup(): void {
  eventBus.on(EventTypes.APP_ACTIVATED, handleAppActivated)
  eventBus.on(EventTypes.APP_FOCUS, handleAppFocus)
  eventBus.on(EventTypes.APP_BEFORE_QUIT, handleAppBeforeQuit)
  eventBus.on(EventTypes.APP_SECOND_INSTANCE, handleAppSecondInstance)
  eventBus.on(EventTypes.APP_CHILD_PROCESS_GONE, handleAppChildProcessGone)

  console.log('[AppEvents] 应用事件处理器已注册')
}
