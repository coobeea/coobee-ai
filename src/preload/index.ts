import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { ShellChannels } from '@shared/ipc'
import type { WindowInfoResponse } from '@shared/ipc'

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
    ipcRenderer.invoke(ShellChannels.GET_WINDOW_INFO)
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
