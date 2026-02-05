/**
 * Tab 事件处理器示例
 * 监听主进程的 Tab 相关事件，自动同步到前端状态
 */

import { EventTypes } from '@shared/ipc/events'
import eventBus from '@/eventbus'

import type { EventPayloads } from '@shared/ipc/events'

/**
 * 处理 Tab 创建事件
 */
function handleTabCreated(payload: EventPayloads['tab:created']): void {
  console.log('[TabEvents] Tab 创建:', payload)
  // 这里可以更新 TabStore 或触发其他业务逻辑
}

/**
 * 处理 Tab 关闭事件
 */
function handleTabClosed(payload: EventPayloads['tab:closed']): void {
  console.log('[TabEvents] Tab 关闭:', payload)
  // 这里可以更新 TabStore 或触发其他业务逻辑
}

/**
 * 处理 Tab 激活事件
 */
function handleTabActivated(payload: EventPayloads['tab:activated']): void {
  console.log('[TabEvents] Tab 激活:', payload)
  // 这里可以更新 TabStore 或触发其他业务逻辑
}

/**
 * 处理 Tab 更新事件
 */
function handleTabUpdated(payload: EventPayloads['tab:updated']): void {
  console.log('[TabEvents] Tab 更新:', payload)
  // 这里可以更新 TabStore 或触发其他业务逻辑
}

/**
 * 处理 Tabs 重新排序事件
 */
function handleTabsReordered(payload: EventPayloads['tabs:reordered']): void {
  console.log('[TabEvents] Tabs 重新排序:', payload)
  console.log(`  - 窗口 ID: ${payload.windowId}`)
  console.log(`  - 新顺序: [${payload.tabIds.join(', ')}]`)
  console.log(`  - 变化数: ${payload.changes.length}`)
  payload.changes.forEach((change) => {
    console.log(`    Tab ${change.tabId}: ${change.fromPosition} -> ${change.toPosition}`)
  })
  // 这里可以批量更新 TabStore 的顺序
}

/**
 * 处理 Tab 移动到另一个窗口事件
 */
function handleTabMovedToWindow(payload: EventPayloads['tab:moved-to-window']): void {
  console.log('[TabEvents] Tab 移动到另一个窗口:', payload)
  console.log(`  - Tab ${payload.tabId}: "${payload.title}"`)
  console.log(`  - 从窗口 ${payload.fromWindowId} -> 窗口 ${payload.toWindowId}`)
  // 这里可以更新多个窗口的 TabStore
}

/**
 * 处理 Tab 复制事件
 */
function handleTabDuplicated(payload: EventPayloads['tab:duplicated']): void {
  console.log('[TabEvents] Tab 复制:', payload)
  console.log(`  - 原 Tab: ${payload.originalTabId}`)
  console.log(`  - 新 Tab: ${payload.newTabId}`)
  console.log(`  - 标题: "${payload.title}"`)
  // 这里可以更新 TabStore
}

/**
 * 处理 Tab 刷新事件
 */
function handleTabReloaded(payload: EventPayloads['tab:reloaded']): void {
  console.log('[TabEvents] Tab 刷新:', payload)
  console.log(`  - 窗口 ID: ${payload.windowId}`)
  console.log(`  - Tab ID: ${payload.tabId}`)
  // 这里可以更新 TabStore 或显示刷新指示器
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
