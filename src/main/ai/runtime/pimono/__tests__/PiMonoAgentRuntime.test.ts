/**
 * PiMonoAgentRuntime 真实执行测试
 *
 * 真实调用链：
 *   ✅ PiMonoAgentRuntime（真实）
 *   ✅ pi-coding-agent SDK createAgentSession + session.prompt()（真实）
 *   ✅ ToolDefinition + TypeBox 参数定义 + execute（真实）
 *   ✅ SessionManager.inMemory() 会话管理（真实）
 *   ✅ StreamEmitter 事件广播（真实）
 *   ✅ LLM API 请求（真实，统一使用 OpenAI Chat Completions 格式）
 *
 * API 格式：
 *   统一使用 OpenAI Chat Completions 格式（openai-completions）。
 *   通过 baseURL 指向 OpenAI 兼容的后端 API（MiniMax、DeepSeek 等）。
 *   不依赖 Anthropic SDK，不使用 ANTHROPIC_AUTH_TOKEN。
 *
 * 唯一 stub：Electron 环境层（electron, electron-log, mkdirp）
 *
 * 测试场景：
 *   1. 简单问答（无工具）— run/turn/llm/text 闭环
 *   2. 单工具调用 — tool:start → tool:delta(进度) → tool:done
 *   3. 链式工具调用 — 多轮 turn，tool 配对
 *   4. 并行工具调用 — 多个 tool:start/done
 *   5. 多种工具混合 — 天气 + 时间 + 计算
 *   6. 思考流独立 — reasoning 独立于 text，不含 <think> 标签
 *
 * pi-coding-agent SDK 事件体系优势（vs OpenAI）：
 *   - turn_start / turn_end：SDK 直接给出，无需推断
 *   - thinking_delta：独立事件，无需解析 <think> 标签
 *   - tool_execution_update：工具执行进度（OpenAI SDK 完全没有）
 *   - auto_compaction：内置自动压缩
 *
 * 日志输出（分离存储，每次运行生成独立文件）：
 *
 *   ┌─────────────────────────────────────────────────────────────────────────┐
 *   │ 文件                                                  │ 内容           │
 *   ├─────────────────────────────────────────────────────────────────────────┤
 *   │ test-results/YYYYMMDD/pi-agent-test-{timestamp}.log   │ 摘要日志       │
 *   │   → 每个场景的输入/输出/耗时                                            │
 *   │   → 事件统计 + 闭环检查（start/done 配对）                               │
 *   │   → 详细事件流（时间戳 + 序号 + 类型 + 摘要）                            │
 *   ├─────────────────────────────────────────────────────────────────────────┤
 *   │ test-results/YYYYMMDD/pi-agent-events-{timestamp}.log │ 原始事件日志   │
 *   │   → 每个事件的完整 JSON（含 data 字段）                                  │
 *   │   → SDK debug 级别的原始事件                                            │
 *   └─────────────────────────────────────────────────────────────────────────┘
 *
 *   注意：集成测试的输出文件名不同，见 PiMonoAgentRuntime.integration.test.ts
 *
 * 运行命令：
 *   pnpm vitest run src/main/ai/runtime/pimono/__tests__/PiMonoAgentRuntime.test.ts
 */

import fs from 'fs'
import path from 'path'
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { Type } from '@sinclair/typebox'

// ===== Electron 环境 stub（非业务 mock） =====

vi.mock('electron', () => {
  const base = path.join(process.cwd(), 'test-results')
  return {
    app: {
      getPath: (name: string) => path.join(base, name),
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

import { PiMonoAgentRuntime } from '../PiMonoAgentRuntime'
import type { StreamChunk } from '../../types'
import type { PiMonoAgentRuntimeOptions } from '../types'

// ========== API 配置 ==========

/**
 * 解析 API 配置
 *
 * 统一使用 OpenAI Chat Completions 格式。
 * 通过 apiKey + baseURL 组合指向不同的 OpenAI 兼容服务端点。
 */
function resolveApiConfig(): {
  apiKey: string
  baseURL: string
  model: string
} | null {
  if (process.env.VITE_LLM_API_KEY) {
    return {
      apiKey: process.env.VITE_LLM_API_KEY,
      baseURL: process.env.VITE_LLM_BASE_URL || 'https://api.minimaxi.com/v1',
      model: process.env.VITE_LLM_MODEL || 'MiniMax-M2.1'
    }
  }
  return null
}

const apiConfig = resolveApiConfig()
const RUN = !!apiConfig

// ========== 日志系统（分离存储） ==========

const LOG_PREFIX = '[PiAgentTest]'
const TEST_LOG_BASE = path.join(process.cwd(), 'test-results')

let currentLogDir: string
let currentTestLogFile: string
let currentEventsLogFile: string

function ensureLogDir(): void {
  fs.mkdirSync(currentLogDir, { recursive: true })
}

function appendTestLog(line: string): void {
  ensureLogDir()
  fs.appendFileSync(currentTestLogFile, line + '\n', 'utf-8')
}

function appendEventsLog(line: string): void {
  ensureLogDir()
  fs.appendFileSync(currentEventsLogFile, line + '\n', 'utf-8')
}

function testLog(line: string): void {
  console.log(line)
}

// 拦截 console 方法
const origConsoleLog = console.log
const origConsoleDebug = console.debug
const origConsoleError = console.error
const origConsoleWarn = console.warn

function patchConsole(): void {
  const formatMsg = (args: unknown[]): string => {
    return args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  }

  const wrapToTestLog =
    (orig: (...args: unknown[]) => void, level: string) =>
    (...args: unknown[]) => {
      orig(...args)
      try {
        const ts = new Date().toISOString().slice(11, 23)
        appendTestLog(`[${ts}] [${level}] ${formatMsg(args)}`)
      } catch {
        // ignore
      }
    }

  const wrapToEventsLog =
    (orig: (...args: unknown[]) => void, level: string) =>
    (...args: unknown[]) => {
      orig(...args)
      try {
        const ts = new Date().toISOString().slice(11, 23)
        appendEventsLog(`[${ts}] [${level}] ${formatMsg(args)}`)
      } catch {
        // ignore
      }
    }

  console.log = wrapToTestLog(origConsoleLog, 'INFO') as typeof console.log
  console.error = wrapToTestLog(origConsoleError, 'ERROR') as typeof console.error
  console.warn = wrapToTestLog(origConsoleWarn, 'WARN') as typeof console.warn
  console.debug = wrapToEventsLog(origConsoleDebug, 'DEBUG') as typeof console.debug
}

function restoreConsole(): void {
  console.log = origConsoleLog
  console.debug = origConsoleDebug
  console.error = origConsoleError
  console.warn = origConsoleWarn
}

// ========== 辅助类型 ==========

interface TimedChunk extends StreamChunk {
  elapsed: number
  seq: number
}

function formatChunkSummary(chunk: StreamChunk, index: number, elapsed: number): string {
  const n = String(index + 1).padStart(3)
  const time = String(elapsed).padStart(6) + 'ms'
  const type = chunk.type.padEnd(20)

  let detail = ''
  if (chunk.type === 'text:delta') {
    const text = chunk.content.length > 80 ? chunk.content.slice(0, 80) + '...' : chunk.content
    detail = `content: ${JSON.stringify(text)}`
  } else if (chunk.type === 'reasoning:delta') {
    const text = chunk.content.length > 80 ? chunk.content.slice(0, 80) + '...' : chunk.content
    detail = `reasoning: ${JSON.stringify(text)}`
  } else if (chunk.type === 'reasoning:start' || chunk.type === 'reasoning:done') {
    const d = chunk.data as { rawContent?: string } | undefined
    detail = d?.rawContent ? `rawContent: ${JSON.stringify(d.rawContent.slice(0, 60))}` : ''
  } else if (chunk.type === 'tool:start') {
    const d = chunk.data as { toolName?: string; callId?: string }
    detail = `tool=${d?.toolName || chunk.content}, callId=${d?.callId || 'N/A'}`
  } else if (chunk.type === 'tool:done') {
    const d = chunk.data as { toolName?: string; isError?: boolean }
    detail = `tool=${d?.toolName || 'N/A'}, result=${JSON.stringify((chunk.content || '').slice(0, 80))}`
  } else if (chunk.type === 'tool:delta') {
    detail = `delta: ${JSON.stringify((chunk.content || '').slice(0, 60))}`
  } else if (chunk.type === 'tool:pending') {
    const d = chunk.data as { callId?: string; arguments?: string }
    detail = `callId: ${d?.callId}, args: ${d?.arguments?.slice(0, 60)}`
  } else if (chunk.type === 'llm:done' && chunk.data) {
    const d = chunk.data as {
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    }
    if (d.usage) {
      detail = `tokens: in=${d.usage.inputTokens || 0}, out=${d.usage.outputTokens || 0}, total=${d.usage.totalTokens || 0}`
    }
  } else if (chunk.type === 'turn:start' || chunk.type === 'turn:done') {
    const d = chunk.data as { turnIndex?: number }
    detail = d?.turnIndex ? `turn=#${d.turnIndex}` : ''
  } else if (chunk.type === 'compression:start' || chunk.type === 'compression:done') {
    detail = `content: ${JSON.stringify(chunk.content)}`
  } else if (chunk.content) {
    const text = chunk.content.length > 60 ? chunk.content.slice(0, 60) + '...' : chunk.content
    detail = `content: ${JSON.stringify(text)}`
  }

  return `  [${time}] #${n}  ${type}${detail ? '  { ' + detail + ' }' : ''}`
}

/** 闭环检查 */
function checkClosedLoops(chunks: StreamChunk[]): string[] {
  const lines: string[] = []
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
    ['tool:start', 'tool:done'],
    ['compression:start', 'compression:done']
  ]
  for (const [s, d] of pairs) {
    const sc = counts[s] || 0
    const dc = counts[d] || 0
    if (sc > 0 || dc > 0) {
      const ok = sc === dc ? '✓' : `✗ MISMATCH`
      lines.push(`    ${s.padEnd(20)} / ${d.padEnd(20)} : ${sc}/${dc}  ${ok}`)
    }
  }
  return lines
}

function safeJsonStringify(x: unknown): string {
  try {
    return JSON.stringify(x, null, 2)
  } catch {
    return String(x)
  }
}

/** 核心日志函数 — 格式化输出测试结果 */
function logTestResult(
  testName: string,
  opts: {
    input?: string
    output?: string
    duration?: number
    toolCalls?: Array<{ toolName: string; arguments: unknown }> | null
    chunks?: StreamChunk[]
    timedChunks?: TimedChunk[]
  }
): void {
  const separator = '━'.repeat(72)
  const subSeparator = '─'.repeat(72)

  testLog('')
  testLog(`${LOG_PREFIX} ${separator}`)
  testLog(`${LOG_PREFIX}  测试: ${testName}`)
  testLog(`${LOG_PREFIX} ${separator}`)

  // 基本信息
  if (opts.input) testLog(`${LOG_PREFIX}  输入: ${opts.input}`)
  if (opts.output) {
    const show = opts.output.length > 200 ? opts.output.slice(0, 200) + '...' : opts.output
    testLog(`${LOG_PREFIX}  输出: ${show}`)
  }
  if (opts.duration) testLog(`${LOG_PREFIX}  耗时: ${opts.duration}ms`)
  if (opts.toolCalls && opts.toolCalls.length > 0) {
    testLog(`${LOG_PREFIX}  工具调用 (${opts.toolCalls.length}):`)
    for (const t of opts.toolCalls) {
      testLog(`${LOG_PREFIX}    → ${t.toolName}(${JSON.stringify(t.arguments)})`)
    }
  }

  // 事件序列
  if (opts.chunks && opts.chunks.length > 0) {
    testLog(`${LOG_PREFIX} ${subSeparator}`)
    testLog(`${LOG_PREFIX}  事件流 (共 ${opts.chunks.length} 个事件):`)
    testLog(`${LOG_PREFIX}`)

    // 事件类型计数
    const typeCounts: Record<string, number> = {}
    for (const c of opts.chunks) {
      typeCounts[c.type] = (typeCounts[c.type] || 0) + 1
    }
    const countEntries = Object.entries(typeCounts).sort()
    testLog(`${LOG_PREFIX}  事件统计:`)
    for (const [t, count] of countEntries) {
      testLog(`${LOG_PREFIX}    ${t.padEnd(20)} : ${count}`)
    }

    // 闭环检查
    testLog(`${LOG_PREFIX}`)
    testLog(`${LOG_PREFIX}  闭环检查:`)
    const loopChecks = checkClosedLoops(opts.chunks)
    for (const l of loopChecks) testLog(`${LOG_PREFIX} ${l}`)

    // 详细事件（每行一个事件，格式化时间戳和类型）
    if (opts.timedChunks) {
      testLog(`${LOG_PREFIX}`)
      testLog(`${LOG_PREFIX}  详细事件流:`)
      for (const tc of opts.timedChunks) {
        testLog(
          `${LOG_PREFIX}${formatChunkSummary({ type: tc.type, content: tc.content, data: tc.data }, tc.seq - 1, tc.elapsed)}`
        )
      }
    }
  }

  testLog(`${LOG_PREFIX} ${separator}`)

  // 写入完整事件 JSON 到 events 日志
  if (opts.timedChunks && opts.timedChunks.length > 0) {
    try {
      appendEventsLog('')
      appendEventsLog(
        `${'━'.repeat(60)}\n` +
          `测试: ${testName} | 共 ${opts.timedChunks.length} 个事件\n` +
          `${'━'.repeat(60)}`
      )
      for (const tc of opts.timedChunks) {
        appendEventsLog(
          `#${String(tc.seq).padStart(3)} [${String(tc.elapsed).padStart(6)}ms] ${tc.type}`
        )
        appendEventsLog(safeJsonStringify(tc))
        appendEventsLog('')
      }
      appendEventsLog('━'.repeat(60))
    } catch {
      // ignore
    }
  }
}

// ========== pi-coding-agent 自定义工具 ==========

/**
 * 创建 pi-coding-agent ToolDefinition
 *
 * 与 OpenAI 的 tool() 不同，pi-coding-agent 使用 TypeBox 定义参数：
 *   - parameters: Type.Object({...}) 而非 z.object({...})
 *   - execute(toolCallId, params, signal, onUpdate, ctx) 签名不同
 *   - 返回值是 AgentToolResult { content: TextContent[], details: T }
 */

function createPiTool(config: {
  name: string
  label: string
  description: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (params: any) => Promise<string>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): any {
  return {
    name: config.name,
    label: config.label,
    description: config.description,
    parameters: config.parameters,
    execute: async (
      _toolCallId: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params: any,
      _signal?: AbortSignal,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onUpdate?: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _ctx?: any
    ) => {
      // 可选：通过 onUpdate 发送进度
      if (onUpdate) {
        onUpdate({
          content: [{ type: 'text', text: `Executing ${config.name}...` }],
          details: { status: 'running' }
        })
      }

      const resultText = await config.execute(params)
      return {
        content: [{ type: 'text', text: resultText }],
        details: { name: config.name }
      }
    }
  }
}

const addNumbersTool = createPiTool({
  name: 'add_numbers',
  label: 'Add Numbers',
  description: '将两个数字相加并返回结果。当用户要求计算加法时必须使用此工具。',
  parameters: Type.Object({
    a: Type.Number({ description: '第一个数字' }),
    b: Type.Number({ description: '第二个数字' })
  }),
  execute: async (params) => {
    const result = params.a + params.b
    testLog(`${LOG_PREFIX}   [工具执行] add_numbers(${params.a}, ${params.b}) = ${result}`)
    return JSON.stringify({ result, expression: `${params.a} + ${params.b} = ${result}` })
  }
})

const multiplyNumbersTool = createPiTool({
  name: 'multiply_numbers',
  label: 'Multiply Numbers',
  description: '将两个数字相乘并返回结果。当用户要求计算乘法时必须使用此工具。',
  parameters: Type.Object({
    a: Type.Number({ description: '第一个数字' }),
    b: Type.Number({ description: '第二个数字' })
  }),
  execute: async (params) => {
    const result = params.a * params.b
    testLog(`${LOG_PREFIX}   [工具执行] multiply_numbers(${params.a}, ${params.b}) = ${result}`)
    return JSON.stringify({ result, expression: `${params.a} × ${params.b} = ${result}` })
  }
})

const reverseStringTool = createPiTool({
  name: 'reverse_string',
  label: 'Reverse String',
  description: '反转一个字符串。当用户要求反转文本时使用。',
  parameters: Type.Object({
    text: Type.String({ description: '要反转的文本' })
  }),
  execute: async (params) => {
    const reversed = params.text.split('').reverse().join('')
    testLog(`${LOG_PREFIX}   [工具执行] reverse_string("${params.text}") = "${reversed}"`)
    return JSON.stringify({ original: params.text, reversed })
  }
})

const getCurrentTimeTool = createPiTool({
  name: 'get_current_time',
  label: 'Get Current Time',
  description: '获取当前日期和时间。当用户询问时间时使用。',
  parameters: Type.Object({}),
  execute: async () => {
    const now = new Date()
    const result = {
      date: now.toLocaleDateString('zh-CN'),
      time: now.toLocaleTimeString('zh-CN')
    }
    testLog(`${LOG_PREFIX}   [工具执行] get_current_time() = ${JSON.stringify(result)}`)
    return JSON.stringify(result)
  }
})

const getWeatherTool = createPiTool({
  name: 'get_weather',
  label: 'Get Weather',
  description: '获取指定城市的天气信息。',
  parameters: Type.Object({
    city: Type.String({ description: '城市名' })
  }),
  execute: async (params) => {
    const result = {
      city: params.city,
      temperature: '25°C',
      condition: '晴天',
      humidity: '60%'
    }
    testLog(`${LOG_PREFIX}   [工具执行] get_weather("${params.city}") = ${JSON.stringify(result)}`)
    return JSON.stringify(result)
  }
})

// ========== 辅助函数 ==========

let counter = 0
function uid(): string {
  return `pi-agent-test-${Date.now()}-${++counter}`
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

function allTypes(chunks: StreamChunk[]): string[] {
  return chunks.map((c) => c.type)
}

function assertOrdered(seq: string[], ...events: string[]): void {
  let lastIdx = -1
  for (const event of events) {
    const idx = seq.indexOf(event, lastIdx + 1)
    expect(idx, `Expected '${event}' after index ${lastIdx}`).toBeGreaterThan(lastIdx)
    lastIdx = idx
  }
}

/**
 * 验证推理事件拆分：
 * 1. text:delta 不含 <think> 标签（pi-SDK 独立思考流的核心优势）
 * 2. text:done 内容不含 <think> 标签
 * 3. result.output 不含 <think> 标签
 * 4. 如果有 reasoning 事件，start/done 必须配对
 */
function assertReasoningSeparation(chunks: StreamChunk[], output: string, testName: string): void {
  // text:delta 不包含 <think> 标签
  const textDeltas = ofType(chunks, 'text:delta')
  for (const delta of textDeltas) {
    expect(delta.content, `[${testName}] text:delta 不应包含 <think> 标签`).not.toMatch(/<think>/i)
    expect(delta.content, `[${testName}] text:delta 不应包含 </think> 标签`).not.toMatch(
      /<\/think>/i
    )
  }

  // text:done 不包含 <think> 标签
  const textDones = ofType(chunks, 'text:done')
  for (const done of textDones) {
    expect(done.content, `[${testName}] text:done 不应包含 <think> 标签`).not.toMatch(/<think>/i)
  }

  // result.output 不包含 <think> 标签
  expect(output, `[${testName}] output 不应包含 <think> 标签`).not.toMatch(/<think>/i)

  // reasoning 闭环检查
  const reasoningStarts = ofType(chunks, 'reasoning:start').length
  const reasoningDones = ofType(chunks, 'reasoning:done').length
  if (reasoningStarts > 0 || reasoningDones > 0) {
    expect(reasoningStarts, `[${testName}] reasoning:start/done 必须配对`).toBe(reasoningDones)

    // 有 reasoning 就必须有 reasoning:delta
    const reasoningDeltas = ofType(chunks, 'reasoning:delta')
    expect(
      reasoningDeltas.length,
      `[${testName}] 有 reasoning:start 则必须有 reasoning:delta`
    ).toBeGreaterThan(0)

    testLog(
      `${LOG_PREFIX}   [reasoning] ${reasoningStarts} 个推理块, ${reasoningDeltas.length} 个 delta`
    )
  }
}

/** 创建 PiMonoAgentRuntime 实例 */
function createRuntime(
  overrides: Partial<PiMonoAgentRuntimeOptions> & { name: string; instructions: string }
): PiMonoAgentRuntime {
  if (!apiConfig) throw new Error('No API config')
  return new PiMonoAgentRuntime({
    apiKey: apiConfig.apiKey,
    baseURL: apiConfig.baseURL,
    model: apiConfig.model,
    thinkingLevel: 'low',
    sessionMode: 'memory',
    compaction: { enabled: false },
    ...overrides
  })
}

// ========== 测试 ==========

describe.skipIf(!RUN)('PiMonoAgentRuntime 真实执行测试（OpenAI 兼容格式）', () => {
  let runtime: PiMonoAgentRuntime
  let sessionId: string

  beforeAll(() => {
    if (!apiConfig) return

    // 初始化日志
    patchConsole()
    const now = new Date()
    const dateDir = now.toISOString().slice(0, 10).replace(/-/g, '')
    const runTs = Date.now()
    currentLogDir = path.join(TEST_LOG_BASE, dateDir)
    currentTestLogFile = path.join(currentLogDir, `pi-agent-test-${runTs}.log`)
    currentEventsLogFile = path.join(currentLogDir, `pi-agent-events-${runTs}.log`)
    ensureLogDir()

    const ts = now.toISOString()
    appendTestLog(
      `========== PiMonoAgentRuntime 真实执行测试 ${ts} ==========\n` +
        `  API 格式: openai-completions\n` +
        `  Model:    ${apiConfig.model}\n` +
        `  Base URL: ${apiConfig.baseURL}\n`
    )
    appendTestLog(`摘要日志: ${currentTestLogFile}`)
    appendTestLog(`事件日志: ${currentEventsLogFile}`)
    appendTestLog('')
    appendEventsLog(
      `========== PiMonoAgentRuntime 事件日志 ${ts} ==========\n` +
        `  API 格式: openai-completions\n` +
        `  Model:    ${apiConfig.model}\n` +
        `  Base URL: ${apiConfig.baseURL}\n`
    )
    appendEventsLog('')

    testLog(
      `${LOG_PREFIX} API: openai-completions, model=${apiConfig.model}, ` +
        `baseURL=${apiConfig.baseURL}`
    )
    testLog(`${LOG_PREFIX} 摘要日志: ${currentTestLogFile}`)
    testLog(`${LOG_PREFIX} 事件日志: ${currentEventsLogFile}`)
  })

  afterAll(() => {
    if (!RUN) return
    const ts = new Date().toISOString()
    appendTestLog(`\n========== 测试结束 ${ts} ==========`)
    appendEventsLog(`\n========== 事件日志结束 ${ts} ==========`)
    restoreConsole()
    origConsoleLog(`\n摘要日志: ${currentTestLogFile}`)
    origConsoleLog(`事件日志: ${currentEventsLogFile}`)
  })

  beforeEach(() => {
    sessionId = uid()
  })

  afterEach(async () => {
    if (runtime) {
      try {
        await runtime.destroy()
      } catch {
        /* ignore */
      }
    }
  })

  // ===== 场景 1：简单问答（无工具） =====

  it('场景1 - 简单问答：完整 run → turn → llm → text 闭环', { timeout: 60_000 }, async () => {
    const inputText = '1+1等于几？用一个数字回答'
    const { chunks, timedChunks, collect } = createCollector()

    runtime = createRuntime({
      name: 'SimpleAgent',
      instructions: '你是一个简洁的助手。用一句话回答。',
      sessionId
    })
    await runtime.initialize()
    const result = await runtime.runStream(inputText, {}, collect)

    logTestResult('场景1 - 简单问答', {
      input: inputText,
      output: result.output,
      duration: result.duration,
      chunks,
      timedChunks
    })

    const seq = allTypes(chunks)
    expect(seq[0]).toBe('run:start')
    expect(seq[seq.length - 1]).toBe('run:done')
    expect(ofType(chunks, 'turn:start').length).toBe(ofType(chunks, 'turn:done').length)
    expect(ofType(chunks, 'llm:start').length).toBe(ofType(chunks, 'llm:done').length)
    expect(ofType(chunks, 'text:delta').length).toBeGreaterThan(0)
    assertOrdered(
      seq,
      'run:start',
      'turn:start',
      'llm:start',
      'text:delta',
      'llm:done',
      'turn:done',
      'run:done'
    )

    // 推理事件拆分验证
    assertReasoningSeparation(chunks, result.output, '场景1')

    // text:delta 拼接后应包含 "2"
    const fullText = ofType(chunks, 'text:delta')
      .map((c) => c.content)
      .join('')
    expect(fullText).toContain('2')
  })

  // ===== 场景 2：单工具调用 =====

  it('场景2 - 单工具调用：add_numbers', { timeout: 60_000 }, async () => {
    const inputText = '请计算 17 + 28'
    const { chunks, timedChunks, collect } = createCollector()

    runtime = createRuntime({
      name: 'MathAgent',
      instructions: '你是数学助手。必须使用 add_numbers 工具完成加法。根据工具结果回答。',
      customTools: [addNumbersTool],
      sessionId,
      maxTurns: 5
    })
    await runtime.initialize()
    const result = await runtime.runStream(inputText, {}, collect)

    logTestResult('场景2 - 单工具调用 add_numbers(17, 28)', {
      input: inputText,
      output: result.output,
      duration: result.duration,
      toolCalls: result.toolCalls,
      chunks,
      timedChunks
    })

    expect(result.output).toContain('45')
    const toolDones = ofType(chunks, 'tool:done')
    expect(toolDones.length).toBeGreaterThanOrEqual(1)
    expect(ofType(chunks, 'turn:start').length).toBe(ofType(chunks, 'turn:done').length)
    expect(ofType(chunks, 'llm:start').length).toBe(ofType(chunks, 'llm:done').length)
    expect(ofType(chunks, 'tool:start').length).toBe(ofType(chunks, 'tool:done').length)

    // tool:start 的 data 应包含工具名
    const toolStarts = ofType(chunks, 'tool:start')
    expect(toolStarts.length).toBeGreaterThanOrEqual(1)
    const toolData = toolStarts[0].data as { toolName?: string }
    expect(toolData?.toolName || toolStarts[0].content).toBe('add_numbers')

    // 推理事件拆分验证
    assertReasoningSeparation(chunks, result.output, '场景2')
  })

  // ===== 场景 3：链式工具调用 =====

  it('场景3 - 链式工具调用：先加法再乘法', { timeout: 90_000 }, async () => {
    const inputText = '先计算 10 + 20，然后把结果乘以 3。必须分两步用工具完成。'
    const { chunks, timedChunks, collect } = createCollector()

    runtime = createRuntime({
      name: 'ChainCalcAgent',
      instructions:
        '你是计算助手。加法用 add_numbers 工具，乘法用 multiply_numbers 工具。' +
        '必须分步执行：先调用 add_numbers 获得结果，再调用 multiply_numbers。',
      customTools: [addNumbersTool, multiplyNumbersTool],
      sessionId,
      maxTurns: 10
    })
    await runtime.initialize()
    const result = await runtime.runStream(inputText, {}, collect)

    logTestResult('场景3 - 链式工具调用（10+20 → 30×3）', {
      input: inputText,
      output: result.output,
      duration: result.duration,
      toolCalls: result.toolCalls,
      chunks,
      timedChunks
    })

    // 至少一次 tool:done
    const toolDones = ofType(chunks, 'tool:done')
    expect(toolDones.length).toBeGreaterThanOrEqual(1)

    // 至少两个 turn（工具调用 + 最终回答）
    expect(ofType(chunks, 'turn:start').length).toBeGreaterThanOrEqual(2)

    // 闭环检查
    expect(ofType(chunks, 'turn:start').length).toBe(ofType(chunks, 'turn:done').length)
    expect(ofType(chunks, 'llm:start').length).toBe(ofType(chunks, 'llm:done').length)
    expect(ofType(chunks, 'tool:start').length).toBe(ofType(chunks, 'tool:done').length)

    // 如果 LLM 确实完成了链式调用，验证最终结果
    if (toolDones.length >= 2) {
      expect(result.output).toContain('90')
    }

    // 推理事件拆分验证
    assertReasoningSeparation(chunks, result.output, '场景3')
  })

  // ===== 场景 4：并行工具调用 =====

  it('场景4 - 并行工具调用：同时加法和反转字符串', { timeout: 90_000 }, async () => {
    const inputText = '帮我同时做两件事：1) 计算 100 + 200；2) 反转 "hello"。请一次性调用两个工具。'
    const { chunks, timedChunks, collect } = createCollector()

    runtime = createRuntime({
      name: 'ParallelAgent',
      instructions:
        '你是多功能助手。加法用 add_numbers，反转文本用 reverse_string。' +
        '如果有多个任务，请尽量一次性并行调用所有工具。根据工具结果汇总回答。',
      customTools: [addNumbersTool, reverseStringTool],
      sessionId,
      maxTurns: 10
    })
    await runtime.initialize()
    const result = await runtime.runStream(inputText, {}, collect)

    logTestResult('场景4 - 并行工具调用 (add + reverse)', {
      input: inputText,
      output: result.output,
      duration: result.duration,
      toolCalls: result.toolCalls,
      chunks,
      timedChunks
    })

    expect(result.output).toContain('300')
    expect(result.output).toContain('olleh')

    const toolDones = ofType(chunks, 'tool:done')
    expect(toolDones.length).toBeGreaterThanOrEqual(2)

    // 闭环检查
    expect(ofType(chunks, 'turn:start').length).toBe(ofType(chunks, 'turn:done').length)
    expect(ofType(chunks, 'llm:start').length).toBe(ofType(chunks, 'llm:done').length)
    expect(ofType(chunks, 'tool:start').length).toBe(ofType(chunks, 'tool:done').length)

    // 推理事件拆分验证
    assertReasoningSeparation(chunks, result.output, '场景4')
  })

  // ===== 场景 5：多种工具混合 =====

  it('场景5 - 多种工具混合：天气 + 时间 + 计算', { timeout: 90_000 }, async () => {
    const inputText = '帮我查一下北京的天气，然后告诉我现在几点，最后算一下 42 + 58'
    const { chunks, timedChunks, collect } = createCollector()

    runtime = createRuntime({
      name: 'MixedToolAgent',
      instructions:
        '你是全能助手。查天气用 get_weather，查时间用 get_current_time，算加法用 add_numbers。' +
        '对于多个任务，可以并行或按顺序调用工具。最后汇总所有结果回答。',
      customTools: [getWeatherTool, getCurrentTimeTool, addNumbersTool],
      sessionId,
      maxTurns: 10
    })
    await runtime.initialize()
    const result = await runtime.runStream(inputText, {}, collect)

    logTestResult('场景5 - 多种工具混合 (weather + time + add)', {
      input: inputText,
      output: result.output,
      duration: result.duration,
      toolCalls: result.toolCalls,
      chunks,
      timedChunks
    })

    // 至少 3 次工具调用
    const toolDones = ofType(chunks, 'tool:done')
    expect(toolDones.length).toBeGreaterThanOrEqual(3)

    // 结果中应包含 100（42+58）
    expect(result.output).toContain('100')

    // 闭环
    expect(ofType(chunks, 'turn:start').length).toBe(ofType(chunks, 'turn:done').length)
    expect(ofType(chunks, 'llm:start').length).toBe(ofType(chunks, 'llm:done').length)
    expect(ofType(chunks, 'tool:start').length).toBe(ofType(chunks, 'tool:done').length)

    // 推理事件拆分验证
    assertReasoningSeparation(chunks, result.output, '场景5')
  })

  // ===== 场景 6：思考流独立验证 =====

  it('场景6 - 思考流独立：reasoning 与 text 分离', { timeout: 60_000 }, async () => {
    const inputText = '请解释为什么天空是蓝色的？'
    const { chunks, timedChunks, collect } = createCollector()

    runtime = createRuntime({
      name: 'ThinkingAgent',
      instructions: '你是一个科学助手。请详细回答问题。',
      thinkingLevel: 'medium',
      sessionId
    })
    await runtime.initialize()
    const result = await runtime.runStream(inputText, {}, collect)

    logTestResult('场景6 - 思考流独立', {
      input: inputText,
      output: result.output,
      duration: result.duration,
      chunks,
      timedChunks
    })

    const seq = allTypes(chunks)
    expect(seq[0]).toBe('run:start')
    expect(seq[seq.length - 1]).toBe('run:done')

    // 核心验证：推理事件独立性
    assertReasoningSeparation(chunks, result.output, '场景6')

    // 如果有 reasoning:delta，验证它不包含 <think> 标签
    const reasoningDeltas = ofType(chunks, 'reasoning:delta')
    for (const delta of reasoningDeltas) {
      expect(delta.content).not.toMatch(/<think>/i)
      expect(delta.content).not.toMatch(/<\/think>/i)
    }

    // 验证 text:delta 拼接后应包含有意义的内容
    const fullText = ofType(chunks, 'text:delta')
      .map((c) => c.content)
      .join('')
    expect(fullText.length).toBeGreaterThan(10)

    testLog(
      `${LOG_PREFIX}   [reasoning] 总共 ${reasoningDeltas.length} 个推理 delta, ` +
        `${ofType(chunks, 'text:delta').length} 个文本 delta`
    )

    // 闭环检查
    expect(ofType(chunks, 'turn:start').length).toBe(ofType(chunks, 'turn:done').length)
    expect(ofType(chunks, 'llm:start').length).toBe(ofType(chunks, 'llm:done').length)
  })

  // ===== 场景 7：Skill + AppendInstructions 注入验证 =====

  it(
    '场景7 - Skill 和 AppendInstructions 注入：LLM 能使用注入的领域知识',
    { timeout: 60_000 },
    async () => {
      const inputText = 'Zyphor 框架的核心设计理念是什么？'
      const { chunks, timedChunks, collect } = createCollector()

      // 注入一个虚构的技能知识（Zyphor 框架）
      // 如果 LLM 能回答关于 Zyphor 的问题，就证明 skill 内容被成功注入
      runtime = createRuntime({
        name: 'SkillAgent',
        instructions: '你是一个技术助手。根据你掌握的知识回答用户问题。',
        skills: [
          {
            name: 'zyphor-framework',
            description: 'Zyphor 前端框架文档',
            content: [
              '# Zyphor Framework v3.0',
              '',
              'Zyphor 是一个基于信号驱动（Signal-Driven）架构的前端框架。',
              '',
              '## 核心设计理念',
              '1. **信号优先（Signal-First）**：所有状态变更通过信号传播，无虚拟 DOM',
              '2. **编译时优化（Compile-Time Optimization）**：模板在构建阶段编译为最小化指令集',
              '3. **零运行时开销（Zero-Runtime Overhead）**：不需要框架运行时，编译后的代码直接操作 DOM',
              '',
              '## 核心 API',
              '- `createSignal(initialValue)` — 创建响应式信号',
              '- `createEffect(fn)` — 创建自动追踪依赖的副作用',
              '- `createMemo(fn)` — 创建缓存计算值'
            ].join('\n')
          }
        ],
        appendInstructions: [
          '回答时必须以"【Zyphor 专家解答】"作为开头。',
          '必须提及 Zyphor 的三个核心理念关键词：信号优先、编译时优化、零运行时开销。'
        ],
        sessionId
      })
      await runtime.initialize()
      const result = await runtime.runStream(inputText, {}, collect)

      logTestResult('场景7 - Skill + AppendInstructions 注入', {
        input: inputText,
        output: result.output,
        duration: result.duration,
        chunks,
        timedChunks
      })

      // 验证：LLM 能基于注入的 Skill 知识回答（Zyphor 是虚构的，只有注入才能回答）
      expect(result.output.toLowerCase()).toContain('zyphor')
      // 验证：LLM 提及了核心理念中的关键概念
      expect(result.output).toMatch(/信号|signal/i)

      // 验证：appendInstructions 生效（要求以特定格式开头）
      expect(result.output).toContain('Zyphor 专家解答')

      // 事件闭环
      const seq = allTypes(chunks)
      expect(seq[0]).toBe('run:start')
      expect(seq[seq.length - 1]).toBe('run:done')
      expect(ofType(chunks, 'turn:start').length).toBe(ofType(chunks, 'turn:done').length)
      expect(ofType(chunks, 'llm:start').length).toBe(ofType(chunks, 'llm:done').length)

      // 推理事件拆分验证
      assertReasoningSeparation(chunks, result.output, '场景7')

      testLog(
        `${LOG_PREFIX}   [skill] Skill 注入验证: ` +
          `output 包含 "Zyphor" = ${result.output.toLowerCase().includes('zyphor')}, ` +
          `output 包含 "专家解答" = ${result.output.includes('专家解答')}`
      )
    }
  )
})
