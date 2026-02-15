/**
 * 模型 Fallback 链执行器
 *
 * 按顺序尝试候选模型，遇到可重试错误时自动切换。
 */
import type { FallbackResult, ModelRef } from './types'
import { formatModelRef, parseModelRef } from './types'

/** 默认可重试错误判断 */
function defaultIsRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    // Rate limit / timeout / server errors
    return (
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('503') ||
      msg.includes('502') ||
      msg.includes('500') ||
      msg.includes('overloaded')
    )
  }
  return false
}

/** 用户取消错误判断（不应重试） */
function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.message.includes('abort')
  }
  return false
}

export interface FallbackOptions {
  /** 自定义可重试判断 */
  isRetryable?: (error: unknown) => boolean
  /** 每次重试前等待时间（ms） */
  delayMs?: number
}

export class ModelFallback {
  /**
   * 按 Fallback 链执行
   *
   * @param candidates 候选模型列表（"provider/model" 格式字符串或 ModelRef）
   * @param execute 执行函数
   * @param opts 选项
   * @returns Fallback 结果
   */
  async run<T>(
    candidates: (string | ModelRef)[],
    execute: (ref: ModelRef) => Promise<T>,
    opts?: FallbackOptions
  ): Promise<FallbackResult<T>> {
    const isRetryable = opts?.isRetryable ?? defaultIsRetryable
    const delayMs = opts?.delayMs ?? 0
    const failedModels: string[] = []
    let attempts = 0

    for (const candidate of candidates) {
      const ref = typeof candidate === 'string' ? parseModelRef(candidate) : candidate
      const refStr = formatModelRef(ref)
      attempts++

      try {
        const result = await execute(ref)
        return {
          result,
          provider: ref.provider,
          model: ref.model,
          attempts,
          failedModels
        }
      } catch (error) {
        // 用户取消 → 立即停止
        if (isAbortError(error)) {
          throw error
        }

        failedModels.push(refStr)

        // 最后一个候选 → 抛出原始错误
        if (candidates.indexOf(candidate) === candidates.length - 1) {
          throw error
        }

        // 不可重试的错误 → 也抛出
        if (!isRetryable(error)) {
          throw error
        }

        // 可重试 → 等待后尝试下一个
        if (delayMs > 0) {
          await sleep(delayMs)
        }
      }
    }

    // 不应到达这里
    throw new Error('No candidates provided for fallback')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
