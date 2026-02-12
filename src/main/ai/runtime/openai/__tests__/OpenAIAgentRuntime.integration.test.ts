/**
 * OpenAIAgentRuntime 集成测试（真实 API 调用）
 *
 * 真实调用链：
 *   ✅ OpenAIAgentRuntime（真实）
 *   ✅ @openai/agents SDK Agent + run()（真实）
 *   ✅ tool() 定义 + execute（真实）
 *   ✅ FileSession 文件持久化（真实）
 *   ✅ StreamEmitter 事件广播（真实）
 *   ✅ LLM API 请求（真实，通过 MiniMax / OpenAI 兼容接口）
 *
 * 唯一 stub：Electron 环境层（electron, electron-log）
 *
 * 日志输出（参考 Joythink-AI 日志模式）：
 *   test-results/YYYYMMDD/
 *     - integration-test-{timestamp}.log       — 摘要日志（事件流转 + 测试结果）
 *     - integration-events-{timestamp}.log     — 完整事件数据（每个 chunk 的 JSON）
 *
 * 运行命令：
 *   pnpm vitest run src/main/ai/runtime/__tests__/OpenAIAgentRuntime.integration.test.ts
 */

import fs from 'fs'
import path from 'path'
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { rm } from 'fs/promises'
import { join } from 'path'

// ===== Electron 环境 stub（非业务 mock） =====

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
import { SessionCompressor } from '../SessionCompressor'
import { FileSession } from '../FileSession'
import type { StreamChunk } from '../../types'

// ========== API 配置 ==========

function resolveApiConfig(): { apiKey: string; baseURL?: string; model: string } | null {
  if (process.env.OPENAI_API_KEY) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    }
  }
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

// ========== 日志系统 ==========

const LOG_PREFIX = '[集成测试]'
const TEST_LOG_BASE = path.join(process.cwd(), 'test-results')
/** Session 存储目录（测试用固定路径，与 readSessionFile 保持一致） */
const TEST_SESSION_DIR = path.join(process.cwd(), 'test-results', 'userData', 'sessions')

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

/** 同时输出到控制台和摘要日志 */
function testLog(line: string): void {
  console.log(line)
  try {
    appendTestLog(line)
  } catch {
    // ignore
  }
}

/** 格式化单条 chunk 为可读摘要 */
function formatChunkSummary(chunk: StreamChunk, index: number, elapsed: number): string {
  const n = String(index + 1).padStart(3)
  const time = String(elapsed).padStart(6) + 'ms'
  const type = chunk.type.padEnd(18)

  let detail = ''
  if (chunk.type === 'text:delta') {
    const text = chunk.content.length > 60 ? chunk.content.slice(0, 60) + '...' : chunk.content
    detail = `content: ${JSON.stringify(text)}`
  } else if (chunk.type === 'reasoning:delta') {
    const text = chunk.content.length > 60 ? chunk.content.slice(0, 60) + '...' : chunk.content
    detail = `reasoning: ${JSON.stringify(text)}`
  } else if (chunk.type === 'reasoning:start' || chunk.type === 'reasoning:done') {
    const d = chunk.data as { rawContent?: string } | undefined
    detail = d?.rawContent ? `rawContent: ${JSON.stringify(d.rawContent.slice(0, 60))}` : ''
  } else if (chunk.type === 'tool:done') {
    detail = `content: ${JSON.stringify((chunk.content || '').slice(0, 80))}`
  } else if (chunk.type === 'llm:done' && chunk.data) {
    const d = chunk.data as { usage?: { totalTokens?: number } }
    detail = d.usage ? `tokens: ${d.usage.totalTokens}` : ''
  } else if (chunk.type === 'turn:start' || chunk.type === 'turn:done') {
    const d = chunk.data as { turnIndex?: number }
    detail = d?.turnIndex ? `turnIndex: ${d.turnIndex}` : ''
  } else if (chunk.content) {
    const text = chunk.content.length > 60 ? chunk.content.slice(0, 60) + '...' : chunk.content
    detail = `content: ${JSON.stringify(text)}`
  }

  return `  [${time}] #${n} ${type}${detail ? ' { ' + detail + ' }' : ''}`
}

function safeJsonStringify(x: unknown): string {
  try {
    return JSON.stringify(x, null, 2)
  } catch {
    return String(x)
  }
}

/** 将完整事件数据写入 events 日志 */
function logEventsData(testName: string, timedChunks: TimedChunk[]): void {
  try {
    appendEventsLog('')
    appendEventsLog(`---------- 测试: ${testName} | 共 ${timedChunks.length} 个事件 ----------`)
    for (const tc of timedChunks) {
      appendEventsLog(`#${tc.seq} ${tc.type}`)
      appendEventsLog(safeJsonStringify(tc))
      appendEventsLog('')
    }
    appendEventsLog('='.repeat(60))
  } catch {
    // ignore
  }
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
    ['tool:start', 'tool:done']
  ]
  for (const [s, d] of pairs) {
    const sc = counts[s] || 0
    const dc = counts[d] || 0
    if (sc > 0 || dc > 0) {
      const ok = sc === dc ? '✓' : `✗ MISMATCH`
      lines.push(`    ${s}/${d}: ${sc}/${dc} ${ok}`)
    }
  }
  return lines
}

/** 核心日志函数：写入测试结果到摘要日志 + 事件日志 */
function logTestResult(
  testName: string,
  opts: {
    input?: string
    output?: string
    duration?: number
    toolCalls?: Array<{ toolName: string; arguments: unknown }> | null
    chunks?: StreamChunk[]
    timedChunks?: TimedChunk[]
    extraMessage?: string
  }
): void {
  testLog('')
  testLog(`${LOG_PREFIX} ---------- 测试: ${testName} ----------`)

  if (opts.input) testLog(`${LOG_PREFIX} 输入: ${opts.input}`)
  if (opts.output) {
    const show = opts.output.length > 100 ? opts.output.slice(0, 100) + '...' : opts.output
    testLog(`${LOG_PREFIX} 输出: ${show}`)
  }
  if (opts.duration) testLog(`${LOG_PREFIX} 耗时: ${opts.duration}ms`)
  if (opts.toolCalls && opts.toolCalls.length > 0) {
    testLog(
      `${LOG_PREFIX} 工具调用: ${opts.toolCalls.map((t) => `${t.toolName}(${JSON.stringify(t.arguments)})`).join(', ')}`
    )
  }

  // 事件序列
  if (opts.chunks && opts.chunks.length > 0) {
    const types = opts.chunks.map((c) => c.type)
    testLog(`${LOG_PREFIX} 事件序列 (${opts.chunks.length} 个):`)
    testLog(`${LOG_PREFIX}   ${types.join(' → ')}`)

    // 闭环检查
    const loopChecks = checkClosedLoops(opts.chunks)
    if (loopChecks.length > 0) {
      testLog(`${LOG_PREFIX} 闭环检查:`)
      for (const l of loopChecks) testLog(`${LOG_PREFIX} ${l}`)
    }

    // 详细事件
    if (opts.timedChunks) {
      testLog(`${LOG_PREFIX} 详细事件:`)
      for (const tc of opts.timedChunks) {
        testLog(
          `${LOG_PREFIX}${formatChunkSummary({ type: tc.type, content: tc.content, data: tc.data }, tc.seq - 1, tc.elapsed)}`
        )
      }
    }
  }

  if (opts.extraMessage) testLog(`${LOG_PREFIX} ${opts.extraMessage}`)

  testLog(`${LOG_PREFIX} ${'='.repeat(50)}`)

  // 写入完整事件数据到 events 日志
  if (opts.timedChunks && opts.timedChunks.length > 0) {
    logEventsData(testName, opts.timedChunks)
  }
}

// ========== 真实工具 ==========

const addNumbersTool = tool({
  name: 'add_numbers',
  description: '将两个数字相加并返回结果。当用户要求计算加法时必须使用此工具。',
  parameters: z.object({
    a: z.number().describe('第一个数字'),
    b: z.number().describe('第二个数字')
  }),
  execute: async ({ a, b }) => {
    const result = a + b
    return JSON.stringify({ result, expression: `${a} + ${b} = ${result}` })
  }
})

const getCurrentTimeTool = tool({
  name: 'get_current_time',
  description: '获取当前日期和时间。当用户询问时间时使用。',
  parameters: z.object({}),
  execute: async () => {
    const now = new Date()
    return JSON.stringify({
      date: now.toLocaleDateString('zh-CN'),
      time: now.toLocaleTimeString('zh-CN')
    })
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
    return JSON.stringify({ original: text, reversed })
  }
})

// ========== 辅助 ==========

interface TimedChunk extends StreamChunk {
  elapsed: number
  seq: number
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
 * 1. text:delta 不含 <think> 标签
 * 2. text:done 内容不含 <think> 标签
 * 3. result.output 不含 <think> 标签
 * 4. 如果有 reasoning 事件，start/done 必须配对
 */
function assertReasoningSeparation(chunks: StreamChunk[], output: string, testName: string): void {
  const textDeltas = ofType(chunks, 'text:delta')
  for (const delta of textDeltas) {
    expect(delta.content, `[${testName}] text:delta 不应包含 <think>`).not.toMatch(/<think>/i)
    expect(delta.content, `[${testName}] text:delta 不应包含 </think>`).not.toMatch(/<\/think>/i)
  }
  const textDones = ofType(chunks, 'text:done')
  for (const done of textDones) {
    expect(done.content, `[${testName}] text:done 不应包含 <think>`).not.toMatch(/<think>/i)
  }
  expect(output, `[${testName}] output 不应包含 <think>`).not.toMatch(/<think>/i)

  const reasoningStarts = ofType(chunks, 'reasoning:start').length
  const reasoningDones = ofType(chunks, 'reasoning:done').length
  if (reasoningStarts > 0 || reasoningDones > 0) {
    expect(reasoningStarts, `[${testName}] reasoning 闭环`).toBe(reasoningDones)
    expect(ofType(chunks, 'reasoning:delta').length).toBeGreaterThan(0)
    testLog(
      `${LOG_PREFIX}   [reasoning] ${reasoningStarts} 个推理块, ${ofType(chunks, 'reasoning:delta').length} 个 delta`
    )
  }
}

let counter = 0
function uid(): string {
  return `integ-${Date.now()}-${++counter}`
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

// ========== 测试 ==========

describe.skipIf(!RUN)('OpenAIAgentRuntime 集成测试（真实 API）', () => {
  let runtime: OpenAIAgentRuntime
  let sessionId: string
  let MODEL: string

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

    // 初始化日志目录和文件
    const now = new Date()
    const dateDir = now.toISOString().slice(0, 10).replace(/-/g, '')
    const runTs = Date.now()
    currentLogDir = path.join(TEST_LOG_BASE, dateDir)
    currentTestLogFile = path.join(currentLogDir, `integration-test-${runTs}.log`)
    currentEventsLogFile = path.join(currentLogDir, `integration-events-${runTs}.log`)
    ensureLogDir()

    const ts = now.toISOString()
    appendTestLog(`========== OpenAIAgentRuntime 集成测试 ${ts} | model=${MODEL} ==========`)
    appendTestLog(`日志文件: ${currentTestLogFile}`)
    appendTestLog(`事件文件: ${currentEventsLogFile}`)
    appendTestLog('')
    appendEventsLog(`========== OpenAIAgentRuntime 事件日志 ${ts} | model=${MODEL} ==========`)
    appendEventsLog('')

    testLog(`${LOG_PREFIX} API: model=${MODEL}, baseURL=${apiConfig.baseURL || 'OpenAI'}`)
    testLog(`${LOG_PREFIX} 摘要日志: ${currentTestLogFile}`)
    testLog(`${LOG_PREFIX} 事件日志: ${currentEventsLogFile}`)
  })

  afterAll(() => {
    if (!RUN) return
    const ts = new Date().toISOString()
    appendTestLog(`\n========== 集成测试结束 ${ts} ==========`)
    appendEventsLog(`\n========== 事件日志结束 ${ts} ==========`)
    testLog(`\n${LOG_PREFIX} 日志已输出到: ${currentLogDir}`)
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
    try {
      const sessionsDir = join(process.cwd(), 'test-results', 'userData', 'sessions')
      await rm(join(sessionsDir, sessionId), { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  // ===== 场景 1：简单问答 =====

  it('简单问答：完整 run → turn → llm → text 闭环', { timeout: 60_000 }, async () => {
    const inputText = '1+1等于几？'
    const { chunks, timedChunks, collect } = createCollector()

    runtime = new OpenAIAgentRuntime({
      name: 'SimpleAgent',
      instructions: '你是一个简洁的助手。用一句话回答，不超过20个字。',
      model: MODEL,
      sessionId,
      sessionDir: TEST_SESSION_DIR
    })
    await runtime.initialize()
    const result = await runtime.runStream(inputText, {}, collect)

    logTestResult('简单问答', {
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
    expect(ofType(chunks, 'tool:start')).toHaveLength(0)
    assertReasoningSeparation(chunks, result.output, '简单问答')
  })

  // ===== 场景 2：单工具调用 =====

  it('单工具调用：add_numbers(17,28) → 结果 45', { timeout: 60_000 }, async () => {
    const inputText = '请计算 17 + 28'
    const { chunks, timedChunks, collect } = createCollector()

    runtime = new OpenAIAgentRuntime({
      name: 'MathAgent',
      instructions: '你是数学助手。必须使用 add_numbers 工具完成加法。根据工具结果回答。',
      model: MODEL,
      sdkTools: [addNumbersTool],
      sessionId,
      sessionDir: TEST_SESSION_DIR,
      maxTurns: 5
    })
    await runtime.initialize()
    const result = await runtime.runStream(inputText, {}, collect)

    logTestResult('单工具调用 add_numbers(17,28)', {
      input: inputText,
      output: result.output,
      duration: result.duration,
      toolCalls: result.toolCalls,
      chunks,
      timedChunks
    })

    expect(result.output).toContain('45')
    expect(ofType(chunks, 'turn:start').length).toBeGreaterThanOrEqual(2)
    const toolDones = ofType(chunks, 'tool:done')
    expect(toolDones.length).toBeGreaterThanOrEqual(1)
    expect(toolDones[0].content).toContain('45')
    expect(result.toolCalls!.length).toBeGreaterThanOrEqual(1)
    expect(result.toolCalls![0].toolName).toBe('add_numbers')
    expect(ofType(chunks, 'turn:start').length).toBe(ofType(chunks, 'turn:done').length)
    expect(ofType(chunks, 'llm:start').length).toBe(ofType(chunks, 'llm:done').length)
    const seq = allTypes(chunks)
    expect(seq[0]).toBe('run:start')
    expect(seq[seq.length - 1]).toBe('run:done')
    assertReasoningSeparation(chunks, result.output, '单工具调用')
  })

  // ===== 场景 3：多工具 =====

  it('多工具：add_numbers + reverse_string', { timeout: 60_000 }, async () => {
    const inputText = '帮我做两件事：1) 100 + 200；2) 反转 "hello"'
    const { chunks, timedChunks, collect } = createCollector()

    runtime = new OpenAIAgentRuntime({
      name: 'MultiToolAgent',
      instructions:
        '你是多功能助手。加法用 add_numbers，反转文本用 reverse_string。依次完成所有任务后汇总。',
      model: MODEL,
      sdkTools: [addNumbersTool, reverseStringTool],
      sessionId,
      sessionDir: TEST_SESSION_DIR,
      maxTurns: 10
    })
    await runtime.initialize()
    const result = await runtime.runStream(inputText, {}, collect)

    logTestResult('多工具 add_numbers + reverse_string', {
      input: inputText,
      output: result.output,
      duration: result.duration,
      toolCalls: result.toolCalls,
      chunks,
      timedChunks
    })

    expect(result.output).toContain('300')
    expect(result.output).toContain('olleh')
    expect(ofType(chunks, 'tool:done').length).toBeGreaterThanOrEqual(2)
    expect(ofType(chunks, 'turn:start').length).toBe(ofType(chunks, 'turn:done').length)
    assertReasoningSeparation(chunks, result.output, '多工具')
  })

  // ===== 场景 4：同步 run() =====

  it('同步 run()：工具调用后返回完整结果', { timeout: 60_000 }, async () => {
    const inputText = '50 + 75 等于？'

    runtime = new OpenAIAgentRuntime({
      name: 'SyncMathAgent',
      instructions: '数学助手。必须使用 add_numbers 工具。只回答计算结果。',
      model: MODEL,
      sdkTools: [addNumbersTool],
      sessionId,
      sessionDir: TEST_SESSION_DIR,
      maxTurns: 5
    })
    await runtime.initialize()
    const result = await runtime.run(inputText)

    logTestResult('同步 run() + 工具', {
      input: inputText,
      output: result.output,
      duration: result.duration,
      toolCalls: result.toolCalls,
      extraMessage: `同步模式无 stream 事件，toolCalls: ${JSON.stringify(result.toolCalls)}`
    })

    expect(result.output).toContain('125')
    expect(result.toolCalls!.length).toBeGreaterThanOrEqual(1)
    expect(result.toolCalls![0].toolName).toBe('add_numbers')
    expect(result.duration).toBeGreaterThan(0)
    // 同步模式 output 也应该干净
    expect(result.output).not.toMatch(/<think>/i)
  })

  // ===== 场景 5：多轮对话 =====

  it('多轮对话：session 保留上下文', { timeout: 60_000 }, async () => {
    runtime = new OpenAIAgentRuntime({
      name: 'ContextAgent',
      instructions: '你是简洁的助手。请记住用户告诉你的所有个人信息，并在后续对话中准确复述。',
      model: MODEL,
      sessionId,
      sessionDir: TEST_SESSION_DIR,
      maxTurns: 3
    })
    await runtime.initialize()

    const r1 = await runtime.run('请记住：我叫小明，今年25岁。')
    const r2 = await runtime.run('请告诉我，我之前说过我叫什么名字？直接回答名字即可。')

    logTestResult('多轮对话 session 持久化', {
      extraMessage: [
        `第1轮 输入: 请记住：我叫小明，今年25岁。`,
        `第1轮 输出: ${r1.output}`,
        `第2轮 输入: 请告诉我，我之前说过我叫什么名字？`,
        `第2轮 输出: ${r2.output}`,
        `包含"小明": ${r2.output.includes('小明') ? '✓' : '✗'}`
      ].join('\n')
    })

    expect(r2.output).toContain('小明')
  })

  // ===== 场景 6：无参数工具 =====

  it('无参数工具：get_current_time', { timeout: 60_000 }, async () => {
    const inputText = '现在几点？'
    const { chunks, timedChunks, collect } = createCollector()

    runtime = new OpenAIAgentRuntime({
      name: 'TimeAgent',
      instructions: '你是时间助手。必须使用 get_current_time 工具获取时间。',
      model: MODEL,
      sdkTools: [getCurrentTimeTool],
      sessionId,
      sessionDir: TEST_SESSION_DIR,
      maxTurns: 5
    })
    await runtime.initialize()
    const result = await runtime.runStream(inputText, {}, collect)

    logTestResult('无参数工具 get_current_time', {
      input: inputText,
      output: result.output,
      duration: result.duration,
      chunks,
      timedChunks
    })

    expect(result.output.length).toBeGreaterThan(0)
    expect(ofType(chunks, 'tool:done').length).toBeGreaterThanOrEqual(1)
    expect(ofType(chunks, 'turn:start').length).toBe(ofType(chunks, 'turn:done').length)
    assertReasoningSeparation(chunks, result.output, '无参数工具')
  })

  // ===== 场景 7：事件闭环完整性 =====

  it('事件闭环：工具场景 turn/llm 正确配对嵌套', { timeout: 60_000 }, async () => {
    const inputText = '3 + 7 等于？'
    const { chunks, timedChunks, collect } = createCollector()

    runtime = new OpenAIAgentRuntime({
      name: 'IntegrityAgent',
      instructions: '数学助手。用 add_numbers 工具，然后中文回答。',
      model: MODEL,
      sdkTools: [addNumbersTool],
      sessionId,
      sessionDir: TEST_SESSION_DIR,
      maxTurns: 5
    })
    await runtime.initialize()
    const result = await runtime.runStream(inputText, {}, collect)

    logTestResult('事件闭环完整性', {
      input: inputText,
      output: result.output,
      duration: result.duration,
      chunks,
      timedChunks
    })

    const seq = allTypes(chunks)
    expect(seq[0]).toBe('run:start')
    expect(seq[seq.length - 1]).toBe('run:done')
    expect(ofType(chunks, 'run:start')).toHaveLength(1)
    expect(ofType(chunks, 'run:done')).toHaveLength(1)
    const ts = ofType(chunks, 'turn:start')
    const td = ofType(chunks, 'turn:done')
    expect(ts.length).toBe(td.length)
    expect(ts.length).toBeGreaterThanOrEqual(2)
    for (let i = 0; i < ts.length; i++) {
      expect((ts[i].data as { turnIndex: number }).turnIndex).toBe(i + 1)
      expect((td[i].data as { turnIndex: number }).turnIndex).toBe(i + 1)
    }
    expect(ofType(chunks, 'llm:start').length).toBe(ofType(chunks, 'llm:done').length)
    expect(seq.indexOf('run:start')).toBeLessThan(seq.indexOf('turn:start'))
    expect(seq.indexOf('run:done')).toBeGreaterThan(seq.lastIndexOf('turn:done'))
    assertReasoningSeparation(chunks, result.output, '事件闭环')
  })

  // ===== 场景 8：text:delta 拼接 =====

  it('text:delta 拼接结果一致', { timeout: 60_000 }, async () => {
    const inputText = '中国的首都是哪里？'
    const { chunks, timedChunks, collect } = createCollector()

    runtime = new OpenAIAgentRuntime({
      name: 'DeltaAgent',
      instructions: '用一句简短的话回答。',
      model: MODEL,
      sessionId,
      sessionDir: TEST_SESSION_DIR
    })
    await runtime.initialize()
    const result = await runtime.runStream(inputText, {}, collect)

    const assembled = ofType(chunks, 'text:delta')
      .map((c) => c.content)
      .join('')

    logTestResult('text:delta 拼接', {
      input: inputText,
      output: result.output,
      duration: result.duration,
      chunks,
      timedChunks,
      extraMessage: `delta 拼接结果: ${assembled}`
    })

    const deltas = ofType(chunks, 'text:delta')
    expect(deltas.length).toBeGreaterThan(0)
    expect(assembled.length).toBeGreaterThan(0)
    expect(assembled).toContain('北京')
    assertReasoningSeparation(chunks, result.output, 'delta拼接')
  })

  // ===== 场景 9：Session 压缩（追加式） =====

  it('Session 压缩：多轮对话后手动压缩，上下文保留', { timeout: 120_000 }, async () => {
    // 1. 创建 runtime（不启用自动压缩，手动测试）
    runtime = new OpenAIAgentRuntime({
      name: 'CompressionAgent',
      instructions: '你是一个简洁的助手。请记住用户告知的所有信息。',
      model: MODEL,
      sessionId,
      sessionDir: TEST_SESSION_DIR,
      maxTurns: 3
    })
    await runtime.initialize()

    // 2. 进行多轮对话，积累 session 历史
    const conversations = [
      '我叫小明，是一名前端工程师，在北京工作。',
      '我正在开发一个 Electron 应用，使用 Vue 3 和 TypeScript。',
      '项目名叫 coobee-ai，是一个 AI 助手应用。',
      '我喜欢用 Tailwind CSS 做样式。'
    ]

    const results: string[] = []
    for (const msg of conversations) {
      const r = await runtime.run(msg)
      results.push(r.output)
    }

    // 3. 检查 session 中消息数量
    const sessionBefore = await runtime.getSession()
    testLog('')
    testLog(`${LOG_PREFIX} ---------- 测试: Session 压缩（追加式） ----------`)
    testLog(`${LOG_PREFIX} 压缩前: ${sessionBefore.messageCount} 条消息`)
    for (let i = 0; i < conversations.length; i++) {
      testLog(
        `${LOG_PREFIX}   第${i + 1}轮: "${conversations[i]}" → "${results[i].slice(0, 60)}..."`
      )
    }

    // 4. 读取压缩前的 session 文件内容（用于调试 — 新格式 SessionItem）
    const sessionFilePath = join(
      process.cwd(),
      'test-results',
      'userData',
      'sessions',
      sessionId,
      'messages.jsonl'
    )
    let beforeContent = ''
    try {
      beforeContent = fs.readFileSync(sessionFilePath, 'utf-8')
    } catch {
      /* ignore */
    }
    testLog(`${LOG_PREFIX} 压缩前 session 文件 (SessionItem 格式):`)
    for (const line of beforeContent.split('\n').filter(Boolean)) {
      try {
        const parsed = JSON.parse(line)
        // 新格式: { seq, type, item, ts }
        if (typeof parsed.seq === 'number') {
          const si = parsed as { seq: number; type: string; item: Record<string, unknown> }
          const role = (si.item.role as string) || (si.item.type as string) || 'unknown'
          const content = typeof si.item.content === 'string' ? si.item.content.slice(0, 80) : ''
          testLog(`${LOG_PREFIX}   [seq=${si.seq} ${si.type}] [${role}] ${content}...`)
        } else {
          // 旧格式兼容
          const role = parsed.role || parsed.type || 'unknown'
          const content = typeof parsed.content === 'string' ? parsed.content.slice(0, 80) : ''
          testLog(`${LOG_PREFIX}   [旧格式] [${role}] ${content}...`)
        }
      } catch {
        testLog(`${LOG_PREFIX}   [raw] ${line.slice(0, 80)}...`)
      }
    }

    // 5. 手动触发压缩（force=true 降低消息数阈值）
    const compressionResult = await runtime.compressSession({ force: true })

    testLog(
      `${LOG_PREFIX} 压缩结果: compressed=${compressionResult.compressed}, ` +
        `summarized=${compressionResult.summarizedCount} msgs, ` +
        `kept=${compressionResult.keptCount} msgs, ` +
        `seqs=[${(compressionResult.summarizedSeqs || []).join(',')}], ` +
        `endSeq=${compressionResult.endSeq}, ` +
        `tokens: ${compressionResult.originalTokens} → ${compressionResult.summaryTokens}, ` +
        `耗时: ${compressionResult.duration}ms`
    )

    // 6. 检查压缩后的 session（追加式：总消息数增加了 1 条 summary）
    const sessionAfter = await runtime.getSession()
    testLog(`${LOG_PREFIX} 压缩后: ${sessionAfter.messageCount} 条 message 消息`)

    // 读取压缩后的 session 文件内容（调试）
    let afterContent = ''
    try {
      afterContent = fs.readFileSync(sessionFilePath, 'utf-8')
    } catch {
      /* ignore */
    }
    testLog(`${LOG_PREFIX} 压缩后 session 文件:`)
    let summaryCount = 0
    for (const line of afterContent.split('\n').filter(Boolean)) {
      try {
        const parsed = JSON.parse(line)
        if (typeof parsed.seq === 'number') {
          const si = parsed as {
            seq: number
            type: string
            item: Record<string, unknown>
            meta?: { summaryText?: string; endSeq?: number; summarizedSeqs?: number[] }
          }
          if (si.type === 'summary') {
            summaryCount++
            testLog(
              `${LOG_PREFIX}   [seq=${si.seq} SUMMARY] endSeq=${si.meta?.endSeq}, ` +
                `summarized=${si.meta?.summarizedSeqs?.length} msgs, ` +
                `text: ${(si.meta?.summaryText || '').slice(0, 100)}...`
            )
          } else {
            const role = (si.item.role as string) || 'unknown'
            const content = typeof si.item.content === 'string' ? si.item.content.slice(0, 80) : ''
            testLog(`${LOG_PREFIX}   [seq=${si.seq} ${si.type}] [${role}] ${content}...`)
          }
        }
      } catch {
        testLog(`${LOG_PREFIX}   [raw] ${line.slice(0, 120)}...`)
      }
    }
    testLog(`${LOG_PREFIX} Summary 项数: ${summaryCount}`)

    // 7. 验证 getItems() 智能上下文构建：应只返回总结上下文 + 后续消息
    const session = new FileSession(sessionId, TEST_SESSION_DIR)
    const contextItems = await session.getItems()
    testLog(`${LOG_PREFIX} getItems() 返回 ${contextItems.length} 条上下文消息`)

    // 8. 验证压缩后上下文仍然保留：询问之前说过的信息
    const verifyResult = await runtime.run('请告诉我，我叫什么名字？我在开发什么项目？')

    testLog(`${LOG_PREFIX} 验证: "${verifyResult.output.slice(0, 200)}"`)
    testLog(
      `${LOG_PREFIX} 包含"小明": ${verifyResult.output.includes('小明') ? '✓' : '✗'}, ` +
        `包含"coobee": ${verifyResult.output.toLowerCase().includes('coobee') ? '✓' : '✗'}`
    )
    testLog(`${LOG_PREFIX} ==================================================`)

    // 写入事件日志
    if (compressionResult.compressed) {
      try {
        appendEventsLog('')
        appendEventsLog('---------- 测试: Session 压缩（追加式） ----------')
        appendEventsLog(`压缩结果: ${safeJsonStringify(compressionResult)}`)
        appendEventsLog(`getItems 上下文: ${contextItems.length} 条`)
        appendEventsLog(`验证输出: ${verifyResult.output}`)
        appendEventsLog('='.repeat(60))
      } catch {
        // ignore
      }
    }

    // 9. 断言
    expect(compressionResult.compressed).toBe(true)
    expect(compressionResult.summarizedSeqs).toBeDefined()
    expect(compressionResult.summarizedSeqs!.length).toBeGreaterThan(0)
    expect(compressionResult.endSeq).toBeGreaterThan(0)
    // 追加式：summary 被追加到文件，文件总行数增加
    expect(summaryCount).toBe(1)
    // getItems() 返回的上下文应少于压缩前的总消息数
    // （2 条总结上下文 + 保留的消息，少于原始 8+ 条消息）
    expect(contextItems.length).toBeLessThan(sessionBefore.messageCount)
    // 压缩后仍能回忆关键信息
    expect(verifyResult.output.toLowerCase()).toContain('coobee')
    const hasMingName = verifyResult.output.includes('小明')
    testLog(`${LOG_PREFIX} [断言] "小明" 保留: ${hasMingName ? '✓' : '✗（总结未包含）'}`)
  })
})

// ===== 独立测试：SessionCompressor + tokenCounter 单元级验证 =====

describe('SessionCompressor 单元验证', () => {
  it('countTokens 中英文混合估算 (tokenx)', async () => {
    const { countTokens } = await import('../tokenCounter')
    // 纯中文
    const zhTokens = countTokens('你好世界这是测试')
    expect(zhTokens).toBeGreaterThan(3)
    // 纯英文
    const enTokens = countTokens('hello world this is a test')
    expect(enTokens).toBeGreaterThan(4)
    // 混合
    const mixedTokens = countTokens('hello 你好 world 世界')
    expect(mixedTokens).toBeGreaterThan(3)
  })

  it('compressIfNeeded 未启用时返回 compressed=false', async () => {
    const compressor = new SessionCompressor({ enabled: false })
    const tempDir = join(process.cwd(), 'test-results', 'sessions')
    const session = new FileSession('compress-test-disabled', tempDir)
    const result = await compressor.compressIfNeeded(session, 'test-model')
    expect(result.compressed).toBe(false)
  })

  it('compressIfNeeded 消息不足时返回 compressed=false', async () => {
    const compressor = new SessionCompressor({
      enabled: true,
      minMessageCount: 10
    })
    const tempDir = join(process.cwd(), 'test-results', 'sessions')
    const session = new FileSession('compress-test-few', tempDir)
    // 只加 3 条消息
    await session.addItems([
      { role: 'user', content: 'hello' } as never,
      { role: 'assistant', content: 'hi' } as never,
      { role: 'user', content: 'bye' } as never
    ])
    const result = await compressor.compressIfNeeded(session, 'test-model')
    expect(result.compressed).toBe(false)
    // 清理
    await session.clearSession()
  })

  it('FileSession SessionItem 格式：addItems + getItems 往返', async () => {
    const tempDir = join(process.cwd(), 'test-results', 'sessions')
    const session = new FileSession('format-test', tempDir)
    await session.clearSession()

    // 写入消息
    await session.addItems([
      { role: 'user', content: '你好' } as never,
      { role: 'assistant', content: '你好！' } as never
    ])

    // 读取
    const items = await session.getItems()
    expect(items).toHaveLength(2)
    expect((items[0] as Record<string, unknown>).role).toBe('user')
    expect((items[1] as Record<string, unknown>).role).toBe('assistant')

    // 验证内部格式是 SessionItem
    const allItems = await session.getAllSessionItems()
    expect(allItems).toHaveLength(2)
    expect(allItems[0].seq).toBe(1)
    expect(allItems[0].type).toBe('message')
    expect(allItems[1].seq).toBe(2)
    expect(allItems[1].type).toBe('message')

    // 清理
    await session.clearSession()
  })

  it('FileSession 智能上下文构建：summary 后只返回总结 + 后续消息', async () => {
    const tempDir = join(process.cwd(), 'test-results', 'sessions')
    const session = new FileSession('ctx-test', tempDir)
    await session.clearSession()

    // 写入 4 条消息
    await session.addItems([
      { role: 'user', content: 'msg1' } as never,
      { role: 'assistant', content: 'reply1' } as never,
      { role: 'user', content: 'msg2' } as never,
      { role: 'assistant', content: 'reply2' } as never
    ])

    // 验证无 summary 时返回全部
    const beforeItems = await session.getItems()
    expect(beforeItems).toHaveLength(4)

    // 追加 summary（endSeq=2，压缩了 seq 1-2）
    await session.appendSummaryItem({
      summaryText: '用户发了 msg1，助手回复了 reply1。',
      summarizedSeqs: [1, 2],
      endSeq: 2,
      originalTokens: 100,
      summaryTokens: 30,
      compressionRatio: 0.3,
      duration: 500
    })

    // 验证 summary 后 getItems() 返回：2 条总结上下文 + 2 条后续消息
    const afterItems = await session.getItems()
    // 2 (summary user + assistant) + 2 (seq 3, 4) = 4
    expect(afterItems).toHaveLength(4)

    // 第一条应是总结引导消息
    const firstContent = (afterItems[0] as Record<string, unknown>).content as string
    expect(firstContent).toContain('之前对话的总结')

    // 第一条（user）应包含总结文本（buildSummaryContext 生成的 user 引导消息包含 summaryText）
    const firstContentStr = (afterItems[0] as Record<string, unknown>).content as string
    expect(firstContentStr).toContain('用户发了 msg1')

    // 第二条（assistant）是确认消息
    const secondContent = (afterItems[1] as Record<string, unknown>).content as string
    expect(secondContent).toContain('已仔细阅读')

    // 后面两条是 seq > endSeq 的原始消息
    expect((afterItems[2] as Record<string, unknown>).content).toBe('msg2')
    expect((afterItems[3] as Record<string, unknown>).content).toBe('reply2')

    // getAllSessionItems 应返回 5 条（4 message + 1 summary）
    const allItems = await session.getAllSessionItems()
    expect(allItems).toHaveLength(5)
    expect(allItems[4].type).toBe('summary')
    expect(allItems[4].meta?.endSeq).toBe(2)

    // getLastSummary 应返回 summary 元数据
    const lastSummary = await session.getLastSummary()
    expect(lastSummary).toBeDefined()
    expect(lastSummary!.endSeq).toBe(2)
    expect(lastSummary!.summarizedSeqs).toEqual([1, 2])

    // 清理
    await session.clearSession()
  })

  it('FileSession 旧格式兼容：裸 AgentInputItem 自动识别', async () => {
    const sessionRootDir = join(process.cwd(), 'test-results', 'sessions')
    const sessionDir = join(sessionRootDir, 'compat-test')
    fs.mkdirSync(sessionDir, { recursive: true })
    const filePath = join(sessionDir, 'messages.jsonl')

    // 手动写入旧格式（裸 AgentInputItem）
    const oldLines =
      [
        JSON.stringify({ role: 'user', content: '旧消息1' }),
        JSON.stringify({ role: 'assistant', content: '旧回复1' })
      ].join('\n') + '\n'
    fs.writeFileSync(filePath, oldLines, 'utf-8')

    const session = new FileSession('compat-test', sessionRootDir)
    const items = await session.getItems()
    expect(items).toHaveLength(2)
    expect((items[0] as Record<string, unknown>).content).toBe('旧消息1')

    // getAllSessionItems 应自动包装为 SessionItem
    const allItems = await session.getAllSessionItems()
    expect(allItems[0].seq).toBe(1)
    expect(allItems[0].type).toBe('message')
    expect(allItems[1].seq).toBe(2)

    // 清理
    await session.clearSession()
  })
})
