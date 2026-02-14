/**
 * edit — 文件编辑工具
 *
 * 在文件中查找并替换指定的文本片段。
 * 要求 oldText 在文件中**唯一匹配**，防止意外修改错误位置。
 *
 * 安全：路径受沙箱限制，不能编辑工作区之外的文件。
 *
 * 分类：FileSystem | 风险：中（修改文件系统）
 */
import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types'
import { ToolCategory } from '../types'
import { resolveSandboxPath, pathGuardErrorToToolResult } from '../../sandbox'

export const editTool: ToolDefinition = {
  name: 'edit',
  description:
    'Edit a file by replacing an exact text match. ' +
    'The oldText must appear EXACTLY ONCE in the file (including whitespace and indentation). ' +
    'Provide enough surrounding context in oldText to ensure a unique match. ' +
    'The newText will replace the matched oldText.',
  category: ToolCategory.FileSystem,
  needUserConfirm: true,
  parameters: z.object({
    path: z.string().describe('Absolute or relative file path to edit'),
    oldText: z.string().describe('The exact text to find (must match exactly once in the file)'),
    newText: z.string().describe('The replacement text')
  }),

  execute: async function* (
    params: Record<string, unknown>,
    signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const filePath = params.path as string
    const oldText = params.oldText as string
    const newText = params.newText as string
    const startTime = Date.now()

    // 参数校验
    if (typeof oldText !== 'string' || typeof newText !== 'string') {
      return {
        success: false,
        llmContent: 'Error: oldText and newText must be strings',
        error: { code: 'INVALID_PARAM', message: 'oldText and newText must be strings' }
      }
    }

    if (oldText === newText) {
      return {
        success: false,
        llmContent: 'Error: oldText and newText are identical, nothing to change',
        error: { code: 'IDENTICAL', message: 'oldText and newText are identical' }
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

    yield { type: 'progress', content: `Reading ${filePath}...`, percentage: 0 }

    try {
      const content = await readFile(absolutePath, 'utf-8')

      yield { type: 'progress', content: 'Searching for match...', percentage: 30 }

      // 检查匹配次数
      const occurrences = content.split(oldText).length - 1

      if (occurrences === 0) {
        const trimmedOld = oldText.trim()
        const loosyMatch = trimmedOld.length > 0 && content.includes(trimmedOld)
        const hint = loosyMatch
          ? ' (a trimmed version was found — check leading/trailing whitespace)'
          : ''
        return {
          success: false,
          llmContent: `Error: oldText not found in ${filePath}${hint}`,
          error: { code: 'NOT_FOUND', message: `oldText not found in ${filePath}${hint}` }
        }
      }

      if (occurrences > 1) {
        return {
          success: false,
          llmContent:
            `Error: oldText matches ${occurrences} times in ${filePath}. ` +
            `Include more surrounding context to make it unique.`,
          error: {
            code: 'MULTIPLE_MATCHES',
            message: `oldText matches ${occurrences} times`,
            details: { occurrences }
          }
        }
      }

      yield { type: 'progress', content: 'Applying edit...', percentage: 60 }

      // 精确替换一次
      const newContent = content.replace(oldText, newText)
      await writeFile(absolutePath, newContent, 'utf-8')

      // 变更统计
      const oldLines = oldText.split('\n').length
      const newLines = newText.split('\n').length
      const lineDiff = newLines - oldLines
      const duration = Date.now() - startTime

      let stat = `Replaced ${oldLines} line(s) with ${newLines} line(s)`
      if (lineDiff > 0) stat += ` (+${lineDiff})`
      else if (lineDiff < 0) stat += ` (${lineDiff})`

      const summary = `${stat} in ${filePath}`

      yield { type: 'output', content: summary }

      return {
        success: true,
        llmContent: summary,
        userContent: summary,
        metadata: { startTime, endTime: Date.now(), duration, oldLines, newLines, lineDiff }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      const duration = Date.now() - startTime

      if (msg.includes('ENOENT')) {
        return {
          success: false,
          llmContent: `Error: File not found: ${filePath}`,
          error: { code: 'ENOENT', message: `File not found: ${filePath}` },
          metadata: { startTime, endTime: Date.now(), duration }
        }
      }
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
        llmContent: `Error editing file: ${msg}`,
        error: { code: 'EDIT_ERROR', message: msg },
        metadata: { startTime, endTime: Date.now(), duration }
      }
    }
  }
}
