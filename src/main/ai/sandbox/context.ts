/**
 * 沙箱上下文构建器
 *
 * 根据 SandboxConfig 构建运行时 SandboxContext。
 * 这是沙箱系统的"总调度器"：
 *   1. 解析配置 → 确定沙箱模式
 *   2. mode=docker → 确保容器存在并运行
 *   3. 解析工具策略
 *   4. 返回 SandboxContext 供工具和 Runtime 使用
 */
import type { SandboxConfig, SandboxContext, SandboxDockerInfo } from './types'
import { resolveToolPolicy } from './tool-policy'
import { isDockerAvailable, ensureContainer } from './docker'
import { createLogger } from '@main/common/logger'

const log = createLogger('sandbox')

/**
 * 构建沙箱运行时上下文
 *
 * @param config    - 沙箱配置
 * @param sessionId - 会话 ID（用于 Docker 容器命名）
 * @returns 沙箱上下文（mode='off' 时也返回，但不启用保护）
 *
 * @example
 * const context = await resolveSandboxContext({
 *   mode: 'path-only',
 *   workspaceRoot: '/home/user/project',
 *   toolPolicy: { deny: ['exec'] }
 * }, 'session-123')
 */
export async function resolveSandboxContext(
  config: SandboxConfig,
  sessionId?: string
): Promise<SandboxContext> {
  const toolPolicy = resolveToolPolicy(config.toolPolicy)

  // off 模式：返回最小上下文
  if (config.mode === 'off') {
    return {
      mode: 'off',
      workspaceRoot: config.workspaceRoot,
      sandboxRoot: config.sandboxRoot,
      toolPolicy,
      sessionId
    }
  }

  // path-only 模式：路径守卫 + 工具策略，无 Docker
  if (config.mode === 'path-only') {
    return {
      mode: 'path-only',
      workspaceRoot: config.workspaceRoot,
      sandboxRoot: config.sandboxRoot,
      toolPolicy,
      sessionId
    }
  }

  // docker 模式：路径守卫 + 工具策略 + Docker 容器
  let docker: SandboxDockerInfo | undefined

  if (config.mode === 'docker') {
    const dockerAvailable = await isDockerAvailable()
    if (!dockerAvailable) {
      // Docker 不可用时降级为 path-only
      log.warn(
        '[Sandbox] Docker not available, falling back to path-only mode. ' +
          'Install Docker or switch to mode: "path-only".'
      )
      return {
        mode: 'path-only',
        workspaceRoot: config.workspaceRoot,
        sandboxRoot: config.sandboxRoot,
        toolPolicy,
        sessionId
      }
    }

    try {
      docker = await ensureContainer({
        sessionId: sessionId || `default-${Date.now()}`,
        workspaceDir: config.workspaceRoot,
        config: config.docker
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.warn(`[Sandbox] Docker container creation failed, falling back to path-only: ${msg}`)
      return {
        mode: 'path-only',
        workspaceRoot: config.workspaceRoot,
        sandboxRoot: config.sandboxRoot,
        toolPolicy,
        sessionId
      }
    }
  }

  return {
    mode: 'docker',
    workspaceRoot: config.workspaceRoot,
    sandboxRoot: config.sandboxRoot,
    toolPolicy,
    docker,
    sessionId
  }
}

/**
 * 创建一个简单的 path-only 沙箱上下文
 *
 * 快捷方法，不需要完整配置。
 * 常用于测试或不需要 Docker 的场景。
 */
export function createPathOnlyContext(
  workspaceRoot: string,
  options?: {
    sandboxRoot?: string
    toolPolicy?: { allow?: string[]; deny?: string[] }
    sessionId?: string
  }
): SandboxContext {
  return {
    mode: 'path-only',
    workspaceRoot,
    sandboxRoot: options?.sandboxRoot,
    toolPolicy: resolveToolPolicy(options?.toolPolicy),
    sessionId: options?.sessionId
  }
}
