/**
 * CoobeeClient - Coobee AI 客户端
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

export class CoobeeClient {
  private serverUrl: string;
  private apiKey: string;
  private connected = false;

  constructor(serverUrl: string, apiKey: string) {
    this.serverUrl = serverUrl;
    this.apiKey = apiKey;
  }

  /**
   * 连接到服务器
   */
  async connect(): Promise<void> {
    const response = await this.get('/health');
    if ((response as { status: string }).status === 'ok') {
      this.connected = true;
    } else {
      throw new Error('Server health check failed');
    }
  }

  /**
   * 发送消息
   */
  async chat(agentId: string, message: string): Promise<{ content: string; sessionId: string }> {
    const response = await this.post('/api/v1/chat', {
      agentId,
      message
    });

    return response as { content: string; sessionId: string };
  }

  /**
   * 提交任务
   */
  async submitTask(description: string): Promise<{ id: string; status: string }> {
    const response = await this.post('/api/v1/tasks', {
      title: '来自 VS Code',
      description,
      priority: 5
    });

    return response as { id: string; status: string };
  }

  /**
   * 获取状态
   */
  async getStatus(): Promise<{ connected: boolean; agents: number }> {
    if (!this.connected) {
      return { connected: false, agents: 0 };
    }

    const response = await this.get('/api/v1/agents');
    const agents = (response as { agents: unknown[] }).agents;

    return {
      connected: true,
      agents: agents.length
    };
  }

  /**
   * GET 请求
   */
  private async get(path: string): Promise<unknown> {
    const url = new URL(path, this.serverUrl);

    return new Promise((resolve, reject) => {
      const protocol = url.protocol === 'https:' ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'X-API-Key': this.apiKey
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
    const url = new URL(path, this.serverUrl);
    const data = JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const protocol = url.protocol === 'https:' ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'X-API-Key': this.apiKey,
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

  isConnected(): boolean {
    return this.connected;
  }
}
