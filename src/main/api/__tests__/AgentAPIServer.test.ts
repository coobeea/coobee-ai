/**
 * AgentAPIServer 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentAPIServer } from '../AgentAPIServer';
import { AgentSDK } from '../sdk/AgentSDK';
import type { APIConfig } from '../types';

describe('AgentAPIServer', () => {
  let server: AgentAPIServer;

  const config: APIConfig = {
    port: 13999,
    apiKeys: ['test-api-key'],
    enabled: true,
    allowedOrigins: ['*'],
    requestTimeout: 30000,
    rateLimit: 60
  };

  beforeEach(async () => {
    server = new AgentAPIServer(config);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('Health check', () => {
    it('should respond to health check', async () => {
      const sdk = new AgentSDK({
        apiUrl: `http://localhost:${config.port}`,
        apiKey: 'test-api-key'
      });

      const response = (await sdk['get']('/health')) as { status: string };
      expect(response.status).toBe('ok');
    });
  });

  describe('Chat API', () => {
    it('should handle chat request', async () => {
      const sdk = new AgentSDK({
        apiUrl: `http://localhost:${config.port}`,
        apiKey: 'test-api-key'
      });

      const response = await sdk.chat('default', 'Hello, world!');

      expect(response.status).toBe('success');
      expect(response.sessionId).toBeDefined();
      expect(response.content).toContain('Hello, world!');
    });
  });

  describe('Agent listing', () => {
    it('should list available agents', async () => {
      const sdk = new AgentSDK({
        apiUrl: `http://localhost:${config.port}`,
        apiKey: 'test-api-key'
      });

      const agents = await sdk.listAgents();

      expect(Array.isArray(agents)).toBe(true);
      expect(agents.length).toBeGreaterThan(0);
    });
  });
});

describe('AgentSDK', () => {
  it('should be instantiable', () => {
    const sdk = new AgentSDK({
      apiUrl: 'http://localhost:3000',
      apiKey: 'test-key'
    });

    expect(sdk).toBeInstanceOf(AgentSDK);
  });
});
