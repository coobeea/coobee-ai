/**
 * Agent Executor — 执行调度层
 *
 * 所有 Agent 执行的统一入口。
 * 位于 API 层和 Runtime 层之间，职责聚焦于：
 *   1. 并发控制 — 同一 session 串行执行（busy 锁）
 *   2. 无状态生命周期 — 每次请求创建 Runtime → 执行 → 销毁
 *   3. HITL 循环编排 — 中断 → 等待决策 → 恢复
 *   4. Builder 工厂 — piMono() / openai()
 *
 * 已提取的职责：
 *   - Builder 实现 → runtime/pimono/PiMonoBuilder.ts, runtime/openai/OpenAIBuilder.ts
 *   - 环境注入 → AgentEnvInjector.ts
 *   - 事件写入 → AgentEventWriter.ts
 *   - 执行协议 → AgentEnvInjector.ts (buildExecutionProtocol)
 *
 * 设计哲学（参考 OpenClaw pi-integration-architecture）：
 *   - 消息驱动：每条用户消息触发完整的 "创建 → 推理 → 销毁" 流程
 *   - 无状态实例：Runtime 对象用完即丢，由 GC 回收
 *   - 有状态存储：会话连续性靠 JSONL 文件持久化（SDK 自动管理）
 */

import { createLogger } from '@main/common/logger'

const log = createLogger('ai')

import type { AgentRuntime } from './runtime/AgentRuntime'
import type { ExecutionResult, StreamChunk } from './runtime/types'
import { PiMonoBuilder } from './runtime/pimono/PiMonoBuilder'
import { OpenAIBuilder } from './runtime/openai/OpenAIBuilder'
import { createStreamEmitter, type IStreamEmitter } from './streaming/StreamEmitter'
import type { StreamSource } from './streaming/types'
import { hitlApprovalManager, DEFAULT_HITL_TIMEOUT_MS } from './hitl/HitlApprovalManager'
import { injectEnv } from './AgentEnvInjector'
import { AgentEventWriter } from './AgentEventWriter'

// ==================== 类型定义 ====================

/** 支持的 Builder 类型 */
export type AgentBuilder = PiMonoBuilder | OpenAIBuilder

/** 执行请求 */
export interface ExecuteRequest {
  /** 会话 ID */
  sessionId: string
  /** 用户消息 */
  message: string
  /** Builder 实例（通过 agentExecutor.piMono() 或 agentExecutor.openai() 创建） */
  builder: AgentBuilder
  /** 流式事件回调（可选） */
  onChunk?: (chunk: StreamChunk) => void
}

/** 执行状态 */
export interface SessionStatus {
  /** 是否正在执行 */
  busy: boolean
  /** 开始时间（busy 时有值） */
  startedAt?: number
}

// ==================== AgentExecutor ====================

class AgentExecutor {
  /** 正在执行的 session 集合 */
  private busySessions = new Map<string, { startedAt: number }>()

  // ========== Builder 工厂 ==========

  /** 创建 PiMono Agent Builder */
  piMono(): PiMonoBuilder {
    return new PiMonoBuilder()
  }

  /** 创建 OpenAI Agent Builder */
  openai(): OpenAIBuilder {
    return new OpenAIBuilder()
  }

  // ========== 提交执行 ==========

  /**
   * 提交执行请求（非阻塞）
   *
   * 立即返回状态，流式事件通过 StreamEmitter → EventBus → WebSocket 推送。
   * 如果 session 正在执行中，返回 busy 错误。
   */
  submit(
    request: ExecuteRequest
  ): { status: 'accepted'; sessionId: string } | { status: 'busy'; sessionId: string } {
    const { sessionId } = request

    if (this.busySessions.has(sessionId)) {
      log.warn(`[AgentExecutor] Session busy: ${sessionId}`)
      return { status: 'busy', sessionId }
    }

    this.busySessions.set(sessionId, { startedAt: Date.now() })

    this.execute(request)
      .catch((error: unknown) => {
        log.error(`[AgentExecutor] Execution failed: sessionId=${sessionId}`, error)
      })
      .finally(() => {
        this.busySessions.delete(sessionId)
      })

    return { status: 'accepted', sessionId }
  }

  /**
   * 提交并等待执行完成（阻塞）
   *
   * 适用于需要同步获取结果的场景（如测试）。
   */
  async submitAndWait(request: ExecuteRequest): Promise<ExecutionResult> {
    const { sessionId } = request

    if (this.busySessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is busy`)
    }

    this.busySessions.set(sessionId, { startedAt: Date.now() })
    try {
      return await this.execute(request)
    } finally {
      this.busySessions.delete(sessionId)
    }
  }

  // ========== 状态查询 ==========

  /** 查询 session 状态 */
  getStatus(sessionId: string): SessionStatus {
    const info = this.busySessions.get(sessionId)
    return info ? { busy: true, startedAt: info.startedAt } : { busy: false }
  }

  /** 获取所有活跃 session */
  getActiveSessions(): Array<{ sessionId: string; startedAt: number }> {
    return Array.from(this.busySessions.entries()).map(([sessionId, info]) => ({
      sessionId,
      startedAt: info.startedAt
    }))
  }

  // ========== 流式执行（SSE 透传） ==========

  /**
   * 流式执行 — AsyncGenerator 透传
   *
   * 供 SSE 端点直接 yield* 使用。
   * 内部管理完整的 busy 锁 + 创建 → stream() → 销毁 生命周期。
   * 每个 chunk 同时通过 StreamEmitter.forward() 广播到 EventBus。
   */
  async *stream(
    request: Omit<ExecuteRequest, 'onChunk'>
  ): AsyncGenerator<StreamChunk, ExecutionResult, unknown> {
    const { sessionId, message, builder } = request

    if (this.busySessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is busy`)
    }

    this.busySessions.set(sessionId, { startedAt: Date.now() })
    let runtime: AgentRuntime | null = null

    log.info(`[AgentExecutor] Stream: sessionId=${sessionId}, message="${message.slice(0, 50)}..."`)

    try {
      // 0. 注入运行时环境
      const workspace = await injectEnv(sessionId, builder)
      const eventWriter = new AgentEventWriter(workspace)

      // 1. 创建 Runtime
      runtime = await builder.sessionId(sessionId).build()
      const emitter = this.createEmitter(sessionId, runtime)

      // 2. 透传 stream()
      const gen = runtime.stream(message)
      let eventSeq = 0
      let r = await gen.next()
      while (!r.done) {
        emitter.forward(r.value)
        eventWriter.append(r.value, ++eventSeq)
        if (r.value.type === 'run:error') {
          log.error(`[AgentExecutor] API error: sessionId=${sessionId}, error=${r.value.content}`)
        }
        yield r.value
        r = await gen.next()
      }

      this.logCompletion(sessionId, r.value)
      return r.value
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error(`[AgentExecutor] Stream error: sessionId=${sessionId}, ${msg}`)
      throw error
    } finally {
      await this.destroyRuntime(runtime)
      runtime = null
      this.busySessions.delete(sessionId)
    }
  }

  // ========== 内部执行 ==========

  /**
   * 消费 AsyncGenerator 并 forward 到 EventBus + 写入 events.jsonl
   */
  private async consumeAndForward(
    gen: AsyncGenerator<StreamChunk, ExecutionResult, unknown>,
    emitter: IStreamEmitter,
    eventWriter: AgentEventWriter,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ExecutionResult> {
    let eventSeq = 0
    let r = await gen.next()
    while (!r.done) {
      emitter.forward(r.value)
      eventWriter.append(r.value, ++eventSeq)
      if (r.value.type === 'run:error') {
        log.error(`[AgentExecutor] API error in execute: error=${r.value.content}`)
      }
      onChunk?.(r.value)
      r = await gen.next()
    }
    return r.value
  }

  /**
   * 核心执行流程：创建 → 推理 → [HITL 循环] → 销毁
   *
   * HITL 循环（Promise 等待模式）：
   *   当 runtime.stream() 返回 interrupted 结果时，执行循环不退出，
   *   而是 await hitlApprovalManager.waitForDecisions()。
   *   前端通过 API 提交决策后，Promise resolve，执行循环自动恢复。
   */
  private async execute(request: ExecuteRequest): Promise<ExecutionResult> {
    const { sessionId, message, builder, onChunk } = request
    let runtime: AgentRuntime | null = null

    log.info(
      `[AgentExecutor] Execute: sessionId=${sessionId}, message="${message.slice(0, 50)}..."`
    )
    const startTime = Date.now()

    try {
      // 0. 注入运行时环境
      const workspace = await injectEnv(sessionId, builder)
      const eventWriter = new AgentEventWriter(workspace)

      // === Extension Hooks: message_received + session_start + before_agent_start ===
      await this.runExtensionHooks(sessionId, message, builder)

      // 1. 创建 Runtime
      runtime = await builder.sessionId(sessionId).build()
      const emitter = this.createEmitter(sessionId, runtime)

      // 2. 初始 stream
      const gen = runtime.stream(message)
      let result = await this.consumeAndForward(gen, emitter, eventWriter, onChunk)

      // 3. HITL 循环
      while (result.interrupted && result.interruptions?.length) {
        log.info(
          `[AgentExecutor] HITL interrupted: sessionId=${sessionId}, tools=${result.interruptions.length}`
        )

        emitter.forward({ type: 'run:interrupted', content: '' })

        const decisions = await hitlApprovalManager.waitForDecisions(
          sessionId,
          result.interruptions.length,
          DEFAULT_HITL_TIMEOUT_MS
        )

        if (!decisions) {
          log.warn(`[AgentExecutor] HITL timeout: sessionId=${sessionId}`)
          emitter.forward({ type: 'run:error', content: 'HITL approval timeout' })
          return { ...result, output: 'HITL approval timeout' }
        }

        for (let i = 0; i < decisions.length; i++) {
          if (decisions[i] === 'reject') {
            runtime.rejectToolCall(i)
          } else {
            runtime.approveToolCall(i, {
              alwaysApprove: decisions[i] === 'approve-always'
            })
          }
        }

        log.info(
          `[AgentExecutor] HITL resumed: sessionId=${sessionId}, decisions=${JSON.stringify(decisions)}`
        )

        const resumeGen = runtime.resumeStream()
        result = await this.consumeAndForward(resumeGen, emitter, eventWriter, onChunk)
      }

      const duration = Date.now() - startTime

      // === Extension Hooks: agent_end + session_end ===
      await this.runExtensionEndHooks(sessionId, result, duration)

      this.logCompletion(sessionId, result, duration)
      return result
    } catch (error: unknown) {
      const duration = Date.now() - startTime
      const msg = error instanceof Error ? error.message : String(error)
      log.error(`[AgentExecutor] Error: sessionId=${sessionId}, duration=${duration}ms, ${msg}`)
      hitlApprovalManager.cleanup(sessionId)
      throw error
    } finally {
      await this.destroyRuntime(runtime)
      runtime = null
    }
  }

  // ========== 辅助方法 ==========

  /** 创建 StreamEmitter */
  private createEmitter(sessionId: string, runtime: AgentRuntime): IStreamEmitter {
    const source: StreamSource = {
      type: runtime.type,
      id: runtime.id,
      name: runtime.name
    }
    return createStreamEmitter(sessionId, source)
  }

  /** 安全销毁 Runtime */
  private async destroyRuntime(runtime: AgentRuntime | null): Promise<void> {
    if (!runtime) return
    try {
      await runtime.destroy()
    } catch (e: unknown) {
      log.warn(`[AgentExecutor] Runtime destroy warning: ${e}`)
    }
  }

  /** 记录完成日志 */
  private logCompletion(sessionId: string, result: ExecutionResult, duration?: number): void {
    const durationStr = duration ? `, duration=${duration}ms` : ''
    if (result.error) {
      log.error(
        `[AgentExecutor] Failed: sessionId=${sessionId}${durationStr}, error=${result.error}`
      )
    } else {
      log.info(
        `[AgentExecutor] Completed: sessionId=${sessionId}${durationStr}, output=${result.output.slice(0, 100)}...`
      )
    }
  }

  // ========== Extension Hook ==========

  /**
   * 执行 Extension 前置 Hook
   * message_received → session_start → before_agent_start
   */
  private async runExtensionHooks(
    sessionId: string,
    message: string,
    builder: AgentBuilder
  ): Promise<void> {
    try {
      const { ExtensionManager } = await import('../common/extension')
      const runner = ExtensionManager.getHookRunner()
      if (!runner) return

      await runner.runVoidHook('message_received', { sessionId, message })
      await runner.runVoidHook('session_start', { sessionId })

      const result = await runner.runModifyingHook('before_agent_start', {
        sessionId,
        prompt: message
      })
      if (result) {
        if (result.prependContext) {
          builder.appendInstructions(result.prependContext)
        }
        if (result.replaceSystemPrompt) {
          builder.instructions(result.replaceSystemPrompt)
        }
      }
    } catch (err) {
      log.warn('[AgentExecutor] Extension hooks (start) failed:', err)
    }
  }

  /**
   * 执行 Extension 后置 Hook
   * agent_end → session_end
   */
  private async runExtensionEndHooks(
    sessionId: string,
    result: ExecutionResult,
    durationMs: number
  ): Promise<void> {
    try {
      const { ExtensionManager } = await import('../common/extension')
      const runner = ExtensionManager.getHookRunner()
      if (!runner) return

      await runner.runVoidHook('agent_end', {
        sessionId,
        success: !result.error,
        output: result.output,
        durationMs
      })
      await runner.runVoidHook('session_end', { sessionId })
    } catch (err) {
      log.warn('[AgentExecutor] Extension hooks (end) failed:', err)
    }
  }
}

// ==================== 单例导出 ====================

export const agentExecutor = new AgentExecutor()

// Re-export builders for consumers
export { PiMonoBuilder } from './runtime/pimono/PiMonoBuilder'
export { OpenAIBuilder } from './runtime/openai/OpenAIBuilder'
