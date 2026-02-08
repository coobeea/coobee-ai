/**
 * AI Agent 网关
 * 提供 WebSocket 服务，供前端连接
 *
 * TODO: 完整实现参考 AgentGateway.example.ts
 */
import { log } from '@main/common/logger'

export class AgentGateway {
  private static instance: AgentGateway

  private constructor() {
    // TODO: 初始化
  }

  static getInstance(): AgentGateway {
    if (!AgentGateway.instance) {
      AgentGateway.instance = new AgentGateway()
    }
    return AgentGateway.instance
  }

  /**
   * 启动 WebSocket 服务器
   */
  async start(port: number = 9527): Promise<void> {
    log.info(`[AgentGateway] TODO: 启动 WebSocket 服务器，端口: ${port}`)
    // TODO: 实现 WebSocket 服务器
    // 1. 安装 ws 依赖
    // 2. 创建 WebSocketServer
    // 3. 处理客户端连接
    // 4. 集成 SessionStore 和 ChatAgent
  }

  /**
   * 停止 WebSocket 服务器
   */
  async stop(): Promise<void> {
    log.info('[AgentGateway] TODO: 停止 WebSocket 服务器')
    // TODO: 实现停止逻辑
  }

  /*
   * TODO: 以下方法在 WebSocket 实现后添加
   *
   * 包括：
   * - handleMessage() - 消息路由
   * - handleCreateSession() - 创建会话
   * - handleSendMessage() - 发送消息
   * - handleGetMessages() - 获取历史
   *
   * 完整实现参考文档：docs/ai-architecture/04-monorepo-architecture.md
   */
}
