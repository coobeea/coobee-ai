/**
 * Tab 事件处理器
 *
 * 职责：监听 Tab 事件，刷新窗口信息
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
  logStore.info('tab', message, data)
}

/**
 * 刷新窗口信息
 */
async function refreshWindowInfo(): Promise<void> {
  const windowStore = useWindowStore()
  await windowStore.refreshWindowInfo()
}

/**
 * 处理 Tab 创建事件
 */
async function handleTabCreated(payload: EventPayloads['tab:created']): Promise<void> {
  logEvent('Tab 创建', payload)
  await refreshWindowInfo()
}

/**
 * 处理 Tab 关闭事件
 */
async function handleTabClosed(payload: EventPayloads['tab:closed']): Promise<void> {
  logEvent('Tab 关闭', payload)
  await refreshWindowInfo()
}

/**
 * 处理 Tab 激活事件
 */
async function handleTabActivated(payload: EventPayloads['tab:activated']): Promise<void> {
  logEvent('Tab 激活', payload)
  await refreshWindowInfo()
}

/**
 * 处理 Tab 更新事件
 */
async function handleTabUpdated(payload: EventPayloads['tab:updated']): Promise<void> {
  logEvent('Tab 更新', payload)
  await refreshWindowInfo()
}

/**
 * 处理 Tabs 重新排序事件
 */
async function handleTabsReordered(payload: EventPayloads['tabs:reordered']): Promise<void> {
  logEvent('Tabs 重新排序', payload)
  await refreshWindowInfo()
}

/**
 * 处理 Tab 移动到另一个窗口事件
 */
async function handleTabMovedToWindow(
  payload: EventPayloads['tab:moved-to-window']
): Promise<void> {
  logEvent('Tab 移动到另一个窗口', payload)
  await refreshWindowInfo()
}

/**
 * 处理 Tab 复制事件
 */
async function handleTabDuplicated(payload: EventPayloads['tab:duplicated']): Promise<void> {
  logEvent('Tab 复制', payload)
  await refreshWindowInfo()
}

/**
 * 处理 Tab 刷新事件
 */
function handleTabReloaded(payload: EventPayloads['tab:reloaded']): void {
  logEvent('Tab 刷新', payload)
}

/**
 * 设置 Tab 事件监听
 */
export function setup(): void {
  eventBus.on(EventTypes.TAB_CREATED, handleTabCreated)
  eventBus.on(EventTypes.TAB_CLOSED, handleTabClosed)
  eventBus.on(EventTypes.TAB_ACTIVATED, handleTabActivated)
  eventBus.on(EventTypes.TAB_UPDATED, handleTabUpdated)
  eventBus.on(EventTypes.TABS_REORDERED, handleTabsReordered)
  eventBus.on(EventTypes.TAB_MOVED_TO_WINDOW, handleTabMovedToWindow)
  eventBus.on(EventTypes.TAB_DUPLICATED, handleTabDuplicated)
  eventBus.on(EventTypes.TAB_RELOADED, handleTabReloaded)

  console.log('[TabEvents] Tab 事件处理器已注册')
}
