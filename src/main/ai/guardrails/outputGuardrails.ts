/**
 * 输出护栏（Output Guardrails）
 *
 * 基于 SDK 的 OutputGuardrail 接口，在 Agent 执行后检查输出安全性
 * 传入 Runner 或 run() 配置的 outputGuardrails 选项
 */

import type { OutputGuardrail, GuardrailFunctionOutput } from '@openai/agents'

/**
 * 敏感数据检测配置
 */
export interface SensitiveDataConfig {
  /** 需要检测的敏感数据模式 */
  patterns?: Array<{
    name: string
    regex: RegExp
  }>
  /** 是否屏蔽敏感数据而非中止执行 */
  maskInsteadOfBlock?: boolean
}

/**
 * 默认敏感数据模式
 */
const DEFAULT_SENSITIVE_PATTERNS = [
  { name: 'credit_card', regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/ },
  { name: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/ },
  { name: 'phone_cn', regex: /\b1[3-9]\d{9}\b/ },
  { name: 'id_card_cn', regex: /\b\d{17}[\dXx]\b/ },
  { name: 'api_key', regex: /\b(?:sk-|pk-|api[-_]?key[-_]?)[\w-]{20,}\b/i }
]

/**
 * 敏感数据输出护栏
 *
 * 检测 Agent 输出中是否包含敏感数据（信用卡号、身份证号、API Key 等）
 */
export function createSensitiveDataGuardrail(config: SensitiveDataConfig = {}): OutputGuardrail {
  const { patterns = DEFAULT_SENSITIVE_PATTERNS, maskInsteadOfBlock = false } = config

  return {
    name: 'sensitive_data_detection',
    execute: async ({ agentOutput }): Promise<GuardrailFunctionOutput> => {
      const output = typeof agentOutput === 'string' ? agentOutput : JSON.stringify(agentOutput)
      const detectedTypes: string[] = []

      for (const pattern of patterns) {
        if (pattern.regex.test(output)) {
          detectedTypes.push(pattern.name)
        }
      }

      return {
        // 如果配置为屏蔽模式，不触发 tripwire
        tripwireTriggered: !maskInsteadOfBlock && detectedTypes.length > 0,
        outputInfo: {
          passed: detectedTypes.length === 0,
          detectedSensitiveTypes: detectedTypes,
          action: maskInsteadOfBlock ? 'mask' : 'block',
          checkedAt: Date.now()
        }
      }
    }
  }
}

/** 默认敏感数据护栏 */
export const sensitiveDataOutputGuardrail = createSensitiveDataGuardrail()

/**
 * 格式合规输出护栏
 *
 * 检查 Agent 输出是否符合预期格式
 * 例如：JSON 格式要求、最小长度、是否包含必要的标记等
 */
export const formatComplianceOutputGuardrail: OutputGuardrail = {
  name: 'format_compliance',
  execute: async ({ agentOutput }): Promise<GuardrailFunctionOutput> => {
    const output = typeof agentOutput === 'string' ? agentOutput : JSON.stringify(agentOutput)
    const issues: string[] = []

    // 检查输出是否为空
    if (!output || output.trim().length === 0) {
      issues.push('Output is empty')
    }

    // 检查是否包含常见的模型幻觉标记
    const hallucinationPatterns = [
      /as an ai language model/i,
      /i cannot access the internet/i,
      /i don't have access to real-time/i
    ]

    for (const pattern of hallucinationPatterns) {
      if (pattern.test(output)) {
        issues.push(`Potential hallucination marker: ${pattern.source}`)
      }
    }

    return {
      tripwireTriggered: false, // 格式问题不阻断，只记录
      outputInfo: {
        passed: issues.length === 0,
        issues,
        outputLength: output.length,
        checkedAt: Date.now()
      }
    }
  }
}
