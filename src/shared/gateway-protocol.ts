/**
 * Gateway RPC 协议类型（前后端共享）
 *
 * 定义 Gateway WebSocket 通信的三种消息格式：
 *   - GatewayRequest:  客户端 → Gateway（RPC 请求）
 *   - GatewayResponse: Gateway → 客户端（RPC 响应）
 *   - GatewayEvent:    Gateway → 客户端（事件推送）
 *
 * 注意：此模块仅包含消息协议类型，不含任何 Node.js / 浏览器专属依赖。
 * 服务端特有类型（ClientMeta、MethodHandler 等）定义在 src/main/gateway/protocol/types.ts。
 */

// ==================== 消息协议 ====================

/** 客户端 → Gateway 请求 */
export interface GatewayRequest {
  type: 'req';
  /** 请求唯一 ID（客户端生成，用于匹配响应） */
  id: string;
  /** 方法名，namespace.action 格式（如 'chat.send'） */
  method: string;
  /** 方法参数 */
  params?: Record<string, unknown>;
}

/** Gateway → 客户端 响应 */
export interface GatewayResponse {
  type: 'res';
  /** 对应请求的 ID */
  id: string;
  /** 是否成功 */
  ok: boolean;
  /** 成功时的返回数据 */
  payload?: unknown;
  /** 失败时的错误信息 */
  error?: { code: number; message: string };
}

/** Gateway → 客户端 事件推送 */
export interface GatewayEvent {
  type: 'event';
  /** 事件名，namespace.action 格式（如 'stream.message'） */
  event: string;
  /** 事件数据 */
  payload: unknown;
}

/** Gateway 出站消息联合类型 */
export type GatewayOutMessage = GatewayResponse | GatewayEvent;

/** 所有 Gateway 消息联合类型（含入站） */
export type GatewayMessage = GatewayRequest | GatewayOutMessage;

// ==================== 错误码 ====================

/**
 * Gateway 标准错误码
 *
 * 与后端 GatewayErrorCode 保持一致。
 */
export enum GatewayErrorCode {
  /** 消息解析失败 */
  PARSE_ERROR = 1001,
  /** 无效消息格式 */
  INVALID_MESSAGE = 1002,
  /** 未知消息类型 */
  UNKNOWN_MESSAGE_TYPE = 1003,

  /** 方法不存在 */
  METHOD_NOT_FOUND = 2001,
  /** 参数错误 */
  INVALID_PARAMS = 2002,

  /** 会话忙碌 */
  SESSION_BUSY = 3001,
  /** 资源不存在 */
  NOT_FOUND = 3002,
  /** 内部错误 */
  INTERNAL_ERROR = 3003,

  /** 未授权 */
  UNAUTHORIZED = 4001,
  /** 请求超时 */
  TIMEOUT = 5001
}
