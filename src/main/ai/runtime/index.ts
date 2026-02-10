/**
 * 统一运行时模块
 *
 * 对外暴露：
 * - AgentRuntime / TeamRuntime — 核心运行时
 * - RuntimeFactory — 工厂方法
 * - FileSession — 文件持久化 Session
 * - 所有类型定义
 */

// ========== 核心类型 ==========
export * from './types'

// ========== 运行时 ==========
export { AgentRuntime } from './AgentRuntime'
export {
  TeamRuntime,
  type TeamRuntimeOptions,
  type TeamMemberConfig,
  type OrchestrationType
} from './TeamRuntime'
export { RuntimeFactory, runtimeFactory, type RuntimeCreateOptions } from './RuntimeFactory'

// ========== Session ==========
export { FileSession } from './FileSession'
export { SessionCompressor } from './SessionCompressor'
export {
  countTokens,
  countItemTokens,
  countItemsTokens,
  isWithinLimit,
  formatTokens
} from './tokenCounter'

// ========== Swarm（re-export for convenience）==========
export { SwarmRuntime, type SwarmRuntimeOptions } from '../swarm/SwarmRuntime'
