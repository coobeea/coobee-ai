/**
 * Agent Executor — 执行调度层
 *
 * 所有 Agent 执行的统一入口。
 * 位于 API 层和 Runtime 层之间，负责：
 *   1. 并发控制 — 同一 session 串行执行（busy 锁）
 *   2. 无状态生命周期 — 每次请求创建 Runtime → 执行 → 销毁
 *   3. 统一错误处理
 *
 * 设计哲学（参考 OpenClaw pi-integration-architecture）：
 *   - 消息驱动：每条用户消息触发完整的 "创建 → 推理 → 销毁" 流程
 *   - 无状态实例：Runtime 对象用完即丢，由 GC 回收
 *   - 有状态存储：会话连续性靠 JSONL 文件持久化（SDK 自动管理）
 *
 * 用法：
 *   const result = agentExecutor.submit({
 *     sessionId: 'abc',
 *     message: 'hello',
 *     builder: AgentBuilder.piMono().instructions('...')
 *   })
 */

import { log } from '@main/common/logger'
import type { AgentRuntime } from './runtime/AgentRuntime'
import type { ExecutionResult, StreamChunk } from './runtime/types'
import type { PiMonoBuilder } from './AgentBuilder'

// ==================== 类型定义 ====================

/** 执行请求 */
export interface ExecuteRequest {
  /** 会话 ID */
  sessionId: string
  /** 用户消息 */
  message: string
  /** Builder 实例（已配置好参数，尚未 build） */
  builder: PiMonoBuilder
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

    // 标记为 busy
    this.busySessions.set(sessionId, { startedAt: Date.now() })

    // 后台执行（不阻塞调用方）
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

  /**
   * 查询 session 状态
   */
  getStatus(sessionId: string): SessionStatus {
    const info = this.busySessions.get(sessionId)
    return info ? { busy: true, startedAt: info.startedAt } : { busy: false }
  }

  /**
   * 获取所有活跃 session
   */
  getActiveSessions(): Array<{ sessionId: string; startedAt: number }> {
    return Array.from(this.busySessions.entries()).map(([sessionId, info]) => ({
      sessionId,
      startedAt: info.startedAt
    }))
  }

  // ==================== 内部执行 ====================

  /**
   * 核心执行流程：创建 → 推理 → 销毁
   *
   * 每次调用都是一个完整的无状态生命周期：
   * 1. 通过 Builder 创建并初始化 Runtime
   * 2. 执行 runStream
   * 3. 函数返回后 Runtime 由 GC 回收
   */
  private async execute(request: ExecuteRequest): Promise<ExecutionResult> {
    const { sessionId, message, builder, onChunk } = request
    let runtime: AgentRuntime | null = null

    log.info(
      `[AgentExecutor] Execute: sessionId=${sessionId}, message="${message.slice(0, 50)}..."`
    )
    const startTime = Date.now()

    try {
      // 1. 创建 Runtime（Builder 内部调用 initialize）
      runtime = await builder.sessionId(sessionId).build()

      // 2. 流式执行
      const result = await runtime.runStream(message, {}, onChunk || (() => {}))

      const duration = Date.now() - startTime
      log.info(
        `[AgentExecutor] Completed: sessionId=${sessionId}, duration=${duration}ms, output=${result.output.slice(0, 100)}...`
      )

      return result
    } catch (error: unknown) {
      const duration = Date.now() - startTime
      const msg = error instanceof Error ? error.message : String(error)
      log.error(`[AgentExecutor] Error: sessionId=${sessionId}, duration=${duration}ms, ${msg}`)
      throw error
    } finally {
      // 3. 销毁 Runtime（释放资源）
      if (runtime) {
        try {
          await runtime.destroy()
        } catch (e: unknown) {
          log.warn(`[AgentExecutor] Runtime destroy warning: ${e}`)
        }
      }
      runtime = null // 确保 GC 可回收
    }
  }
}

// ==================== 单例导出 ====================

export const agentExecutor = new AgentExecutor()
