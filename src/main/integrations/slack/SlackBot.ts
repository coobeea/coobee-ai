/**
 * SlackBot - Slack 机器人
 *
 * 处理 Slack 事件和命令
 */

import { createLogger } from '@main/common/logger';
import { SlackClient } from './SlackClient';
import type { SlackConfig, SlackEvent, SlackCommand } from './types';

const log = createLogger('slack-bot');

export class SlackBot {
  private client: SlackClient;
  private eventHandlers = new Map<string, (event: SlackEvent) => Promise<void>>();
  private commandHandlers = new Map<string, (command: SlackCommand) => Promise<void>>();

  constructor(config: SlackConfig) {
    this.client = new SlackClient(config);

    this.registerDefaultHandlers();
  }

  /**
   * 注册事件处理器
   */
  onEvent(eventType: string, handler: (event: SlackEvent) => Promise<void>): void {
    this.eventHandlers.set(eventType, handler);
    log.info(`[SlackBot] Registered event handler: ${eventType}`);
  }

  /**
   * 注册命令处理器
   */
  onCommand(commandName: string, handler: (command: SlackCommand) => Promise<void>): void {
    this.commandHandlers.set(commandName, handler);
    log.info(`[SlackBot] Registered command handler: ${commandName}`);
  }

  /**
   * 处理事件
   */
  async handleEvent(event: SlackEvent): Promise<void> {
    const handler = this.eventHandlers.get(event.type);

    if (handler) {
      try {
        await handler(event);
      } catch (err) {
        log.error(`[SlackBot] Error handling event ${event.type}:`, err);
      }
    } else {
      log.debug(`[SlackBot] No handler for event type: ${event.type}`);
    }
  }

  /**
   * 处理命令
   */
  async handleCommand(command: SlackCommand): Promise<void> {
    const handler = this.commandHandlers.get(command.command);

    if (handler) {
      try {
        await handler(command);
      } catch (err) {
        log.error(`[SlackBot] Error handling command ${command.command}:`, err);
      }
    } else {
      log.debug(`[SlackBot] No handler for command: ${command.command}`);
    }
  }

  /**
   * 发送消息
   */
  async sendMessage(channel: string, text: string, threadTs?: string): Promise<void> {
    await this.client.sendMessage({
      channel,
      text,
      thread_ts: threadTs
    });
  }

  /**
   * 注册默认处理器
   */
  private registerDefaultHandlers(): void {
    this.onEvent('app_mention', async (event: SlackEvent) => {
      log.info(`[SlackBot] Mentioned in channel ${event.channel} by user ${event.user}`);

      if (event.channel && event.text) {
        await this.sendMessage(event.channel, `收到！正在处理您的请求...`, event.thread_ts);
      }
    });

    this.onEvent('message', async (event: SlackEvent) => {
      if (event.text?.includes('@coobee')) {
        log.info(`[SlackBot] Bot mentioned in message`);
      }
    });
  }

  /**
   * 获取客户端
   */
  getClient(): SlackClient {
    return this.client;
  }
}
