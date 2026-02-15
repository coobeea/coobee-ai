/**
 * Orchestration 模块 — Orchestrator-Planner-Worker 协作模式
 *
 * @experimental 设计储备 — 本模块目前未接入产品代码。
 *
 * ⚠️ OpenAI SDK 专用：直接依赖 @openai/agents SDK，不可用于 PiMono Runtime。
 * 待多 Agent 路线确定后评估是否激活或替换为 SDK 无关实现。
 */

export * from './types'
export * from './Planner'
export * from './WorkerCoordinator'
export * from './Orchestrator'
export * from './PlanVersionManager'
export * from './VerificationGate'
export * from './verification-rules'
