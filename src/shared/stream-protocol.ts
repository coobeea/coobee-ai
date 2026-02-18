/**
 * WebSocket 流式协议类型（前后端共享）
 *
 * 前后端通过 WebSocket 传输的消息格式定义。
 * 后端 WsHub 和前端 wsSetup 共同引用此模块，
 * 确保协议变更时编译期即可发现不一致。
 *
 * 消息类型采用 prefix:action 前缀约定：
 *   - stream:*  — AI 流式频道
 *   - worker:*  — Worker 管理频道
 *   - 无前缀    — WsHub 内置（ping/pong/error）
 */

// ==================== 流式消息 ====================

/**
 * 流式消息类型（粗粒度，用于 WebSocket 传输）
 *
 * 对应关系（StreamChunkType → StreamMessageType）：
 *   text:delta   → text
 *   reasoning:*  → thinking
 *   tool:start   → tool_call
 *   tool:done    → tool_result
 *   handoff:*    → handoff
 *   delegate:*   → delegate
 *   hitl:*       → hitl
 *   run:start       → start
 *   run:done        → done
 *   run:error       → error
 *   run:interrupted → interrupted
 *   run:resumed     → resumed
 */
export type StreamMessageType =
  | 'text'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'handoff'
  | 'delegate'
  | 'hitl'
  | 'agent_updated'
  | 'start'
  | 'done'
  | 'error'
  | 'interrupted'
  | 'resumed';

/** 流式消息来源 */
export interface StreamSource {
  /** 来源类型 */
  type: 'agent' | 'orchestrator' | 'swarm';
  /** 来源 ID */
  id: string;
  /** 来源名称 */
  name: string;
}

/** 流式消息 */
export interface StreamMessage {
  /** 消息唯一 ID */
  id: string;
  /** 会话 ID */
  sessionId: string;
  /** 消息序号（单调递增） */
  sequence: number;
  /** 消息类型 */
  type: StreamMessageType;
  /** 消息内容 */
  content: string;
  /** 额外数据 */
  data?: Record<string, unknown>;
  /** 时间戳 */
  timestamp: number;
  /** 来源 */
  source: StreamSource;
}

// ==================== WsHub Channel 接口 ====================

/**
 * WebSocket 频道接口
 *
 * 每个 Channel 负责一类消息的处理，通过 prefix 约定自动路由。
 * 文件放在 src/main/channels/ 目录，命名 *Channel.ts，WsHub 自动发现。
 */
export interface WsChannel {
  /** 频道前缀（用于消息路由，如 'stream'、'worker'） */
  prefix: string;
  /** 频道显示名称（用于日志） */
  label: string;
  /** 频道初始化：注册 EventBus 监听、获取 Hub 引用等 */
  onInit(hub: WsHubApi): void;
  /** 处理客户端消息（action 是去除前缀后的部分） */
  onMessage(ws: unknown, action: string, msg: WsClientMessage, meta: Record<string, unknown>): Promise<void>;
  /** 客户端连接（可选） */
  onConnect?(ws: unknown, meta: Record<string, unknown>): void;
  /** 客户端断开（可选） */
  onDisconnect?(ws: unknown, meta: Record<string, unknown>): void;
}

/**
 * WsHub 对外暴露的 API（供 Channel 调用）
 *
 * Channel 通过 onInit(hub) 获得此引用，用于发送/广播消息。
 */
export interface WsHubApi {
  /** 向单个客户端发送消息 */
  send(ws: unknown, payload: WsServerMessage): void;
  /** 向所有客户端广播 */
  broadcast(payload: WsServerMessage): void;
  /** 按条件广播（predicate 返回 true 的客户端） */
  broadcastIf(payload: WsServerMessage, predicate: (ws: unknown, meta: Record<string, unknown>) => boolean): number;
  /** 遍历所有客户端 */
  forEachClient(callback: (ws: unknown, meta: Record<string, unknown>) => void): void;
  /** 当前连接数 */
  readonly clientCount: number;
}

// ==================== WebSocket 协议 ====================

/**
 * 客户端消息（客户端 → 服务端）
 *
 * 消息类型采用 prefix:action 前缀约定：
 *   - stream:subscribe / stream:unsubscribe / stream:resend / stream:latest_sequence
 *   - worker:list / worker:start / worker:stop
 *   - ping（内置，无前缀）
 */
export interface WsClientMessage {
  type: // stream 频道
    | 'stream:subscribe'
    | 'stream:unsubscribe'
    | 'stream:resend'
    | 'stream:latest_sequence'
    // worker 频道
    | 'worker:list'
    | 'worker:start'
    | 'worker:stop'
    // 内置
    | 'ping';
  /** Worker 名称（worker:start/worker:stop 时使用） */
  workerName?: string;
  sessionId?: string;
  fromSequence?: number;
}

// ==================== Worker 状态（Runtime → 前端）====================

/** Worker 运行状态 */
export type WorkerStatus = 'stopped' | 'initializing' | 'starting' | 'ready' | 'error' | 'stopping';

/** Worker 状态信息（推送给前端） */
export interface WorkerStatusInfo {
  /** Worker 名称 */
  name: string;
  /** 显示名称 */
  label: string;
  /** 当前状态 */
  status: WorkerStatus;
  /** 服务端口（ready 时有效，前端据此直连 Worker） */
  port?: number;
  /** 错误信息 */
  error?: string;
  /** 重启次数 */
  restartCount: number;
}

/**
 * 服务端消息（服务端 → 客户端）
 *
 * 消息类型同样采用 prefix:action 前缀约定：
 *   - stream:message / stream:resend_batch / stream:latest_sequence
 *   - worker:status / worker:list
 *   - pong / error（内置，无前缀）
 */
export type WsServerMessage =
  // stream 频道
  | { type: 'stream:message'; data: StreamMessage }
  | { type: 'stream:resend_batch'; data: StreamMessage[] }
  | { type: 'stream:latest_sequence'; data: { sequence: number } }
  // worker 频道
  | { type: 'worker:status'; data: WorkerStatusInfo }
  | { type: 'worker:list'; data: WorkerStatusInfo[] }
  // 内置
  | { type: 'pong'; data?: Record<string, never> }
  | { type: 'error'; data: { error: string } };

/** WebSocket 连接状态 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

// ==================== HITL 审批 ====================

/**
 * HITL 审批决策
 *
 * 对应 OpenClaw 的三种决策：
 *   - approve-once:   本次允许执行
 *   - approve-always:  始终允许（白名单自学习，预留）
 *   - reject:          拒绝执行
 */
export type HitlApprovalDecision = 'approve-once' | 'approve-always' | 'reject';

/**
 * HITL 消息数据（hitl 类型 StreamMessage 的 data 字段结构）
 *
 * 前端通过 action 区分事件阶段：
 *   - required:  需要审批（展示审批卡片）
 *   - approved:  已批准（更新卡片状态）
 *   - rejected:  已拒绝（更新卡片状态）
 */
export interface HitlMessageData {
  /** 审批项索引（一次中断可能有多个工具需要审批） */
  index: number;
  /** 工具名称 */
  toolName: string;
  /** 工具参数（JSON 字符串） */
  arguments?: string;
  /** 事件阶段 */
  action: 'required' | 'approved' | 'rejected';
}
