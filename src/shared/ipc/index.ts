/**
 * IPC 统一导出
 *
 * 集中管理所有 IPC 相关的类型、通道常量和工具函数
 */

// ==================== 通道常量 ====================
export { IPC_EVENT_CHANNEL, ShellChannels, WindowChannels, TabChannels, AppChannels, EventChannels } from './channels';

export type { ShellChannel, WindowChannel, TabChannel, AppChannel, EventChannel } from './channels';

// ==================== 事件类型 ====================
export type { EventType, EventPayloads, EventHandler, GenericEventHandler, IpcEventMessage } from './events';

export { EventTypes } from './events';

// ==================== 类型定义 ====================
export type {
  // 通用类型
  IpcResult,
  WindowType,
  TabType,

  // Shell 相关
  WindowInfoResponse,
  TabInfoResponse,

  // Window 控制相关
  WindowControlRequest,
  MinimizeWindowRequest,
  MaximizeWindowRequest,
  CloseWindowRequest,

  // Tab 操作相关
  CreateTabRequest,
  CreateTabResponse,
  CloseTabRequest,
  SwitchTabRequest,
  UpdateTabRequest,

  // 事件相关
  TabsUpdatedEvent,
  TabActivatedEvent,
  TabClosedEvent
} from './types';
