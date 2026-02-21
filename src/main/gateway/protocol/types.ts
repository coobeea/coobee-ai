/**
 * Gateway RPC 协议类型定义
 *
 * 三种消息类型：
 *   - GatewayRequest:  客户端 → Gateway（RPC 请求）
 *   - GatewayResponse: Gateway → 客户端（RPC 响应）
 *   - GatewayEvent:    Gateway → 客户端（事件推送）
 */

import type { WebSocket } from 'ws';

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

/** Gateway 消息联合类型（所有出站消息） */
export type GatewayOutMessage = GatewayResponse | GatewayEvent;

// ==================== 客户端元数据 ====================

/** 客户端连接元数据 */
export interface ClientMeta {
  /** 连接唯一 ID */
  connectionId: string;
  /** 连接时间戳 */
  connectedAt: number;
  /** 心跳存活标记 */
  isAlive: boolean;
  /** 心跳定时器 */
  heartbeatTimer: NodeJS.Timeout | null;
  /** 已订阅的会话 ID 集合（用于 stream 事件过滤） */
  subscribedSessions: Set<string>;
}

// ==================== 方法相关 ====================

/** 方法执行上下文（Gateway 注入给 handler） */
export interface MethodContext {
  /** 客户端连接 ID */
  clientId: string;
  /** WebSocket 连接 */
  ws: WebSocket;
  /** 客户端元数据 */
  meta: ClientMeta;
  /** Gateway 引用（供 handler 调用广播等功能） */
  gateway: GatewayApi;
}

/** 单个方法处理函数 */
export type MethodHandler = (params: Record<string, unknown>, ctx: MethodContext) => Promise<unknown>;

/**
 * 方法组：一个文件导出一组相关方法
 *
 * 文件放在 src/main/gateway/methods/ 目录，Gateway 自动发现。
 */
export interface MethodGroup {
  /** 命名空间（如 'chat', 'stream', 'worker'） */
  namespace: string;
  /** 方法映射，key 为 action 名（不含 namespace 前缀） */
  methods: Record<string, MethodHandler>;
  /** 初始化回调（Gateway 注入自身引用时调用，可选） */
  onInit?: (gateway: GatewayApi) => void;
}

// ==================== 事件桥接 ====================

/** 事件桥接初始化函数签名（返回清理函数用于移除监听器） */
export type EventBridgeInit = (gateway: GatewayApi) => (() => void) | void;

// ==================== Gateway API ====================

/** 客户端过滤谓词 */
export type ClientPredicate = (meta: ClientMeta) => boolean;

/**
 * Gateway 对外暴露的 API（供方法组和事件桥接调用）
 *
 * 类比 WsHubApi，但使用结构化消息格式。
 */
export interface GatewayApi {
  /** 向单个客户端发送消息 */
  send(ws: WebSocket, payload: GatewayOutMessage): void;
  /** 向所有客户端广播事件 */
  broadcastEvent(event: string, payload: unknown): void;
  /** 按条件广播事件 */
  broadcastEventIf(event: string, payload: unknown, predicate: ClientPredicate): number;
  /** 遍历所有客户端 */
  forEachClient(callback: (ws: WebSocket, meta: ClientMeta) => void): void;
  /** 当前连接数 */
  readonly clientCount: number;
}
