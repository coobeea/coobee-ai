/**
 * WebSocket 通信协议定义
 */

/**
 * 客户端请求类型
 */
export type ClientMessageType =
  | 'create_session'
  | 'send_message'
  | 'get_messages'
  | 'get_sessions'
  | 'delete_session'

/**
 * 客户端消息基础接口
 */
export interface ClientMessage {
  type: ClientMessageType
  id: string // 请求 ID，用于匹配响应
}

/**
 * 创建 Session 请求
 */
export interface CreateSessionRequest extends ClientMessage {
  type: 'create_session'
  payload: {
    agentType: string
    model: string
    config?: Record<string, unknown>
  }
}

/**
 * 发送消息请求
 */
export interface SendMessageRequest extends ClientMessage {
  type: 'send_message'
  payload: {
    sessionId: string
    message: string
  }
}

/**
 * 获取消息请求
 */
export interface GetMessagesRequest extends ClientMessage {
  type: 'get_messages'
  payload: {
    sessionId: string
  }
}

/**
 * 服务端响应
 */
export interface ServerResponse {
  id: string // 对应请求的 ID
  success: boolean
  data?: unknown
  error?: string
}
