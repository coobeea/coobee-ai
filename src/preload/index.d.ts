import { ElectronAPI } from '@electron-toolkit/preload';
import type {
  WindowInfoResponse,
  CreateTabRequest,
  CreateTabResponse,
  CloseTabRequest,
  SwitchTabRequest,
  UpdateTabRequest,
  IpcResult,
  IpcEventMessage
} from '@shared/ipc';

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      getPlatform: () => string;
      getWindowInfo: () => Promise<WindowInfoResponse | null>;
      tab: {
        create: (req: CreateTabRequest) => Promise<IpcResult<CreateTabResponse>>;
        close: (req: CloseTabRequest) => Promise<IpcResult<void>>;
        switch: (req: SwitchTabRequest) => Promise<IpcResult<void>>;
        update: (req: UpdateTabRequest) => Promise<IpcResult<void>>;
      };
      openDirectory: () => Promise<string | null>;
      openFile: (options?: {
        properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
        filters?: Array<{ name: string; extensions: string[] }>;
      }) => Promise<{ canceled: boolean; filePaths: string[] }>;
      getClipboardFiles: () => Promise<string[]>;
      isBackendReady: () => Promise<boolean>;
      onEvent: (callback: (message: IpcEventMessage) => void) => void;
    };
  }
}
