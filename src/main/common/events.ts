/**
 * 事件定义
 * 从 @shared/events.d.ts 导出统一的事件定义
 */

// 导出所有事件枚举
export {
  AppEvents,
  WindowEvents,
  LifecycleEvents,
  DatabaseEvents,
  WorkspaceEvents,
  JobEvents,
  ThemeEvents,
  ConfigEvents,
  LogEvents,
  type AllEvents,
  type EventPayloads
} from '@shared/events'
