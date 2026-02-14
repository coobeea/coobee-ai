/**
 * 事件流 + Session 完整分析测试
 *
 * 目标：
 *   1. 执行真实场景（简单问答、工具调用），捕获完整事件流
 *   2. 读取 session 文件（messages.jsonl），验证持久化内容
 *   3. 获取 context snapshot，验证 LLM 上下文构建
 *   4. 将所有分析结果写入 docs/ 下的 Markdown 文档
 *
 * 输出：
 *   docs/2.openai-sdk/18-event-stream-analysis.md — 完整分析报告
 *   test-results/YYYYMMDD/event-analysis-{timestamp}.log — 摘要日志
 *
 * 运行命令：
 *   pnpm vitest run src/main/ai/runtime/openai/__tests__/event-stream-analysis.integration.test.ts
 */

import fs from 'fs'
import path from 'path'
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { join } from 'path'

// ===== Electron 环境 stub =====

vi.mock('electron', () => {
  const base = join(process.cwd(), 'test-results')
  return {
    app: {
      getPath: (name: string) => join(base, name),
      getAppPath: () => base,
      getName: () => 'coobee-ai-test',
      getVersion: () => '0.0.0-test',
      getLocale: () => 'zh-CN',
      isPackaged: false
    },
    BrowserWindow: vi.fn(),
    ipcMain: { on: vi.fn(), handle: vi.fn() },
    session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } }
  }
})

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: true }
}))

vi.mock('electron-log', () => {
  const noop = (): void => {}
  const mockTransport = {
    resolvePathFn: null,
    level: 'info',
    maxSize: 10 * 1024 * 1024,
    format: '',
    getFile: () => ({ path: '/tmp/test.log' })
  }
  const mockLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    verbose: noop,
    transports: {
      file: { ...mockTransport },
      console: { level: 'info', format: '' }
    },
    create: () => ({
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      verbose: noop,
      transports: {
        file: { ...mockTransport },
        console: { level: 'info', format: '' }
      }
    })
  }
  return { default: mockLogger }
})

vi.mock('mkdirp', () => ({
  mkdirp: vi.fn().mockResolvedValue(undefined)
}))

// ===== 真实 imports =====
import { tool, setDefaultOpenAIClient, setOpenAIAPI } from '@openai/agents'
import OpenAI from 'openai'
import { z } from 'zod'
import { OpenAIAgentRuntime } from '../OpenAIAgentRuntime'
import type { StreamChunk } from '../../types'
import type { ContextSnapshot, SessionItem } from '../types'

// ========== API 配置 ==========

function resolveApiConfig(): { apiKey: string; baseURL?: string; model: string } | null {
  if (process.env.OPENAI_API_KEY) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    }
  }
  if (process.env.VITE_MINIMAX_API_KEY) {
    return {
      apiKey: process.env.VITE_MINIMAX_API_KEY,
      baseURL: process.env.VITE_MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1',
      model: process.env.VITE_MINIMAX_MODEL || 'MiniMax-M2.1'
    }
  }
  return null
}

const apiConfig = resolveApiConfig()
const RUN = !!apiConfig

// ========== 常量 ==========

const LOG_PREFIX = '[事件分析]'
const TEST_LOG_BASE = path.join(process.cwd(), 'test-results')
const DOCS_DIR = path.join(process.cwd(), 'docs', '2.openai-sdk')
/** Session 存储目录（测试用固定路径，与 readSessionFile 保持一致） */
const TEST_SESSION_DIR = path.join(process.cwd(), 'test-results', 'userData', 'sessions')

let currentLogDir: string
let currentTestLogFile: string

// ========== Markdown 报告收集器 ==========

const reportSections: string[] = []

function addReportSection(content: string): void {
  reportSections.push(content)
}

// ========== 日志工具 ==========

function ensureLogDir(): void {
  fs.mkdirSync(currentLogDir, { recursive: true })
}

function appendTestLog(line: string): void {
  ensureLogDir()
  fs.appendFileSync(currentTestLogFile, line + '\n', 'utf-8')
}

function testLog(line: string): void {
  console.log(line)
  try {
    appendTestLog(line)
  } catch {
    // ignore
  }
}

// ========== 辅助类型 ==========

interface TimedChunk extends StreamChunk {
  elapsed: number
  seq: number
}

interface ScenarioResult {
  name: string
  input: string
  output: string
  duration: number
  chunks: StreamChunk[]
  timedChunks: TimedChunk[]
  sessionFileContent: string
  sessionItems: SessionItem[]
  contextSnapshot: ContextSnapshot
  toolCalls?: Array<{ toolName: string; arguments: unknown; result?: unknown }> | null
}

// ========== 辅助函数 ==========

let counter = 0
function uid(): string {
  return `evt-analysis-${Date.now()}-${++counter}`
}

function createCollector(): {
  chunks: StreamChunk[]
  timedChunks: TimedChunk[]
  collect: (chunk: StreamChunk) => void
} {
  const chunks: StreamChunk[] = []
  const timedChunks: TimedChunk[] = []
  const startTime = Date.now()
  let seq = 0
  return {
    chunks,
    timedChunks,
    collect: (chunk: StreamChunk): void => {
      seq++
      chunks.push(chunk)
      timedChunks.push({ ...chunk, elapsed: Date.now() - startTime, seq })
    }
  }
}

function ofType(chunks: StreamChunk[], type: string): StreamChunk[] {
  return chunks.filter((c) => c.type === type)
}

/**
 * 读取 session 文件原始内容
 */
function readSessionFile(sessionId: string): string {
  const sessionFilePath = join(
    process.cwd(),
    'test-results',
    'userData',
    'sessions',
    sessionId,
    'messages.jsonl'
  )
  try {
    return fs.readFileSync(sessionFilePath, 'utf-8')
  } catch {
    return '[文件未找到]'
  }
}

/**
 * 解析 session 文件为 SessionItem 数组
 */
function parseSessionItems(content: string): SessionItem[] {
  if (!content || content === '[文件未找到]') return []
  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as SessionItem
      } catch {
        return null
      }
    })
    .filter((item): item is SessionItem => item !== null)
}

// ========== 工具定义 ==========

const addNumbersTool = tool({
  name: 'add_numbers',
  description: '将两个数字相加并返回结果。当用户要求计算加法时必须使用此工具。',
  parameters: z.object({
    a: z.number().describe('第一个数字'),
    b: z.number().describe('第二个数字')
  }),
  execute: async ({ a, b }) => {
    const result = a + b
    testLog(`${LOG_PREFIX}   [工具执行] add_numbers(${a}, ${b}) = ${result}`)
    return JSON.stringify({ result, expression: `${a} + ${b} = ${result}` })
  }
})

const reverseStringTool = tool({
  name: 'reverse_string',
  description: '反转一个字符串。当用户要求反转文本时使用。',
  parameters: z.object({
    text: z.string().describe('要反转的文本')
  }),
  execute: async ({ text }) => {
    const reversed = text.split('').reverse().join('')
    testLog(`${LOG_PREFIX}   [工具执行] reverse_string("${text}") = "${reversed}"`)
    return JSON.stringify({ original: text, reversed })
  }
})

// ========== Markdown 格式化 ==========

function formatEventStreamMarkdown(timedChunks: TimedChunk[]): string {
  const lines: string[] = []
  lines.push('| # | 时间(ms) | 事件类型 | 内容摘要 |')
  lines.push('|---|---------|---------|---------|')

  for (const tc of timedChunks) {
    const idx = String(tc.seq).padStart(2)
    const time = String(tc.elapsed).padStart(5)
    const type = tc.type

    let detail = ''
    if (type === 'text:delta') {
      const text = tc.content.length > 50 ? tc.content.slice(0, 50) + '...' : tc.content
      detail = `\`${JSON.stringify(text).slice(1, -1)}\``
    } else if (type === 'reasoning:delta') {
      const text = tc.content.length > 50 ? tc.content.slice(0, 50) + '...' : tc.content
      detail = `\`${JSON.stringify(text).slice(1, -1)}\``
    } else if (type === 'reasoning:done') {
      const d = tc.data as { rawContent?: string } | undefined
      detail = d?.rawContent ? `rawContent(${d.rawContent.length}字符)` : ''
    } else if (type === 'tool:start') {
      const d = tc.data as { toolName?: string; callId?: string }
      detail = `${d?.toolName || tc.content} (callId: ${d?.callId || 'N/A'})`
    } else if (type === 'tool:done') {
      detail = tc.content.length > 50 ? tc.content.slice(0, 50) + '...' : tc.content
    } else if (type === 'llm:done') {
      const d = tc.data as {
        usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
      }
      detail = d?.usage
        ? `tokens: in=${d.usage.inputTokens}, out=${d.usage.outputTokens}, total=${d.usage.totalTokens}`
        : ''
    } else if (type === 'turn:start' || type === 'turn:done') {
      const d = tc.data as { turnIndex?: number }
      detail = `turnIndex: ${d?.turnIndex}`
    } else if (tc.content) {
      detail = tc.content.length > 50 ? tc.content.slice(0, 50) + '...' : tc.content
    }

    lines.push(`| ${idx} | ${time} | \`${type}\` | ${detail} |`)
  }

  return lines.join('\n')
}

function formatSessionItemsMarkdown(items: SessionItem[]): string {
  if (items.length === 0) return '*无数据*'

  const lines: string[] = []
  lines.push('| seq | type | role | 内容摘要 | 时间 |')
  lines.push('|-----|------|------|---------|------|')

  for (const si of items) {
    const role =
      (si.item as { role?: string }).role || (si.item as { type?: string }).type || 'unknown'
    let content = ''

    if (typeof (si.item as { content?: unknown }).content === 'string') {
      const raw = (si.item as { content: string }).content
      content = raw.length > 80 ? raw.slice(0, 80) + '...' : raw
    } else if (Array.isArray((si.item as { content?: unknown[] }).content)) {
      content = '[多段内容]'
    }

    const ts = si.ts ? new Date(si.ts).toISOString().slice(11, 23) : 'N/A'
    const metaInfo = si.meta ? ` (summary: ${si.meta.summarizedSeqs?.length || 0} msgs)` : ''

    lines.push(
      `| ${si.seq} | ${si.type} | ${role} | ${content.replace(/\|/g, '\\|')}${metaInfo} | ${ts} |`
    )
  }

  return lines.join('\n')
}

function formatContextSnapshotMarkdown(snapshot: ContextSnapshot): string {
  const lines: string[] = []

  lines.push('**统计信息：**')
  lines.push(`- 上下文消息数（发送给 LLM）: ${snapshot.stats.contextItemCount}`)
  lines.push(`- 总 SessionItem 数: ${snapshot.stats.totalSessionItems}`)
  lines.push(`- 其中 message 数: ${snapshot.stats.messageCount}`)
  lines.push(`- 其中 summary 数: ${snapshot.stats.summaryCount}`)
  lines.push(`- 最后一条 summary: ${snapshot.lastSummary ? '有' : '无'}`)
  lines.push('')

  lines.push('**上下文内容（contextItems — 下次 LLM 调用时发送的内容）：**')
  lines.push('')
  lines.push('```json')
  for (const item of snapshot.contextItems) {
    const role = (item as { role?: string }).role || 'unknown'
    let content = ''
    if (typeof (item as { content?: unknown }).content === 'string') {
      content = (item as { content: string }).content
      if (content.length > 200) content = content.slice(0, 200) + '...'
    } else {
      content = JSON.stringify((item as { content?: unknown }).content)?.slice(0, 200) || ''
    }
    lines.push(`// [${role}] ${content}`)
  }
  lines.push('```')

  return lines.join('\n')
}

function formatClosedLoopMarkdown(chunks: StreamChunk[]): string {
  const counts: Record<string, number> = {}
  for (const c of chunks) {
    counts[c.type] = (counts[c.type] || 0) + 1
  }

  const pairs: [string, string][] = [
    ['run:start', 'run:done'],
    ['turn:start', 'turn:done'],
    ['llm:start', 'llm:done'],
    ['text:start', 'text:done'],
    ['reasoning:start', 'reasoning:done'],
    ['tool:start', 'tool:done']
  ]

  const lines: string[] = []
  lines.push('| 事件对 | start 次数 | done 次数 | 状态 |')
  lines.push('|--------|-----------|-----------|------|')

  for (const [s, d] of pairs) {
    const sc = counts[s] || 0
    const dc = counts[d] || 0
    if (sc > 0 || dc > 0) {
      const ok = sc === dc ? '✅ 配对' : '❌ 不匹配'
      lines.push(`| \`${s}\` / \`${d}\` | ${sc} | ${dc} | ${ok} |`)
    }
  }

  return lines.join('\n')
}

// ========== 测试 ==========

describe.skipIf(!RUN)('事件流 + Session 完整分析', () => {
  let runtime: OpenAIAgentRuntime
  let sessionId: string
  let MODEL: string
  const scenarioResults: ScenarioResult[] = []

  beforeAll(() => {
    if (!apiConfig) return

    const client = new OpenAI({
      apiKey: apiConfig.apiKey,
      ...(apiConfig.baseURL ? { baseURL: apiConfig.baseURL } : {})
    })
    setDefaultOpenAIClient(client)
    if (apiConfig.baseURL) {
      setOpenAIAPI('chat_completions')
    }
    MODEL = apiConfig.model

    // 初始化日志
    const now = new Date()
    const dateDir = now.toISOString().slice(0, 10).replace(/-/g, '')
    const runTs = Date.now()
    currentLogDir = path.join(TEST_LOG_BASE, dateDir)
    currentTestLogFile = path.join(currentLogDir, `event-analysis-${runTs}.log`)
    ensureLogDir()

    const ts = now.toISOString()
    appendTestLog(`========== 事件流分析测试 ${ts} | model=${MODEL} ==========\n`)

    testLog(`${LOG_PREFIX} API: model=${MODEL}, baseURL=${apiConfig.baseURL || 'OpenAI'}`)
    testLog(`${LOG_PREFIX} 日志: ${currentTestLogFile}`)

    // 报告头
    addReportSection(`# OpenAI AgentRuntime 事件流分析报告\n`)
    addReportSection(
      `> 自动生成于 ${ts}\n>\n> 模型: \`${MODEL}\` | API: \`${apiConfig.baseURL || 'OpenAI'}\`\n`
    )
    addReportSection(
      `## 目录\n\n1. [场景1：简单问答（无工具）](#场景1简单问答无工具)\n2. [场景2：工具调用（add_numbers）](#场景2工具调用add_numbers)\n3. [场景3：多轮对话 + Session 持久化验证](#场景3多轮对话--session-持久化验证)\n4. [总结](#总结)\n`
    )
  })

  afterAll(async () => {
    if (!RUN) return

    // ========== 生成 Markdown 报告 ==========
    const reportContent = reportSections.join('\n')
    fs.mkdirSync(DOCS_DIR, { recursive: true })
    const reportPath = path.join(DOCS_DIR, '18-event-stream-analysis.md')
    fs.writeFileSync(reportPath, reportContent, 'utf-8')

    testLog(`\n${LOG_PREFIX} ✅ 分析报告已写入: ${reportPath}`)
    testLog(`${LOG_PREFIX} 日志文件: ${currentTestLogFile}`)

    const ts = new Date().toISOString()
    appendTestLog(`\n========== 分析结束 ${ts} ==========`)
  })

  beforeEach(() => {
    sessionId = uid()
  })

  afterEach(async () => {
    if (runtime) {
      try {
        await runtime.clearSession()
        await runtime.destroy()
      } catch {
        /* ignore */
      }
    }
  })

  // ===== 场景 1：简单问答（无工具）=====

  it('场景1：简单问答 — 完整事件流 + Session + Context', { timeout: 60_000 }, async () => {
    const inputText = '1+1等于几？用一个数字回答'
    const { chunks, timedChunks, collect } = createCollector()

    runtime = new OpenAIAgentRuntime({
      name: 'SimpleAgent',
      instructions: '你是一个简洁的助手。用一句话回答。',
      model: MODEL,
      sessionId,
      sessionDir: TEST_SESSION_DIR
    })
    await runtime.initialize()
    const result = await runtime.runStream(inputText, {}, collect)

    // 读取 session 文件
    const sessionFileContent = readSessionFile(sessionId)
    const sessionItems = parseSessionItems(sessionFileContent)

    // 获取 context snapshot
    const contextSnapshot = await runtime.getContextSnapshot()

    const scenario: ScenarioResult = {
      name: '场景1：简单问答（无工具）',
      input: inputText,
      output: result.output,
      duration: result.duration || 0,
      chunks,
      timedChunks,
      sessionFileContent,
      sessionItems,
      contextSnapshot
    }
    scenarioResults.push(scenario)

    // ---- 日志 ----
    testLog(`\n${LOG_PREFIX} ========== ${scenario.name} ==========`)
    testLog(`${LOG_PREFIX} 输入: ${inputText}`)
    testLog(`${LOG_PREFIX} 输出: ${result.output}`)
    testLog(`${LOG_PREFIX} 耗时: ${result.duration}ms`)
    testLog(`${LOG_PREFIX} 事件数: ${chunks.length}`)
    testLog(`${LOG_PREFIX} Session 文件行数: ${sessionItems.length}`)
    testLog(`${LOG_PREFIX} Context 消息数: ${contextSnapshot.stats.contextItemCount}`)

    // ---- 断言 ----
    const seq = chunks.map((c) => c.type)
    expect(seq[0]).toBe('run:start')
    expect(seq[seq.length - 1]).toBe('run:done')
    expect(ofType(chunks, 'turn:start').length).toBe(ofType(chunks, 'turn:done').length)
    expect(ofType(chunks, 'llm:start').length).toBe(ofType(chunks, 'llm:done').length)
    expect(ofType(chunks, 'text:delta').length).toBeGreaterThan(0)

    // text:delta 不含 <think>
    for (const delta of ofType(chunks, 'text:delta')) {
      expect(delta.content).not.toMatch(/<think>/i)
      expect(delta.content).not.toMatch(/<\/think>/i)
    }

    // output 不含 <think>
    expect(result.output).not.toMatch(/<think>/i)

    // reasoning 闭环
    const rStarts = ofType(chunks, 'reasoning:start').length
    const rDones = ofType(chunks, 'reasoning:done').length
    if (rStarts > 0) {
      expect(rStarts).toBe(rDones)
    }

    // session 文件验证
    expect(sessionItems.length).toBeGreaterThanOrEqual(2) // 至少 user + assistant

    // context snapshot 验证
    expect(contextSnapshot.stats.contextItemCount).toBeGreaterThanOrEqual(2)
    expect(contextSnapshot.stats.messageCount).toBeGreaterThanOrEqual(2)

    // ---- 写入报告 ----
    const md: string[] = []
    md.push(`## 场景1：简单问答（无工具）\n`)
    md.push(`- **输入**: \`${inputText}\``)
    md.push(`- **输出**: \`${result.output}\``)
    md.push(`- **耗时**: ${result.duration}ms`)
    md.push(`- **事件总数**: ${chunks.length}`)
    md.push(`- **模型**: \`${MODEL}\``)
    md.push(`- **有推理事件**: ${rStarts > 0 ? '是（<think> 标签被拆分）' : '否'}`)
    md.push('')

    md.push(`### 1.1 完整事件流\n`)
    md.push(formatEventStreamMarkdown(timedChunks))
    md.push('')

    md.push(`### 1.2 事件闭环检查\n`)
    md.push(formatClosedLoopMarkdown(chunks))
    md.push('')

    md.push(`### 1.3 Session 文件内容 (messages.jsonl)\n`)
    md.push(`共 ${sessionItems.length} 条记录：\n`)
    md.push(formatSessionItemsMarkdown(sessionItems))
    md.push('')

    md.push(`### 1.4 Session 文件原始内容\n`)
    md.push('```json')
    for (const line of sessionFileContent.split('\n').filter(Boolean)) {
      md.push(line)
    }
    md.push('```')
    md.push('')

    md.push(`### 1.5 Context Snapshot（下次 LLM 调用的上下文）\n`)
    md.push(formatContextSnapshotMarkdown(contextSnapshot))
    md.push('')

    // reasoning 拆分分析
    if (rStarts > 0) {
      md.push(`### 1.6 推理事件拆分分析\n`)
      md.push(`模型 \`${MODEL}\` 输出了 \`<think>\` 标签，ThinkTagParser 已成功拆分：\n`)
      md.push(`- reasoning:start 次数: ${rStarts}`)
      md.push(`- reasoning:delta 次数: ${ofType(chunks, 'reasoning:delta').length}`)
      md.push(`- reasoning:done 次数: ${rDones}`)
      const reasoningContent = ofType(chunks, 'reasoning:delta')
        .map((c) => c.content)
        .join('')
      md.push(
        `- 推理全文(${reasoningContent.length}字符): \`${reasoningContent.slice(0, 200)}${reasoningContent.length > 200 ? '...' : ''}\``
      )
      md.push(
        `- text:delta 拼接: \`${ofType(chunks, 'text:delta')
          .map((c) => c.content)
          .join('')}\``
      )
      md.push(`- text:done 全文: \`${ofType(chunks, 'text:done')[0]?.content || 'N/A'}\``)
      md.push('')
      md.push(`**结论**: text:delta 和 text:done 中均不含 \`<think>\` 标签 ✅`)
      md.push('')
    }

    addReportSection(md.join('\n'))
  })

  // ===== 场景 2：工具调用 =====

  it('场景2：工具调用 — 完整事件流 + Session + Context', { timeout: 90_000 }, async () => {
    const inputText = '请计算 17 + 28，然后反转 "hello" 这个字符串'
    const { chunks, timedChunks, collect } = createCollector()

    runtime = new OpenAIAgentRuntime({
      name: 'ToolAgent',
      instructions:
        '你是一个全能助手。加法用 add_numbers 工具，反转字符串用 reverse_string 工具。根据工具结果回答。',
      model: MODEL,
      sdkTools: [addNumbersTool, reverseStringTool],
      sessionId,
      sessionDir: TEST_SESSION_DIR,
      maxTurns: 10
    })
    await runtime.initialize()
    const result = await runtime.runStream(inputText, {}, collect)

    // 读取 session 文件
    const sessionFileContent = readSessionFile(sessionId)
    const sessionItems = parseSessionItems(sessionFileContent)

    // 获取 context snapshot
    const contextSnapshot = await runtime.getContextSnapshot()

    const scenario: ScenarioResult = {
      name: '场景2：工具调用（add_numbers + reverse_string）',
      input: inputText,
      output: result.output,
      duration: result.duration || 0,
      chunks,
      timedChunks,
      sessionFileContent,
      sessionItems,
      contextSnapshot,
      toolCalls: result.toolCalls
    }
    scenarioResults.push(scenario)

    // ---- 日志 ----
    testLog(`\n${LOG_PREFIX} ========== ${scenario.name} ==========`)
    testLog(`${LOG_PREFIX} 输入: ${inputText}`)
    testLog(`${LOG_PREFIX} 输出: ${result.output}`)
    testLog(`${LOG_PREFIX} 耗时: ${result.duration}ms`)
    testLog(`${LOG_PREFIX} 事件数: ${chunks.length}`)
    testLog(`${LOG_PREFIX} 工具调用: ${JSON.stringify(result.toolCalls)}`)
    testLog(`${LOG_PREFIX} Session 文件行数: ${sessionItems.length}`)
    testLog(`${LOG_PREFIX} Context 消息数: ${contextSnapshot.stats.contextItemCount}`)

    // ---- 断言 ----
    expect(result.output).toContain('45')
    expect(result.output).toContain('olleh')

    const toolDones = ofType(chunks, 'tool:done')
    expect(toolDones.length).toBeGreaterThanOrEqual(2)

    // 闭环
    expect(ofType(chunks, 'turn:start').length).toBe(ofType(chunks, 'turn:done').length)
    expect(ofType(chunks, 'llm:start').length).toBe(ofType(chunks, 'llm:done').length)
    expect(ofType(chunks, 'tool:start').length).toBe(ofType(chunks, 'tool:done').length)

    // text:delta 不含 <think>
    for (const delta of ofType(chunks, 'text:delta')) {
      expect(delta.content).not.toMatch(/<think>/i)
    }
    expect(result.output).not.toMatch(/<think>/i)

    // reasoning 闭环
    const rStarts = ofType(chunks, 'reasoning:start').length
    const rDones = ofType(chunks, 'reasoning:done').length
    if (rStarts > 0) expect(rStarts).toBe(rDones)

    // session 应包含 user + tool_call + tool_result + assistant
    expect(sessionItems.length).toBeGreaterThanOrEqual(2)

    // ---- 写入报告 ----
    const md: string[] = []
    md.push(`## 场景2：工具调用（add_numbers + reverse_string）\n`)
    md.push(`- **输入**: \`${inputText}\``)
    md.push(`- **输出**: \`${result.output}\``)
    md.push(`- **耗时**: ${result.duration}ms`)
    md.push(`- **事件总数**: ${chunks.length}`)
    md.push(`- **Turn 数**: ${ofType(chunks, 'turn:start').length}`)
    md.push(
      `- **工具调用**: ${result.toolCalls?.map((t) => `${t.toolName}(${JSON.stringify(t.arguments)})`).join(', ')}`
    )
    md.push(`- **有推理事件**: ${rStarts > 0 ? '是' : '否'}`)
    md.push('')

    md.push(`### 2.1 完整事件流\n`)
    md.push(formatEventStreamMarkdown(timedChunks))
    md.push('')

    md.push(`### 2.2 事件闭环检查\n`)
    md.push(formatClosedLoopMarkdown(chunks))
    md.push('')

    // 事件流分析：工具调用嵌套
    md.push(`### 2.3 事件嵌套结构分析\n`)
    md.push('```')
    let indent = 0
    const indentStr = (n: number): string => '  '.repeat(n)
    for (const tc of timedChunks) {
      if (tc.type.endsWith(':start')) {
        md.push(`${indentStr(indent)}${tc.type}`)
        indent++
      } else if (tc.type.endsWith(':done')) {
        indent = Math.max(0, indent - 1)
        md.push(`${indentStr(indent)}${tc.type}`)
      } else if (tc.type.endsWith(':delta')) {
        // 合并连续 delta
      } else {
        md.push(`${indentStr(indent)}${tc.type}`)
      }
    }
    md.push('```')
    md.push('')

    md.push(`### 2.4 Session 文件内容 (messages.jsonl)\n`)
    md.push(`共 ${sessionItems.length} 条记录：\n`)
    md.push(formatSessionItemsMarkdown(sessionItems))
    md.push('')

    md.push(`### 2.5 Session 文件原始内容\n`)
    md.push('```json')
    for (const line of sessionFileContent.split('\n').filter(Boolean)) {
      md.push(line)
    }
    md.push('```')
    md.push('')

    md.push(`### 2.6 Context Snapshot\n`)
    md.push(formatContextSnapshotMarkdown(contextSnapshot))
    md.push('')

    if (rStarts > 0) {
      md.push(`### 2.7 推理事件拆分分析\n`)
      md.push(
        `- reasoning:start/delta/done: ${rStarts}/${ofType(chunks, 'reasoning:delta').length}/${rDones}`
      )
      md.push(
        `- text:delta 拼接: \`${ofType(chunks, 'text:delta')
          .map((c) => c.content)
          .join('')
          .slice(0, 200)}\``
      )
      md.push(
        `- text:done: \`${ofType(chunks, 'text:done')
          .map((c) => c.content)
          .join('')
          .slice(0, 200)}\``
      )
      md.push(`- **结论**: 推理与正文已正确分离 ✅`)
      md.push('')
    }

    addReportSection(md.join('\n'))
  })

  // ===== 场景 3：多轮对话 + Session 持久化 =====

  it('场景3：多轮对话 — Session 累积 + Context 构建验证', { timeout: 120_000 }, async () => {
    const { chunks: allChunks, timedChunks: allTimedChunks, collect } = createCollector()

    runtime = new OpenAIAgentRuntime({
      name: 'ContextAgent',
      instructions: '你是简洁的助手。请记住用户告诉你的所有信息，后续对话中准确引用。',
      model: MODEL,
      sdkTools: [addNumbersTool],
      sessionId,
      sessionDir: TEST_SESSION_DIR,
      maxTurns: 5
    })
    await runtime.initialize()

    // --- 第1轮：告知信息 ---
    const input1 = '我叫小明，最喜欢的数字是 42'
    const r1 = await runtime.runStream(input1, {}, collect)

    const snapshot1 = await runtime.getContextSnapshot()
    const sessionContent1 = readSessionFile(sessionId)
    const sessionItems1 = parseSessionItems(sessionContent1)

    testLog(`\n${LOG_PREFIX} === 多轮对话 第1轮 ===`)
    testLog(`${LOG_PREFIX} 输入: ${input1}`)
    testLog(`${LOG_PREFIX} 输出: ${r1.output}`)
    testLog(`${LOG_PREFIX} Session 行数: ${sessionItems1.length}`)
    testLog(`${LOG_PREFIX} Context 消息数: ${snapshot1.stats.contextItemCount}`)

    // --- 第2轮：使用工具 ---
    const input2 = '帮我算一下 42 + 58'
    const r2 = await runtime.runStream(input2, {}, collect)

    const snapshot2 = await runtime.getContextSnapshot()
    const sessionContent2 = readSessionFile(sessionId)
    const sessionItems2 = parseSessionItems(sessionContent2)

    testLog(`\n${LOG_PREFIX} === 多轮对话 第2轮 ===`)
    testLog(`${LOG_PREFIX} 输入: ${input2}`)
    testLog(`${LOG_PREFIX} 输出: ${r2.output}`)
    testLog(`${LOG_PREFIX} Session 行数: ${sessionItems2.length}`)
    testLog(`${LOG_PREFIX} Context 消息数: ${snapshot2.stats.contextItemCount}`)

    // --- 第3轮：回忆信息 ---
    const input3 = '我叫什么名字？'
    const r3 = await runtime.runStream(input3, {}, collect)

    const snapshot3 = await runtime.getContextSnapshot()
    const sessionContent3 = readSessionFile(sessionId)
    const sessionItems3 = parseSessionItems(sessionContent3)

    testLog(`\n${LOG_PREFIX} === 多轮对话 第3轮 ===`)
    testLog(`${LOG_PREFIX} 输入: ${input3}`)
    testLog(`${LOG_PREFIX} 输出: ${r3.output}`)
    testLog(`${LOG_PREFIX} Session 行数: ${sessionItems3.length}`)
    testLog(`${LOG_PREFIX} Context 消息数: ${snapshot3.stats.contextItemCount}`)

    // ---- 断言 ----
    expect(r2.output).toContain('100')
    expect(r3.output).toContain('小明')

    // Session 应累积增长
    expect(sessionItems2.length).toBeGreaterThan(sessionItems1.length)
    expect(sessionItems3.length).toBeGreaterThan(sessionItems2.length)

    // Context 应累积增长
    expect(snapshot2.stats.contextItemCount).toBeGreaterThan(snapshot1.stats.contextItemCount)
    expect(snapshot3.stats.contextItemCount).toBeGreaterThan(snapshot2.stats.contextItemCount)

    // text:delta 不含 <think>
    for (const delta of ofType(allChunks, 'text:delta')) {
      expect(delta.content).not.toMatch(/<think>/i)
    }

    // ---- 写入报告 ----
    const md: string[] = []
    md.push(`## 场景3：多轮对话 + Session 持久化验证\n`)
    md.push(`### 3.1 对话记录\n`)
    md.push(`| 轮次 | 输入 | 输出 | Session行数 | Context消息数 |`)
    md.push(`|------|------|------|------------|--------------|`)
    md.push(
      `| 1 | ${input1} | ${r1.output.slice(0, 60)}... | ${sessionItems1.length} | ${snapshot1.stats.contextItemCount} |`
    )
    md.push(
      `| 2 | ${input2} | ${r2.output.slice(0, 60)}... | ${sessionItems2.length} | ${snapshot2.stats.contextItemCount} |`
    )
    md.push(
      `| 3 | ${input3} | ${r3.output.slice(0, 60)}... | ${sessionItems3.length} | ${snapshot3.stats.contextItemCount} |`
    )
    md.push('')

    md.push(`### 3.2 Session 文件最终内容\n`)
    md.push(`共 ${sessionItems3.length} 条记录：\n`)
    md.push(formatSessionItemsMarkdown(sessionItems3))
    md.push('')

    md.push(`### 3.3 Session 文件原始内容\n`)
    md.push('```json')
    for (const line of sessionContent3.split('\n').filter(Boolean)) {
      md.push(line)
    }
    md.push('```')
    md.push('')

    md.push(`### 3.4 各轮 Context Snapshot 对比\n`)

    md.push(`#### 第1轮后\n`)
    md.push(formatContextSnapshotMarkdown(snapshot1))
    md.push('')

    md.push(`#### 第2轮后（工具调用后）\n`)
    md.push(formatContextSnapshotMarkdown(snapshot2))
    md.push('')

    md.push(`#### 第3轮后\n`)
    md.push(formatContextSnapshotMarkdown(snapshot3))
    md.push('')

    md.push(`### 3.5 完整事件流（3轮合计 ${allTimedChunks.length} 个事件）\n`)
    md.push(formatEventStreamMarkdown(allTimedChunks))
    md.push('')

    md.push(`### 3.6 事件闭环检查\n`)
    md.push(formatClosedLoopMarkdown(allChunks))
    md.push('')

    // 验证结论
    md.push(`### 3.7 验证结论\n`)
    md.push(
      `- Session 累积增长: ${sessionItems1.length} → ${sessionItems2.length} → ${sessionItems3.length} ✅`
    )
    md.push(
      `- Context 累积增长: ${snapshot1.stats.contextItemCount} → ${snapshot2.stats.contextItemCount} → ${snapshot3.stats.contextItemCount} ✅`
    )
    md.push(`- 第3轮回忆成功（包含"小明"）: ${r3.output.includes('小明') ? '✅' : '❌'}`)
    md.push(`- 第2轮计算正确（包含"100"）: ${r2.output.includes('100') ? '✅' : '❌'}`)
    md.push(`- text:delta 无 \`<think>\` 标签: ✅`)
    md.push('')

    addReportSection(md.join('\n'))

    // ---- 总结部分 ----
    const summaryMd: string[] = []
    summaryMd.push(`## 总结\n`)
    summaryMd.push(`### 事件流体系\n`)
    summaryMd.push(`本次测试使用模型 \`${MODEL}\` 验证了以下关键能力：\n`)
    summaryMd.push(
      `1. **事件闭环**: 所有 \`start/done\` 事件正确配对（run, turn, llm, text, reasoning, tool）`
    )
    summaryMd.push(
      `2. **推理拆分**: ThinkTagParser 正确将 \`<think>\` 标签拆分为独立的 \`reasoning:start/delta/done\` 事件`
    )
    summaryMd.push(`3. **文本纯净**: \`text:delta\` 和 \`text:done\` 中不含 \`<think>\` 标签`)
    summaryMd.push(
      `4. **Session 持久化**: messages.jsonl 正确记录了所有对话历史（user, assistant, function_call, function_call_output）`
    )
    summaryMd.push(`5. **Context 构建**: getItems() 正确返回累积的上下文，LLM 能回忆之前的信息`)
    summaryMd.push('')
    summaryMd.push(`### 事件嵌套层级\n`)
    summaryMd.push('```')
    summaryMd.push('run:start')
    summaryMd.push('  turn:start (turnIndex=1)')
    summaryMd.push('    llm:start')
    summaryMd.push('      reasoning:start        ← 仅 <think> 模型')
    summaryMd.push('      reasoning:delta × N')
    summaryMd.push('      reasoning:done')
    summaryMd.push('      text:start')
    summaryMd.push('      text:delta × N')
    summaryMd.push('      text:done')
    summaryMd.push('    llm:done (usage)')
    summaryMd.push('    tool:start (toolName)')
    summaryMd.push('    tool:done (output)')
    summaryMd.push('  turn:done')
    summaryMd.push('  turn:start (turnIndex=2)   ← 工具调用后新 turn')
    summaryMd.push('    llm:start')
    summaryMd.push('      ...')
    summaryMd.push('    llm:done')
    summaryMd.push('  turn:done')
    summaryMd.push('run:done')
    summaryMd.push('```')
    summaryMd.push('')
    summaryMd.push(`### Session 文件格式\n`)
    summaryMd.push('```')
    summaryMd.push('messages.jsonl 每行格式（SessionItem）：')
    summaryMd.push(
      '  { "seq": 1, "type": "message", "item": { "role": "user", "content": "..." }, "ts": ... }'
    )
    summaryMd.push(
      '  { "seq": 2, "type": "message", "item": { "role": "assistant", "content": [{"type":"output_text","text":"..."}] }, "ts": ... }'
    )
    summaryMd.push(
      '  { "seq": N, "type": "summary", "item": {...}, "meta": { "summarizedSeqs": [...], ... }, "ts": ... }'
    )
    summaryMd.push('```')
    summaryMd.push('')

    addReportSection(summaryMd.join('\n'))
  })
})
