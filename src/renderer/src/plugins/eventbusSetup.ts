/**
 * 事件处理器统一注册
 */

import { setup as setupTabEvents } from '../eventbus/event_handles/tabEventsHandle'
import { setup as setupWindowEvents } from '../eventbus/event_handles/windowEventsHandle'
import { setup as setupAppEvents } from '../eventbus/event_handles/appEventsHandle'

/**
 * 设置所有事件处理器
 */
export function setupEventHandlers(): void {
  setupTabEvents()
  setupWindowEvents()
  setupAppEvents()

  console.log('[EventHandlers] 所有事件处理器已注册')
}

export default {
  install: (): void => {
    setupEventHandlers()
  }
}
