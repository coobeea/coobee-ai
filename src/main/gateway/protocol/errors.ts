/**
 * Gateway 错误码和错误类
 *
 * 错误码范围：
 *   1xxx — 协议错误（解析、格式）
 *   2xxx — 路由错误（方法未找到、参数无效）
 *   3xxx — 业务错误（会话忙、超时）
 *   4xxx — 认证权限（预留）
 */

// ==================== 错误码枚举 ====================

export enum GatewayErrorCode {
  // 1xxx 协议错误
  PARSE_ERROR = 1001,
  INVALID_MESSAGE = 1002,
  UNKNOWN_MESSAGE_TYPE = 1003,

  // 2xxx 路由错误
  METHOD_NOT_FOUND = 2001,
  INVALID_PARAMS = 2002,

  // 3xxx 业务错误
  SESSION_BUSY = 3001,
  TIMEOUT = 3002,
  INTERNAL_ERROR = 3003,

  // 4xxx 认证（预留）
  UNAUTHORIZED = 4001,
  FORBIDDEN = 4002
}

/** 错误码 → 默认消息映射 */
const ERROR_MESSAGES: Record<GatewayErrorCode, string> = {
  [GatewayErrorCode.PARSE_ERROR]: 'Failed to parse message',
  [GatewayErrorCode.INVALID_MESSAGE]: 'Invalid message format',
  [GatewayErrorCode.UNKNOWN_MESSAGE_TYPE]: 'Unknown message type',
  [GatewayErrorCode.METHOD_NOT_FOUND]: 'Method not found',
  [GatewayErrorCode.INVALID_PARAMS]: 'Invalid parameters',
  [GatewayErrorCode.SESSION_BUSY]: 'Session is busy',
  [GatewayErrorCode.TIMEOUT]: 'Request timeout',
  [GatewayErrorCode.INTERNAL_ERROR]: 'Internal error',
  [GatewayErrorCode.UNAUTHORIZED]: 'Unauthorized',
  [GatewayErrorCode.FORBIDDEN]: 'Forbidden'
}

// ==================== 错误类 ====================

/**
 * Gateway 方法错误
 *
 * 方法 handler 抛出此错误时，Gateway 自动使用其 code 和 message
 * 构建结构化的 GatewayResponse 返回给客户端。
 */
export class GatewayMethodError extends Error {
  readonly code: GatewayErrorCode

  constructor(code: GatewayErrorCode, message?: string) {
    super(message ?? ERROR_MESSAGES[code])
    this.code = code
    this.name = 'GatewayMethodError'
  }
}

/**
 * 获取错误码的默认消息
 */
export function getErrorMessage(code: GatewayErrorCode): string {
  return ERROR_MESSAGES[code]
}
