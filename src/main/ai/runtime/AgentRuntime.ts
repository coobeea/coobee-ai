/**
 * AgentRuntime 接口
 *
 * 统一运行时抽象 — 单智能体、团队、蜂群模式的唯一接口。
 * 所有实现（OpenAI、PiMono、Team、Swarm）都必须实现此接口。
 *
 * 设计原则：
 *   1. SDK 无关：不引用任何特定 SDK 类型
 *   2. 双模式流式：stream()（AsyncGenerator 拉取）为主，推送通过 StreamEmitter 自动广播
 *   3. 无状态实例：每次请求创建 → 执行 → 销毁，会话连续性靠文件持久化
 *
 * 使用示例：
 *   // 拉取模式（SSE / 直接迭代）
 *   for await (const chunk of runtime.stream('hello')) { ... }
 *
 *   // 便捷模式（等待完整结果）
 *   const result = await runtime.run('hello')
 */

import type {
  AgentRuntimeOptions,
  ExecutionConfig,
  ExecutionResult,
  StreamChunk,
  SessionInfo
} from './types'

/**
 * 统一运行时接口
 *
 * 实现：
 *   - PiMonoAgentRuntime（runtime/pimono/）— 基于 pi-coding-agent SDK
 *   - OpenAIAgentRuntime（runtime/openai/）— 基于 @openai/agents SDK
 *   - TeamRuntime（teams/）— 多智能体编排
 *   - SwarmRuntime（swarm/）— 群体智能
 */
export interface AgentRuntime {
  // ========== 身份 ==========

  /** 运行时类型 */
  readonly type: 'agent' | 'team' | 'swarm'
  /** 运行时 ID */
  readonly id: string
  /** 名称 */
  readonly name: string
  /** 运行时配置选项 */
  readonly options: AgentRuntimeOptions
  /** 是否处于中断状态（HITL 工具审批等待中） */
  readonly interrupted: boolean

  // ========== 生命周期 ==========

  /** 初始化 */
  initialize(): Promise<void>
  /** 销毁 */
  destroy(): Promise<void>

  // ========== 执行方法 ==========

  /**
   * 流式执行（主方法 — AsyncGenerator）
   *
   * 每个 StreamChunk 通过 yield 输出（拉取模式）。
   * 同时通过 StreamEmitter 广播到 EventBus（推送模式）。
   *
   * @param input 用户输入
   * @param config 执行配置
   * @yields StreamChunk 流式事件块
   * @returns ExecutionResult 执行结果
   */
  stream(
    input: string,
    config?: ExecutionConfig
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown>

  /**
   * 同步执行（便捷方法）
   *
   * 内部调用 stream() 并静默消费所有事件，返回最终结果。
   *
   * @param input 用户输入
   * @param config 执行配置
   */
  run(input: string, config?: ExecutionConfig): Promise<ExecutionResult>

  // ========== HITL 工具审批 ==========

  /**
   * 批准工具调用
   * @param index 审批项索引
   * @param options 选项（如 alwaysApprove）
   */
  approveToolCall(index: number, options?: { alwaysApprove?: boolean }): void

  /**
   * 拒绝工具调用
   * @param index 审批项索引
   * @param options 选项（如 alwaysReject）
   */
  rejectToolCall(index: number, options?: { alwaysReject?: boolean }): void

  /**
   * 恢复被中断的执行（AsyncGenerator 模式）
   */
  resumeStream(config?: ExecutionConfig): AsyncGenerator<StreamChunk, ExecutionResult, unknown>

  // ========== 会话管理 ==========

  /** 获取会话信息 */
  getSession(): Promise<SessionInfo>
  /** 清除会话历史 */
  clearSession(): Promise<void>
}
