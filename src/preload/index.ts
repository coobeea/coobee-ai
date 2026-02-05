import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { ShellChannels, TabChannels } from '@shared/ipc'
import type {
  WindowInfoResponse,
  CreateTabRequest,
  CreateTabResponse,
  CloseTabRequest,
  SwitchTabRequest,
  UpdateTabRequest,
  IpcResult
} from '@shared/ipc'

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
