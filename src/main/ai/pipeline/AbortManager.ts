/**
 * 中断管理器
 *
 * 管理每个 session 的 AbortController，支持 interrupt 模式。
 */

export class AbortManager {
  private controllers = new Map<string, AbortController>()
  private abortedSessions = new Set<string>()

  /**
   * 为 session 创建新的 AbortController
   *
   * 如果已有旧的 controller，先 abort 旧的。
   * @returns 新创建的 AbortSignal
   */
  create(sessionId: string): AbortSignal {
    // 先中断旧的
    this.abort(sessionId)

    // 新 run 清除已 abort 标记
    this.abortedSessions.delete(sessionId)

    const controller = new AbortController()
    this.controllers.set(sessionId, controller)
    return controller.signal
  }

  /**
   * 中断指定 session
   *
   * @returns 是否成功中断（false = 不存在 controller）
   */
  abort(sessionId: string): boolean {
    const controller = this.controllers.get(sessionId)
    if (!controller) return false

    controller.abort()
    this.abortedSessions.add(sessionId)
    this.controllers.delete(sessionId)
    return true
  }

  /**
   * 获取指定 session 的 AbortSignal
   */
  getSignal(sessionId: string): AbortSignal | undefined {
    return this.controllers.get(sessionId)?.signal
  }

  /**
   * 检查 session 是否已被中断
   *
   * 在 abort() 后 controller 被删除，但仍能通过 abortedSessions 追踪状态。
   */
  isAborted(sessionId: string): boolean {
    if (this.abortedSessions.has(sessionId)) return true
    const controller = this.controllers.get(sessionId)
    return controller?.signal.aborted ?? false
  }

  /**
   * 清理 session 的 AbortController（run 结束时调用）
   */
  cleanup(sessionId: string): void {
    this.controllers.delete(sessionId)
    this.abortedSessions.delete(sessionId)
  }

  /**
   * 清理所有 session
   */
  clear(): void {
    for (const controller of this.controllers.values()) {
      controller.abort()
    }
    this.controllers.clear()
    this.abortedSessions.clear()
  }

  /** 当前管理的 session 数 */
  get size(): number {
    return this.controllers.size
  }
}
