/**
 * 内置验证规则
 */

import type { VerificationRule } from './types'

/**
 * JSON 格式验证
 */
export const formatValidationRule: VerificationRule = {
  id: 'format-json',
  name: 'JSON格式验证',
  type: 'format',
  execute: async (output) => {
    try {
      if (typeof output === 'string') {
        JSON.parse(output)
      }
      return {
        passed: true,
        ruleId: 'format-json',
        ruleName: 'JSON格式验证'
      }
    } catch (error) {
      return {
        passed: false,
        ruleId: 'format-json',
        ruleName: 'JSON格式验证',
        message: '输出不是有效的JSON格式',
        issues: [
          {
            severity: 'error',
            code: 'INVALID_JSON',
            message: error instanceof Error ? error.message : String(error)
          }
        ]
      }
    }
  }
}

/**
 * 内容完整性验证
 */
export const contentCompletenessRule: VerificationRule = {
  id: 'content-completeness',
  name: '内容完整性验证',
  type: 'content',
  execute: async (output) => {
    // 检查输出是否为空
    if (!output || (typeof output === 'string' && output.trim().length === 0)) {
      return {
        passed: false,
        ruleId: 'content-completeness',
        ruleName: '内容完整性验证',
        message: '输出内容为空',
        issues: [
          {
            severity: 'error',
            code: 'EMPTY_OUTPUT',
            message: '任务输出不能为空'
          }
        ]
      }
    }

    return {
      passed: true,
      ruleId: 'content-completeness',
      ruleName: '内容完整性验证'
    }
  }
}

/**
 * 字符串长度验证
 */
export function createMinLengthRule(minLength: number): VerificationRule {
  return {
    id: `min-length-${minLength}`,
    name: `最小长度验证(${minLength})`,
    type: 'content',
    execute: async (output) => {
      const content = typeof output === 'string' ? output : JSON.stringify(output)
      const passed = content.length >= minLength

      return {
        passed,
        ruleId: `min-length-${minLength}`,
        ruleName: `最小长度验证(${minLength})`,
        message: passed ? undefined : `输出长度${content.length}小于最小要求${minLength}`,
        issues: passed
          ? []
          : [
              {
                severity: 'error',
                code: 'CONTENT_TOO_SHORT',
                message: `输出内容长度不足，当前${content.length}字符，要求至少${minLength}字符`
              }
            ]
      }
    }
  }
}

/**
 * 自定义验证规则工厂
 */
export function createCustomRule(
  id: string,
  name: string,
  validate: (output: unknown) => boolean | Promise<boolean>,
  errorMessage: string
): VerificationRule {
  return {
    id,
    name,
    type: 'custom',
    execute: async (output) => {
      const passed = await validate(output)
      return {
        passed,
        ruleId: id,
        ruleName: name,
        message: passed ? undefined : errorMessage,
        issues: passed
          ? []
          : [
              {
                severity: 'error',
                code: 'CUSTOM_VALIDATION_FAILED',
                message: errorMessage
              }
            ]
      }
    }
  }
}

/**
 * 必需字段验证（针对对象）
 */
export function createRequiredFieldsRule(fields: string[]): VerificationRule {
  return {
    id: `required-fields-${fields.join('-')}`,
    name: `必需字段验证`,
    type: 'structure',
    execute: async (output) => {
      if (typeof output !== 'object' || output === null) {
        return {
          passed: false,
          ruleId: `required-fields-${fields.join('-')}`,
          ruleName: '必需字段验证',
          message: '输出不是有效的对象',
          issues: [
            {
              severity: 'error',
              code: 'INVALID_OBJECT',
              message: '期望输出为对象类型'
            }
          ]
        }
      }

      const missingFields: string[] = []
      for (const field of fields) {
        if (!(field in (output as Record<string, unknown>))) {
          missingFields.push(field)
        }
      }

      if (missingFields.length > 0) {
        return {
          passed: false,
          ruleId: `required-fields-${fields.join('-')}`,
          ruleName: '必需字段验证',
          message: `缺少必需字段: ${missingFields.join(', ')}`,
          issues: missingFields.map((field) => ({
            severity: 'error',
            code: 'MISSING_FIELD',
            message: `缺少必需字段: ${field}`
          }))
        }
      }

      return {
        passed: true,
        ruleId: `required-fields-${fields.join('-')}`,
        ruleName: '必需字段验证'
      }
    }
  }
}

/**
 * 默认验证规则集合
 */
export const defaultVerificationRules: VerificationRule[] = [
  contentCompletenessRule,
  createMinLengthRule(10)
]
