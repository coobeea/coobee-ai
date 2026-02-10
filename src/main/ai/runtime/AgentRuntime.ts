/**
 * AgentRuntime 接口
 *
 * 单智能体运行时的统一抽象。
 * 所有 Agent 实现（OpenAI、pi-coding-agent 等）都必须实现此接口。
 *
 * 继承 IExecutable 的基础执行能力，约束 type = 'agent'。
 *
 * 使用示例：
 *   const runtime: AgentRuntime = new OpenAIAgentRuntime(options)
 *   await runtime.initialize()
 *   const result = await runtime.run('hello')
 */

import type { AgentRuntimeOptions, IExecutable } from './types'

/**
 * 单智能体运行时接口
 *
 * 设计原则：
 *   1. SDK 无关：不引用任何特定 SDK 类型
 *   2. 接口约束：所有 Agent 实现必须满足此契约
 *   3. 继承 IExecutable：复用通用执行接口（run/runStream/HITL/session）
 *
 * 层级关系：
 *   IExecutable（基础执行接口）
 *     ├── AgentRuntime（单智能体，本接口）
 *     ├── TeamRuntime（多智能体编排）
 *     └── SwarmRuntime（群体智能）
 *
 * 已有实现：
 *   - OpenAIAgentRuntime（runtime/openai/）— 基于 @openai/agents SDK
 *   - （计划中）PiAgentRuntime（runtime/pi/）— 基于 pi-coding-agent SDK
 */
export interface AgentRuntime extends IExecutable {
  /** 约束类型为 agent */
  readonly type: 'agent'

  /** 运行时配置选项 */
  readonly options: AgentRuntimeOptions
}
