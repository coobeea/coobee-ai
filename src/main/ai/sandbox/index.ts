/**
 * 沙箱系统统一导出
 *
 * 三层防护：
 *   1. path-guard  — 路径守卫（文件操作边界）
 *   2. tool-policy — 工具策略（allow/deny 过滤）
 *   3. docker      — Docker 容器隔离（可选）
 */

// 类型
export type {
  SandboxMode,
  SandboxConfig,
  SandboxContext,
  SandboxToolPolicy,
  SandboxDockerConfig,
  SandboxDockerInfo,
  ResolvedToolPolicy
} from './types'
export { DEFAULT_DOCKER_CONFIG, DEFAULT_SANDBOX_CONFIG } from './types'

// 路径守卫
export type { PathResolveResult, PathGuardError } from './path-guard'
export {
  resolveSandboxPath,
  resolveWorkingDirectory,
  pathGuardErrorToToolResult
} from './path-guard'

// 工具策略
export { isToolAllowed, resolveToolPolicy, formatToolBlockedMessage } from './tool-policy'

// Docker 容器管理
export {
  isDockerAvailable,
  getContainerState,
  ensureContainer,
  execInContainer,
  stopContainer,
  removeContainer,
  listContainers,
  removeAllContainers
} from './docker'

// 上下文构建
export { resolveSandboxContext, createPathOnlyContext } from './context'
