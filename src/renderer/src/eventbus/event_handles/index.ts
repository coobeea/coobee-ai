/**
 * 事件处理器统一注册
 */

import { setup as setupTabEvents } from './tabEventsHandle'
import { setup as setupWindowEvents } from './windowEventsHandle'

/**
 * 设置所有事件处理器
 */
export function setupEventHandlers(): void {
  setupTabEvents()
  setupWindowEvents()

  console.log('[EventHandlers] 所有事件处理器已注册')
}

export default {
  install: (): void => {
    setupEventHandlers()
  }
}
