/**
 * IPC 模块
 *
 * 统一注册 shell: 与 window: 相关 IPC 处理器
 */

import { registerShellHandlers } from './shellHandlers'
import { registerWindowHandlers } from './windowHandlers'

export { ShellChannels, WindowChannels } from '../../../shared/ipcChannels'
export type { ShellChannel, WindowChannel } from '../../../shared/ipcChannels'
export { registerShellHandlers } from './shellHandlers'
export { registerWindowHandlers } from './windowHandlers'

/**
 * 注册所有常用 IPC 处理器（shell + window）
 */
export function registerIpcHandlers(): void {
  registerShellHandlers()
  registerWindowHandlers()
}
