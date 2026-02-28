/**
 * SessionStatusManager — 活跃会话状态管理
 *
 * 从 AgentExecutor 提取的会话跟踪逻辑：
 *   - 活跃 session 集合（busy 锁）
 *   - 注册/注销生命周期
 *   - 状态查询与中止标记
 */

/** 执行状态 */
export interface SessionStatus {
  /** 是否正在执行 */
  busy: boolean;
  /** 开始时间（busy 时有值） */
  startedAt?: number;
}

export class SessionStatusManager {
  private activeSessions = new Map<string, { startedAt: number }>();

  /** 注册活跃 session */
  register(sessionId: string): void {
    this.activeSessions.set(sessionId, { startedAt: Date.now() });
  }

  /** 注销 session，返回是否曾存在 */
  unregister(sessionId: string): boolean {
    const existed = this.activeSessions.has(sessionId);
    this.activeSessions.delete(sessionId);
    return existed;
  }

  /** 是否正在执行 */
  isRunning(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  /** 中止标记（仅清理 busy 状态，实际中止由 Pipeline 处理） */
  abort(sessionId: string): boolean {
    return this.unregister(sessionId);
  }

  /** 查询 session 状态 */
  getStatus(sessionId: string): SessionStatus {
    const info = this.activeSessions.get(sessionId);
    return info ? { busy: true, startedAt: info.startedAt } : { busy: false };
  }

  /** 获取指定 session 的 info（用于合并 pipeline 状态时取 startedAt） */
  getInfo(sessionId: string): { startedAt: number } | undefined {
    return this.activeSessions.get(sessionId);
  }

  /** 获取所有活跃 session */
  getActive(): Map<string, { startedAt: number }> {
    return new Map(this.activeSessions);
  }

  /** 获取活跃 session 列表（兼容 getActiveSessions 返回格式） */
  getActiveList(): Array<{ sessionId: string; startedAt: number }> {
    return Array.from(this.activeSessions.entries()).map(([sessionId, info]) => ({
      sessionId,
      startedAt: info.startedAt
    }));
  }
}
