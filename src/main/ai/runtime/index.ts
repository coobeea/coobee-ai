/**
 * 统一运行时模块
 * 为 Agent、Team 和 Swarm 提供一致的对外接口
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

// Re-export SwarmRuntime for convenience
export { SwarmRuntime, type SwarmRuntimeOptions } from '../swarm/SwarmRuntime'
