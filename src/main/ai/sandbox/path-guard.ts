/**
 * 沙箱路径守卫
 *
 * 提供统一的路径安全检查，确保所有文件操作都在允许的目录边界内。
 *
 * 设计：
 *   - 相对路径基于 workspaceRoot（或 sandboxRoot）解析
 *   - 绝对路径验证是否在边界内
 *   - 防止 ../../../etc/passwd 之类的路径穿越攻击
 *   - 不依赖具体工具实现，内置工具和扩展工具都可以使用
 */
import fs from 'node:fs'
import { resolve, relative, isAbsolute, dirname } from 'node:path'
import type { SandboxContext } from './types'

/** 路径解析结果 */
export type PathResolveResult =
  | { path: string; error?: undefined }
  | { path?: undefined; error: PathGuardError }

/** 路径守卫错误 */
export interface PathGuardError {
  code: 'SANDBOX_VIOLATION'
  message: string
  details: {
    filePath: string
    absolutePath: string
    boundary: string
  }
}

/**
 * 解析并验证文件路径
 *
 * 沙箱策略：
 *   - 写操作（默认）：严格限制在 workspace 目录内（防止误改系统文件）
 *   - 读操作（readOnly=true）：不限制目录边界，仅做路径解析
 *     Agent 需要读取 Skill 文件、配置文件等 workspace 外的资源，
 *     限制读取只会迫使 Agent 用 exec+cat 绕过，体验更差。
 *
 * @param filePath  - 原始路径（LLM 传入的）
 * @param context   - 沙箱上下文（包含 workspaceRoot / sandboxRoot）
 * @param options   - 可选配置
 * @param options.readOnly - 为 true 时跳过目录边界检查（读操作）
 * @returns 验证后的绝对路径，或错误信息
 */
export function resolveSandboxPath(
  filePath: string,
  context?: SandboxContext | { workspaceRoot: string; sandboxRoot?: string },
  options?: { readOnly?: boolean }
): PathResolveResult {
  // 没有 context 时降级为 process.cwd()（兼容测试场景）
  const root = context?.sandboxRoot || context?.workspaceRoot || process.cwd()

  // 解析路径
  let absolutePath: string
  if (isAbsolute(filePath)) {
    absolutePath = resolve(filePath)
  } else {
    absolutePath = resolve(root, filePath)
  }

  // 读操作 或 沙箱关闭（mode='off'）：直接返回，不检查边界
  if (options?.readOnly) {
    return { path: absolutePath }
  }

  // 检查沙箱是否关闭（mode='off' 时所有操作都不限制）
  if (context && 'mode' in context && context.mode === 'off') {
    return { path: absolutePath }
  }

  // === 以下为写操作的严格检查 ===

  // 1. 字符串级检查（resolve 后的路径）
  const rel = relative(root, absolutePath)
  const isOutside = rel.startsWith('..') || isAbsolute(rel)

  if (isOutside) {
    return {
      error: {
        code: 'SANDBOX_VIOLATION',
        message: `Path "${filePath}" is outside the allowed workspace (${root}). Write operations are restricted to the workspace directory.`,
        details: { filePath, absolutePath, boundary: root }
      }
    }
  }

  // 2. 符号链接穿越检查：realpath 解析后再次验证
  //    防止 workspace 内的 symlink 指向外部文件
  //    仅在目标路径或其某个祖先实际存在时才检查
  try {
    // 只有路径存在时才有实际的 symlink 穿越风险
    if (fs.existsSync(absolutePath)) {
      const realTarget = fs.realpathSync(absolutePath)
      const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : root
      const realRel = relative(realRoot, realTarget)
      const realOutside = realRel.startsWith('..') || isAbsolute(realRel)

      if (realOutside) {
        return {
          error: {
            code: 'SANDBOX_VIOLATION',
            message: `Path "${filePath}" resolves through a symlink to "${realTarget}" which is outside the workspace (${root}).`,
            details: { filePath, absolutePath: realTarget, boundary: root }
          }
        }
      }
    } else if (fs.existsSync(root)) {
      // 目标不存在但 root 存在 — 检查最近存在的祖先目录
      const realTarget = resolveNearestRealpath(absolutePath)
      const realRoot = fs.realpathSync(root)
      const realRel = relative(realRoot, realTarget)
      const realOutside = realRel.startsWith('..') || isAbsolute(realRel)

      if (realOutside) {
        return {
          error: {
            code: 'SANDBOX_VIOLATION',
            message: `Path "${filePath}" resolves through a symlink to "${realTarget}" which is outside the workspace (${root}).`,
            details: { filePath, absolutePath: realTarget, boundary: root }
          }
        }
      }
    }
    // 如果 root 本身不存在（测试用虚拟路径），跳过 realpath 检查
  } catch {
    // realpath 失败（broken symlink 等）— 允许通过，由后续 IO 操作处理错误
  }

  return { path: absolutePath }
}

/**
 * 将 PathGuardError 转换为工具可以直接 return 的 ToolResult 格式
 *
 * 工具的 execute 返回 ToolResult，而 resolveSandboxPath 返回 PathGuardError。
 * 此辅助函数做桥接转换。
 */
export function pathGuardErrorToToolResult(error: PathGuardError): {
  success: false
  llmContent: string
  error: { code: string; message: string; details?: unknown }
} {
  return {
    success: false,
    llmContent: `Error: ${error.message}`,
    error: {
      code: error.code,
      message: error.message,
      details: error.details
    }
  }
}

/**
 * 解析命令的工作目录
 *
 * exec 工具和 Docker exec 都需要确定执行目录。
 * Docker 模式下返回容器内工作目录，否则返回 workspaceRoot。
 *
 * @param context - 沙箱上下文
 * @returns 命令应该在哪个目录下执行
 */
export function resolveWorkingDirectory(
  context?: SandboxContext | { workspaceRoot: string }
): string {
  if (context && 'docker' in context && context.docker?.running) {
    return (context as SandboxContext).docker!.workdir
  }
  return context?.workspaceRoot || process.cwd()
}

/**
 * 向上查找最近存在的祖先目录并返回其 realpath + 剩余路径
 *
 * 用于文件不存在时（如即将创建），检查其父目录链是否有 symlink 穿越。
 *
 * @param targetPath - 不存在的目标路径
 * @returns 最近存在祖先的 realpath + 剩余子路径
 */
function resolveNearestRealpath(targetPath: string): string {
  let current = targetPath
  const trail: string[] = []

  while (!fs.existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) {
      // 到达根目录，无法继续
      return targetPath
    }
    trail.unshift(current.slice(parent.length + 1))
    current = parent
  }

  const realParent = fs.realpathSync(current)
  return trail.length > 0 ? resolve(realParent, ...trail) : realParent
}
