/**
 * Tab 事件处理器
 *
 * 职责：监听 Tab 事件，更新 Store 中的 currentTabId
 */
import { EventTypes, type EventPayloads } from '@shared/ipc/events'
import eventBus from '@/eventbus'
import { useWindowStore } from '@/stores/window'

/**
 * 处理 Tab 创建事件
 */
function handleTabCreated(payload: EventPayloads['tab:created']): void {
  console.log('[TabEvents] Tab 创建:', payload)
}

/**
 * 处理 Tab 关闭事件
 */
function handleTabClosed(payload: EventPayloads['tab:closed']): void {
  console.log('[TabEvents] Tab 关闭:', payload)
}

/**
 * 处理 Tab 激活事件
 */
function handleTabActivated(payload: EventPayloads['tab:activated']): void {
  console.log('[TabEvents] Tab 激活:', payload)
  const windowStore = useWindowStore()

  // 只更新当前窗口的激活 Tab
  if (payload.windowId === windowStore.windowId) {
    windowStore.setCurrentTab(payload.tabId)
  }
}

/**
 * 处理 Tab 更新事件
 */
function handleTabUpdated(payload: EventPayloads['tab:updated']): void {
  console.log('[TabEvents] Tab 更新:', payload)
}

/**
 * 处理 Tabs 重新排序事件
 */
function handleTabsReordered(payload: EventPayloads['tabs:reordered']): void {
  console.log('[TabEvents] Tabs 重新排序:', payload)
}

/**
 * 处理 Tab 移动到另一个窗口事件
 */
function handleTabMovedToWindow(payload: EventPayloads['tab:moved-to-window']): void {
  console.log('[TabEvents] Tab 移动到另一个窗口:', payload)
}

/**
 * 处理 Tab 复制事件
 */
function handleTabDuplicated(payload: EventPayloads['tab:duplicated']): void {
  console.log('[TabEvents] Tab 复制:', payload)
}

/**
 * 处理 Tab 刷新事件
 */
function handleTabReloaded(payload: EventPayloads['tab:reloaded']): void {
  console.log('[TabEvents] Tab 刷新:', payload)
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
