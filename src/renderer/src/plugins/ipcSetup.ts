import type { App } from 'vue'
import eventBus from '@/eventbus'
import { useLogStore } from '@/stores/log'

/**
 * 是否已初始化
 */
let isInitialized = false

/**
 * 初始化 IPC 事件系统
 *
 * 此方法应该在应用启动时调用一次
 */
export function initIpcEvents(): void {
  if (isInitialized) {
    console.warn('[ipcSetup] IPC events already initialized')
    return
  }

  // 监听 IPC 事件并转发到 EventBus
  if (window.api?.onEvent) {
    window.api.onEvent((message) => {
      // 转发到 EventBus（由 event_handles 统一记录业务日志）
      eventBus.emit(message.type, message.payload)
    })
  }

  isInitialized = true

  // 记录系统初始化
  const logStore = useLogStore()
  logStore.info('system', 'IPC 事件系统已初始化')
  console.log('[ipcSetup] IPC events initialized')
}

/**
 * IPC 事件系统安装插件
 */
export default {
  install(_app: App) {
    initIpcEvents()
  }
}
