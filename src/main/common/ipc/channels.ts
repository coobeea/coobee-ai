/**
 * IPC 通道常量：从 shared/ipc re-export，供主进程 ipc 模块使用
 */
export {
  ShellChannels,
  WindowChannels,
  TabChannels,
  EventChannels,
  type ShellChannel,
  type WindowChannel,
  type TabChannel,
  type EventChannel
} from '@shared/ipc'
