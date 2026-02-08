/**
 * 统一运行时模块
 * 为 Agent 和 Team 提供一致的对外接口
 */

export * from './types'
export { AgentRuntime } from './AgentRuntime'
export { TeamRuntime } from './TeamRuntime'
export {
  RuntimeFactory,
  runtimeFactory,
  type RuntimeType,
  type RuntimeCreateOptions
} from './RuntimeFactory'
