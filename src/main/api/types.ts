/**
 * Agent API Types
 */

/**
 * API 请求
 */
export interface AgentAPIRequest {
  /** Agent ID */
  agentId: string;

  /** 消息内容 */
  message: string;

  /** 会话 ID（可选） */
  sessionId?: string;

  /** 上下文（可选） */
  context?: Record<string, unknown>;

  /** 流式响应 */
  stream?: boolean;
}

/**
 * API 响应
 */
export interface AgentAPIResponse {
  /** 会话 ID */
  sessionId: string;

  /** 响应内容 */
  content: string;

  /** 状态 */
  status: 'success' | 'error' | 'partial';

  /** 错误信息 */
  error?: string;

  /** 元数据 */
  metadata?: {
    duration: number;
    tokens?: number;
    model?: string;
  };
}

/**
 * API 配置
 */
export interface APIConfig {
  /** 端口 */
  port: number;

  /** API Key 列表 */
  apiKeys: string[];

  /** 是否启用 */
  enabled: boolean;

  /** CORS 允许的源 */
  allowedOrigins: string[];

  /** 请求超时（毫秒） */
  requestTimeout: number;

  /** 速率限制（每分钟请求数） */
  rateLimit: number;
}

/**
 * SDK 配置
 */
export interface SDKConfig {
  /** API 地址 */
  apiUrl: string;

  /** API Key */
  apiKey: string;

  /** 超时时间 */
  timeout?: number;
}
