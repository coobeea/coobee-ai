/**
 * SessionService - 会话管理服务
 *
 * 职责：
 * - 管理 FileSession 实例
 * - 提供会话信息查询
 * - 提供会话清理功能
 */

import { createLogger } from '@main/common/logger';
import { FileSession } from '../openai/FileSession';

const log = createLogger('SessionService');
import type { SessionInfo } from '../types';

/**
 * 会话管理服务
 */
export class SessionService {
  private session: FileSession;
  private readonly sessionId: string;
  private readonly createdAt: number;
  private readonly agentId: string;
  private readonly agentName: string;

  constructor(options: { sessionId: string; sessionDir?: string; agentId: string; agentName: string }) {
    this.sessionId = options.sessionId;
    this.agentId = options.agentId;
    this.agentName = options.agentName;
    this.createdAt = Date.now();

    // 创建 FileSession（第一个参数是 sessionId，第二个是可选的 sessionDir）
    this.session = new FileSession(options.sessionId, options.sessionDir);
  }

  /**
   * 获取 Session 实例
   */
  getSession(): FileSession {
    return this.session;
  }

  /**
   * 获取会话信息
   */
  async getInfo(): Promise<SessionInfo> {
    const count = await this.session.getItemCount();
    return {
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      messageCount: count,
      metadata: {
        agentId: this.agentId,
        agentName: this.agentName
      }
    };
  }

  /**
   * 清空会话
   */
  async clear(): Promise<void> {
    log.info(`Clearing session: ${this.sessionId}`);
    await this.session.clearSession();
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string {
    return this.sessionId;
  }
}
