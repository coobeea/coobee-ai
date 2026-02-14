/**
 * write — 文件写入工具
 *
 * 将内容写入指定路径的文件。如果文件不存在则创建（含中间目录）。
 * 如果文件已存在则完全覆盖。
 *
 * 安全：路径受沙箱限制，不能写入工作区之外的文件。
 *
 * 分类：FileSystem | 风险：中（修改文件系统）
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types'
import { ToolKind } from '../types'
import { resolveSandboxPath, pathGuardErrorToToolResult } from '../../sandbox'

export const writeTool: ToolDefinition = {
  name: 'write',
  description:
    'Write content to a file. Creates the file (and parent directories) if it does not exist. ' +
    'Overwrites the file completely if it already exists. ' +
    'Always provide the COMPLETE file content — do not use placeholders or omit sections.',
  kind: ToolKind.FileSystem,
  needUserConfirm: true,
  parameters: z.object({
    path: z.string().describe('Absolute or relative file path to write'),
    content: z.string().describe('The full content to write to the file')
  }),

  execute: async function* (
    params: Record<string, unknown>,
    signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const filePath = params.path as string
    const content = params.content as string
    const startTime = Date.now()

    if (typeof content !== 'string') {
      return {
        success: false,
        llmContent: 'Error: content must be a string',
        error: { code: 'INVALID_PARAM', message: 'content must be a string' }
      }
    }

    // 沙箱路径检查
    const resolved = resolveSandboxPath(filePath, context)
    if (resolved.error) return pathGuardErrorToToolResult(resolved.error)

    const absolutePath = resolved.path

    if (signal?.aborted) {
      return {
        success: false,
        error: { code: 'ABORTED', message: 'Operation cancelled' }
      }
    }

    yield { type: 'progress', content: `Writing to ${filePath}...`, percentage: 0 }

    try {
      // 确保父目录存在
      await mkdir(dirname(absolutePath), { recursive: true })

      yield { type: 'progress', content: 'Writing content...', percentage: 50 }

      await writeFile(absolutePath, content, 'utf-8')

      const lineCount = content.split('\n').length
      const byteSize = Buffer.byteLength(content, 'utf-8')
      const duration = Date.now() - startTime

      const summary = `Successfully wrote ${byteSize} bytes (${lineCount} lines) to ${filePath}`

      yield { type: 'output', content: summary }

      return {
        success: true,
        llmContent: summary,
        userContent: summary,
        metadata: { startTime, endTime: Date.now(), duration, byteSize, lineCount }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      const duration = Date.now() - startTime

      if (msg.includes('EACCES')) {
        return {
          success: false,
          llmContent: `Error: Permission denied: ${filePath}`,
          error: { code: 'EACCES', message: `Permission denied: ${filePath}` },
          metadata: { startTime, endTime: Date.now(), duration }
        }
      }
      return {
        success: false,
        llmContent: `Error writing file: ${msg}`,
        error: { code: 'WRITE_ERROR', message: msg },
        metadata: { startTime, endTime: Date.now(), duration }
      }
    }
  }
}
