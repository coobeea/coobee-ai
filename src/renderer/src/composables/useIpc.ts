/**
 * IPC 通信 Composable
 *
 * 职责：
 * - 初始化 IPC 事件监听
 * - 注册前端 EventBus 到 preload
 * - 提供 IPC 相关的工具方法
 */
import eventBus from '@/utils/eventBus'

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
    console.warn('[useIpc] IPC events already initialized')
    return
  }

  // 监听 IPC 事件并转发到 EventBus
  window.api.onEvent((message) => {
    eventBus.emit(message.type, message.payload)
  })

  isInitialized = true
  console.log('[useIpc] IPC events initialized')
}

/**
 * IPC 通信 Composable
 *
 * @returns IPC 相关的方法
 */
export function useIpc() {
  /**
   * 获取平台信息
   */
  const getPlatform = (): string => {
    return window.api.getPlatform()
  }

  /**
   * 获取窗口信息
   */
  const getWindowInfo = async () => {
    return await window.api.getWindowInfo()
  }

  /**
   * Tab 操作
   */
  const tab = {
    create: window.api.tab.create,
    close: window.api.tab.close,
    switch: window.api.tab.switch,
    update: window.api.tab.update
  }

  return {
    getPlatform,
    getWindowInfo,
    tab
  }
}

/**
 * 默认导出
 */
export default useIpc
