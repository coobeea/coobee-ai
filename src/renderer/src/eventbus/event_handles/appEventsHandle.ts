/**
 * 应用事件处理器
 *
 * 职责：监听应用级事件，处理全局业务逻辑
 */
import { EventTypes, type EventPayloads } from '@shared/ipc/events'
import eventBus from '@/eventbus'

/**
 * 处理应用激活事件（macOS Dock 图标点击）
 */
function handleAppActivated(payload: EventPayloads['app:activated']): void {
  console.log('[AppEvents] 应用激活:', payload)
  console.log(`  - 是否有窗口: ${payload.hasWindows}`)
}

/**
 * 处理应用获得焦点事件
 */
function handleAppFocus(payload: EventPayloads['app:focus']): void {
  console.log('[AppEvents] 应用获得焦点:', payload)
}

/**
 * 处理应用即将退出事件
 */
function handleAppBeforeQuit(payload: EventPayloads['app:before-quit']): void {
  console.log('[AppEvents] 应用即将退出:', payload)
  // 可以在这里保存状态、清理资源等
}

/**
 * 处理第二个实例启动事件
 */
function handleAppSecondInstance(payload: EventPayloads['app:second-instance']): void {
  console.log('[AppEvents] 第二个实例启动:', payload)
  console.log(`  - 是否有窗口: ${payload.hasWindows}`)
}

/**
 * 处理子进程崩溃事件
 */
function handleAppChildProcessGone(payload: EventPayloads['app:child-process-gone']): void {
  console.error('[AppEvents] 子进程崩溃:', payload)
  console.error(`  - 类型: ${payload.type}`)
  console.error(`  - 原因: ${payload.reason}`)
  console.error(`  - 退出码: ${payload.exitCode}`)
  // 可以在这里上报错误、显示提示等
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
