import type { ChannelConfig, ExtensionLogger } from '../common/extension/types';

// ==================== 现有类型（保留向后兼容） ====================

export interface ChannelStatus {
  id: string;
  name: string;
  status: 'stopped' | 'running' | 'error';
  error?: string;
}

export interface ManagedChannel {
  config: ChannelConfig;
  status: ChannelStatus['status'];
  error?: string;
  abortController?: AbortController;
  /** 关联的 ChannelPlugin（新增，可选） */
  plugin?: ChannelPlugin;
}

// ==================== ChannelPlugin 架构（新增） ====================

/**
 * Channel 上下文
 *
 * 传递给 Agent 的额外信息，每个 Channel 可以自由扩展
 *
 * @example
 * // Discussion Channel
 * {
 *   channel: 'discussion',
 *   roomId: 'room-123',
 *   role: 'Expert',
 *   topic: 'AI Architecture'
 * }
 *
 * @example
 * // Feishu Channel
 * {
 *   channel: 'feishu',
 *   chatId: 'oc_xxx',
 *   chatType: 'group',
 *   messageId: 'om_yyy'
 * }
 */
export interface ChannelContext {
  /** Channel ID（必填） */
  channel: string;
  /** Channel 特定字段（灵活扩展） */
  [key: string]: unknown;
}

/**
 * 媒体附件
 */
export interface MediaAttachment {
  /** 类型：image/video/audio/file */
  type: 'image' | 'video' | 'audio' | 'file';
  /** 资源 URL 或本地路径 */
  url: string;
  /** 文件名（可选） */
  name?: string;
  /** 文件大小（字节，可选） */
  size?: number;
}

/**
 * 入站消息（Channel → Agent）
 *
 * 所有 Channel 发送给 Agent 的消息必须转换为此格式
 */
export interface InboundMessage {
  /** 对话标识（讨论室 ID / 飞书 chatId / Slack channelId） */
  peer: string;

  /** 发送者标识（参与者 ID / 用户 openId / Slack userId） */
  from: string;

  /** 消息文本内容 */
  text: string;

  /** Channel 上下文 */
  context: ChannelContext;

  /** 媒体附件（可选） */
  media?: MediaAttachment[];

  /** 消息元数据（可选） */
  metadata?: Record<string, unknown>;
}

/**
 * 出站消息（Agent → Channel）
 *
 * Agent 生成的回复消息，由 Channel 发送到目标平台
 */
export interface OutboundMessage {
  /** 目标标识（讨论室 ID / 飞书 chatId / Slack channelId） */
  to: string;

  /** 消息文本内容 */
  text: string;

  /** 发送者 Agent ID */
  agentId: string;

  /** 附件（可选） */
  attachments?: MediaAttachment[];

  /** 回复目标消息 ID（可选，用于 reply-to） */
  replyTo?: string;

  /** 消息元数据（可选） */
  metadata?: Record<string, unknown>;
}

/**
 * Channel 生命周期上下文
 *
 * 传递给 start/stop 钩子的参数
 */
export interface ChannelLifecycleContext {
  /** 绑定的 AbortSignal（用于安全退出） */
  abortSignal: AbortSignal;

  /** 日志接口 */
  log: ExtensionLogger;

  /** Channel 配置（可选） */
  config?: Record<string, unknown>;
}

/**
 * Channel 能力声明
 *
 * 用于声明 Channel 支持的特性
 */
export interface ChannelCapabilities {
  /** 支持多 Agent 协作 */
  supportsMultiAgent?: boolean;

  /** 支持流式输出 */
  supportsStreaming?: boolean;

  /** 支持工具调用可视化 */
  supportsTools?: boolean;

  /** 支持媒体消息 */
  supportsMedia?: boolean;

  /** 支持消息编辑 */
  supportsEdit?: boolean;

  /** 支持消息删除 */
  supportsDelete?: boolean;

  /** 支持 Reactions（表情回应） */
  supportsReactions?: boolean;
}

/**
 * ChannelPlugin 接口
 *
 * 所有 Channel 必须实现此接口
 *
 * @example
 * const discussionChannel: ChannelPlugin = {
 *   id: 'discussion',
 *   name: 'Discussion Room',
 *   lifecycle: {
 *     start: async (ctx) => { ... },
 *     stop: async (ctx) => { ... }
 *   },
 *   inbound: {
 *     handleMessage: async (msg) => { ... }
 *   },
 *   outbound: {
 *     sendMessage: async (msg) => { ... }
 *   },
 *   capabilities: {
 *     supportsMultiAgent: true
 *   }
 * };
 */
export interface ChannelPlugin {
  /** Channel 唯一 ID（如 'discussion', 'feishu', 'slack'） */
  id: string;

  /** Channel 显示名称 */
  name: string;

  /** 描述（可选） */
  description?: string;

  /** 生命周期钩子 */
  lifecycle: {
    /**
     * 启动 Channel 监听
     *
     * 此方法应：
     * 1. 初始化连接（WebSocket、HTTP Server 等）
     * 2. 注册事件监听器
     * 3. 返回 Promise（当 abortSignal 触发时 resolve）
     */
    start: (ctx: ChannelLifecycleContext) => Promise<void> | void;

    /**
     * 停止 Channel 监听
     *
     * 此方法应：
     * 1. 清理连接
     * 2. 注销事件监听器
     * 3. 释放资源
     */
    stop: (ctx: ChannelLifecycleContext) => Promise<void> | void;
  };

  /**
   * 入站消息处理器（可选）
   *
   * Channel 收到消息后，调用 handleMessage 转发给 Agent
   */
  inbound?: {
    handleMessage: (msg: InboundMessage) => Promise<void>;
  };

  /**
   * 出站消息发送器（可选）
   *
   * Agent 回复后，调用 sendMessage 发送到 Channel
   */
  outbound?: {
    sendMessage: (msg: OutboundMessage) => Promise<void>;
  };

  /**
   * 能力声明（可选）
   */
  capabilities?: ChannelCapabilities;
}
