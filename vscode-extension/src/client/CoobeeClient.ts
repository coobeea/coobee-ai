/**
 * Coobee API Client for VS Code
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';

interface CoobeeConfig {
  apiUrl: string;
  apiKey: string;
}

interface ChatResponse {
  sessionId: string;
  content: string;
  status: string;
}

export class CoobeeClient {
  private config: CoobeeConfig;

  constructor(config: CoobeeConfig) {
    this.config = config;
  }

  /**
   * 发送聊天消息
   */
  async chat(agentId: string, message: string, sessionId?: string): Promise<ChatResponse> {
    const response = await this.post('/api/v1/chat', {
      agentId,
      message,
      sessionId
    });

    return response as ChatResponse;
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
      req.end();
    });
  }

  /**
   * POST 请求
   */
  private async post(path: string, body: unknown): Promise<unknown> {
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
            resolve(JSON.parse(responseData));
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }
}
