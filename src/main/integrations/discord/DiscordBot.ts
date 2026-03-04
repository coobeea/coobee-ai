/**
 * DiscordBot - Discord 机器人
 */

import { createLogger } from '@main/common/logger';
import { DiscordClient } from './DiscordClient';
import type { DiscordConfig, DiscordMessage, DiscordInteraction } from './types';

const log = createLogger('discord-bot');

export class DiscordBot {
  private client: DiscordClient;
  private messageHandlers: Array<(message: DiscordMessage) => Promise<void>> = [];
  private interactionHandlers = new Map<string, (interaction: DiscordInteraction) => Promise<void>>();

  constructor(config: DiscordConfig) {
    this.client = new DiscordClient(config);

    this.registerDefaultCommands();
  }

  /**
   * 注册消息处理器
   */
  onMessage(handler: (message: DiscordMessage) => Promise<void>): void {
    this.messageHandlers.push(handler);
  }

  /**
   * 注册交互处理器
   */
  onInteraction(commandName: string, handler: (interaction: DiscordInteraction) => Promise<void>): void {
    this.interactionHandlers.set(commandName, handler);
    log.info(`[DiscordBot] Registered interaction handler: ${commandName}`);
  }

  /**
   * 处理消息
   */
  async handleMessage(message: DiscordMessage): Promise<void> {
    if (message.author.bot) return;

    if (message.mentions_bot || message.content.includes('@coobee')) {
      log.info(`[DiscordBot] Bot mentioned in channel ${message.channel_id}`);

      await this.client.sendMessage(message.channel_id, '收到！正在处理您的请求...');
    }

    for (const handler of this.messageHandlers) {
      try {
        await handler(message);
      } catch (err) {
        log.error('[DiscordBot] Message handler error:', err);
      }
    }
  }

  /**
   * 处理交互
   */
  async handleInteraction(interaction: DiscordInteraction): Promise<void> {
    const commandName = interaction.data?.name;

    if (!commandName) {
      log.warn('[DiscordBot] Interaction without command name');
      return;
    }

    const handler = this.interactionHandlers.get(commandName);

    if (handler) {
      try {
        await handler(interaction);
      } catch (err) {
        log.error(`[DiscordBot] Error handling interaction ${commandName}:`, err);
      }
    } else {
      log.debug(`[DiscordBot] No handler for command: ${commandName}`);
    }
  }

  /**
   * 发送消息
   */
  async sendMessage(channelId: string, content: string): Promise<void> {
    await this.client.sendMessage(channelId, content);
  }

  /**
   * 注册默认命令
   */
  private registerDefaultCommands(): void {
    this.onInteraction('help', async (interaction: DiscordInteraction) => {
      const helpText = `
**Coobee AI 命令列表**

/help - 显示此帮助信息
/ask [问题] - 向 AI 提问
/status - 查看系统状态
`;

      if (interaction.channel_id) {
        await this.client.sendMessage(interaction.channel_id, helpText);
      }
    });
  }

  /**
   * 获取客户端
   */
  getClient(): DiscordClient {
    return this.client;
  }
}
