import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { ShellChannels, TabChannels, IPC_EVENT_CHANNEL } from '@shared/ipc'
import type {
  WindowInfoResponse,
  CreateTabRequest,
  CreateTabResponse,
  CloseTabRequest,
  SwitchTabRequest,
  UpdateTabRequest,
  IpcResult,
  IpcEventMessage
} from '@shared/ipc'

// 前端 EventBus 引用（由前端在初始化时注入）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let frontendEventBus: any = null

// 监听统一的 IPC 事件通道，转发到前端 EventBus
ipcRenderer.on(IPC_EVENT_CHANNEL, (_, message: IpcEventMessage) => {
  if (frontendEventBus) {
    // 转发到前端 EventBus
    frontendEventBus.emit(message.type, message.payload)
  } else {
    console.warn('[Preload] EventBus not registered, event ignored:', message.type)
  }
})

// Custom APIs for renderer
const api = {
  /**
   * 获取平台信息
   */
  getPlatform: (): string => process.platform,

  /**
   * 获取当前窗口完整信息（windowId、tabs、currentTabId 等）
   */
  getWindowInfo: (): Promise<WindowInfoResponse | null> =>
    ipcRenderer.invoke(ShellChannels.GET_WINDOW_INFO),

  /**
   * Tab 操作
   */
  tab: {
    create: (req: CreateTabRequest): Promise<IpcResult<CreateTabResponse>> =>
      ipcRenderer.invoke(TabChannels.CREATE, req),
    close: (req: CloseTabRequest): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(TabChannels.CLOSE, req),
    switch: (req: SwitchTabRequest): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(TabChannels.SWITCH, req),
    update: (req: UpdateTabRequest): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(TabChannels.UPDATE, req)
  },

  /**
   * 注册前端 EventBus
   * 前端在初始化时调用此方法，将 EventBus 实例注入到 Preload
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerEventBus: (bus: any): void => {
    frontendEventBus = bus
    console.log('[Preload] EventBus registered successfully')
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).electron = electronAPI
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = api
}
