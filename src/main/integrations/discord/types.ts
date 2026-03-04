/**
 * Discord Integration Types
 */

/**
 * Discord 配置
 */
export interface DiscordConfig {
  /** Bot Token */
  botToken: string;

  /** Application ID */
  applicationId: string;

  /** Guild ID（服务器 ID） */
  guildId?: string;
}

/**
 * Discord 消息
 */
export interface DiscordMessage {
  /** 消息 ID */
  id: string;

  /** 频道 ID */
  channel_id: string;

  /** 作者 */
  author: {
    id: string;
    username: string;
    bot?: boolean;
  };

  /** 内容 */
  content: string;

  /** 时间戳 */
  timestamp: string;

  /** 是否提到 Bot */
  mentions_bot?: boolean;
}

/**
 * Discord 交互
 */
export interface DiscordInteraction {
  /** 交互类型 */
  type: number;

  /** 数据 */
  data?: {
    name: string;
    options?: Array<{
      name: string;
      value: string;
    }>;
  };

  /** 用户 */
  user?: {
    id: string;
    username: string;
  };

  /** 频道 ID */
  channel_id?: string;

  /** Token */
  token: string;
}

/**
 * Discord 命令
 */
export interface DiscordCommand {
  /** 命令名称 */
  name: string;

  /** 描述 */
  description: string;

  /** 选项 */
  options?: Array<{
    type: number;
    name: string;
    description: string;
    required?: boolean;
  }>;
}
