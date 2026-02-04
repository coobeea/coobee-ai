/**
 * 事件处理器示例
 *
 * 此文件展示如何创建事件处理器
 *
 * 文件命名规范：
 * - 必须以 Handler.ts 结尾
 * - 使用 PascalCase 命名
 *
 * 导出规范：
 * - 可以使用默认导出或命名导出
 * - 必须实现 EventHandler 接口
 */

import type { EventHandler } from '@main/common/types'
import { WindowEvents, AppEvents } from '@shared/events'
import { log } from '@main/common/logger'

/**
 * 窗口就绪事件处理器
 */
export const windowReadyHandler: EventHandler = {
  name: 'WindowReadyHandler',
  event: WindowEvents.READY_TO_SHOW,
  description: '处理窗口就绪事件',
  handle: () => {
    log.info('[WindowReadyHandler] 窗口已准备就绪')
  }
}

/**
 * 应用激活事件处理器
 */
export const appActivateHandler: EventHandler = {
  name: 'AppActivateHandler',
  event: AppEvents.ACTIVATE,
  description: '处理应用激活事件（macOS）',
  handle: () => {
    log.info('[AppActivateHandler] 应用被激活')
  }
}

/**
 * 也可以使用默认导出
 */
// export default windowReadyHandler
