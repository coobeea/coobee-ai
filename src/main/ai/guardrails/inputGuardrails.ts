/**
 * 输入护栏（Input Guardrails）
 *
 * 基于 SDK 的 InputGuardrail 接口，在 Agent 执行前检查输入安全性
 * 传入 Runner 或 run() 的 inputGuardrails 选项
 */

import type { InputGuardrail, GuardrailFunctionOutput } from '@openai/agents'

/**
 * 内容安全配置
 */
export interface ContentSafetyConfig {
  /** 敏感词列表 */
  blockedPatterns?: RegExp[]
  /** 最大输入长度 */
  maxInputLength?: number
  /** 是否允许 URL */
  allowUrls?: boolean
}

/**
 * 内容安全输入护栏
 *
 * 检查输入是否包含敏感或不安全内容
 * 当检测到敏感内容时，触发 tripwire 中止执行
 */
export function createContentSafetyGuardrail(config: ContentSafetyConfig = {}): InputGuardrail {
  const { blockedPatterns = [], maxInputLength = 50000, allowUrls = true } = config

  return {
    name: 'content_safety',
    execute: async ({ input }): Promise<GuardrailFunctionOutput> => {
      const text = typeof input === 'string' ? input : JSON.stringify(input)
      const issues: string[] = []

      // 1. 长度检查
      if (text.length > maxInputLength) {
        issues.push(`Input exceeds maximum length (${text.length}/${maxInputLength})`)
      }

      // 2. 敏感词检查
      for (const pattern of blockedPatterns) {
        if (pattern.test(text)) {
          issues.push(`Blocked pattern detected: ${pattern.source}`)
        }
      }

      // 3. URL 检查（如果禁止）
      if (!allowUrls) {
        const urlPattern = /https?:\/\/[^\s]+/gi
        if (urlPattern.test(text)) {
          issues.push('URLs are not allowed in input')
        }
      }

      return {
        tripwireTriggered: issues.length > 0,
        outputInfo: {
          passed: issues.length === 0,
          issues,
          checkedAt: Date.now()
        }
      }
    },
    // 内容安全检查必须在 Agent 执行前完成（阻塞模式）
    runInParallel: false
  }
}

/** 默认内容安全护栏 */
export const contentSafetyInputGuardrail = createContentSafetyGuardrail()

/**
 * 注入检测护栏
 *
 * 检测常见的 prompt injection 攻击模式
 */
export const injectionDetectionGuardrail: InputGuardrail = {
  name: 'injection_detection',
  execute: async ({ input }): Promise<GuardrailFunctionOutput> => {
    const text = typeof input === 'string' ? input : JSON.stringify(input)

    // 常见 prompt injection 模式
    const injectionPatterns = [
      /ignore\s+(all\s+)?previous\s+instructions/i,
      /you\s+are\s+now\s+(?:a|an)\s+(?:different|new)/i,
      /disregard\s+(?:all\s+)?(?:above|previous)/i,
      /system\s*:\s*you\s+are/i,
      /\[SYSTEM\]\s*override/i
    ]

    const detected = injectionPatterns.filter((p) => p.test(text))

    return {
      tripwireTriggered: detected.length > 0,
      outputInfo: {
        passed: detected.length === 0,
        detectedPatterns: detected.map((p) => p.source),
        checkedAt: Date.now()
      }
    }
  },
  // 注入检测可以与 Agent 并行运行
  runInParallel: true
}

/**
 * 输入长度护栏
 *
 * 简单的长度限制检查
 */
export function createMaxLengthGuardrail(maxLength: number = 100000): InputGuardrail {
  return {
    name: 'max_input_length',
    execute: async ({ input }): Promise<GuardrailFunctionOutput> => {
      const text = typeof input === 'string' ? input : JSON.stringify(input)
      const exceeded = text.length > maxLength

      return {
        tripwireTriggered: exceeded,
        outputInfo: {
          passed: !exceeded,
          length: text.length,
          maxLength,
          checkedAt: Date.now()
        }
      }
    },
    runInParallel: true
  }
}

/** 默认最大长度护栏 */
export const maxLengthInputGuardrail = createMaxLengthGuardrail()
