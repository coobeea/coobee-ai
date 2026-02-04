/**
 * IPC 通道常量：从 shared  re-export，供主进程 ipc 模块使用
 */
export {
  ShellChannels,
  WindowChannels,
  type ShellChannel,
  type WindowChannel
} from '@shared/ipcChannels'
