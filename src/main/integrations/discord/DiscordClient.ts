/**
 * DiscordClient - Discord API 客户端
 */

import https from 'https';
import { createLogger } from '@main/common/logger';
import type { DiscordConfig, DiscordCommand } from './types';

const log = createLogger('discord-client');

export class DiscordClient {
  private config: DiscordConfig;

  constructor(config: DiscordConfig) {
    this.config = config;
  }

  /**
   * 发送消息
   */
  async sendMessage(channelId: string, content: string): Promise<{ id: string }> {
    const response = await this.request('POST', `/channels/${channelId}/messages`, {
      content
    });
    return response as { id: string };
  }

  /**
   * 回复消息
   */
  async replyMessage(channelId: string, messageId: string, content: string): Promise<{ id: string }> {
    const response = await this.request('POST', `/channels/${channelId}/messages`, {
      content,
      message_reference: {
        message_id: messageId
      }
    });
    return response as { id: string };
  }

  /**
   * 添加 Reaction
   */
  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    await this.request('PUT', `/channels/${channelId}/messages/${messageId}/reactions/${emoji}/@me`, null);
  }

  /**
   * 注册全局命令
   */
  async registerCommand(command: DiscordCommand): Promise<void> {
    await this.request('POST', `/applications/${this.config.applicationId}/commands`, command);
    log.info(`[DiscordClient] Registered command: /${command.name}`);
  }

  /**
   * 响应交互
   */
  async respondToInteraction(interactionId: string, token: string, content: string): Promise<void> {
    await this.request('POST', `/interactions/${interactionId}/${token}/callback`, {
      type: 4,
      data: {
        content
      }
    });
  }

  /**
   * 发起 HTTP 请求
   */
  private async request(method: string, path: string, body: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;

      const options = {
        hostname: 'discord.com',
        port: 443,
        path: `/api/v10${path}`,
        method,
        headers: {
          Authorization: `Bot ${this.config.botToken}`,
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
        }
      };

      const req = https.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(responseData ? JSON.parse(responseData) : {});
            } catch {
              resolve(responseData);
            }
          } else {
            log.error(`[DiscordClient] API error: ${res.statusCode} ${responseData}`);
            reject(new Error(`Discord API error: ${res.statusCode}`));
          }
        });
      });

      req.on('error', (err) => {
        log.error('[DiscordClient] Request error:', err);
        reject(err);
      });

      if (data) {
        req.write(data);
      }
      req.end();
    });
  }
}
