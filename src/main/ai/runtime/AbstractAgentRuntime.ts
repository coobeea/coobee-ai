/**
 * AbstractAgentRuntime — 抽象基类
 *
 * 提取 OpenAI、PiMono、Team、Swarm 的公共实现：
 *   - id 生成（crypto.randomUUID 或 timestamp+random）
 *   - run() 默认实现（消费 stream() 收集结果）
 *   - runStream(onChunk) 默认实现
 *   - createRuntimeLogger() 静态工厂
 *   - stripThinkTags() 静态工具
 *
 * 子类只需实现：
 *   - stream() — 核心流式方法
 *   - initialize() / destroy() — 生命周期
 *   - getSession() / clearSession() — 会话管理
 *   - 以及必要的 HITL 方法（或使用默认的 throw 实现）
 */

import type { AgentRuntime } from './AgentRuntime'
import type {
  AgentRuntimeOptions,
  ExecutionConfig,
  ExecutionResult,
  StreamChunk,
  SessionInfo
} from './types'

// ==================== Logger 工具 ====================

/** Runtime 内部日志接口 */
export interface RuntimeLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
}

/**
 * 创建 Runtime 日志实例
 *
 * 优先使用项目 createLogger，fallback 到 console（测试环境）。
 */
export function createRuntimeLogger(moduleName: string): RuntimeLogger {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createLogger } = require('@main/common/logger')
    return createLogger(moduleName) as RuntimeLogger
  } catch {
    const prefix = `[${moduleName}]`
    return {
      info: (msg: string, ...args: unknown[]) => console.log(`${prefix} ${msg}`, ...args),
      warn: (msg: string, ...args: unknown[]) => console.warn(`${prefix} ${msg}`, ...args),
      error: (msg: string, ...args: unknown[]) => console.error(`${prefix} ${msg}`, ...args),
      debug: (msg: string, ...args: unknown[]) => console.debug(`${prefix} ${msg}`, ...args)
    }
  }
}

// ==================== 文本工具 ====================

/**
 * 去除文本中的 `<think>...</think>` 标签及其内容
 *
 * 部分 Provider（如 MiniMax）在 OpenAI 兼容模式下
 * 会将思考内容以 `<think>` 标签包裹在文本中返回。
 */
export function stripThinkTags(text: string): string {
  if (!text) return ''
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim()
}

// ==================== ID 生成 ====================

/**
 * 生成 Runtime 唯一 ID
 * @param prefix 前缀标识（如 'agent', 'pi-agent', 'team', 'swarm'）
 */
export function generateRuntimeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ==================== 抽象基类 ====================

/**
 * Agent Runtime 抽象基类
 *
 * 提供 run()、runStream() 等的默认实现。
 * 子类继承后只需聚焦于 stream() 的 SDK 特定逻辑。
 */
export abstract class AbstractAgentRuntime implements AgentRuntime {
  abstract readonly type: 'agent' | 'team' | 'swarm'
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly options: AgentRuntimeOptions
  abstract readonly interrupted: boolean
  abstract readonly supportsHITL: boolean

  // ========== 生命周期（子类必须实现） ==========

  abstract initialize(): Promise<void>
  abstract destroy(): Promise<void>

  // ========== 核心流式方法（子类必须实现） ==========

  abstract stream(
    input: string,
    config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown>

  // ========== 默认实现：run ==========

  /**
   * 同步执行 — 消费 stream() 收集结果
   *
   * 子类一般不需要覆盖此方法。
   * 如果子类有特殊的非流式执行路径，可以覆盖。
   */
  async run(input: string, config?: ExecutionConfig): Promise<ExecutionResult> {
    const gen = this.stream(input, config)
    let r = await gen.next()
    while (!r.done) {
      r = await gen.next()
    }
    return r.value
  }

  // ========== 默认实现：runStream ==========

  /**
   * 流式执行（回调模式 — stream() 的包装）
   *
   * 这是一个便捷方法，将 AsyncGenerator 转为回调模式。
   * 子类一般不需要覆盖。
   */
  async runStream(
    input: string,
    config: ExecutionConfig,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult> {
    const gen = this.stream(input, config)
    let r = await gen.next()
    while (!r.done) {
      onChunk(r.value)
      r = await gen.next()
    }
    return r.value
  }

  // ========== 默认实现：HITL（不支持时 throw） ==========

  approveToolCall(_index: number, _options?: { alwaysApprove?: boolean }): void {
    throw new Error(`${this.constructor.name} does not support HITL tool approval`)
  }

  rejectToolCall(_index: number, _options?: { alwaysReject?: boolean }): void {
    throw new Error(`${this.constructor.name} does not support HITL tool approval`)
  }

  // eslint-disable-next-line require-yield
  async *resumeStream(
    _config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    throw new Error(`${this.constructor.name} does not support HITL resume`)
  }

  // ========== 会话管理（子类必须实现） ==========

  abstract getSession(): Promise<SessionInfo>
  abstract clearSession(): Promise<void>
}
