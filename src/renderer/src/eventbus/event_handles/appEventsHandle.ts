/**
 * 应用事件处理器
 */
import { EventTypes, type EventPayloads } from '@shared/ipc/events'
import eventBus from '@/eventbus'

/**
 * 处理应用激活事件（macOS Dock 图标点击）
 */
function handleAppActivated(payload: EventPayloads['app:activated']): void {
  console.log('[AppEvents] 应用激活:', payload)
  console.log(`  - 是否有窗口: ${payload.hasWindows}`)
  // 这里可以显示欢迎提示或执行其他操作
}

/**
 * 处理应用获得焦点事件
 */
function handleAppFocus(payload: EventPayloads['app:focus']): void {
  console.log('[AppEvents] 应用获得焦点:', payload)
  console.log(`  - 时间戳: ${new Date(payload.timestamp).toLocaleString()}`)
  // 这里可以检查更新、同步数据等
}

/**
 * 处理应用即将退出事件
 */
function handleAppBeforeQuit(payload: EventPayloads['app:before-quit']): void {
  console.log('[AppEvents] 应用即将退出:', payload)
  console.log(`  - 时间戳: ${new Date(payload.timestamp).toLocaleString()}`)
  // 这里可以保存状态、显示退出确认等
}

/**
 * 处理第二个实例启动事件
 */
function handleAppSecondInstance(payload: EventPayloads['app:second-instance']): void {
  console.log('[AppEvents] 检测到第二个实例:', payload)
  console.log(`  - 是否有窗口: ${payload.hasWindows}`)
  // 这里可以显示提示信息
}

/**
 * 处理子进程崩溃事件
 */
function handleAppChildProcessGone(payload: EventPayloads['app:child-process-gone']): void {
  console.error('[AppEvents] 子进程崩溃:', payload)
  console.error(`  - 类型: ${payload.type}`)
  console.error(`  - 原因: ${payload.reason}`)
  console.error(`  - 退出码: ${payload.exitCode}`)
  // 这里可以显示错误提示、尝试恢复等
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
