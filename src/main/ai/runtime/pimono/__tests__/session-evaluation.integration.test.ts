/**
 * PiMonoAgentRuntime Session 分析 + 评估集成测试
 *
 * 目标：
 *   1. 以 file 模式运行，观测 session 文件结构
 *   2. 启用压缩，观测 compaction 行为
 *   3. Dump LLM 上下文（buildSessionContext）到文件
 *   4. 使用 ExecutionEvaluator 对每次执行进行三维度评估
 *   5. 多轮对话后观测 session 文件的增量变化
 *
 * 可观测产物（输出到 test-results/YYYYMMDD/）：
 *
 *   ┌──────────────────────────────────────────────────────────────────────────┐
 *   │ 文件                                               │ 内容               │
 *   ├──────────────────────────────────────────────────────────────────────────┤
 *   │ pi-session-eval-{ts}.log                           │ 测试摘要 + 评估报告 │
 *   │ pi-session-context-{ts}.log                        │ LLM 上下文快照      │
 *   │ pi-session-files-{ts}.log                          │ Session 文件内容    │
 *   │ pi-session-eval-report-{ts}.json                   │ 结构化评估报告      │
 *   └──────────────────────────────────────────────────────────────────────────┘
 *
 * 运行命令：
 *   pnpm vitest run src/main/ai/runtime/pimono/__tests__/session-evaluation.integration.test.ts
 */

import fs from 'fs'
import path from 'path'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Type } from '@sinclair/typebox'

// ===== Electron 环境 stub =====

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
import { ExecutionEvaluator } from '../../evaluation'
import type { EvaluationInput, EvaluationReport, TimedChunkInfo } from '../../evaluation'

// ========== API 配置 ==========

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

// ========== 日志系统 ==========

const LOG_PREFIX = '[SessionEval]'
const TEST_LOG_BASE = path.join(process.cwd(), 'test-results')

let logDir: string
let testLogFile: string
let contextLogFile: string
let sessionFilesLogFile: string
let evalReportFile: string
let runTs: number

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function appendLog(file: string, line: string): void {
  ensureDir(path.dirname(file))
  fs.appendFileSync(file, line + '\n', 'utf-8')
}

function log(msg: string): void {
  console.log(msg)
  appendLog(testLogFile, msg)
}

// ========== 辅助 ==========

interface TimedChunk extends StreamChunk {
  elapsed: number
  seq: number
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

function createPiTool(config: {
  name: string
  label: string
  description: string
  parameters: unknown
  execute: (params: Record<string, unknown>) => Promise<string>
}): unknown {
  return {
    name: config.name,
    label: config.label,
    description: config.description,
    parameters: config.parameters,
    execute: async (
      _toolCallId: string,
      params: Record<string, unknown>,
      _signal?: AbortSignal,
      onUpdate?: (update: unknown) => void
    ) => {
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

// 测试工具
const addNumbersTool = createPiTool({
  name: 'add_numbers',
  label: 'Add Numbers',
  description: '将两个数字相加并返回结果。',
  parameters: Type.Object({
    a: Type.Number({ description: '第一个数字' }),
    b: Type.Number({ description: '第二个数字' })
  }),
  execute: async (params) => {
    const a = params.a as number
    const b = params.b as number
    return JSON.stringify({ result: a + b, expression: `${a} + ${b} = ${a + b}` })
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
    return JSON.stringify({
      city: params.city,
      temperature: '22°C',
      condition: '多云',
      humidity: '55%'
    })
  }
})

// ========== 创建 runtime ==========

function createRuntime(
  overrides: Partial<PiMonoAgentRuntimeOptions> & { name: string; instructions: string }
): PiMonoAgentRuntime {
  if (!apiConfig) throw new Error('No API config')

  // file 模式的 session 目录
  const sessionDir = path.join(process.cwd(), 'test-results', 'sessions')
  ensureDir(sessionDir)

  return new PiMonoAgentRuntime({
    apiKey: apiConfig.apiKey,
    baseURL: apiConfig.baseURL,
    model: apiConfig.model,
    thinkingLevel: 'low',
    sessionMode: 'file',
    cwd: sessionDir,
    compaction: { enabled: true },
    ...overrides
  })
}

/**
 * Dump session 上下文到日志
 */
function dumpSessionContext(runtime: PiMonoAgentRuntime, label: string): void {
  const sep = '━'.repeat(60)

  // 1. Session 文件路径
  const sessionFile = runtime.getSessionFilePath()
  appendLog(contextLogFile, `\n${sep}`)
  appendLog(contextLogFile, `${label} - Session 上下文快照`)
  appendLog(contextLogFile, `${sep}`)
  appendLog(contextLogFile, `Session 文件: ${sessionFile || 'N/A（memory 模式）'}`)

  // 2. 原始消息
  const rawMessages = runtime.getRawMessages()
  appendLog(contextLogFile, `\n--- 原始消息 (${rawMessages.length} 条) ---`)
  for (let i = 0; i < rawMessages.length; i++) {
    const msg = rawMessages[i] as Record<string, unknown>
    appendLog(contextLogFile, `\n[消息 #${i + 1}] role=${msg.role}`)
    appendLog(contextLogFile, JSON.stringify(msg, null, 2))
  }

  // 3. Session 上下文（发送给 LLM 的）
  const ctx = runtime.getSessionContext()
  if (ctx) {
    appendLog(contextLogFile, `\n--- LLM 上下文 (${(ctx.messages as unknown[]).length} 条消息) ---`)
    appendLog(contextLogFile, `模型: ${JSON.stringify(ctx.model)}`)
    appendLog(contextLogFile, `思考级别: ${ctx.thinkingLevel}`)
    for (let i = 0; i < (ctx.messages as unknown[]).length; i++) {
      const msg = (ctx.messages as Record<string, unknown>[])[i]
      appendLog(contextLogFile, `\n[LLM 消息 #${i + 1}] role=${msg.role}`)
      // 对内容做截断
      const msgStr = JSON.stringify(msg, null, 2)
      if (msgStr.length > 3000) {
        appendLog(contextLogFile, msgStr.slice(0, 3000) + '\n... (截断)')
      } else {
        appendLog(contextLogFile, msgStr)
      }
    }
  } else {
    appendLog(contextLogFile, '\n--- LLM 上下文: 不可用 ---')
  }

  appendLog(contextLogFile, `\n${sep}\n`)
}

/**
 * Dump session 文件内容
 */
function dumpSessionFile(runtime: PiMonoAgentRuntime, label: string): void {
  const sep = '━'.repeat(60)
  const sessionFile = runtime.getSessionFilePath()

  appendLog(sessionFilesLogFile, `\n${sep}`)
  appendLog(sessionFilesLogFile, `${label} - Session 文件分析`)
  appendLog(sessionFilesLogFile, `${sep}`)

  if (!sessionFile) {
    appendLog(sessionFilesLogFile, '无 session 文件（memory 模式）')
    return
  }

  appendLog(sessionFilesLogFile, `文件路径: ${sessionFile}`)

  if (!fs.existsSync(sessionFile)) {
    appendLog(sessionFilesLogFile, '文件不存在')
    return
  }

  const content = fs.readFileSync(sessionFile, 'utf-8')
  const lines = content.split('\n').filter((l) => l.trim())
  appendLog(sessionFilesLogFile, `文件大小: ${content.length} 字节`)
  appendLog(sessionFilesLogFile, `JSONL 行数: ${lines.length}`)

  // 分析每行的类型
  const typeDistribution: Record<string, number> = {}
  for (let i = 0; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i])
      const type = entry.type || 'unknown'
      typeDistribution[type] = (typeDistribution[type] || 0) + 1

      // 每行输出
      appendLog(sessionFilesLogFile, `\n[行 ${i + 1}] type=${type}, id=${entry.id || 'N/A'}`)

      // 根据类型做简要输出
      if (type === 'session') {
        appendLog(
          sessionFilesLogFile,
          `  版本: ${entry.version}, cwd: ${entry.cwd}, timestamp: ${entry.timestamp}`
        )
      } else if (type === 'message') {
        const msg = entry.message
        const role = msg?.role || 'unknown'
        let contentSummary = ''
        if (typeof msg?.content === 'string') {
          contentSummary = msg.content.slice(0, 200)
        } else if (Array.isArray(msg?.content)) {
          contentSummary = msg.content
            .map((c: { type: string; text?: string }) => {
              if (c.type === 'text') return `[text: ${(c.text || '').slice(0, 100)}]`
              return `[${c.type}]`
            })
            .join(', ')
        }
        appendLog(sessionFilesLogFile, `  role: ${role}`)
        appendLog(sessionFilesLogFile, `  content: ${contentSummary}`)
        if (msg?.usage) {
          appendLog(sessionFilesLogFile, `  usage: ${JSON.stringify(msg.usage)}`)
        }
      } else if (type === 'compaction') {
        appendLog(sessionFilesLogFile, `  summary: ${(entry.summary || '').slice(0, 200)}`)
        appendLog(sessionFilesLogFile, `  firstKeptEntryId: ${entry.firstKeptEntryId}`)
        appendLog(sessionFilesLogFile, `  tokensBefore: ${entry.tokensBefore}`)
      } else {
        // 通用输出
        const str = JSON.stringify(entry)
        appendLog(sessionFilesLogFile, `  ${str.length > 500 ? str.slice(0, 500) + '...' : str}`)
      }
    } catch {
      appendLog(sessionFilesLogFile, `[行 ${i + 1}] 解析失败: ${lines[i].slice(0, 100)}`)
    }
  }

  // 类型分布汇总
  appendLog(sessionFilesLogFile, `\n--- 条目类型分布 ---`)
  for (const [type, count] of Object.entries(typeDistribution).sort()) {
    appendLog(sessionFilesLogFile, `  ${type.padEnd(20)} : ${count}`)
  }

  appendLog(sessionFilesLogFile, `\n${sep}\n`)
}

// ========== 测试 ==========

describe.skipIf(!RUN)('PiMonoAgentRuntime Session 分析 + 评估集成测试', () => {
  let runtime: PiMonoAgentRuntime
  const evaluator = new ExecutionEvaluator()
  const allReports: EvaluationReport[] = []
  const sessionId = `session-eval-${Date.now()}`

  beforeAll(() => {
    if (!apiConfig) return

    runTs = Date.now()
    const dateDir = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    logDir = path.join(TEST_LOG_BASE, dateDir)
    testLogFile = path.join(logDir, `pi-session-eval-${runTs}.log`)
    contextLogFile = path.join(logDir, `pi-session-context-${runTs}.log`)
    sessionFilesLogFile = path.join(logDir, `pi-session-files-${runTs}.log`)
    evalReportFile = path.join(logDir, `pi-session-eval-report-${runTs}.json`)
    ensureDir(logDir)

    const ts = new Date().toISOString()
    log(`\n${'═'.repeat(72)}`)
    log(`${LOG_PREFIX} Session 分析 + 评估集成测试`)
    log(`${LOG_PREFIX} 时间: ${ts}`)
    log(`${LOG_PREFIX} 模型: ${apiConfig.model}`)
    log(`${LOG_PREFIX} Session ID: ${sessionId}`)
    log(`${LOG_PREFIX} Session 模式: file（压缩启用）`)
    log(`${'═'.repeat(72)}`)
    log(`${LOG_PREFIX} 摘要日志: ${testLogFile}`)
    log(`${LOG_PREFIX} 上下文日志: ${contextLogFile}`)
    log(`${LOG_PREFIX} Session 文件日志: ${sessionFilesLogFile}`)
    log(`${LOG_PREFIX} 评估报告: ${evalReportFile}`)
  })

  afterAll(async () => {
    if (!RUN) return

    // 输出评估汇总
    if (allReports.length > 0) {
      const summary = ExecutionEvaluator.formatSummary(allReports)
      log(summary)

      // 保存结构化报告
      fs.writeFileSync(
        evalReportFile,
        JSON.stringify({ reports: allReports, summary: { count: allReports.length } }, null, 2),
        'utf-8'
      )
      log(`${LOG_PREFIX} 评估报告已保存: ${evalReportFile}`)
    }

    if (runtime) {
      try {
        await runtime.destroy()
      } catch {
        /* ignore */
      }
    }

    log(`\n${'═'.repeat(72)}`)
    log(`${LOG_PREFIX} 测试结束 ${new Date().toISOString()}`)
    log(`${'═'.repeat(72)}`)
  })

  // ===== 场景 A：File 模式多轮对话 + Session 文件分析 =====

  it('场景A - File 模式多轮对话：观测 session 文件结构', { timeout: 180_000 }, async () => {
    // 第一轮：简单问答
    log(`\n${LOG_PREFIX} ── 轮次 1：简单问答 ──`)

    runtime = createRuntime({
      name: 'SessionAnalysisAgent',
      instructions: '你是一个简洁的助手。用简短的语言回答。',
      customTools: [addNumbersTool, getWeatherTool],
      sessionId,
      maxTurns: 10
    })
    await runtime.initialize()

    const c1 = createCollector()
    const r1 = await runtime.runStream('你好，请问 1+1 等于几？', {}, c1.collect)

    log(`${LOG_PREFIX}   输出: ${r1.output.slice(0, 200)}`)
    log(`${LOG_PREFIX}   耗时: ${r1.duration}ms`)
    log(`${LOG_PREFIX}   事件数: ${c1.chunks.length}`)

    // Dump session 文件（第一轮后）
    dumpSessionFile(runtime, '轮次 1 后')
    dumpSessionContext(runtime, '轮次 1 后')

    // 评估
    const eval1: EvaluationInput = {
      testName: 'A-轮次1-简单问答',
      input: '你好，请问 1+1 等于几？',
      result: r1,
      chunks: c1.chunks,
      timedChunks: c1.timedChunks as TimedChunkInfo[],
      expectedKeywords: ['2']
    }
    const report1 = evaluator.evaluate(eval1)
    allReports.push(report1)
    log(ExecutionEvaluator.formatReport(report1))

    expect(r1.output).toContain('2')

    // 第二轮：工具调用（同一个 session！）
    log(`\n${LOG_PREFIX} ── 轮次 2：工具调用 ──`)

    const c2 = createCollector()
    const r2 = await runtime.runStream('请计算 25 + 37', {}, c2.collect)

    log(`${LOG_PREFIX}   输出: ${r2.output.slice(0, 200)}`)
    log(`${LOG_PREFIX}   耗时: ${r2.duration}ms`)
    log(`${LOG_PREFIX}   事件数: ${c2.chunks.length}`)

    // Dump session 文件（第二轮后 — 应该看到增量）
    dumpSessionFile(runtime, '轮次 2 后')
    dumpSessionContext(runtime, '轮次 2 后')

    const eval2: EvaluationInput = {
      testName: 'A-轮次2-工具调用',
      input: '请计算 25 + 37',
      result: r2,
      chunks: c2.chunks,
      timedChunks: c2.timedChunks as TimedChunkInfo[],
      expectedKeywords: ['62'],
      expectedTools: ['add_numbers']
    }
    const report2 = evaluator.evaluate(eval2)
    allReports.push(report2)
    log(ExecutionEvaluator.formatReport(report2))

    expect(r2.output).toContain('62')

    // 第三轮：引用上下文（验证 session 持久化）
    log(`\n${LOG_PREFIX} ── 轮次 3：引用上下文 ──`)

    const c3 = createCollector()
    const r3 = await runtime.runStream(
      '你还记得我之前问的第一个问题吗？那个答案是什么？',
      {},
      c3.collect
    )

    log(`${LOG_PREFIX}   输出: ${r3.output.slice(0, 200)}`)
    log(`${LOG_PREFIX}   耗时: ${r3.duration}ms`)

    // Dump session 文件（第三轮后）
    dumpSessionFile(runtime, '轮次 3 后')
    dumpSessionContext(runtime, '轮次 3 后')

    const eval3: EvaluationInput = {
      testName: 'A-轮次3-上下文引用',
      input: '你还记得我之前问的第一个问题吗？那个答案是什么？',
      result: r3,
      chunks: c3.chunks,
      timedChunks: c3.timedChunks as TimedChunkInfo[],
      expectedKeywords: ['2', '1+1']
    }
    const report3 = evaluator.evaluate(eval3)
    allReports.push(report3)
    log(ExecutionEvaluator.formatReport(report3))

    // 验证 session 文件存在
    const sessionFile = runtime.getSessionFilePath()
    log(`\n${LOG_PREFIX} Session 文件路径: ${sessionFile}`)
    if (sessionFile) {
      expect(fs.existsSync(sessionFile)).toBe(true)
      const stat = fs.statSync(sessionFile)
      log(`${LOG_PREFIX} Session 文件大小: ${stat.size} 字节`)
    }

    // 事件闭环
    for (const c of [c1, c2, c3]) {
      const starts = c.chunks.filter((e) => e.type === 'run:start').length
      const dones = c.chunks.filter((e) => e.type === 'run:done').length
      expect(starts).toBe(dones)
    }
  })

  // ===== 场景 B：多工具 + 评估质量 =====

  it('场景B - 多工具混合 + 评估：质量、过程、成本全维度', { timeout: 120_000 }, async () => {
    const localSessionId = `session-eval-b-${Date.now()}`
    const localRuntime = createRuntime({
      name: 'MultiToolEvalAgent',
      instructions:
        '你是一个全能助手。查天气用 get_weather，算加法用 add_numbers。' +
        '对于多个任务，尽量一次性调用所有工具。最后汇总结果。',
      customTools: [addNumbersTool, getWeatherTool],
      sessionId: localSessionId,
      maxTurns: 10
    })
    await localRuntime.initialize()

    const c = createCollector()
    const result = await localRuntime.runStream('帮我查北京天气，然后算 100 + 200', {}, c.collect)

    log(`\n${LOG_PREFIX} ── 场景B：多工具混合 ──`)
    log(`${LOG_PREFIX}   输出: ${result.output.slice(0, 300)}`)
    log(`${LOG_PREFIX}   耗时: ${result.duration}ms`)

    // Dump
    dumpSessionFile(localRuntime, '场景B')
    dumpSessionContext(localRuntime, '场景B')

    // 评估
    const evalInput: EvaluationInput = {
      testName: 'B-多工具混合',
      input: '帮我查北京天气，然后算 100 + 200',
      result,
      chunks: c.chunks,
      timedChunks: c.timedChunks as TimedChunkInfo[],
      expectedKeywords: ['北京', '300'],
      expectedTools: ['get_weather', 'add_numbers']
    }
    const report = evaluator.evaluate(evalInput)
    allReports.push(report)
    log(ExecutionEvaluator.formatReport(report))

    // 基本断言
    expect(result.output).toContain('300')
    expect(c.chunks.filter((e) => e.type === 'tool:done').length).toBeGreaterThanOrEqual(2)

    await localRuntime.destroy()
  })

  // ===== 场景 C：Skill + AppendInstructions + 评估 =====

  it('场景C - Skill 注入 + 评估：验证知识注入质量', { timeout: 120_000 }, async () => {
    const localSessionId = `session-eval-c-${Date.now()}`
    const localRuntime = createRuntime({
      name: 'SkillEvalAgent',
      instructions: '你是一个技术助手。根据你掌握的知识回答用户问题。',
      skills: [
        {
          name: 'quantum-db',
          description: 'QuantumDB 数据库文档',
          content: [
            '# QuantumDB v2.0',
            '',
            'QuantumDB 是一款基于量子退火算法的分布式数据库。',
            '',
            '## 核心特性',
            '1. **量子索引（Quantum Index）**：使用量子退火算法优化查询计划',
            '2. **时空分片（Temporal Sharding）**：按时间维度自动分片',
            '3. **纠缠同步（Entanglement Sync）**：节点间零延迟数据同步',
            '',
            '## API',
            '- `QuantumDB.connect(url)` — 连接数据库',
            '- `db.query(sql, { temporal: true })` — 时空查询',
            '- `db.index.quantum(fields)` — 创建量子索引'
          ].join('\n')
        }
      ],
      appendInstructions: ['回答时必须以"【QuantumDB 技术顾问】"作为开头。'],
      sessionId: localSessionId
    })
    await localRuntime.initialize()

    const c = createCollector()
    const result = await localRuntime.runStream('QuantumDB 的三大核心特性是什么？', {}, c.collect)

    log(`\n${LOG_PREFIX} ── 场景C：Skill 注入 ──`)
    log(`${LOG_PREFIX}   输出: ${result.output.slice(0, 400)}`)

    dumpSessionContext(localRuntime, '场景C')

    const evalInput: EvaluationInput = {
      testName: 'C-Skill注入',
      input: 'QuantumDB 的三大核心特性是什么？',
      result,
      chunks: c.chunks,
      timedChunks: c.timedChunks as TimedChunkInfo[],
      expectedKeywords: ['QuantumDB', '量子索引', '时空分片', '纠缠同步', '技术顾问']
    }
    const report = evaluator.evaluate(evalInput)
    allReports.push(report)
    log(ExecutionEvaluator.formatReport(report))

    // 验证
    expect(result.output.toLowerCase()).toContain('quantumdb')
    expect(result.output).toContain('技术顾问')

    await localRuntime.destroy()
  })
})
