import { ElectronAPI } from '@electron-toolkit/preload'
import type { WindowInfoResponse } from '@shared/ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getPlatform: () => string
      getWindowInfo: () => Promise<WindowInfoResponse | null>
    }
  }
}
