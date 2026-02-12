/**
 * WebSocket 流式协议类型（前后端共享）
 *
 * 前后端通过 WebSocket 传输的消息格式定义。
 * 后端 WebSocketBroadcaster 和前端 useAgentStream 共同引用此模块，
 * 确保协议变更时编译期即可发现不一致。
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
  | 'hitl'
  | 'agent_updated'
  | 'start'
  | 'done'
  | 'error'
  | 'interrupted'
  | 'resumed'

/** 流式消息来源 */
export interface StreamSource {
  /** 来源类型 */
  type: 'agent' | 'team' | 'swarm'
  /** 来源 ID */
  id: string
  /** 来源名称 */
  name: string
}

/** 流式消息 */
export interface StreamMessage {
  /** 消息唯一 ID */
  id: string
  /** 会话 ID */
  sessionId: string
  /** 消息序号（单调递增） */
  sequence: number
  /** 消息类型 */
  type: StreamMessageType
  /** 消息内容 */
  content: string
  /** 额外数据 */
  data?: Record<string, unknown>
  /** 时间戳 */
  timestamp: number
  /** 来源 */
  source: StreamSource
}

// ==================== WebSocket 协议 ====================

/** 客户端消息（客户端 → 服务端） */
export interface WsClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'resend' | 'ping' | 'get_latest_sequence'
  sessionId?: string
  fromSequence?: number
}

/** 服务端消息（服务端 → 客户端） */
export type WsServerMessage =
  | { type: 'message'; data: StreamMessage }
  | { type: 'resend_batch'; data: StreamMessage[] }
  | { type: 'pong'; data?: Record<string, never> }
  | { type: 'error'; data: { error: string } }
  | { type: 'latest_sequence'; data: { sequence: number } }

/** WebSocket 连接状态 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

// ==================== HITL 审批 ====================

/**
 * HITL 审批决策
 *
 * 对应 OpenClaw 的三种决策：
 *   - approve-once:   本次允许执行
 *   - approve-always:  始终允许（白名单自学习，预留）
 *   - reject:          拒绝执行
 */
export type HitlApprovalDecision = 'approve-once' | 'approve-always' | 'reject'

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
  index: number
  /** 工具名称 */
  toolName: string
  /** 工具参数（JSON 字符串） */
  arguments?: string
  /** 事件阶段 */
  action: 'required' | 'approved' | 'rejected'
}
