/**
 * read — 文件读取工具
 *
 * 读取指定路径的文件内容，支持 offset/limit 分页读取大文件。
 * 返回带行号的文本，便于 LLM 引用具体行。
 *
 * 安全：只读操作，不限制读取路径。Agent 需要读取 Skill 文件、
 * 配置文件等 workspace 外的资源，限制读取只会导致体验下降。
 *
 * 分类：FileSystem | 风险：低（只读操作）
 */
import { readFile, stat } from 'node:fs/promises'
import { z } from 'zod'
import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types'
import { ToolCategory } from '../types'
import { resolveToolPath, formatFileError, checkAborted } from '../pipeline'

/** 默认最大读取行数（防止超大文件打爆 token） */
const DEFAULT_MAX_LINES = 2000

export const readTool: ToolDefinition = {
  name: 'read',
  description:
    'Read the contents of a file. ' +
    'Returns lines with line numbers (e.g. "  1|content"). ' +
    'Use offset and limit to read specific ranges of large files.',
  category: ToolCategory.FileSystem,
  needUserConfirm: false,
  parameters: z.object({
    path: z.string().describe('Absolute or relative file path to read'),
    offset: z.number().optional().describe('Starting line number (1-based). Defaults to 1'),
    limit: z
      .number()
      .optional()
      .describe(`Maximum number of lines to return. Defaults to ${DEFAULT_MAX_LINES}`)
  }),

  execute: async function* (
    params: Record<string, unknown>,
    signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const filePath = params.path as string
    const offset = Math.max(1, (params.offset as number) || 1)
    const limit = Math.min((params.limit as number) || DEFAULT_MAX_LINES, DEFAULT_MAX_LINES)
    const startTime = Date.now()

    // 统一路径解析（读操作不限制目录边界）
    const resolved = resolveToolPath(filePath, context, { readOnly: true })
    if (!resolved.ok) return resolved.error

    const absolutePath = resolved.absolutePath

    // 取消信号检查
    const aborted = checkAborted(signal)
    if (aborted) return aborted

    yield { type: 'progress', content: `Reading ${filePath}...`, percentage: 0 }

    try {
      const fileStat = await stat(absolutePath)
      if (!fileStat.isFile()) {
        return {
          success: false,
          llmContent: `Error: ${filePath} is not a file`,
          error: { code: 'NOT_FILE', message: `${filePath} is not a file` }
        }
      }

      yield { type: 'progress', content: 'Reading content...', percentage: 30 }

      const content = await readFile(absolutePath, 'utf-8')
      const allLines = content.split('\n')
      const totalLines = allLines.length

      yield { type: 'progress', content: 'Formatting output...', percentage: 70 }

      // 分页截取
      const startIdx = offset - 1
      const endIdx = Math.min(startIdx + limit, totalLines)
      const selectedLines = allLines.slice(startIdx, endIdx)

      // 添加行号（右对齐，宽度自适应）
      const lineNumWidth = String(endIdx).length
      const numberedLines = selectedLines.map((line, i) => {
        const lineNum = String(startIdx + i + 1).padStart(lineNumWidth, ' ')
        return `${lineNum}|${line}`
      })

      let result = numberedLines.join('\n')

      if (startIdx > 0) {
        result = `... ${startIdx} lines not shown ...\n` + result
      }
      if (endIdx < totalLines) {
        result = result + `\n... ${totalLines - endIdx} lines not shown ...`
      }

      const duration = Date.now() - startTime

      yield {
        type: 'output',
        content: `Read ${selectedLines.length} lines from ${filePath} (${totalLines} total)`
      }

      return {
        success: true,
        llmContent: result,
        userContent: result,
        metadata: {
          startTime,
          endTime: Date.now(),
          duration,
          totalLines,
          readLines: selectedLines.length
        }
      }
    } catch (error: unknown) {
      return formatFileError(error, filePath, 'reading', startTime)
    }
  }
}
