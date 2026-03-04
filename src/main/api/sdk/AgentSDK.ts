/**
 * AgentSDK - Agent 客户端 SDK
 *
 * 用于外部应用调用 Agent API
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';
import type { SDKConfig, AgentAPIRequest, AgentAPIResponse } from '../types';

export class AgentSDK {
  private config: SDKConfig;

  constructor(config: SDKConfig) {
    this.config = config;
  }

  /**
   * 发送消息
   */
  async chat(agentId: string, message: string, sessionId?: string): Promise<AgentAPIResponse> {
    const request: AgentAPIRequest = {
      agentId,
      message,
      sessionId,
      stream: false
    };

    return this.post('/api/v1/chat', request);
  }

  /**
   * 获取会话
   */
  async getSession(sessionId: string): Promise<unknown> {
    return this.get(`/api/v1/sessions/${sessionId}`);
  }

  /**
   * 列出 Agent
   */
  async listAgents(): Promise<Array<{ id: string; name: string }>> {
    const response = await this.get('/api/v1/agents');
    return (response as { agents: Array<{ id: string; name: string }> }).agents;
  }

  /**
   * GET 请求
   */
  private async get(path: string): Promise<unknown> {
    const url = new URL(path, this.config.apiUrl);

    return new Promise((resolve, reject) => {
      const protocol = url.protocol === 'https:' ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'X-API-Key': this.config.apiKey,
          'Content-Type': 'application/json'
        }
      };

      const req = protocol.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      });

      req.on('error', reject);

      if (this.config.timeout) {
        req.setTimeout(this.config.timeout, () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
      }

      req.end();
    });
  }

  /**
   * POST 请求
   */
  private async post(path: string, body: unknown): Promise<AgentAPIResponse> {
    const url = new URL(path, this.config.apiUrl);
    const data = JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const protocol = url.protocol === 'https:' ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'X-API-Key': this.config.apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };

      const req = protocol.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            resolve(JSON.parse(responseData) as AgentAPIResponse);
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', reject);

      if (this.config.timeout) {
        req.setTimeout(this.config.timeout, () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
      }

      req.write(data);
      req.end();
    });
  }
}
