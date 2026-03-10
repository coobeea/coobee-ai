/**
 * SlackClient - Slack API 客户端
 */

import https from 'https';
import { createLogger } from '@main/common/logger';
import type { SlackConfig, SlackMessage } from './types';

const log = createLogger('slack-client');

export class SlackClient {
  private config: SlackConfig;

  constructor(config: SlackConfig) {
    this.config = config;
  }

  /**
   * 发送消息
   */
  async sendMessage(message: SlackMessage): Promise<{ ok: boolean; ts?: string }> {
    const response = await this.request('chat.postMessage', message);
    return response as { ok: boolean; ts?: string };
  }

  /**
   * 更新消息
   */
  async updateMessage(channel: string, ts: string, text: string): Promise<{ ok: boolean }> {
    const response = await this.request('chat.update', {
      channel,
      ts,
      text
    });
    return response as { ok: boolean };
  }

  /**
   * 添加 Reaction
   */
  async addReaction(channel: string, timestamp: string, name: string): Promise<{ ok: boolean }> {
    const response = await this.request('reactions.add', {
      channel,
      timestamp,
      name
    });
    return response as { ok: boolean };
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(userId: string): Promise<{ ok: boolean; user?: unknown }> {
    const response = await this.request('users.info', { user: userId });
    return response as { ok: boolean; user?: unknown };
  }

  /**
   * 发起 HTTP 请求
   */
  private async request(method: string, body: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);

      const options = {
        hostname: 'slack.com',
        port: 443,
        path: `/api/${method}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.botToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };

      const req = https.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const json = JSON.parse(responseData);
            if (json.ok) {
              resolve(json);
            } else {
              log.error(`[SlackClient] API error: ${json.error}`);
              reject(new Error(json.error));
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', (err) => {
        log.error('[SlackClient] Request error:', err);
        reject(err);
      });

      req.write(data);
      req.end();
    });
  }
}
