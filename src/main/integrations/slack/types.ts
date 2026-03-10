/**
 * Slack Integration Types
 */

/**
 * Slack 配置
 */
export interface SlackConfig {
  /** Bot Token */
  botToken: string;

  /** Signing Secret */
  signingSecret: string;

  /** App Token (for Socket Mode) */
  appToken?: string;

  /** Workspace ID */
  workspaceId?: string;
}

/**
 * Slack 事件
 */
export interface SlackEvent {
  /** 事件类型 */
  type: string;

  /** 频道 ID */
  channel?: string;

  /** 用户 ID */
  user?: string;

  /** 文本内容 */
  text?: string;

  /** 时间戳 */
  ts?: string;

  /** 线程时间戳 */
  thread_ts?: string;
}

/**
 * Slack 消息
 */
export interface SlackMessage {
  /** 频道 ID */
  channel: string;

  /** 文本内容 */
  text: string;

  /** 线程时间戳（回复时使用） */
  thread_ts?: string;

  /** 块（富文本） */
  blocks?: unknown[];
}

/**
 * Slack 命令
 */
export interface SlackCommand {
  /** 命令名称 */
  command: string;

  /** 文本参数 */
  text: string;

  /** 用户 ID */
  user_id: string;

  /** 频道 ID */
  channel_id: string;

  /** 响应 URL */
  response_url: string;
}
