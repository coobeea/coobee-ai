/**
 * 评审者（Verification Gate）
 * 负责验证 Worker 输出的质量，并生成修复建议
 */

import type { SessionFileManager } from '../storage/SessionFileManager'
import type { VerificationRule, VerificationResult, VerificationIssue } from './types'

/**
 * 评审者接口
 */
export interface IVerificationGate {
  /**
   * 验证子任务输出
   */
  verify(
    subTaskId: string,
    output: unknown,
    rules?: VerificationRule[]
  ): Promise<{
    passed: boolean
    results: VerificationResult[]
  }>

  /**
   * 生成修复建议
   */
  generateFixSuggestions(issues: VerificationIssue[]): Promise<string>
}

/**
 * 评审者实现
 */
export class VerificationGate implements IVerificationGate {
  constructor(
    private sessionManager: SessionFileManager,
    _sessionId: string
  ) {}

  async verify(
    subTaskId: string,
    output: unknown,
    rules: VerificationRule[] = []
  ): Promise<{ passed: boolean; results: VerificationResult[] }> {
    console.log(`[VerificationGate] Verifying subtask: ${subTaskId}`)

    const results: VerificationResult[] = []

    // 执行所有验证规则
    for (const rule of rules) {
      const result = await rule.execute(output)
      results.push(result)

      // 写入验证记录
      await this.sessionManager.writeVerificationCheck(subTaskId, rule.id, result)
    }

    const passed = results.every((r) => r.passed)

    if (!passed) {
      // 收集所有问题
      const allIssues = results.flatMap((r) => r.issues || [])
      await this.sessionManager.appendVerificationIssues(subTaskId, allIssues)
    }

    console.log(`[VerificationGate] Verification ${passed ? 'passed' : 'failed'}: ${subTaskId}`)

    return { passed, results }
  }

  async generateFixSuggestions(issues: VerificationIssue[]): Promise<string> {
    // 根据问题生成修复建议
    const suggestions = issues.map((issue) => {
      return `- ${issue.severity.toUpperCase()}: ${issue.message}`
    })

    return `发现以下问题，需要修复：\n${suggestions.join('\n')}`
  }
}
