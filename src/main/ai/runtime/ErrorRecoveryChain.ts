/**
 * 渐进式错误恢复链
 *
 * 当 LLM 执行过程中出错时，按照策略链逐一尝试恢复：
 *   1. 简单重试（临时网络错误、速率限制）
 *   2. 思考级别降级（减少 reasoning tokens）
 *   3. 模型降级（切换到更稳定的模型）
 *
 * 每个策略实现 `canHandle(error)` 和 `recover()` 方法。
 * 第一个能处理该错误的策略生效。
 *
 * 参考：OpenClaw 的渐进式恢复机制
 */

import { createLogger } from '@main/common/logger'

const log = createLogger('error-recovery')

// ==================== Types ====================

/** 恢复动作 */
export type RecoveryAction =
  | { action: 'retry'; delay?: number; reason: string }
  | { action: 'throw'; reason: string }

/** 恢复策略接口 */
export interface RecoveryStrategy {
  /** 策略名称 */
  readonly name: string
  /** 是否能处理此错误 */
  canHandle(error: Error): boolean
  /** 执行恢复，返回恢复动作 */
  recover(error: Error, context: RecoveryContext): Promise<RecoveryAction>
}

/** 恢复上下文 */
export interface RecoveryContext {
  /** 当前重试次数 */
  attempt: number
  /** 最大重试次数 */
  maxAttempts: number
  /** Agent 会话 ID */
  sessionId?: string
  /**
   * Runtime 引用（可选）
   *
   * 允许恢复策略访问 Runtime 能力：
   *   - compressor: 上下文压缩器（ContextCompressionStrategy 使用）
   *   - thinkingLevel: 当前思考级别（ThinkingLevelFallbackStrategy 使用）
   *   - setThinkingLevel: 修改思考级别
   */
  runtime?: {
    compressor?: { compress(): Promise<void> }
    thinkingLevel?: string
    setThinkingLevel?: (level: string) => void
  }
}

// ==================== Strategies ====================

/**
 * 策略 1: 简单重试（指数退避）
 *
 * 匹配：网络超时、连接错误、速率限制
 */
export class SimpleRetryStrategy implements RecoveryStrategy {
  readonly name = 'simple-retry'

  private maxRetries: number
  private baseDelayMs: number

  constructor(options?: { maxRetries?: number; baseDelayMs?: number }) {
    this.maxRetries = options?.maxRetries ?? 2
    this.baseDelayMs = options?.baseDelayMs ?? 1000
  }

  canHandle(error: Error): boolean {
    const msg = error.message.toLowerCase()
    return (
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('socket hang up') ||
      msg.includes('network') ||
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('too many requests') ||
      msg.includes('500') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('service unavailable')
    )
  }

  async recover(_error: Error, context: RecoveryContext): Promise<RecoveryAction> {
    if (context.attempt >= this.maxRetries) {
      return { action: 'throw', reason: `Max retries (${this.maxRetries}) exceeded` }
    }

    const delay = this.baseDelayMs * Math.pow(2, context.attempt)
    return {
      action: 'retry',
      delay,
      reason: `Transient error, retrying in ${delay}ms (attempt ${context.attempt + 1}/${this.maxRetries})`
    }
  }
}

/**
 * 策略 2: 上下文压缩恢复
 *
 * 匹配：context_length_exceeded、tokens exceed 等错误
 * 恢复：如果 runtime 提供了 compressor，主动触发压缩后重试
 */
export class ContextCompressionStrategy implements RecoveryStrategy {
  readonly name = 'context-compression'

  canHandle(error: Error): boolean {
    const msg = error.message.toLowerCase()
    return (
      msg.includes('context_length_exceeded') ||
      msg.includes('context length') ||
      msg.includes('maximum context') ||
      msg.includes('tokens exceed') ||
      msg.includes('too many tokens') ||
      msg.includes('request too large')
    )
  }

  async recover(_error: Error, context: RecoveryContext): Promise<RecoveryAction> {
    if (context.attempt >= 2) {
      return {
        action: 'throw',
        reason: 'Context still too long after 2 compression attempts'
      }
    }

    // 有 compressor → 主动压缩后重试
    if (context.runtime?.compressor) {
      try {
        log.info('[ErrorRecovery] Triggering context compression...')
        await context.runtime.compressor.compress()
        return {
          action: 'retry',
          reason: 'Context compressed, retrying'
        }
      } catch (compressErr) {
        log.warn('[ErrorRecovery] Compression failed:', compressErr)
        return {
          action: 'throw',
          reason: `Compression failed: ${compressErr instanceof Error ? compressErr.message : String(compressErr)}`
        }
      }
    }

    // 无 compressor → 只重试一次（期望调用方在重试前自行处理）
    if (context.attempt >= 1) {
      return {
        action: 'throw',
        reason: 'Context too long and no compressor available'
      }
    }
    return {
      action: 'retry',
      reason: 'Context too long — will attempt with truncated context'
    }
  }
}

/**
 * 策略 2.5: 思考级别降级
 *
 * 匹配：context_length_exceeded（在压缩失败后）、thinking_budget 相关错误
 * 恢复：将思考级别从 high → medium → low → off 逐级降低
 */
export class ThinkingLevelFallbackStrategy implements RecoveryStrategy {
  readonly name = 'thinking-level-fallback'

  private static readonly LEVELS = ['high', 'medium', 'low', 'off'] as const

  canHandle(error: Error): boolean {
    const msg = error.message.toLowerCase()
    return (
      msg.includes('context_length_exceeded') ||
      msg.includes('tokens exceed') ||
      msg.includes('thinking_budget') ||
      msg.includes('reasoning_tokens')
    )
  }

  async recover(_error: Error, context: RecoveryContext): Promise<RecoveryAction> {
    const currentLevel = context.runtime?.thinkingLevel || 'medium'
    const levels = ThinkingLevelFallbackStrategy.LEVELS
    const currentIdx = levels.indexOf(currentLevel as (typeof levels)[number])

    // 已经是最低级别或找不到当前级别
    if (currentIdx < 0 || currentIdx >= levels.length - 1) {
      return {
        action: 'throw',
        reason: `Thinking level already at "${currentLevel}", cannot downgrade further`
      }
    }

    const nextLevel = levels[currentIdx + 1]

    if (context.runtime?.setThinkingLevel) {
      context.runtime.setThinkingLevel(nextLevel)
      log.info(`[ErrorRecovery] Downgraded thinking level: ${currentLevel} → ${nextLevel}`)
      return {
        action: 'retry',
        reason: `Thinking level downgraded from ${currentLevel} to ${nextLevel}`
      }
    }

    return {
      action: 'throw',
      reason: 'Cannot change thinking level — no runtime access'
    }
  }
}

/**
 * 策略 3: 认证错误（不可恢复）
 *
 * 匹配：unauthorized、invalid_api_key、forbidden
 * 直接抛出：此类错误重试无意义
 */
export class AuthenticationStrategy implements RecoveryStrategy {
  readonly name = 'authentication'

  canHandle(error: Error): boolean {
    const msg = error.message.toLowerCase()
    return (
      msg.includes('unauthorized') ||
      msg.includes('invalid_api_key') ||
      msg.includes('invalid api key') ||
      msg.includes('forbidden') ||
      msg.includes('401') ||
      msg.includes('403')
    )
  }

  async recover(_error: Error): Promise<RecoveryAction> {
    return {
      action: 'throw',
      reason: 'Authentication error — check your API key'
    }
  }
}

// ==================== Chain ====================

/**
 * 错误恢复链
 *
 * 按照策略注册顺序逐一匹配错误，第一个匹配的策略执行恢复。
 * 如果没有策略匹配，直接抛出原错误。
 */
export class ErrorRecoveryChain {
  private strategies: RecoveryStrategy[]

  constructor(strategies?: RecoveryStrategy[]) {
    this.strategies = strategies ?? [
      // 认证错误优先匹配（不可恢复，避免无意义重试）
      new AuthenticationStrategy(),
      // 上下文压缩（优先于思考级别降级）
      new ContextCompressionStrategy(),
      // 思考级别降级（压缩后仍不够时触发）
      new ThinkingLevelFallbackStrategy(),
      // 简单重试（兜底）
      new SimpleRetryStrategy()
    ]
  }

  /**
   * 尝试恢复错误
   *
   * @param error 发生的错误
   * @param context 恢复上下文（包含重试次数等）
   * @returns 恢复动作（retry 或 throw）
   */
  async recover(error: Error, context: RecoveryContext): Promise<RecoveryAction> {
    for (const strategy of this.strategies) {
      if (strategy.canHandle(error)) {
        log.info(
          `[ErrorRecovery] Strategy "${strategy.name}" matched for: ${error.message.slice(0, 100)}`
        )
        const action = await strategy.recover(error, context)
        log.info(`[ErrorRecovery] Action: ${action.action} — ${action.reason}`)
        return action
      }
    }

    // 无策略匹配
    log.warn(`[ErrorRecovery] No recovery strategy matched for: ${error.message.slice(0, 100)}`)
    return { action: 'throw', reason: 'No recovery strategy available' }
  }

  /** 添加自定义策略（插入到链首） */
  addStrategy(strategy: RecoveryStrategy): void {
    this.strategies.unshift(strategy)
  }
}

/** 默认的错误恢复链单例 */
export const defaultRecoveryChain = new ErrorRecoveryChain()
