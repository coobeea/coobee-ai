/**
 * 统一 Gateway 协议类型定义
 *
 * 提供统一的通信接口，兼容 RPC、Event、REST 三种协议
 */

/** 统一请求类型 */
export type UnifiedRequestType = 'rpc' | 'event' | 'http';

/** 统一请求 */
export interface UnifiedRequest {
  /** 请求类型 */
  type: UnifiedRequestType;

  /** 方法/事件名称或 HTTP 路径 */
  target: string;

  /** 参数/数据 */
  payload?: unknown;

  /** 请求 ID（用于响应匹配） */
  requestId?: string;

  /** 元数据 */
  meta?: Record<string, unknown>;
}

/** 统一响应 */
export interface UnifiedResponse<T = unknown> {
  /** 是否成功 */
  success: boolean;

  /** 响应数据 */
  data?: T;

  /** 错误信息 */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };

  /** 请求 ID */
  requestId?: string;

  /** 元数据 */
  meta?: Record<string, unknown>;
}

/** 统一事件 */
export interface UnifiedEvent<T = unknown> {
  /** 事件名称 */
  event: string;

  /** 事件数据 */
  data: T;

  /** 时间戳 */
  timestamp: number;

  /** 元数据 */
  meta?: Record<string, unknown>;
}

/** 统一处理器 */
export type UnifiedHandler<TReq = unknown, TRes = unknown> = (
  request: TReq,
  context: UnifiedContext
) => Promise<TRes> | TRes;

/** 统一上下文 */
export interface UnifiedContext {
  /** 请求类型 */
  type: UnifiedRequestType;

  /** 客户端信息 */
  client?: {
    connectionId: string;
    [key: string]: unknown;
  };

  /** 其他上下文信息 */
  [key: string]: unknown;
}
