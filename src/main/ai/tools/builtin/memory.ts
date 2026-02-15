/**
 * memory — 记忆管理工具
 *
 * 让 Agent 主动管理自己的记忆。
 * 记忆是持久化的 Markdown 文件，不随会话结束而清除。
 *
 * 存储结构（参考 OpenClaw memory-core）：
 *   Agent 工作空间：
 *     {workspace}/MEMORY.md          — 主记忆文件（核心知识、偏好、经验）
 *     {workspace}/memory/*.md        — 分类记忆（preferences.md, lessons.md, 日期.md 等）
 *   全局共享：
 *     {userHome}/memory/MEMORY.md    — 全局主记忆
 *     {userHome}/memory/*.md         — 全局分类记忆
 *
 * 操作：
 *   - list:   列出可用记忆文件
 *   - get:    读取指定记忆文件内容
 *   - write:  写入/更新记忆文件（支持追加模式）
 *   - search: 搜索记忆内容（多关键字、评分、片段提取）
 *
 * 分类：Memory | 风险：低
 *
 * 设计原则：文件即记忆。Agent 可直接用 write 工具操作 MEMORY.md，
 * 也可通过 memory 工具的结构化接口操作。
 *
 * @module tools/builtin/memory
 */

import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { ToolDefinition, ToolStreamUpdate, ToolResult, ToolExecutionContext } from '../types'
import { ToolCategory } from '../types'
import { log } from '@main/common/logger'
import { updateIndexEntry } from './memory-index'

/** 支持的记忆文件扩展名 */
const MEMORY_EXTENSIONS = ['.md', '.json', '.txt', '.yaml', '.yml']

/** 最大文件大小（读取限制，100KB） */
const MAX_FILE_SIZE = 100_000

/** 搜索时每个文件最大片段数 */
const MAX_SNIPPETS_PER_FILE = 5

/** 搜索时片段上下文行数（匹配行前后各 N 行） */
const SNIPPET_CONTEXT_LINES = 2

/** 搜索默认最大结果数 */
const DEFAULT_MAX_RESULTS = 10

/** 搜索默认最低分数 */
const DEFAULT_MIN_SCORE = 0.1

// ==================== 工具定义 ====================

export const memoryTool: ToolDefinition = {
  name: 'memory',
  description:
    'Manage persistent memory files across sessions.\n\n' +
    'Actions:\n' +
    '- list: list memory files (MEMORY.md + memory/*.md)\n' +
    '- get: read a memory file\n' +
    '- write: create/update a memory file (Markdown recommended)\n' +
    '- search: search memory by keywords (multi-keyword, ranked results)\n\n' +
    'Scopes:\n' +
    '- "agent" (default): workspace-specific memory ({workspace}/MEMORY.md + memory/)\n' +
    '- "user": global shared memory ({userHome}/memory/)\n\n' +
    'MEMORY.md is the primary memory file — use it for core knowledge, preferences, and key lessons.\n' +
    'memory/ directory holds categorized files (preferences.md, lessons.md, dates, etc.).\n' +
    'Memory persists across sessions. Write only valuable long-term knowledge.',
  category: ToolCategory.Memory,
  needUserConfirm: false,
  parameters: z.object({
    action: z.enum(['list', 'get', 'write', 'search']).describe('The action to perform'),
    scope: z
      .enum(['user', 'agent'])
      .optional()
      .describe('Memory scope. "agent" (default) = workspace-specific, "user" = global shared.'),
    file: z
      .string()
      .optional()
      .describe(
        'File name or path. Use "MEMORY.md" for the primary memory file, ' +
          'or "memory/xxx.md" for categorized files. For get/write actions.'
      ),
    content: z
      .string()
      .optional()
      .describe('Content to write (for write action, Markdown recommended)'),
    append: z
      .boolean()
      .optional()
      .describe('If true, append content instead of overwriting (for write action)'),
    query: z
      .string()
      .optional()
      .describe(
        'Search query — supports multiple keywords separated by spaces (for search action)'
      ),
    maxResults: z.number().optional().describe('Maximum search results to return (default 10)')
  }),

  execute: async function* (
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const action = params.action as string
    const scope = (params.scope as string) || 'agent'
    const file = params.file as string | undefined
    const content = params.content as string | undefined
    const append = params.append as boolean | undefined
    const query = params.query as string | undefined
    const maxResults = (params.maxResults as number) || DEFAULT_MAX_RESULTS

    // 解析记忆根目录
    const roots = await resolveMemoryRoots(scope, context?.workspaceRoot)
    if (!roots) {
      return {
        success: false,
        llmContent: 'Error: Memory system not initialized (workspace or Env not available)',
        error: { code: 'NOT_INITIALIZED', message: 'Cannot resolve memory paths' }
      }
    }

    // ==================== list ====================
    if (action === 'list') {
      yield { type: 'progress', content: `Listing ${scope} memory files...`, percentage: 0 }

      const files = collectMemoryFiles(roots)

      if (files.length === 0) {
        return {
          success: true,
          llmContent:
            `No memory files found in ${scope} scope.\n\n` +
            `Tip: Create ${scope === 'agent' ? 'MEMORY.md in your workspace' : 'memory/MEMORY.md in user home'} to start building memory.`
        }
      }

      const lines = files.map((f) => {
        const sizeKB = (f.size / 1024).toFixed(1)
        const modified = new Date(f.modifiedAt).toISOString().slice(0, 19)
        const primary = f.isPrimary ? ' ★' : ''
        return `${f.displayPath}  (${sizeKB}KB, ${modified})${primary}`
      })

      return {
        success: true,
        llmContent:
          `Memory files (${scope}, ${files.length} files):\n` +
          `★ = primary memory file (MEMORY.md)\n\n` +
          lines.join('\n')
      }
    }

    // ==================== get ====================
    if (action === 'get') {
      if (!file) {
        return {
          success: false,
          llmContent:
            'Error: file is required for get action.\n' +
            'Use "MEMORY.md" for the primary memory file, or "memory/xxx.md" for categorized files.',
          error: { code: 'MISSING_PARAM', message: 'file is required' }
        }
      }

      const filePath = resolveFileInRoots(roots, file)
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
          llmContent:
            'Error: file is required for write action.\n' +
            'Use "MEMORY.md" for primary memory, or "memory/xxx.md" for categorized files.',
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

      const filePath = resolveFileInRoots(roots, file, true)
      if (!filePath) {
        return {
          success: false,
          llmContent: `Error: invalid file path "${file}" — path escapes memory directory`,
          error: { code: 'INVALID_PATH', message: 'Path escapes memory directory' }
        }
      }

      yield { type: 'progress', content: `Writing to ${scope}/${file}...`, percentage: 50 }

      const exists = fs.existsSync(filePath)

      if (append && exists) {
        // 追加模式
        const existing = fs.readFileSync(filePath, 'utf-8')
        const separator = existing.endsWith('\n') ? '\n' : '\n\n'
        fs.writeFileSync(filePath, existing + separator + content, 'utf-8')
        log.info(`[memory] Appended: ${scope}/${file}`)
        // 更新记忆索引
        tryUpdateIndex(roots.memorySubDir, file, filePath)
        return {
          success: true,
          llmContent: `Memory file appended: ${scope}/${file}`
        }
      }

      // 覆盖/创建模式
      let finalContent = content
      if (file.endsWith('.md') && !content.startsWith('---') && file !== 'MEMORY.md') {
        const now = new Date().toISOString()
        finalContent = `---\nupdated: ${now}\n---\n\n${content}`
      }

      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, finalContent, 'utf-8')

      log.info(`[memory] ${exists ? 'Updated' : 'Created'}: ${scope}/${file}`)
      // 更新记忆索引
      tryUpdateIndex(roots.memorySubDir, file, filePath)

      return {
        success: true,
        llmContent: `Memory file ${exists ? 'updated' : 'created'}: ${scope}/${file} (${finalContent.length} bytes)`
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

      const results = searchMemoryFiles(roots, query, {
        maxResults,
        minScore: DEFAULT_MIN_SCORE
      })

      if (results.length === 0) {
        return {
          success: true,
          llmContent: `No matches found for "${query}" in ${scope} memory.`
        }
      }

      const output = results
        .map((r) => {
          const scoreStr = (r.score * 100).toFixed(0)
          const sectionStr = r.section ? ` (§ ${r.section})` : ''
          return `📄 ${r.file}${sectionStr} [relevance: ${scoreStr}%]\n${r.snippet}`
        })
        .join('\n\n')

      return {
        success: true,
        llmContent: `Search results for "${query}" in ${scope} memory (${results.length} matches):\n\n${output}`
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

// ==================== 路径解析 ====================

/** 记忆根目录信息 */
interface MemoryRoots {
  /** 主目录（MEMORY.md 所在目录） */
  primaryDir: string
  /** memory/ 子目录 */
  memorySubDir: string
}

/**
 * 解析记忆根目录
 *
 * agent scope:
 *   - 有 workspaceRoot → workspace 根目录（MEMORY.md + memory/）
 *   - 无 workspaceRoot → fallback 到 Env.paths.agentMemoryDir
 * user scope:  {userHome}/memory/（MEMORY.md + 子文件）
 */
async function resolveMemoryRoots(
  scope: string,
  workspaceRoot?: string
): Promise<MemoryRoots | null> {
  if (scope === 'agent') {
    if (workspaceRoot) {
      // 优先：workspace 根目录（MEMORY.md + memory/）
      const memorySubDir = path.join(workspaceRoot, 'memory')
      fs.mkdirSync(memorySubDir, { recursive: true })
      return {
        primaryDir: workspaceRoot,
        memorySubDir
      }
    }
    // Fallback：Env.paths.agentMemoryDir（无 workspace 上下文时）
    try {
      const { Env } = await import('@main/common/env')
      const agentMemDir = Env.paths.agentMemoryDir
      fs.mkdirSync(agentMemDir, { recursive: true })
      return {
        primaryDir: agentMemDir,
        memorySubDir: agentMemDir
      }
    } catch {
      return null
    }
  }

  // user scope
  try {
    const { Env } = await import('@main/common/env')
    const userMemDir = Env.paths.userMemoryDir
    fs.mkdirSync(userMemDir, { recursive: true })
    return {
      primaryDir: userMemDir,
      memorySubDir: userMemDir
    }
  } catch {
    return null
  }
}

/**
 * 解析文件路径（在 roots 中定位）
 *
 * 路径解析规则：
 *   - "MEMORY.md" / "memory.md" → {primaryDir}/MEMORY.md
 *   - "memory/xxx.md" → {memorySubDir}/xxx.md（strip prefix）
 *   - "xxx.md" → 当 primaryDir == memorySubDir 时直接放 primaryDir/xxx.md
 *                 当 primaryDir != memorySubDir 时放 memorySubDir/xxx.md
 */
function resolveFileInRoots(roots: MemoryRoots, file: string, forWrite = false): string | null {
  const isSameDir = roots.primaryDir === roots.memorySubDir

  // MEMORY.md 特殊处理 → 放在 primaryDir
  if (file === 'MEMORY.md' || file === 'memory.md') {
    const target = path.join(roots.primaryDir, 'MEMORY.md')
    return resolveMemoryPath(roots.primaryDir, 'MEMORY.md') ? target : null
  }

  // 确定目标目录和相对路径
  let baseDir: string
  let relativeName: string

  if (file.startsWith('memory/')) {
    // memory/xxx.md → memorySubDir/xxx.md
    baseDir = roots.memorySubDir
    relativeName = file.slice(7)
  } else if (isSameDir) {
    // primaryDir == memorySubDir（user scope / fallback）→ 直接用 primaryDir
    baseDir = roots.primaryDir
    relativeName = file
  } else {
    // primaryDir != memorySubDir（workspace agent scope）→ 放入 memory/ 子目录
    baseDir = roots.memorySubDir
    relativeName = file
  }

  // 安全检查
  const resolved = resolveMemoryPath(baseDir, relativeName)
  if (!resolved) return null

  const target = path.join(baseDir, relativeName)

  // 写入时确保父目录存在
  if (forWrite) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
  }

  return target
}

// ==================== 文件列举 ====================

interface MemoryFileInfo {
  /** 显示路径（相对于 scope 根） */
  displayPath: string
  /** 绝对路径 */
  absolutePath: string
  /** 文件大小 */
  size: number
  /** 修改时间 */
  modifiedAt: number
  /** 是否为主记忆文件 */
  isPrimary: boolean
}

/**
 * 收集所有记忆文件（MEMORY.md + memory/ 下的文件）
 */
function collectMemoryFiles(roots: MemoryRoots): MemoryFileInfo[] {
  const results: MemoryFileInfo[] = []
  const isSameDir = roots.primaryDir === roots.memorySubDir

  // 1. 检查主记忆文件 MEMORY.md
  const primaryPath = path.join(roots.primaryDir, 'MEMORY.md')
  if (fs.existsSync(primaryPath)) {
    const stat = fs.statSync(primaryPath)
    results.push({
      displayPath: 'MEMORY.md',
      absolutePath: primaryPath,
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      isPrimary: true
    })
  }

  // 2. 扫描 memory/ 目录
  const subFiles = listMemoryFilesRecursive(roots.memorySubDir)
  for (const f of subFiles) {
    // 避免重复（如果 memorySubDir == primaryDir，跳过已添加的 MEMORY.md）
    if (f.absolutePath === primaryPath) continue
    results.push({
      ...f,
      // primaryDir == memorySubDir 时（user scope / fallback agent scope）直接用相对路径
      // primaryDir != memorySubDir 时（workspace agent scope）加 memory/ 前缀
      displayPath: isSameDir ? f.relativePath : `memory/${f.relativePath}`,
      isPrimary: false
    })
  }

  // 按修改时间倒序，主记忆文件置顶
  return results.sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1
    if (!a.isPrimary && b.isPrimary) return 1
    return b.modifiedAt - a.modifiedAt
  })
}

interface InternalFileInfo {
  relativePath: string
  absolutePath: string
  size: number
  modifiedAt: number
}

/** 递归列出目录下的记忆文件 */
function listMemoryFilesRecursive(dir: string, prefix = ''): InternalFileInfo[] {
  const results: InternalFileInfo[] = []

  if (!fs.existsSync(dir)) return results

  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue
      results.push(...listMemoryFilesRecursive(fullPath, relativePath))
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (MEMORY_EXTENSIONS.includes(ext)) {
        const stat = fs.statSync(fullPath)
        results.push({
          relativePath,
          absolutePath: fullPath,
          size: stat.size,
          modifiedAt: stat.mtimeMs
        })
      }
    }
  }

  return results.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

// ==================== 增强型搜索 ====================

/** 搜索结果 */
export interface MemorySearchResult {
  /** 显示路径 */
  file: string
  /** 相关度评分 (0-1) */
  score: number
  /** 匹配片段（带上下文） */
  snippet: string
  /** 所在 Markdown 章节标题 */
  section?: string
}

interface SearchOptions {
  maxResults?: number
  minScore?: number
}

/**
 * 增强型记忆搜索
 *
 * 特性：
 *   - 多关键字：query 按空格拆词，每个词独立匹配
 *   - 评分：词频 × 标题加权 × 主文件加权
 *   - 片段提取：返回匹配行 ± N 行上下文
 *   - Section 感知：返回匹配所在的 Markdown ## 标题
 */
export function searchMemoryFiles(
  roots: MemoryRoots,
  query: string,
  options?: SearchOptions
): MemorySearchResult[] {
  const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS
  const minScore = options?.minScore ?? DEFAULT_MIN_SCORE

  // 1. 拆词（按空格，去空）
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((k) => k.length > 0)
  if (keywords.length === 0) return []

  // 2. 收集所有记忆文件
  const files = collectMemoryFiles(roots)
  const results: MemorySearchResult[] = []

  for (const fileInfo of files) {
    if (fileInfo.size > MAX_FILE_SIZE) continue

    let content: string
    try {
      content = fs.readFileSync(fileInfo.absolutePath, 'utf-8')
    } catch {
      continue
    }

    const lines = content.split('\n')
    const totalWords = content.toLowerCase().split(/\s+/).length || 1

    // 3. 逐行评分
    let weightedScore = 0
    let matchCount = 0
    const matchedLineIndices: number[] = []

    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase()
      let lineMatchCount = 0

      for (const kw of keywords) {
        if (lineLower.includes(kw)) {
          lineMatchCount++
        }
      }

      if (lineMatchCount > 0) {
        matchCount += lineMatchCount
        matchedLineIndices.push(i)

        // 标题行加权
        if (lines[i].startsWith('#')) {
          weightedScore += lineMatchCount * 2
        } else {
          weightedScore += lineMatchCount
        }
      }
    }

    if (matchCount === 0) continue

    // 4. 计算归一化分数
    //    weightedScore 包含标题加权（标题匹配 ×2）
    //    归一化到 0-1 范围
    let score = Math.min(1, (weightedScore / keywords.length) * (1 / Math.log2(totalWords + 2)))

    // 主记忆文件加权
    if (fileInfo.isPrimary) {
      score *= 1.5
    }

    // 钳制到 0-1
    score = Math.min(1, score)

    if (score < minScore) continue

    // 5. 提取片段（取前 N 个匹配位置，带上下文）
    const snippets: string[] = []
    const usedLines = new Set<number>()

    for (
      let idx = 0;
      idx < matchedLineIndices.length && snippets.length < MAX_SNIPPETS_PER_FILE;
      idx++
    ) {
      const lineIdx = matchedLineIndices[idx]
      if (usedLines.has(lineIdx)) continue

      const start = Math.max(0, lineIdx - SNIPPET_CONTEXT_LINES)
      const end = Math.min(lines.length - 1, lineIdx + SNIPPET_CONTEXT_LINES)

      const snippetLines: string[] = []
      for (let j = start; j <= end; j++) {
        usedLines.add(j)
        const prefix = j === lineIdx ? '> ' : '  '
        snippetLines.push(`${prefix}L${j + 1}: ${lines[j]}`)
      }
      snippets.push(snippetLines.join('\n'))
    }

    // 6. 查找所在 Section
    const section = findSection(lines, matchedLineIndices[0])

    results.push({
      file: fileInfo.displayPath,
      score,
      snippet: snippets.join('\n  ---\n'),
      section
    })
  }

  // 7. 按分数排序，截断
  return results.sort((a, b) => b.score - a.score).slice(0, maxResults)
}

/**
 * 查找指定行所在的 Markdown ## 章节标题
 */
function findSection(lines: string[], lineIndex: number): string | undefined {
  for (let i = lineIndex; i >= 0; i--) {
    const match = lines[i].match(/^#{1,3}\s+(.+)/)
    if (match) return match[1].trim()
  }
  return undefined
}

// ==================== 路径安全 ====================

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
      let current = path.dirname(resolved)
      while (!fs.existsSync(current) && current !== path.dirname(current)) {
        current = path.dirname(current)
      }
      realTarget = fs.existsSync(current) ? fs.realpathSync(current) : current
    }

    const realMemoryRoot = fs.existsSync(memoryRoot) ? fs.realpathSync(memoryRoot) : memoryRoot
    if (!realTarget.startsWith(realMemoryRoot + path.sep) && realTarget !== realMemoryRoot) {
      log.warn(
        `[memory] Symlink traversal blocked: "${file}" → "${realTarget}" outside "${realMemoryRoot}"`
      )
      return null
    }
  } catch {
    return null
  }

  return resolved
}

// ==================== 索引更新辅助 ====================

/**
 * 安全更新记忆索引（不阻塞主流程）
 *
 * 在写入记忆文件后调用。如果文件在 memorySubDir 中，更新索引。
 * 如果是 MEMORY.md 在 primaryDir 中，跳过索引更新（不在子目录中）。
 */
function tryUpdateIndex(memorySubDir: string, file: string, filePath: string): void {
  try {
    const dir = path.dirname(filePath)
    // 只索引 memorySubDir 下的文件
    if (dir === memorySubDir) {
      updateIndexEntry(memorySubDir, path.basename(filePath))
    }
  } catch (err) {
    log.warn(`[memory] Index update failed for ${file}:`, err)
  }
}
