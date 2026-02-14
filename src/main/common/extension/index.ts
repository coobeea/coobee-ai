/**
 * Extension 系统统一导出
 */

export { ExtensionRegistry } from './ExtensionRegistry'
export { ExtensionHookRunner } from './ExtensionHookRunner'
export { ExtensionManager } from './ExtensionManager'
export { ExtensionLoader } from './ExtensionLoader'
export { createExtensionApi } from './ExtensionApi'

// 类型
export type {
  ExtensionManifest,
  ExtensionOrigin,
  ExtensionModule,
  ExtensionLogger,
  ExtensionApi,
  ExtensionHookName,
  ExtensionHookMode,
  ExtensionHookHandler,
  ExtensionHookEventMap,
  ExtensionHookResultMap,
  RegisteredExtensionHook,
  RegisteredExtensionTool,
  RegisteredExtensionMethod,
  RegisteredExtensionSkillDir,
  BeforeAgentStartEvent,
  BeforeAgentStartResult,
  BeforeToolCallEvent,
  BeforeToolCallResult,
  ToolResultPersistEvent,
  ToolResultPersistResult,
  AgentEndEvent,
  AfterToolCallEvent,
  MessageReceivedEvent,
  SessionEvent
} from './types'

export { EXTENSION_HOOK_MODE } from './types'
