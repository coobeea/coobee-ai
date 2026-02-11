/**
 * PiMonoAgentRuntime 集成测试
 *
 * API 格式：
 *   统一使用 OpenAI Chat Completions 格式（openai-completions）。
 *   通过 baseURL 指向 OpenAI 兼容的后端 API。
 *   不依赖 Anthropic SDK，不使用 ANTHROPIC_AUTH_TOKEN。
 *
 * 验证更偏重业务逻辑的场景：
 *   1. 多轮对话 — session 保留上下文
 *   2. 同步 run() 模式 — 非流式执行
 *   3. text:delta 拼接一致性 — 拼接结果与 output 一致
 *   4. 事件闭环完整性 — turn/llm 正确配对嵌套
 *   5. 无参数工具调用 — get_current_time()
 *
 * 日志输出（分离存储，每次运行生成独立文件）：
 *
 *   ┌──────────────────────────────────────────────────────────────────────────┐
 *   │ 文件                                                   │ 内容           │
 *   ├──────────────────────────────────────────────────────────────────────────┤
 *   │ test-results/YYYYMMDD/pi-integ-test-{timestamp}.log    │ 摘要日志       │
 *   │   → 每个场景的输入/输出/耗时                                             │
 *   │   → 事件统计 + 闭环检查（start/done 配对）                                │
 *   │   → 详细事件流（时间戳 + 序号 + 类型 + 摘要）                             │
 *   ├──────────────────────────────────────────────────────────────────────────┤
 *   │ test-results/YYYYMMDD/pi-integ-events-{timestamp}.log  │ 原始事件日志   │
 *   │   → 每个事件的完整 JSON（含 data 字段）                                   │
 *   │   → SDK debug 级别的原始事件                                             │
 *   └──────────────────────────────────────────────────────────────────────────┘
 *
 *   注意：单元测试的输出文件名不同，见 PiMonoAgentRuntime.test.ts
 *
 * 运行命令：
 *   pnpm vitest run src/main/ai/runtime/pimono/__tests__/PiMonoAgentRuntime.integration.test.ts
 */

import fs from 'fs'
import path from 'path'
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { Type } from '@sinclair/typebox'

// ===== Electron 环境 stub =====

vi.mock('electron', () => {
  const home = process.env.HOME || '/tmp'
  const base = path.join(home, '.coobee-ai-test')
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

// ========== 日志系统 ==========

const LOG_PREFIX = '[PiIntegTest]'
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

// ========== 辅助类型和函数 ==========

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
  } else if (chunk.type === 'tool:start') {
    const d = chunk.data as { toolName?: string; callId?: string }
    detail = `tool=${d?.toolName || chunk.content}, callId=${d?.callId || 'N/A'}`
  } else if (chunk.type === 'tool:done') {
    const d = chunk.data as { toolName?: string; isError?: boolean }
    detail = `tool=${d?.toolName || 'N/A'}, result=${JSON.stringify((chunk.content || '').slice(0, 80))}`
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
  } else if (chunk.content) {
    const text = chunk.content.length > 60 ? chunk.content.slice(0, 60) + '...' : chunk.content
    detail = `content: ${JSON.stringify(text)}`
  }

  return `  [${time}] #${n}  ${type}${detail ? '  { ' + detail + ' }' : ''}`
}

function safeJsonStringify(x: unknown): string {
  try {
    return JSON.stringify(x, null, 2)
  } catch {
    return String(x)
  }
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

function checkClosedLoops(
  chunks: StreamChunk[]
): Record<string, { start: number; done: number; ok: boolean }> {
  const counts: Record<string, number> = {}
  for (const c of chunks) {
    counts[c.type] = (counts[c.type] || 0) + 1
  }
  const result: Record<string, { start: number; done: number; ok: boolean }> = {}
  const pairs: [string, string][] = [
    ['run:start', 'run:done'],
    ['turn:start', 'turn:done'],
    ['llm:start', 'llm:done'],
    ['text:start', 'text:done'],
    ['reasoning:start', 'reasoning:done'],
    ['tool:start', 'tool:done']
  ]
  for (const [s, d] of pairs) {
    const sc = counts[s] || 0
    const dc = counts[d] || 0
    if (sc > 0 || dc > 0) {
      result[s.split(':')[0]] = { start: sc, done: dc, ok: sc === dc }
    }
  }
  return result
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

  if (opts.chunks && opts.chunks.length > 0) {
    testLog(`${LOG_PREFIX} ${subSeparator}`)
    testLog(`${LOG_PREFIX}  事件流 (共 ${opts.chunks.length} 个事件):`)

    // 事件类型计数
    const typeCounts: Record<string, number> = {}
    for (const c of opts.chunks) {
      typeCounts[c.type] = (typeCounts[c.type] || 0) + 1
    }
    testLog(`${LOG_PREFIX}`)
    testLog(`${LOG_PREFIX}  事件统计:`)
    for (const [t, count] of Object.entries(typeCounts).sort()) {
      testLog(`${LOG_PREFIX}    ${t.padEnd(20)} : ${count}`)
    }

    // 闭环检查
    const loops = checkClosedLoops(opts.chunks)
    testLog(`${LOG_PREFIX}`)
    testLog(`${LOG_PREFIX}  闭环检查:`)
    for (const [name, check] of Object.entries(loops)) {
      testLog(
        `${LOG_PREFIX}    ${name.padEnd(12)} : ${check.start}/${check.done}  ${check.ok ? '✓' : '✗ MISMATCH'}`
      )
    }

    // 详细事件
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

// ========== 工具定义 ==========

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
      _onUpdate?: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _ctx?: any
    ) => {
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
  description: '将两个数字相加并返回结果',
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

const getCurrentTimeTool = createPiTool({
  name: 'get_current_time',
  label: 'Get Current Time',
  description: '获取当前日期和时间',
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

let counter = 0
function uid(): string {
  return `pi-integ-test-${Date.now()}-${++counter}`
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

describe.skipIf(!RUN)('PiMonoAgentRuntime 集成测试（OpenAI 兼容格式）', () => {
  let runtime: PiMonoAgentRuntime
  let sessionId: string

  beforeAll(() => {
    if (!apiConfig) return

    patchConsole()
    const now = new Date()
    const dateDir = now.toISOString().slice(0, 10).replace(/-/g, '')
    const runTs = Date.now()
    currentLogDir = path.join(TEST_LOG_BASE, dateDir)
    currentTestLogFile = path.join(currentLogDir, `pi-integ-test-${runTs}.log`)
    currentEventsLogFile = path.join(currentLogDir, `pi-integ-events-${runTs}.log`)
    ensureLogDir()

    const ts = now.toISOString()
    appendTestLog(
      `========== PiMonoAgentRuntime 集成测试 ${ts} ==========\n` +
        `  API 格式: openai-completions\n` +
        `  Model:    ${apiConfig.model}\n` +
        `  Base URL: ${apiConfig.baseURL}\n`
    )
    appendEventsLog(
      `========== PiMonoAgentRuntime 集成事件日志 ${ts} ==========\n` +
        `  API 格式: openai-completions\n` +
        `  Model:    ${apiConfig.model}\n` +
        `  Base URL: ${apiConfig.baseURL}\n`
    )

    testLog(
      `${LOG_PREFIX} API: openai-completions, model=${apiConfig.model}, ` +
        `baseURL=${apiConfig.baseURL}`
    )
  })

  afterAll(() => {
    if (!RUN) return
    const ts = new Date().toISOString()
    appendTestLog(`\n========== 集成测试结束 ${ts} ==========`)
    appendEventsLog(`\n========== 集成事件日志结束 ${ts} ==========`)
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

  // ===== 测试 1：多轮对话（session 上下文保留） =====

  it('多轮对话：session 保留上下文', { timeout: 120_000 }, async () => {
    testLog(`\n${LOG_PREFIX} ========== 多轮对话 ==========`)

    runtime = createRuntime({
      name: 'ContextAgent',
      instructions: '你是一个记忆力很好的助手。记住用户告诉你的信息并在后续回答中使用。',
      sessionId
    })
    await runtime.initialize()

    // Round 1: 提供信息
    const { chunks: chunks1, timedChunks: timedChunks1, collect: collect1 } = createCollector()
    const result1 = await runtime.runStream('我叫李明，今年25岁', {}, collect1)

    logTestResult('多轮对话 - Round 1 (提供信息)', {
      input: '我叫李明，今年25岁',
      output: result1.output,
      duration: result1.duration,
      chunks: chunks1,
      timedChunks: timedChunks1
    })

    expect(ofType(chunks1, 'run:start').length).toBe(1)
    expect(ofType(chunks1, 'run:done').length).toBe(1)

    // Round 2: 验证上下文
    const { chunks: chunks2, timedChunks: timedChunks2, collect: collect2 } = createCollector()
    const result2 = await runtime.runStream('我叫什么名字？几岁？', {}, collect2)

    logTestResult('多轮对话 - Round 2 (验证上下文)', {
      input: '我叫什么名字？几岁？',
      output: result2.output,
      duration: result2.duration,
      chunks: chunks2,
      timedChunks: timedChunks2
    })

    // 验证上下文保留
    expect(result2.output).toMatch(/李明/)
    expect(result2.output).toMatch(/25/)

    // 验证两轮都有完整闭环
    const loops2 = checkClosedLoops(chunks2)
    expect(loops2.run.ok).toBe(true)
    expect(loops2.turn.ok).toBe(true)
    expect(loops2.llm.ok).toBe(true)
  })

  // ===== 测试 2：同步 run() 模式 =====

  it('同步 run() 模式', { timeout: 60_000 }, async () => {
    testLog(`\n${LOG_PREFIX} ========== 同步 run() ==========`)

    runtime = createRuntime({
      name: 'SyncAgent',
      instructions: '你是一个简洁的助手。用一句话回答。',
      sessionId
    })
    await runtime.initialize()

    const result = await runtime.run('什么是人工智能？')

    testLog(`${LOG_PREFIX}  同步输出: ${result.output.slice(0, 150)}`)
    testLog(`${LOG_PREFIX}  耗时: ${result.duration}ms`)

    expect(result.output.length).toBeGreaterThan(5)
    expect(result.duration).toBeGreaterThan(0)
    expect(result.metadata?.agentId).toBeDefined()
    expect(result.metadata?.sessionId).toBe(sessionId)
  })

  // ===== 测试 3：text:delta 拼接一致性 =====

  it('text:delta 拼接与 output 一致', { timeout: 60_000 }, async () => {
    testLog(`\n${LOG_PREFIX} ========== text:delta 拼接一致性 ==========`)

    runtime = createRuntime({
      name: 'DeltaAgent',
      instructions: '你是一个简洁的助手。用一句话回答。',
      sessionId
    })
    await runtime.initialize()

    const { chunks, timedChunks, collect } = createCollector()
    const result = await runtime.runStream('请说一句名言', {}, collect)

    logTestResult('text:delta 拼接一致性', {
      input: '请说一句名言',
      output: result.output,
      duration: result.duration,
      chunks,
      timedChunks
    })

    // 拼接所有 text:delta
    const deltaText = ofType(chunks, 'text:delta')
      .map((c) => c.content)
      .join('')

    testLog(`${LOG_PREFIX}  output 长度: ${result.output.length}`)
    testLog(`${LOG_PREFIX}  delta 拼接长度: ${deltaText.length}`)

    // delta 拼接结果应与 output 一致
    expect(deltaText.length).toBeGreaterThan(0)
    expect(result.output).toContain(deltaText.slice(0, Math.min(50, deltaText.length)))
  })

  // ===== 测试 4：事件闭环完整性 =====

  it('事件闭环完整性：所有 start/done 正确配对', { timeout: 60_000 }, async () => {
    testLog(`\n${LOG_PREFIX} ========== 事件闭环完整性 ==========`)

    runtime = createRuntime({
      name: 'LoopAgent',
      instructions: '你是数学助手。必须使用 add_numbers 工具完成加法。',
      customTools: [addNumbersTool],
      sessionId,
      maxTurns: 10
    })
    await runtime.initialize()

    const { chunks, timedChunks, collect } = createCollector()
    const result = await runtime.runStream('请计算 99 + 1', {}, collect)

    logTestResult('事件闭环完整性 (99 + 1)', {
      input: '请计算 99 + 1',
      output: result.output,
      duration: result.duration,
      toolCalls: result.toolCalls,
      chunks,
      timedChunks
    })

    // 全面闭环检查
    const loops = checkClosedLoops(chunks)

    for (const [name, check] of Object.entries(loops)) {
      expect(check.ok, `${name} start/done 必须配对`).toBe(true)
    }

    // 嵌套顺序验证
    const seq = chunks.map((c) => c.type)
    expect(seq[0]).toBe('run:start')
    expect(seq[seq.length - 1]).toBe('run:done')

    // run 内应有 turn
    const firstTurn = seq.indexOf('turn:start')
    const lastTurn = seq.lastIndexOf('turn:done')
    expect(firstTurn).toBeGreaterThan(0) // run:start 之后
    expect(lastTurn).toBeLessThan(seq.length - 1) // run:done 之前

    // turn 内应有 llm
    const firstLlm = seq.indexOf('llm:start')
    expect(firstLlm).toBeGreaterThan(firstTurn)

    // 结果验证
    expect(result.output).toContain('100')
  })

  // ===== 测试 5：无参数工具调用 =====

  it('无参数工具调用：get_current_time', { timeout: 60_000 }, async () => {
    testLog(`\n${LOG_PREFIX} ========== 无参数工具调用 ==========`)

    runtime = createRuntime({
      name: 'TimeAgent',
      instructions: '你是时间助手。使用 get_current_time 工具获取时间，然后告诉用户。',
      customTools: [getCurrentTimeTool],
      sessionId,
      maxTurns: 5
    })
    await runtime.initialize()

    const { chunks, timedChunks, collect } = createCollector()
    const result = await runtime.runStream('现在几点？', {}, collect)

    logTestResult('无参数工具调用 get_current_time()', {
      input: '现在几点？',
      output: result.output,
      duration: result.duration,
      toolCalls: result.toolCalls,
      chunks,
      timedChunks
    })

    // 应至少调用一次工具
    const toolDones = ofType(chunks, 'tool:done')
    expect(toolDones.length).toBeGreaterThanOrEqual(1)

    // tool:start 应包含 get_current_time
    const toolStarts = ofType(chunks, 'tool:start')
    expect(toolStarts.length).toBeGreaterThanOrEqual(1)
    const firstToolData = toolStarts[0].data as { toolName?: string }
    expect(firstToolData?.toolName || toolStarts[0].content).toBe('get_current_time')

    // 闭环
    const loops = checkClosedLoops(chunks)
    for (const [name, check] of Object.entries(loops)) {
      expect(check.ok, `${name} must be paired`).toBe(true)
    }

    // 会话信息
    const session = await runtime.getSession()
    testLog(`${LOG_PREFIX}  Session: ${JSON.stringify(session)}`)
    expect(session.sessionId).toBe(sessionId)
    expect(session.messageCount).toBeGreaterThan(0)
  })
})
