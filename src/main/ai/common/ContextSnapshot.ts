/**
 * Context Snapshot — LLM 请求上下文快照
 *
 * 每次 LLM 调用完成后，由 Runtime 层将输入上下文和输出结果写入 JSON 文件。
 * 用于调试、Prompt 优化和成本分析。
 *
 * 写入位置：{workspace}/contexts/{timestamp}.json
 * 文件名格式：ISO 时间戳（冒号替换为短横线），自然排序 = 时间线顺序。
 *
 * 架构位置：
 *   AgentExecutor（调度层）
 *     → injectEnv() 设置 contextDir = {workspace}/contexts
 *     → Builder.contextDir(dir) → 传入 Runtime options
 *   Runtime 层（实际写入）
 *     → stream()/run() 完成后调用 saveContextSnapshot()
 */

import fs from 'fs'
import path from 'path'
import type { AgentRuntimeOptions, ExecutionResult } from '../runtime/types'

// ==================== Logger ====================

interface SnapshotLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
}

const createSnapshotLogger = (): SnapshotLogger => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createLogger } = require('@main/common/logger')
    return createLogger('context-snapshot') as SnapshotLogger
  } catch {
    return {
      info: (msg: string, ...args: unknown[]) => console.log(`[ContextSnapshot] ${msg}`, ...args),
      warn: (msg: string, ...args: unknown[]) => console.warn(`[ContextSnapshot] ${msg}`, ...args)
    }
  }
}

const log = createSnapshotLogger()

// ==================== 类型定义 ====================

/**
 * 完整的上下文快照
 */
export interface ContextSnapshot {
  /** 写入时间 */
  timestamp: string
  /** 会话 ID */
  sessionId: string
  /** Runtime 类型 */
  runtime: string
  /** 配置快照（不含敏感信息） */
  config: {
    /** Agent 名称 */
    name: string
    /** 模型名称 */
    model: string
    /** 系统指令 */
    instructions: string
    /** 追加指令片段 */
    appendInstructions?: string[]
    /** 技能列表（仅名称和描述） */
    skills?: Array<{ name: string; description: string }>
    /** 工具列表（仅名称和描述） */
    tools?: Array<{ name: string; description: string }>
  }
  /** 用户消息 */
  userMessage: string
  /** LLM 输出 */
  output: string
  /** 工具调用记录 */
  toolCalls?: Array<{
    toolName: string
    arguments: Record<string, unknown>
    result?: unknown
  }>
  /** 执行耗时（ms） */
  duration?: number
}

// ==================== 写入函数 ====================

/**
 * 生成时间戳文件名
 *
 * 格式：2026-02-12T10-00-05-123.json
 * - ISO 格式保证自然排序 = 时间顺序
 * - 冒号替换为短横线，兼容 Windows
 * - 毫秒精度，基本不会冲突
 */
function generateFilename(): string {
  const ts = new Date()
    .toISOString()
    .replace(/:/g, '-') // 冒号 → 短横线（Windows 兼容）
    .replace('.', '-') // 小数点 → 短横线
    .replace('Z', '') // 去掉尾部 Z
  return `${ts}.json`
}

/**
 * 将上下文快照写入文件
 *
 * 写入失败仅记录警告，不阻断主流程。
 *
 * @param contextDir 上下文快照目录（{workspace}/contexts/）
 * @param snapshot   上下文快照数据
 */
export async function writeContextSnapshot(
  contextDir: string,
  snapshot: ContextSnapshot
): Promise<void> {
  try {
    // 确保目录存在（正常情况已由 getAgentWorkspaceDir 创建，这里做兜底）
    if (!fs.existsSync(contextDir)) {
      fs.mkdirSync(contextDir, { recursive: true })
    }

    const filename = generateFilename()
    const filepath = path.join(contextDir, filename)

    await fs.promises.writeFile(filepath, JSON.stringify(snapshot, null, 2), 'utf-8')
    log.info(`Written: ${filename}`)
  } catch (error) {
    // 写入失败不阻断执行
    log.warn(`Write failed:`, error)
  }
}

// ==================== 便捷函数 ====================

/**
 * Runtime 层的便捷快照写入
 *
 * 从 AgentRuntimeOptions + ExecutionResult 自动构建快照并写入。
 * 如果 options.contextDir 未设置，直接跳过（不报错）。
 *
 * @param options     Runtime 选项（含 contextDir）
 * @param runtimeType Runtime 类型标识（如 'openai'、'pimono'）
 * @param input       用户输入消息
 * @param result      执行结果
 */
export async function saveContextSnapshot(
  options: AgentRuntimeOptions,
  runtimeType: string,
  input: string,
  result: ExecutionResult
): Promise<void> {
  const contextDir = options.contextDir
  if (!contextDir) return

  const snapshot: ContextSnapshot = {
    timestamp: new Date().toISOString(),
    sessionId: options.sessionId || 'unknown',
    runtime: runtimeType,
    config: {
      name: options.name,
      model: options.model || 'unknown',
      instructions: options.instructions,
      appendInstructions: options.appendInstructions,
      skills: options.skills?.map((s) => ({ name: s.name, description: s.description })),
      tools: options.tools?.map((t) => ({ name: t.name, description: t.description }))
    },
    userMessage: input,
    output: result.output,
    toolCalls: result.toolCalls,
    duration: result.duration
  }

  await writeContextSnapshot(contextDir, snapshot)
}
