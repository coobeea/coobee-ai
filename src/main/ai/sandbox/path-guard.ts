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
import { resolve, relative, isAbsolute } from 'node:path'
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
 * @param filePath - 原始路径（LLM 传入的）
 * @param context  - 沙箱上下文（包含 workspaceRoot / sandboxRoot）
 * @returns 验证后的绝对路径，或错误信息
 *
 * @example
 * const result = resolveSandboxPath('src/index.ts', sandboxContext)
 * if (result.error) {
 *   // 路径越界
 * } else {
 *   // result.path 是安全的绝对路径
 * }
 */
export function resolveSandboxPath(
  filePath: string,
  context?: SandboxContext | { workspaceRoot: string; sandboxRoot?: string }
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

  // 计算相对路径，检查是否越界
  const rel = relative(root, absolutePath)
  const isOutside = rel.startsWith('..') || isAbsolute(rel)

  if (isOutside) {
    return {
      error: {
        code: 'SANDBOX_VIOLATION',
        message: `Path "${filePath}" is outside the allowed workspace (${root}). File operations are restricted to the workspace directory.`,
        details: { filePath, absolutePath, boundary: root }
      }
    }
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
