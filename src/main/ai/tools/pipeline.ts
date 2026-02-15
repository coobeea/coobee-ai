/**
 * 工具管线 — 消除工具样板代码
 *
 * 提供统一的路径解析、错误格式化和取消信号检查。
 * 所有文件系统相关工具应使用这些工具函数，而非直接调用 sandbox 模块。
 *
 * 设计原则：
 *   - 提供辅助函数而非包装整个 execute — 保持工具独立性
 *   - 路径参数统一命名 `path`（归一化 file_path → path）
 *   - 错误格式始终返回 ToolResult（不抛异常）
 *
 * @module tools/pipeline
 */

import { resolveSandboxPath, pathGuardErrorToToolResult } from '../sandbox'
import type { ToolResult, ToolExecutionContext } from './types'

// ==================== 路径解析 ====================

/**
 * 解析路径结果
 */
export type ResolvePathResult =
  | { ok: true; absolutePath: string }
  | { ok: false; error: ToolResult }

/**
 * 统一工具路径解析
 *
 * 替代各工具中重复的：
 *   const resolved = resolveSandboxPath(filePath, context)
 *   if (resolved.error) return pathGuardErrorToToolResult(resolved.error)
 *   const absolutePath = resolved.path
 *
 * @example
 * const resolved = resolveToolPath(params.path as string, context)
 * if (!resolved.ok) return resolved.error
 * const absolutePath = resolved.absolutePath
 */
export function resolveToolPath(
  filePath: string,
  context?: ToolExecutionContext
): ResolvePathResult {
  const resolved = resolveSandboxPath(filePath, context)
  if (resolved.error) {
    return { ok: false, error: pathGuardErrorToToolResult(resolved.error) }
  }
  return { ok: true, absolutePath: resolved.path }
}

// ==================== 参数归一化 ====================

/**
 * 归一化工具路径参数名
 *
 * 不同 LLM provider 可能传入不同的参数名：
 *   - Claude: file_path, file, filepath
 *   - GPT: path
 *
 * 统一提取为 `path`。
 */
export function normalizePathParam(params: Record<string, unknown>): string | undefined {
  return (params.path ?? params.file_path ?? params.file ?? params.filepath) as string | undefined
}

// ==================== 错误格式化 ====================

/**
 * 将文件操作异常格式化为统一 ToolResult
 *
 * 替代各工具中重复的 ENOENT / EACCES / generic 错误判断。
 */
export function formatFileError(
  error: unknown,
  filePath: string,
  operation: string,
  startTime?: number
): ToolResult {
  const msg = error instanceof Error ? error.message : String(error)
  const now = Date.now()
  const metadata = startTime ? { startTime, endTime: now, duration: now - startTime } : undefined

  if (msg.includes('ENOENT')) {
    return {
      success: false,
      llmContent: `Error: File not found: ${filePath}`,
      error: { code: 'ENOENT', message: `File not found: ${filePath}` },
      metadata
    }
  }
  if (msg.includes('EACCES')) {
    return {
      success: false,
      llmContent: `Error: Permission denied: ${filePath}`,
      error: { code: 'EACCES', message: `Permission denied: ${filePath}` },
      metadata
    }
  }
  if (msg.includes('EISDIR')) {
    return {
      success: false,
      llmContent: `Error: Path is a directory: ${filePath}`,
      error: { code: 'EISDIR', message: `Path is a directory: ${filePath}` },
      metadata
    }
  }

  // 生成简洁错误码：reading → READ, writing → WRITE, editing → EDIT
  const OPERATION_CODES: Record<string, string> = {
    reading: 'READ',
    writing: 'WRITE',
    editing: 'EDIT'
  }
  const code = OPERATION_CODES[operation] || operation.toUpperCase()
  return {
    success: false,
    llmContent: `Error ${operation} file: ${msg}`,
    error: { code: `${code}_ERROR`, message: msg },
    metadata
  }
}

// ==================== 取消信号检查 ====================

/**
 * 检查 AbortSignal，返回标准化的取消结果
 *
 * @returns null 表示未取消，ToolResult 表示已取消
 */
export function checkAborted(signal?: AbortSignal): ToolResult | null {
  if (!signal?.aborted) return null
  return {
    success: false,
    error: { code: 'ABORTED', message: 'Operation cancelled' }
  }
}
