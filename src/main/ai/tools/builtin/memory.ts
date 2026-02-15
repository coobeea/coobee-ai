/**
 * memory — 记忆管理工具
 *
 * 让 Agent 主动管理自己的记忆。
 * 记忆是持久化的 Markdown/JSON 文件，不随会话结束而清除。
 *
 * 记忆层级：
 *   - user:  用户级记忆（跨 Agent 共享，如偏好、长期经验）
 *   - agent: Agent 级记忆（按 Agent 隔离，如特定领域学习成果）
 *
 * 操作：
 *   - list:   列出可用记忆文件
 *   - get:    读取指定记忆文件内容
 *   - write:  写入/更新记忆文件
 *   - search: 搜索记忆内容（关键字匹配）
 *
 * 分类：Memory | 风险：低
 *
 * 后端演进路径：
 *   当前 → 文件系统（Markdown/JSON）
 *   计划 → memory/LongTermMemoryStore（SQLite + embedding + importance）
 *   文件系统后端作为 fallback 保留
 */

import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { ToolDefinition, ToolStreamUpdate, ToolResult } from '../types'
import { ToolCategory } from '../types'
import { log } from '@main/common/logger'

/** 支持的记忆文件扩展名 */
const MEMORY_EXTENSIONS = ['.md', '.json', '.txt', '.yaml', '.yml']

/** 最大文件大小（读取限制，100KB） */
const MAX_FILE_SIZE = 100_000

export const memoryTool: ToolDefinition = {
  name: 'memory',
  description:
    'Manage persistent memory files across sessions.\n' +
    'Actions:\n' +
    '- list: list memory files in user or agent scope\n' +
    '- get: read a memory file\n' +
    '- write: create or update a memory file (Markdown recommended)\n' +
    '- search: search memory files by keyword\n\n' +
    'Scopes: "user" (shared across agents), "agent" (agent-specific).\n' +
    'Memory persists across sessions. Write only valuable long-term knowledge.',
  category: ToolCategory.Memory,
  needUserConfirm: false,
  parameters: z.object({
    action: z.enum(['list', 'get', 'write', 'search']).describe('The action to perform'),
    scope: z
      .enum(['user', 'agent'])
      .optional()
      .describe('Memory scope. "user" = shared, "agent" = agent-specific. Defaults to "user"'),
    file: z
      .string()
      .optional()
      .describe('File name or relative path within memory scope (for get/write)'),
    content: z
      .string()
      .optional()
      .describe('Content to write (for write action, Markdown recommended)'),
    query: z.string().optional().describe('Search keyword (for search action, case-insensitive)')
  }),

  execute: async function* (
    params: Record<string, unknown>
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const action = params.action as string
    const scope = (params.scope as string) || 'user'
    const file = params.file as string | undefined
    const content = params.content as string | undefined
    const query = params.query as string | undefined

    // 解析记忆根目录
    let memoryRoot: string
    try {
      const { Env } = await import('@main/common/env')
      memoryRoot = scope === 'agent' ? Env.paths.agentMemoryDir : Env.paths.userMemoryDir
    } catch {
      return {
        success: false,
        llmContent: 'Error: Memory system not initialized',
        error: { code: 'NOT_INITIALIZED', message: 'Env not available' }
      }
    }

    // 确保目录存在
    fs.mkdirSync(memoryRoot, { recursive: true })

    // ==================== list ====================
    if (action === 'list') {
      yield { type: 'progress', content: `Listing ${scope} memory files...`, percentage: 0 }

      const files = listMemoryFiles(memoryRoot)

      if (files.length === 0) {
        return {
          success: true,
          llmContent: `No memory files found in ${scope} scope (${memoryRoot}).`
        }
      }

      const lines = files.map((f) => {
        const sizeKB = (f.size / 1024).toFixed(1)
        const modified = new Date(f.modifiedAt).toISOString().slice(0, 19)
        return `${f.relativePath}  (${sizeKB}KB, ${modified})`
      })

      return {
        success: true,
        llmContent: `Memory files (${scope}, ${files.length} files):\n\n` + lines.join('\n')
      }
    }

    // ==================== get ====================
    if (action === 'get') {
      if (!file) {
        return {
          success: false,
          llmContent: 'Error: file is required for get action',
          error: { code: 'MISSING_PARAM', message: 'file is required' }
        }
      }

      const filePath = resolveMemoryPath(memoryRoot, file)
      if (!filePath) {
        return {
          success: false,
          llmContent: `Error: invalid file path "${file}" — path escapes memory directory`,
          error: { code: 'INVALID_PATH', message: 'Path escapes memory directory' }
        }
      }

      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          llmContent: `Memory file not found: ${file} (in ${scope} scope)`,
          error: { code: 'NOT_FOUND', message: `File not found: ${file}` }
        }
      }

      const stat = fs.statSync(filePath)
      if (stat.size > MAX_FILE_SIZE) {
        return {
          success: false,
          llmContent: `Memory file too large: ${file} (${(stat.size / 1024).toFixed(1)}KB, max ${MAX_FILE_SIZE / 1024}KB)`,
          error: { code: 'TOO_LARGE', message: `File exceeds ${MAX_FILE_SIZE} bytes` }
        }
      }

      const fileContent = fs.readFileSync(filePath, 'utf-8')
      return {
        success: true,
        llmContent: `[${scope}/${file}]\n\n${fileContent}`
      }
    }

    // ==================== write ====================
    if (action === 'write') {
      if (!file) {
        return {
          success: false,
          llmContent: 'Error: file is required for write action',
          error: { code: 'MISSING_PARAM', message: 'file is required' }
        }
      }
      if (content === undefined || content === null) {
        return {
          success: false,
          llmContent: 'Error: content is required for write action',
          error: { code: 'MISSING_PARAM', message: 'content is required' }
        }
      }

      const filePath = resolveMemoryPath(memoryRoot, file)
      if (!filePath) {
        return {
          success: false,
          llmContent: `Error: invalid file path "${file}" — path escapes memory directory`,
          error: { code: 'INVALID_PATH', message: 'Path escapes memory directory' }
        }
      }

      yield { type: 'progress', content: `Writing to ${scope}/${file}...`, percentage: 50 }

      // 自动添加时间戳头部（如果是 Markdown 且没有 frontmatter）
      let finalContent = content
      if (file.endsWith('.md') && !content.startsWith('---')) {
        const now = new Date().toISOString()
        finalContent = `---\nupdated: ${now}\n---\n\n${content}`
      }

      // 确保父目录存在
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, finalContent, 'utf-8')

      const isNew = !fs.existsSync(filePath)
      log.info(`[memory] ${isNew ? 'Created' : 'Updated'}: ${scope}/${file}`)

      return {
        success: true,
        llmContent: `Memory file ${isNew ? 'created' : 'updated'}: ${scope}/${file} (${finalContent.length} bytes)`
      }
    }

    // ==================== search ====================
    if (action === 'search') {
      if (!query) {
        return {
          success: false,
          llmContent: 'Error: query is required for search action',
          error: { code: 'MISSING_PARAM', message: 'query is required' }
        }
      }

      yield {
        type: 'progress',
        content: `Searching ${scope} memory for "${query}"...`,
        percentage: 0
      }

      const files = listMemoryFiles(memoryRoot)
      const results: { file: string; matches: string[] }[] = []
      const queryLower = query.toLowerCase()

      for (const f of files) {
        const filePath = path.join(memoryRoot, f.relativePath)
        try {
          const fileContent = fs.readFileSync(filePath, 'utf-8')
          const lines = fileContent.split('\n')
          const matchingLines: string[] = []

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(queryLower)) {
              matchingLines.push(`  L${i + 1}: ${lines[i].trim()}`)
            }
          }

          if (matchingLines.length > 0) {
            results.push({
              file: f.relativePath,
              matches: matchingLines.slice(0, 5) // 每文件最多 5 行
            })
          }
        } catch {
          // 读取失败跳过
        }
      }

      if (results.length === 0) {
        return {
          success: true,
          llmContent: `No matches found for "${query}" in ${scope} memory.`
        }
      }

      const output = results.map((r) => `📄 ${r.file}:\n${r.matches.join('\n')}`).join('\n\n')

      return {
        success: true,
        llmContent: `Search results for "${query}" in ${scope} memory (${results.length} files):\n\n${output}`
      }
    }

    // ---- 未知 action ----
    return {
      success: false,
      llmContent: `Unknown action: "${action}". Valid actions: list, get, write, search`,
      error: { code: 'UNKNOWN_ACTION', message: `Unknown action: ${action}` }
    }
  }
}

// ==================== 工具函数 ====================

interface MemoryFileInfo {
  relativePath: string
  size: number
  modifiedAt: number
}

/** 递归列出目录下的记忆文件 */
function listMemoryFiles(dir: string, prefix = ''): MemoryFileInfo[] {
  const results: MemoryFileInfo[] = []

  if (!fs.existsSync(dir)) return results

  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      // 跳过隐藏目录
      if (entry.name.startsWith('.')) continue
      results.push(...listMemoryFiles(fullPath, relativePath))
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (MEMORY_EXTENSIONS.includes(ext)) {
        const stat = fs.statSync(fullPath)
        results.push({
          relativePath,
          size: stat.size,
          modifiedAt: stat.mtimeMs
        })
      }
    }
  }

  // 按修改时间倒序
  return results.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

/**
 * 解析记忆文件路径（防止路径穿越 + 符号链接穿越）
 *
 * 1. path.resolve 后检查是否在 memoryRoot 内
 * 2. 如果文件/目录存在，用 realpathSync 解析符号链接再次检查
 * 3. 如果文件不存在，检查最近存在的祖先目录
 */
function resolveMemoryPath(memoryRoot: string, file: string): string | null {
  const resolved = path.resolve(memoryRoot, file)

  // 1. 字符串级检查
  if (!resolved.startsWith(memoryRoot + path.sep) && resolved !== memoryRoot) {
    return null
  }

  // 2. 符号链接穿越检查
  try {
    let realTarget: string
    if (fs.existsSync(resolved)) {
      realTarget = fs.realpathSync(resolved)
    } else {
      // 文件不存在（write 创建场景），检查最近存在的父目录
      let current = path.dirname(resolved)
      while (!fs.existsSync(current) && current !== path.dirname(current)) {
        current = path.dirname(current)
      }
      realTarget = fs.existsSync(current) ? fs.realpathSync(current) : current
    }

    // 确保 realpath 结果仍在 memoryRoot 内
    const realMemoryRoot = fs.existsSync(memoryRoot) ? fs.realpathSync(memoryRoot) : memoryRoot
    if (!realTarget.startsWith(realMemoryRoot + path.sep) && realTarget !== realMemoryRoot) {
      log.warn(
        `[memory] Symlink traversal blocked: "${file}" → "${realTarget}" outside "${realMemoryRoot}"`
      )
      return null
    }
  } catch {
    // realpath 失败（broken symlink 等），阻止访问
    return null
  }

  return resolved
}
