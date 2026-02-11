/**
 * Session 压缩场景集成测试 — 全链路上下文监控
 *
 * 目标：在真实 LLM 调用中测试压缩的完整流程：
 *   1. 设置低阈值（让 2-3 轮对话后即触发压缩）
 *   2. 启用自动压缩（compression.enabled = true）
 *   3. 每轮对话前后记录上下文快照
 *   4. 观察压缩触发时机和效果
 *   5. 压缩后继续对话，验证上下文正确性
 *
 * 输出：
 *   test-results/YYYYMMDD/compression-monitor-{timestamp}.log
 *
 * 运行：
 *   pnpm vitest run src/main/ai/runtime/__tests__/compression-scenario.integration.test.ts
 */

import fs from 'fs'
import path from 'path'
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { rm } from 'fs/promises'
import { join } from 'path'

// ===== Electron 环境 stub =====

vi.mock('electron', () => {
  const home = process.env.HOME || '/tmp'
  const base = join(home, '.coobee-ai-test')
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
import type { AgentInputItem } from '@openai/agents'
import { z } from 'zod'
import OpenAI from 'openai'
import { OpenAIAgentRuntime } from '../OpenAIAgentRuntime'
import { countItemsTokens } from '../tokenCounter'
import type { ContextSnapshot } from '../types'
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

const LOG_BASE = path.join(process.cwd(), 'test-results')
let logFile: string
let logDir: string

function ensureLogDir(): void {
  fs.mkdirSync(logDir, { recursive: true })
}

function log(line: string): void {
  console.log(line)
  try {
    ensureLogDir()
    fs.appendFileSync(logFile, line + '\n', 'utf-8')
  } catch {
    // ignore
  }
}

function logSep(title?: string): void {
  if (title) {
    log(`\n${'='.repeat(80)}`)
    log(`  ${title}`)
    log(`${'='.repeat(80)}`)
  } else {
    log(`${'─'.repeat(80)}`)
  }
}

// ========== 关键信息追踪 ==========

/** 需要追踪的关键词列表 */
const TRACK_KEYWORDS = [
  { key: '小明', label: '姓名' },
  { key: '25', label: '年龄' },
  { key: '字节', label: '公司' },
  { key: '北京', label: '城市' },
  { key: 'coobee', label: '项目名', caseInsensitive: true },
  { key: 'Electron', label: 'Electron', caseInsensitive: true },
  { key: 'Vue', label: 'Vue', caseInsensitive: true },
  { key: 'TypeScript', label: 'TypeScript', caseInsensitive: true },
  { key: 'Tailwind', label: 'Tailwind', caseInsensitive: true },
  { key: '@openai/agents', label: 'SDK', caseInsensitive: true },
  { key: 'JSONL', label: 'JSONL', caseInsensitive: true }
]

/** 检查关键词在文本中的出现情况 */
function checkKeywords(text: string): { key: string; label: string; found: boolean }[] {
  return TRACK_KEYWORDS.map((kw) => {
    const found = kw.caseInsensitive
      ? text.toLowerCase().includes(kw.key.toLowerCase())
      : text.includes(kw.key)
    return { key: kw.key, label: kw.label, found }
  })
}

/** 将上下文所有 items 拼接为一个文本（用于关键词搜索） */
function contextToText(items: AgentInputItem[]): string {
  return items
    .map((item) => {
      const raw = item as Record<string, unknown>
      if (typeof raw.content === 'string') return raw.content
      if (Array.isArray(raw.content)) {
        return (raw.content as Array<{ text?: string }>).map((c) => c.text || '').join('')
      }
      return ''
    })
    .join('\n')
}

/** 打印关键词追踪对比表 */
function logKeywordComparison(label: string, beforeText: string, afterText: string): void {
  const beforeKw = checkKeywords(beforeText)
  const afterKw = checkKeywords(afterText)

  log(`\n  ── 关键信息追踪: ${label} ──`)
  log(
    `  ${'关键词'.padEnd(14)}${'标签'.padEnd(12)}${'压缩前'.padEnd(8)}${'压缩后'.padEnd(8)}${'状态'}`
  )
  log(`  ${'─'.repeat(50)}`)

  let lostCount = 0
  for (let i = 0; i < beforeKw.length; i++) {
    const b = beforeKw[i]
    const a = afterKw[i]
    let status = ''
    if (b.found && a.found) status = '✓ 保留'
    else if (b.found && !a.found) {
      status = '✗ 丢失'
      lostCount++
    } else if (!b.found && a.found) status = '+ 新增'
    else status = '· 无'

    log(
      `  ${b.key.padEnd(14)}${b.label.padEnd(12)}` +
        `${(b.found ? '有' : '无').padEnd(8)}` +
        `${(a.found ? '有' : '无').padEnd(8)}${status}`
    )
  }
  log(`  ${'─'.repeat(50)}`)
  log(`  丢失: ${lostCount} 项`)
}

/** 提取 AgentInputItem 的摘要文本 */
function extractContent(item: AgentInputItem, maxLen = 120): string {
  const raw = item as Record<string, unknown>
  const role = (raw.role as string) || (raw.type as string) || '?'
  let content = ''

  if (typeof raw.content === 'string') {
    content = raw.content
  } else if (Array.isArray(raw.content)) {
    content = (raw.content as Array<{ text?: string }>).map((c) => c.text || '').join('')
  }

  // 清洗 <think> 标签用于显示
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  content = content.replace(/\n/g, '\\n')
  if (content.length > maxLen) content = content.slice(0, maxLen) + '...'

  return `[${role}] ${content}`
}

/** 记录上下文快照 */
function logSnapshot(label: string, snapshot: ContextSnapshot): void {
  logSep(`上下文快照: ${label}`)

  const ctxTokens = countItemsTokens(snapshot.contextItems)
  log(
    `  统计: contextItems=${snapshot.stats.contextItemCount}, ` +
      `sessionItems=${snapshot.stats.totalSessionItems}, ` +
      `messages=${snapshot.stats.messageCount}, ` +
      `summaries=${snapshot.stats.summaryCount}, ` +
      `tokens≈${ctxTokens}`
  )

  log(`\n  ── LLM 上下文 (${snapshot.contextItems.length} 条) ──`)
  for (let i = 0; i < snapshot.contextItems.length; i++) {
    log(`    ${i + 1}. ${extractContent(snapshot.contextItems[i])}`)
  }

  if (snapshot.lastSummary) {
    // 清洗显示
    const cleanText = snapshot.lastSummary.summaryText
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .trim()
    log(`\n  ── Summary (endSeq=${snapshot.lastSummary.endSeq}) ──`)
    log(`    seqs: [${snapshot.lastSummary.summarizedSeqs.join(', ')}]`)
    log(
      `    tokens: ${snapshot.lastSummary.originalTokens} → ${snapshot.lastSummary.summaryTokens}`
    )
    log(`    text: ${cleanText.replace(/\n/g, '\\n').slice(0, 300)}`)
  }

  // 关键词检查
  const ctxText = contextToText(snapshot.contextItems)
  const kwResults = checkKeywords(ctxText)
  const found = kwResults.filter((k) => k.found).map((k) => k.label)
  const missing = kwResults.filter((k) => !k.found).map((k) => k.label)
  log(`\n  关键词: 有=[${found.join(', ')}] | 无=[${missing.join(', ')}]`)
}

// ========== 辅助 ==========

let counter = 0
function uid(): string {
  return `compress-${Date.now()}-${++counter}`
}

// ========== 测试 ==========

describe.skipIf(!RUN)('Session 压缩场景：全链路上下文监控', () => {
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

    const now = new Date()
    const dateDir = now.toISOString().slice(0, 10).replace(/-/g, '')
    logDir = path.join(LOG_BASE, dateDir)
    logFile = path.join(logDir, `compression-monitor-${Date.now()}.log`)
    ensureLogDir()

    logSep('Session 压缩场景测试')
    log(`  时间: ${now.toISOString()}`)
    log(`  模型: ${MODEL}`)
    log(`  API: ${apiConfig.baseURL || 'OpenAI'}`)
    log(`  日志: ${logFile}`)
  })

  afterAll(() => {
    if (!RUN) return
    logSep('测试结束')
    log(`  日志: ${logFile}`)
    console.log(`\n📄 压缩监控日志: ${logFile}`)
  })

  afterEach(async () => {
    if (runtime) {
      try {
        await runtime.destroy()
      } catch {
        /* ignore */
      }
    }
    if (sessionId) {
      try {
        const base = join(process.env.HOME || '/tmp', '.coobee-ai')
        await rm(join(base, 'sessions', sessionId), { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  /**
   * 完整场景：自动压缩 + 每轮上下文对比 + 信息保留追踪
   *
   * 6 轮对话：
   *   Round 1: 自我介绍（姓名、年龄、公司）
   *   Round 2: 项目信息（项目名、类型）
   *   Round 3: 技术栈（此时触发压缩）
   *   Round 4: 补充功能细节（可能再次压缩）
   *   Round 5: 验证回忆
   *   Round 6: 最终确认
   */
  it('全链路测试：自动压缩 + 上下文对比 + 信息追踪', { timeout: 240_000 }, async () => {
    sessionId = uid()

    runtime = new OpenAIAgentRuntime({
      name: 'TrackAgent',
      instructions:
        '你是一个简洁的助手。请记住用户告诉你的所有个人信息和项目信息。回复保持简短（不超过30字）。不要使用 <think> 标签。',
      model: MODEL,
      sessionId,
      maxTurns: 3,
      compression: {
        enabled: true,
        contextWindowSize: 500,
        thresholdRatio: 0.5,
        minMessageCount: 4,
        keepRatio: 0.3,
        summaryModel: MODEL,
        debug: true
      }
    })
    await runtime.initialize()

    const conversations = [
      {
        input: '你好！我叫小明，今年25岁，是一名全栈工程师，在北京字节跳动工作。',
        tag: 'R1-自我介绍'
      },
      {
        input: '我正在开发一个叫 coobee-ai 的项目，它是一个基于 Electron 的 AI 助手桌面应用。',
        tag: 'R2-项目信息'
      },
      {
        input: '技术栈用了 Vue 3 + TypeScript + Tailwind CSS 4，后端用 @openai/agents SDK。',
        tag: 'R3-技术栈'
      },
      {
        input: '我们最近在实现 Session 压缩功能，用 JSONL 文件存储对话历史，支持增量总结。',
        tag: 'R4-功能细节'
      },
      {
        input: '请完整回顾：我叫什么名字？年龄？在哪工作？项目叫什么？技术栈有哪些？',
        tag: 'R5-验证回忆'
      },
      {
        input: '再确认一下我的名字。',
        tag: 'R6-最终确认'
      }
    ]

    // 每轮记录
    interface TurnRecord {
      turn: number
      tag: string
      input: string
      output: string
      duration: number
      compressed: boolean
      beforeCtxCount: number
      afterCtxCount: number
      summaryCount: number
      beforeText: string
      afterText: string
    }
    const turns: TurnRecord[] = []

    for (let i = 0; i < conversations.length; i++) {
      const { input, tag } = conversations[i]
      const turn = i + 1

      // ── 对话前 ──
      const before = await runtime.getContextSnapshot()
      const beforeText = contextToText(before.contextItems)
      const summaryBefore = before.stats.summaryCount

      // ── 执行 ──
      const result = await runtime.run(input)

      // ── 对话后 ──
      const after = await runtime.getContextSnapshot()
      const afterText = contextToText(after.contextItems)
      const compressed = after.stats.summaryCount > summaryBefore

      turns.push({
        turn,
        tag,
        input,
        output: result.output,
        duration: result.duration || 0,
        compressed,
        beforeCtxCount: before.stats.contextItemCount,
        afterCtxCount: after.stats.contextItemCount,
        summaryCount: after.stats.summaryCount,
        beforeText,
        afterText
      })

      // ── 每轮详细日志 ──
      logSep(`第 ${turn} 轮: ${tag}`)
      log(`  输入: "${input}"`)

      // 清洗输出
      const cleanOutput = result.output.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
      log(`  输出: "${cleanOutput.replace(/\n/g, '\\n').slice(0, 150)}"`)
      log(`  耗时: ${result.duration}ms`)
      log(`  压缩: ${compressed ? '✓ 触发' : '─'}`)
      log(
        `  上下文: ${before.stats.contextItemCount} → ${after.stats.contextItemCount} 条, ` +
          `summaries: ${before.stats.summaryCount} → ${after.stats.summaryCount}`
      )

      // 对话前上下文简览
      log(`\n  ── 对话前 LLM 上下文 (${before.stats.contextItemCount} 条) ──`)
      for (let j = 0; j < before.contextItems.length; j++) {
        log(`    ${j + 1}. ${extractContent(before.contextItems[j], 90)}`)
      }

      // 如果发生了压缩，显示压缩后上下文
      if (compressed) {
        log(`\n  ── 压缩后 LLM 上下文 (${after.stats.contextItemCount} 条) ──`)
        for (let j = 0; j < after.contextItems.length; j++) {
          log(`    ${j + 1}. ${extractContent(after.contextItems[j], 90)}`)
        }

        // 关键词对比
        logKeywordComparison(`第 ${turn} 轮压缩`, beforeText, afterText)

        // Summary 内容
        if (after.lastSummary) {
          const cleanSummary = after.lastSummary.summaryText
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .trim()
          log(`\n  ── Summary 内容 ──`)
          log(`    ${cleanSummary.replace(/\n/g, '\\n').slice(0, 400)}`)
        }
      }
    }

    // ========== 总览表 ==========
    logSep('总览表')

    log(
      `  ${'轮次'.padEnd(6)}${'标签'.padEnd(14)}${'压缩'.padEnd(6)}` +
        `${'上下文'.padEnd(14)}${'Summary#'.padEnd(10)}${'耗时'}`
    )
    log(`  ${'─'.repeat(60)}`)
    for (const t of turns) {
      log(
        `  ${String(t.turn).padEnd(6)}${t.tag.padEnd(14)}${(t.compressed ? '✓' : '─').padEnd(6)}` +
          `${`${t.beforeCtxCount} → ${t.afterCtxCount}`.padEnd(14)}` +
          `${String(t.summaryCount).padEnd(10)}${t.duration}ms`
      )
    }

    // ========== 信息保留追踪总表 ==========
    logSep('信息保留追踪')

    // 检查每轮对话后上下文中的关键词
    log(`  ${'轮次'.padEnd(6)}` + TRACK_KEYWORDS.map((k) => k.label.padEnd(8)).join(''))
    log(`  ${'─'.repeat(6 + TRACK_KEYWORDS.length * 8)}`)

    for (const t of turns) {
      const kws = checkKeywords(t.afterText)
      const row = kws.map((k) => (k.found ? '✓' : '✗').padEnd(8)).join('')
      log(`  ${`R${t.turn}`.padEnd(6)}${row}`)
    }

    // ========== 最终状态 ==========
    const finalSnapshot = await runtime.getContextSnapshot()
    logSnapshot('最终状态', finalSnapshot)

    // ========== 验证输出分析 ==========
    logSep('验证输出分析')

    // R5 的输出
    const r5 = turns.find((t) => t.turn === 5)
    if (r5) {
      const cleanR5 = r5.output.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
      log(`  R5 输出: "${cleanR5.replace(/\n/g, '\\n').slice(0, 300)}"`)
      const r5kw = checkKeywords(cleanR5)
      log(`  R5 关键词: ${r5kw.map((k) => `${k.label}=${k.found ? '✓' : '✗'}`).join(', ')}`)
    }

    // R6 的输出
    const r6 = turns.find((t) => t.turn === 6)
    if (r6) {
      const cleanR6 = r6.output.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
      log(`  R6 输出: "${cleanR6.replace(/\n/g, '\\n').slice(0, 200)}"`)
      log(`  R6 包含 "小明": ${cleanR6.includes('小明') ? '✓' : '✗'}`)
    }

    // ========== 断言 ==========
    expect(finalSnapshot.stats.summaryCount).toBeGreaterThanOrEqual(1)
    expect(finalSnapshot.stats.contextItemCount).toBeLessThan(finalSnapshot.stats.messageCount)

    // 最终上下文中应包含项目名
    const finalText = contextToText(finalSnapshot.contextItems)
    expect(finalText.toLowerCase()).toContain('coobee')
  })
})

// ===================================================================================
//  场景二：工具调用 + 压缩
// ===================================================================================

// ========== 真实工具定义 ==========

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

const lookupWeatherTool = tool({
  name: 'lookup_weather',
  description: '查询指定城市的天气情况。当用户询问天气时使用。',
  parameters: z.object({
    city: z.string().describe('城市名称')
  }),
  execute: async ({ city }) => {
    // 模拟天气数据
    const weatherData: Record<string, { temp: string; condition: string; humidity: string }> = {
      北京: { temp: '5°C', condition: '晴', humidity: '35%' },
      上海: { temp: '12°C', condition: '多云', humidity: '65%' },
      深圳: { temp: '22°C', condition: '阴', humidity: '78%' },
      成都: { temp: '10°C', condition: '小雨', humidity: '82%' }
    }
    const data = weatherData[city] || { temp: '未知', condition: '未知', humidity: '未知' }
    return JSON.stringify({ city, ...data })
  }
})

const multiplyTool = tool({
  name: 'multiply',
  description: '将两个数字相乘。当用户要求乘法计算时使用。',
  parameters: z.object({
    a: z.number().describe('第一个数字'),
    b: z.number().describe('第二个数字')
  }),
  execute: async ({ a, b }) => {
    const result = a * b
    return JSON.stringify({ result, expression: `${a} × ${b} = ${result}` })
  }
})

const searchKnowledgeTool = tool({
  name: 'search_knowledge',
  description: '搜索知识库，查询技术或概念相关信息。当用户有技术问题时使用。',
  parameters: z.object({
    query: z.string().describe('搜索关键词')
  }),
  execute: async ({ query }) => {
    // 模拟知识库搜索结果
    const lowerQ = query.toLowerCase()
    if (lowerQ.includes('electron')) {
      return JSON.stringify({
        query,
        results: [
          '- Electron 是由 GitHub 开发的跨平台桌面应用框架',
          '- 基于 Chromium + Node.js',
          '- 支持 Windows、macOS、Linux',
          '- 主进程和渲染进程架构'
        ]
      })
    }
    if (lowerQ.includes('vue')) {
      return JSON.stringify({
        query,
        results: [
          '- Vue 3 使用 Composition API 和 <script setup>',
          '- 响应式系统基于 Proxy',
          '- 支持 TypeScript',
          '- 生态：Pinia (状态管理), Vue Router (路由)'
        ]
      })
    }
    return JSON.stringify({ query, results: [`未找到与 "${query}" 相关的信息`] })
  }
})

// ========== 工具场景关键词追踪 ==========

const TOOL_TRACK_KEYWORDS = [
  { key: '加法', label: '加法', caseInsensitive: false },
  { key: '42', label: '加法结果(42)', caseInsensitive: false },
  { key: '天气', label: '天气', caseInsensitive: false },
  { key: '北京', label: '北京', caseInsensitive: false },
  { key: '乘', label: '乘法', caseInsensitive: false },
  { key: '120', label: '乘法结果(120)', caseInsensitive: false },
  { key: 'electron', label: 'Electron', caseInsensitive: true },
  { key: 'vue', label: 'Vue', caseInsensitive: true },
  { key: '工具', label: '工具', caseInsensitive: false },
  { key: '小李', label: '用户名', caseInsensitive: false }
]

/** 检查工具场景的关键词 */
function checkToolKeywords(text: string): { key: string; label: string; found: boolean }[] {
  return TOOL_TRACK_KEYWORDS.map((kw) => {
    const found = kw.caseInsensitive
      ? text.toLowerCase().includes(kw.key.toLowerCase())
      : text.includes(kw.key)
    return { key: kw.key, label: kw.label, found }
  })
}

/** 提取 AgentInputItem 的类型标签（包括 function_call 等） */
function itemTypeLabel(item: AgentInputItem): string {
  const raw = item as Record<string, unknown>
  if (raw.role) return `role:${raw.role}`
  if (raw.type === 'function_call') return `tool:call:${raw.name || '?'}`
  if (raw.type === 'function_call_output') return `tool:output`
  return `type:${raw.type || '?'}`
}

// ========== 工具调用 + 压缩 测试 ==========

describe.skipIf(!RUN)('Session 压缩场景：工具调用 + 压缩', () => {
  let runtime: OpenAIAgentRuntime
  let sessionId: string
  let MODEL: string
  let toolLogFile: string

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

    const now = new Date()
    const dateDir = now.toISOString().slice(0, 10).replace(/-/g, '')
    const toolLogDir = path.join(LOG_BASE, dateDir)
    fs.mkdirSync(toolLogDir, { recursive: true })
    toolLogFile = path.join(toolLogDir, `compression-tool-${Date.now()}.log`)

    toolLog(`\n${'='.repeat(80)}`)
    toolLog(`  工具调用 + 压缩场景测试`)
    toolLog(`${'='.repeat(80)}`)
    toolLog(`  时间: ${now.toISOString()}`)
    toolLog(`  模型: ${MODEL}`)
    toolLog(`  API: ${apiConfig.baseURL || 'OpenAI'}`)
    toolLog(`  日志: ${toolLogFile}`)
  })

  afterAll(() => {
    if (!RUN) return
    toolLog(`\n${'='.repeat(80)}`)
    toolLog(`  测试结束`)
    toolLog(`${'='.repeat(80)}`)
    toolLog(`  日志: ${toolLogFile}`)
    console.log(`\n📄 工具压缩日志: ${toolLogFile}`)
  })

  /** 工具场景专用日志 */
  function toolLog(line: string): void {
    console.log(line)
    try {
      fs.appendFileSync(toolLogFile, line + '\n', 'utf-8')
    } catch {
      // ignore
    }
  }

  afterEach(async () => {
    if (runtime) {
      try {
        await runtime.destroy()
      } catch {
        /* ignore */
      }
    }
    if (sessionId) {
      try {
        const base = join(process.env.HOME || '/tmp', '.coobee-ai')
        await rm(join(base, 'sessions', sessionId), { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  /**
   * 工具调用 + 自动压缩 + 流式输出 + 上下文监控
   *
   * 场景设计（8 轮，其中多轮包含工具调用）：
   *   R1: 自我介绍（纯文本）
   *   R2: 请求计算 17 + 25（触发 add_numbers 工具）
   *   R3: 查询北京天气（触发 lookup_weather 工具）
   *   R4: 计算 12 × 10（触发 multiply 工具）— 此时可能触发压缩
   *   R5: 搜索 Electron 知识（触发 search_knowledge 工具）
   *   R6: 搜索 Vue 知识（触发 search_knowledge 工具）— 此时应已触发压缩
   *   R7: 验证回忆（纯文本，问之前计算和天气结果）
   *   R8: 再次计算，验证压缩后工具链路仍正常
   */
  it(
    '工具调用 + 流式压缩：上下文含 function_call 时的完整压缩链路',
    { timeout: 360_000 },
    async () => {
      sessionId = uid()

      runtime = new OpenAIAgentRuntime({
        name: 'ToolAgent',
        instructions: [
          '你是一个能力全面的助手。请记住用户的个人信息。',
          '你有以下工具可用：add_numbers（加法）、multiply（乘法）、lookup_weather（天气查询）、search_knowledge（知识搜索）。',
          '当用户要求计算或查询时，必须使用对应的工具。',
          '回复时请引用工具返回的具体数据（如具体数字、温度等）。',
          '回复保持简洁，不超过 50 字。不要使用 <think> 标签。'
        ].join('\n'),
        model: MODEL,
        sessionId,
        maxTurns: 5,
        sdkTools: [addNumbersTool, lookupWeatherTool, multiplyTool, searchKnowledgeTool],
        compression: {
          enabled: true,
          contextWindowSize: 800, // 工具调用产生更多 token，稍大一些
          thresholdRatio: 0.4,
          minMessageCount: 6,
          keepRatio: 0.3,
          summaryModel: MODEL,
          debug: true
        }
      })
      await runtime.initialize()

      const conversations = [
        {
          input: '你好！我叫小李，是一名前端工程师。',
          tag: 'R1-自我介绍',
          expectTool: false,
          streaming: false
        },
        {
          input: '帮我计算 17 + 25 等于多少？',
          tag: 'R2-加法计算',
          expectTool: true,
          streaming: true // 流式执行，观察 tool 事件
        },
        {
          input: '北京现在天气怎么样？',
          tag: 'R3-天气查询',
          expectTool: true,
          streaming: true
        },
        {
          input: '再帮我算一下 12 × 10 是多少？',
          tag: 'R4-乘法计算',
          expectTool: true,
          streaming: false
        },
        {
          input: '我想了解一下 Electron 框架，帮我搜索一下。',
          tag: 'R5-知识搜索(Electron)',
          expectTool: true,
          streaming: false
        },
        {
          input: '再帮我搜索一下 Vue 3 的信息。',
          tag: 'R6-知识搜索(Vue)',
          expectTool: true,
          streaming: true
        },
        {
          input:
            '请回顾一下：我叫什么名字？之前 17+25 的结果是什么？北京天气怎样？12×10 等于多少？',
          tag: 'R7-验证回忆',
          expectTool: false,
          streaming: false
        },
        {
          input: '最后帮我算 99 + 1。',
          tag: 'R8-压缩后工具调用',
          expectTool: true,
          streaming: true
        }
      ]

      interface ToolTurnRecord {
        turn: number
        tag: string
        input: string
        output: string
        duration: number
        compressed: boolean
        toolCalls: string[] // 工具调用名称列表
        streaming: boolean
        streamEvents: string[] // 事件类型列表
        beforeCtxCount: number
        afterCtxCount: number
        summaryCount: number
        contextItemTypes: string[] // 上下文中 item 的类型分布
        beforeText: string
        afterText: string
      }

      const turns: ToolTurnRecord[] = []

      for (let i = 0; i < conversations.length; i++) {
        const { input, tag, streaming } = conversations[i]
        const turn = i + 1

        // ── 对话前上下文 ──
        const before = await runtime.getContextSnapshot()
        const beforeText = contextToText(before.contextItems)
        const summaryBefore = before.stats.summaryCount

        toolLog(`\n${'='.repeat(80)}`)
        toolLog(`  第 ${turn} 轮: ${tag}`)
        toolLog(`${'='.repeat(80)}`)
        toolLog(`  输入: "${input}"`)
        toolLog(`  模式: ${streaming ? '流式' : '同步'}`)

        // 对话前上下文详情
        toolLog(`\n  ── 对话前 LLM 上下文 (${before.stats.contextItemCount} 条) ──`)
        for (let j = 0; j < before.contextItems.length; j++) {
          const item = before.contextItems[j]
          toolLog(`    ${j + 1}. ${itemTypeLabel(item)} | ${extractContent(item, 80)}`)
        }

        let output = ''
        let duration = 0
        const toolCallNames: string[] = []
        const streamEvents: string[] = []

        if (streaming) {
          // ── 流式执行 ──
          const chunks: StreamChunk[] = []
          const result = await runtime.runStream(
            input,
            { streaming: true },
            (chunk: StreamChunk) => {
              chunks.push(chunk)
              streamEvents.push(chunk.type)
            }
          )
          output = result.output
          duration = result.duration || 0

          // 提取工具调用
          for (const c of chunks) {
            if (c.type === 'tool:start' && c.data) {
              const d = c.data as { toolName?: string }
              if (d.toolName) toolCallNames.push(d.toolName)
            }
          }

          // 记录流式事件
          toolLog(`  流式事件 (${chunks.length} 个):`)
          const typeSummary: Record<string, number> = {}
          for (const c of chunks) {
            typeSummary[c.type] = (typeSummary[c.type] || 0) + 1
          }
          for (const [type, count] of Object.entries(typeSummary)) {
            toolLog(`    ${type}: ${count}`)
          }

          // 闭环检查
          const pairs: [string, string][] = [
            ['run:start', 'run:done'],
            ['turn:start', 'turn:done'],
            ['llm:start', 'llm:done'],
            ['text:start', 'text:done'],
            ['tool:start', 'tool:done']
          ]
          for (const [s, d] of pairs) {
            const sc = typeSummary[s] || 0
            const dc = typeSummary[d] || 0
            if (sc > 0 || dc > 0) {
              const ok = sc === dc ? '✓' : `✗ MISMATCH(${sc}/${dc})`
              toolLog(`    闭环: ${s}/${d} = ${ok}`)
            }
          }
        } else {
          // ── 同步执行 ──
          const result = await runtime.run(input)
          output = result.output
          duration = result.duration || 0
          if (result.toolCalls) {
            for (const tc of result.toolCalls) {
              toolCallNames.push(tc.toolName)
            }
          }
        }

        // 清洗输出
        const cleanOutput = output.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()

        // ── 对话后上下文 ──
        const after = await runtime.getContextSnapshot()
        const afterText = contextToText(after.contextItems)
        const compressed = after.stats.summaryCount > summaryBefore

        // 上下文中 item 类型分布
        const ctxItemTypes = after.contextItems.map((item) => itemTypeLabel(item))

        turns.push({
          turn,
          tag,
          input,
          output: cleanOutput,
          duration,
          compressed,
          toolCalls: toolCallNames,
          streaming,
          streamEvents,
          beforeCtxCount: before.stats.contextItemCount,
          afterCtxCount: after.stats.contextItemCount,
          summaryCount: after.stats.summaryCount,
          contextItemTypes: ctxItemTypes,
          beforeText,
          afterText
        })

        toolLog(`  输出: "${cleanOutput.replace(/\n/g, '\\n').slice(0, 150)}"`)
        toolLog(`  耗时: ${duration}ms`)
        toolLog(`  工具调用: ${toolCallNames.length > 0 ? toolCallNames.join(', ') : '无'}`)
        toolLog(`  压缩: ${compressed ? '✓ 触发' : '─'}`)
        toolLog(
          `  上下文: ${before.stats.contextItemCount} → ${after.stats.contextItemCount} 条, ` +
            `summaries: ${before.stats.summaryCount} → ${after.stats.summaryCount}`
        )

        // 对话后上下文类型分布
        toolLog(`\n  ── 对话后上下文类型分布 (${after.stats.contextItemCount} 条) ──`)
        const typeDistrib: Record<string, number> = {}
        for (const t of ctxItemTypes) {
          typeDistrib[t] = (typeDistrib[t] || 0) + 1
        }
        for (const [t, c] of Object.entries(typeDistrib)) {
          toolLog(`    ${t}: ${c}`)
        }

        // 如果发生了压缩
        if (compressed) {
          toolLog(`\n  ── 压缩后 LLM 上下文 (${after.stats.contextItemCount} 条) ──`)
          for (let j = 0; j < after.contextItems.length; j++) {
            const item = after.contextItems[j]
            toolLog(`    ${j + 1}. ${itemTypeLabel(item)} | ${extractContent(item, 80)}`)
          }

          // 关键词对比
          const beforeKw = checkToolKeywords(beforeText)
          const afterKw = checkToolKeywords(afterText)
          toolLog(`\n  ── 关键信息追踪: 第 ${turn} 轮压缩 ──`)
          toolLog(
            `  ${'关键词'.padEnd(14)}${'标签'.padEnd(14)}${'压缩前'.padEnd(8)}${'压缩后'.padEnd(8)}${'状态'}`
          )
          toolLog(`  ${'─'.repeat(54)}`)
          let lostCount = 0
          for (let k = 0; k < beforeKw.length; k++) {
            const b = beforeKw[k]
            const a = afterKw[k]
            let status = ''
            if (b.found && a.found) status = '✓ 保留'
            else if (b.found && !a.found) {
              status = '✗ 丢失'
              lostCount++
            } else if (!b.found && a.found) status = '+ 新增'
            else status = '· 无'
            toolLog(
              `  ${b.key.padEnd(14)}${b.label.padEnd(14)}` +
                `${(b.found ? '有' : '无').padEnd(8)}` +
                `${(a.found ? '有' : '无').padEnd(8)}${status}`
            )
          }
          toolLog(`  丢失: ${lostCount} 项`)

          // Summary 内容
          if (after.lastSummary) {
            const cleanSummary = after.lastSummary.summaryText
              .replace(/<think>[\s\S]*?<\/think>/gi, '')
              .trim()
            toolLog(`\n  ── Summary 内容 ──`)
            toolLog(`    seqs: [${after.lastSummary.summarizedSeqs.join(', ')}]`)
            toolLog(
              `    tokens: ${after.lastSummary.originalTokens} → ${after.lastSummary.summaryTokens}`
            )
            toolLog(`    text: ${cleanSummary.replace(/\n/g, '\\n').slice(0, 400)}`)
          }
        }
      }

      // ========== 总览表 ==========
      toolLog(`\n${'='.repeat(80)}`)
      toolLog(`  总览表`)
      toolLog(`${'='.repeat(80)}`)

      toolLog(
        `  ${'轮次'.padEnd(6)}${'标签'.padEnd(22)}${'模式'.padEnd(6)}${'工具'.padEnd(22)}` +
          `${'压缩'.padEnd(6)}${'上下文'.padEnd(14)}${'耗时'}`
      )
      toolLog(`  ${'─'.repeat(80)}`)
      for (const t of turns) {
        toolLog(
          `  ${String(t.turn).padEnd(6)}${t.tag.padEnd(22)}` +
            `${(t.streaming ? '流式' : '同步').padEnd(6)}` +
            `${(t.toolCalls.length > 0 ? t.toolCalls.join(',') : '─').padEnd(22)}` +
            `${(t.compressed ? '✓' : '─').padEnd(6)}` +
            `${`${t.beforeCtxCount} → ${t.afterCtxCount}`.padEnd(14)}${t.duration}ms`
        )
      }

      // ========== 信息保留追踪总表 ==========
      toolLog(`\n${'='.repeat(80)}`)
      toolLog(`  工具信息保留追踪`)
      toolLog(`${'='.repeat(80)}`)

      toolLog(`  ${'轮次'.padEnd(6)}` + TOOL_TRACK_KEYWORDS.map((k) => k.label.padEnd(10)).join(''))
      toolLog(`  ${'─'.repeat(6 + TOOL_TRACK_KEYWORDS.length * 10)}`)

      for (const t of turns) {
        const kws = checkToolKeywords(t.afterText)
        const row = kws.map((k) => (k.found ? '✓' : '✗').padEnd(10)).join('')
        toolLog(`  ${`R${t.turn}`.padEnd(6)}${row}`)
      }

      // ========== 最终状态 ==========
      const finalSnapshot = await runtime.getContextSnapshot()
      const ctxTokens = countItemsTokens(finalSnapshot.contextItems)

      toolLog(`\n${'='.repeat(80)}`)
      toolLog(`  最终状态`)
      toolLog(`${'='.repeat(80)}`)
      toolLog(
        `  contextItems: ${finalSnapshot.stats.contextItemCount}, ` +
          `totalSessionItems: ${finalSnapshot.stats.totalSessionItems}, ` +
          `messages: ${finalSnapshot.stats.messageCount}, ` +
          `summaries: ${finalSnapshot.stats.summaryCount}, ` +
          `tokens ≈ ${ctxTokens}`
      )

      toolLog(`\n  ── 最终 LLM 上下文 (${finalSnapshot.contextItems.length} 条) ──`)
      for (let j = 0; j < finalSnapshot.contextItems.length; j++) {
        const item = finalSnapshot.contextItems[j]
        toolLog(`    ${j + 1}. ${itemTypeLabel(item)} | ${extractContent(item, 100)}`)
      }

      if (finalSnapshot.lastSummary) {
        const cleanSummary = finalSnapshot.lastSummary.summaryText
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .trim()
        toolLog(`\n  ── 最终 Summary ──`)
        toolLog(`    endSeq: ${finalSnapshot.lastSummary.endSeq}`)
        toolLog(`    seqs: [${finalSnapshot.lastSummary.summarizedSeqs.join(', ')}]`)
        toolLog(
          `    tokens: ${finalSnapshot.lastSummary.originalTokens} → ${finalSnapshot.lastSummary.summaryTokens}`
        )
        toolLog(
          `    text:\n${cleanSummary
            .split('\n')
            .map((l) => `      ${l}`)
            .join('\n')}`
        )
      }

      // ========== R7 验证输出分析 ==========
      toolLog(`\n${'='.repeat(80)}`)
      toolLog(`  验证输出分析`)
      toolLog(`${'='.repeat(80)}`)

      const r7 = turns.find((t) => t.turn === 7)
      if (r7) {
        toolLog(`  R7 验证回忆:`)
        toolLog(`    输出: "${r7.output.replace(/\n/g, '\\n').slice(0, 300)}"`)
        toolLog(`    包含 "小李": ${r7.output.includes('小李') ? '✓' : '✗'}`)
        toolLog(`    包含 "42": ${r7.output.includes('42') ? '✓' : '✗'}`)
        toolLog(`    包含 "120": ${r7.output.includes('120') ? '✓' : '✗'}`)
      }

      const r8 = turns.find((t) => t.turn === 8)
      if (r8) {
        toolLog(`  R8 压缩后工具调用:`)
        toolLog(`    输出: "${r8.output.replace(/\n/g, '\\n').slice(0, 200)}"`)
        toolLog(`    工具调用: ${r8.toolCalls.join(', ') || '无'}`)
        toolLog(`    包含 "100": ${r8.output.includes('100') ? '✓' : '✗'}`)
      }

      // ========== 断言 ==========

      // 1. 至少发生过一次压缩
      expect(finalSnapshot.stats.summaryCount).toBeGreaterThanOrEqual(1)

      // 2. 有工具调用发生过
      const totalToolCalls = turns.reduce((sum, t) => sum + t.toolCalls.length, 0)
      expect(totalToolCalls).toBeGreaterThanOrEqual(3)

      // 3. R8 压缩后工具调用仍然正常
      expect(r8?.toolCalls.length).toBeGreaterThanOrEqual(1)
    }
  )
})
