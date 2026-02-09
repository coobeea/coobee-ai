/**
 * SDK Guardrails 模块
 *
 * 基于 @openai/agents SDK 的 inputGuardrails / outputGuardrails 机制
 * 提供输入/输出安全检查
 *
 * SDK 特性：
 * - InputGuardrail: 在 Agent 执行前检查输入（可并行或阻塞）
 * - OutputGuardrail: 在 Agent 执行后检查输出
 * - tripwireTriggered: 触发时中止 Agent 执行
 */

export {
  contentSafetyInputGuardrail,
  injectionDetectionGuardrail,
  maxLengthInputGuardrail,
  type ContentSafetyConfig
} from './inputGuardrails'

export {
  sensitiveDataOutputGuardrail,
  formatComplianceOutputGuardrail,
  type SensitiveDataConfig
} from './outputGuardrails'
