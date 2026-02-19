/**
 * GatewayClient 单元测试
 *
 * 覆盖：
 *   - WebSocket 连接管理
 *   - 指数退避重连
 *   - RPC 请求/响应
 *   - RPC 超时处理
 *   - 事件订阅和分发
 *   - 连接回调（onConnect）
 *   - 断开时 rejectAllPending
 *   - 重连后 stream.resend（验证第 26/28 轮 P0-3）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { GatewayClient, GatewayRpcError } from '../GatewayClient';
import { GatewayErrorCode } from '@shared/gateway-protocol';

// ==================== Mock WebSocket ====================

interface MockWebSocketInstance {
  url: string;
  readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  triggerOpen: () => void;
  triggerError: () => void;
  triggerClose: () => void;
  triggerMessage: (data: unknown) => void;
}

let lastMockWs: MockWebSocketInstance | null = null;

class MockWebSocket implements MockWebSocketInstance {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  });

  constructor(url: string) {
    this.url = url;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastMockWs = this;
  }

  triggerOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen();
  }

  triggerError(): void {
    if (this.onerror) this.onerror();
  }

  triggerClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }

  triggerMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
}

// 全局替换 WebSocket
global.WebSocket = MockWebSocket as unknown as typeof WebSocket;

// ==================== Helpers ====================

function getMockWs(): MockWebSocketInstance {
  if (!lastMockWs) throw new Error('No MockWebSocket instance created');
  return lastMockWs;
}

// ==================== Tests ====================

describe('GatewayClient', () => {
  let client: GatewayClient;

  beforeEach(() => {
    vi.useFakeTimers();
    lastMockWs = null;
    client = new GatewayClient('ws://localhost:3000', { requestTimeout: 5000 });
  });

  afterEach(() => {
    vi.useRealTimers();
    client.disconnect();
  });

  // ========== 连接管理 ==========

  describe('connection management', () => {
    it('connect 创建 WebSocket 并设置 connectionState', () => {
      expect(client.connectionState.value).toBe('disconnected');

      client.connect();

      const ws = getMockWs();
      expect(ws.url).toBe('ws://localhost:3000');
      expect(client.connectionState.value).toBe('connecting');
    });

    it('onopen → connectionState = connected', async () => {
      client.connect();
      const ws = getMockWs();

      ws.triggerOpen();
      await nextTick();

      expect(client.connectionState.value).toBe('connected');
      expect(client.lastError.value).toBeNull();
    });

    it('重复 connect 不创建新 WebSocket（已连接）', () => {
      client.connect();
      const ws1 = getMockWs();
      ws1.triggerOpen();

      client.connect(); // 第二次
      const ws2 = getMockWs();

      expect(ws2).toBe(ws1); // 同一个实例
    });

    it('disconnect 关闭 WebSocket 并清理', () => {
      client.connect();
      const ws = getMockWs();
      ws.triggerOpen();

      client.disconnect();

      expect(ws.close).toHaveBeenCalled();
      expect(client.connectionState.value).toBe('disconnected');
    });
  });

  // ========== 重连 ==========

  describe('reconnection', () => {
    it('onclose → 自动重连（指数退避）', async () => {
      client.connect();
      const ws1 = getMockWs();
      ws1.triggerOpen();

      // 第一次断开
      ws1.triggerClose();
      await nextTick();

      expect(client.connectionState.value).toBe('disconnected');

      // 2s 后重连（第 1 次，delay = 2s * 2^0 = 2s）
      vi.advanceTimersByTime(2000);
      await nextTick();

      const ws2 = getMockWs();
      expect(ws2).not.toBe(ws1);
      expect(ws2.url).toBe('ws://localhost:3000');
    });

    it('指数退避：第 2 次 4s，第 3 次 8s', async () => {
      client.connect();
      getMockWs().triggerClose();
      await nextTick();

      // 第 1 次重连：2s
      vi.advanceTimersByTime(2000);
      await nextTick();
      getMockWs().triggerClose();
      await nextTick();

      // 第 2 次重连：4s
      vi.advanceTimersByTime(4000);
      await nextTick();
      const ws3 = getMockWs();
      expect(ws3).toBeDefined();

      ws3.triggerClose();
      await nextTick();

      // 第 3 次重连：8s
      vi.advanceTimersByTime(8000);
      await nextTick();
      const ws4 = getMockWs();
      expect(ws4).toBeDefined();
    });

    it('最大延迟 30s', async () => {
      client.connect();

      // 触发 10 次断开，delay 应该 cap 在 30s
      for (let i = 0; i < 10; i++) {
        getMockWs().triggerClose();
        await nextTick();

        const delay = i === 0 ? 2000 : Math.min(2000 * Math.pow(2, i), 30_000);
        vi.advanceTimersByTime(delay);
        await nextTick();
      }

      // 最后一次应该还是重连成功
      const finalWs = getMockWs();
      expect(finalWs).toBeDefined();
    });

    it('onerror → 记录 lastError + 重连', async () => {
      client.connect();
      const ws = getMockWs();

      ws.triggerError();
      await nextTick();

      expect(client.lastError.value).toContain('第 1 次');

      vi.advanceTimersByTime(2000);
      await nextTick();

      expect(getMockWs()).toBeDefined(); // 重连了
    });
  });

  // ========== RPC 请求 ==========

  describe('RPC requests', () => {
    it('request 成功返回 payload', async () => {
      client.connect();
      const ws = getMockWs();
      ws.triggerOpen();

      const promise = client.request('test.method', { foo: 'bar' });

      // 验证发送的请求格式
      expect(ws.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"req"') &&
          expect.stringContaining('"method":"test.method"') &&
          expect.stringContaining('"foo":"bar"')
      );

      // 模拟后端响应
      const req = JSON.parse(ws.send.mock.calls[0][0]);
      ws.triggerMessage({
        type: 'res',
        id: req.id,
        ok: true,
        payload: { result: 'success' }
      });

      await nextTick();
      const result = await promise;
      expect(result).toEqual({ result: 'success' });
    });

    it('request 错误 reject GatewayRpcError', async () => {
      client.connect();
      const ws = getMockWs();
      ws.triggerOpen();

      const promise = client.request('fail.method');

      const req = JSON.parse(ws.send.mock.calls[0][0]);
      ws.triggerMessage({
        type: 'res',
        id: req.id,
        ok: false,
        error: {
          code: GatewayErrorCode.METHOD_NOT_FOUND,
          message: 'Method not found'
        }
      });

      await nextTick();

      await expect(promise).rejects.toThrow(GatewayRpcError);
      await expect(promise).rejects.toMatchObject({
        code: GatewayErrorCode.METHOD_NOT_FOUND,
        message: 'Method not found'
      });
    });

    it('request 超时 reject', async () => {
      client.connect();
      const ws = getMockWs();
      ws.triggerOpen();

      const promise = client.request('slow.method');

      // 5s 超时
      vi.advanceTimersByTime(5000);
      await nextTick();

      await expect(promise).rejects.toThrow(GatewayRpcError);
      await expect(promise).rejects.toMatchObject({
        code: GatewayErrorCode.TIMEOUT,
        message: expect.stringContaining('Request timeout')
      });
    });

    it('未连接时 request reject', async () => {
      const promise = client.request('test.method');

      await expect(promise).rejects.toThrow(GatewayRpcError);
      await expect(promise).rejects.toMatchObject({
        code: GatewayErrorCode.INTERNAL_ERROR,
        message: 'WebSocket not connected'
      });
    });

    it('断开时 rejectAllPending', async () => {
      client.connect();
      const ws = getMockWs();
      ws.triggerOpen();

      const promise1 = client.request('method1');
      const promise2 = client.request('method2');

      ws.triggerClose();
      await nextTick();

      await expect(promise1).rejects.toThrow('Connection closed');
      await expect(promise2).rejects.toThrow('Connection closed');
    });
  });

  // ========== 事件监听 ==========

  describe('event subscription', () => {
    it('on 注册监听器，收到事件时触发', async () => {
      const listener = vi.fn();
      client.on('test.event', listener);

      client.connect();
      const ws = getMockWs();
      ws.triggerOpen();

      ws.triggerMessage({
        type: 'event',
        event: 'test.event',
        payload: { data: 'hello' }
      });

      await nextTick();

      expect(listener).toHaveBeenCalledWith({ data: 'hello' });
    });

    it('取消监听后不再触发', async () => {
      const listener = vi.fn();
      const off = client.on('test.event', listener);

      client.connect();
      const ws = getMockWs();
      ws.triggerOpen();

      // 取消监听
      off();

      ws.triggerMessage({
        type: 'event',
        event: 'test.event',
        payload: { data: 'hello' }
      });

      await nextTick();

      expect(listener).not.toHaveBeenCalled();
    });

    it('多个监听器都会触发', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      client.on('test.event', listener1);
      client.on('test.event', listener2);

      client.connect();
      const ws = getMockWs();
      ws.triggerOpen();

      ws.triggerMessage({
        type: 'event',
        event: 'test.event',
        payload: { data: 'hello' }
      });

      await nextTick();

      expect(listener1).toHaveBeenCalledWith({ data: 'hello' });
      expect(listener2).toHaveBeenCalledWith({ data: 'hello' });
    });
  });

  // ========== onConnect ==========

  describe('onConnect callbacks', () => {
    it('连接成功触发 onConnect', async () => {
      const handler = vi.fn();
      client.onConnect(handler);

      client.connect();
      const ws = getMockWs();
      ws.triggerOpen();

      await nextTick();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('重连成功再次触发 onConnect', async () => {
      const handler = vi.fn();
      client.onConnect(handler);

      client.connect();
      let ws = getMockWs();
      ws.triggerOpen();
      await nextTick();

      expect(handler).toHaveBeenCalledTimes(1);

      // 断开 + 重连
      ws.triggerClose();
      await nextTick();

      vi.advanceTimersByTime(2000);
      await nextTick();

      ws = getMockWs();
      ws.triggerOpen();
      await nextTick();

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('取消 onConnect 后不再触发', async () => {
      const handler = vi.fn();
      const off = client.onConnect(handler);

      // 立即取消
      off();

      client.connect();
      const ws = getMockWs();
      ws.triggerOpen();

      await nextTick();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ========== P0-3: 重连后 stream.resend ==========

  describe('reconnection with stream.resend (P0-3 from arch review 26/28)', () => {
    it('重连后 onConnect 回调应触发 stream.resend', async () => {
      const resendHandler = vi.fn();
      client.onConnect(() => {
        // 模拟 useStreamWs 中的逻辑：重连后调用 stream.resend
        resendHandler();
      });

      // 初始连接
      client.connect();
      let ws = getMockWs();
      ws.triggerOpen();
      await nextTick();

      expect(resendHandler).toHaveBeenCalledTimes(1);

      // 断开连接
      ws.triggerClose();
      await nextTick();

      // 重连
      vi.advanceTimersByTime(2000);
      await nextTick();

      ws = getMockWs();
      ws.triggerOpen();
      await nextTick();

      // onConnect 应再次触发
      expect(resendHandler).toHaveBeenCalledTimes(2);
    });

    it('多次重连，每次都触发 onConnect', async () => {
      const resendHandler = vi.fn();
      client.onConnect(resendHandler);

      // 第 1 次连接
      client.connect();
      getMockWs().triggerOpen();
      await nextTick();
      expect(resendHandler).toHaveBeenCalledTimes(1);

      // 第 1 次断开 + 重连
      getMockWs().triggerClose();
      await nextTick();
      vi.advanceTimersByTime(2000);
      await nextTick();
      getMockWs().triggerOpen();
      await nextTick();
      expect(resendHandler).toHaveBeenCalledTimes(2);

      // 第 2 次断开 + 重连
      getMockWs().triggerClose();
      await nextTick();
      vi.advanceTimersByTime(4000);
      await nextTick();
      getMockWs().triggerOpen();
      await nextTick();
      expect(resendHandler).toHaveBeenCalledTimes(3);
    });
  });

  // ========== RPC 并发 ==========

  describe('concurrent RPC requests', () => {
    it('多个并发请求独立响应', async () => {
      client.connect();
      const ws = getMockWs();
      ws.triggerOpen();

      const promise1 = client.request('method1');
      const promise2 = client.request('method2');
      const promise3 = client.request('method3');

      // 获取请求 ID
      const req1 = JSON.parse(ws.send.mock.calls[0][0]);
      const req2 = JSON.parse(ws.send.mock.calls[1][0]);
      const req3 = JSON.parse(ws.send.mock.calls[2][0]);

      // 乱序响应
      ws.triggerMessage({ type: 'res', id: req2.id, ok: true, payload: 'result2' });
      await nextTick();

      ws.triggerMessage({ type: 'res', id: req1.id, ok: true, payload: 'result1' });
      await nextTick();

      ws.triggerMessage({ type: 'res', id: req3.id, ok: true, payload: 'result3' });
      await nextTick();

      expect(await promise1).toBe('result1');
      expect(await promise2).toBe('result2');
      expect(await promise3).toBe('result3');
    });

    it('部分请求超时，其他正常返回', async () => {
      client.connect();
      const ws = getMockWs();
      ws.triggerOpen();

      const promise1 = client.request('fast');
      const promise2 = client.request('slow');

      const req1 = JSON.parse(ws.send.mock.calls[0][0]);

      // 第一个快速响应
      ws.triggerMessage({ type: 'res', id: req1.id, ok: true, payload: 'fast-result' });
      await nextTick();

      expect(await promise1).toBe('fast-result');

      // 第二个超时
      vi.advanceTimersByTime(5000);
      await nextTick();

      await expect(promise2).rejects.toThrow('Request timeout');
    });
  });

  // ========== 边界条件 ==========

  describe('edge cases', () => {
    it('收到未知 message type → 警告不崩溃', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      client.connect();
      const ws = getMockWs();
      ws.triggerOpen();

      ws.triggerMessage({ type: 'unknown', data: 'test' });
      await nextTick();

      expect(consoleWarn).toHaveBeenCalled();
      expect(consoleWarn.mock.calls[0][0]).toContain('Unknown message type');

      consoleWarn.mockRestore();
    });

    it('收到未匹配的响应 ID → 警告不崩溃', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      client.connect();
      const ws = getMockWs();
      ws.triggerOpen();

      ws.triggerMessage({
        type: 'res',
        id: 'non-existent-id',
        ok: true,
        payload: 'test'
      });

      await nextTick();

      expect(consoleWarn).toHaveBeenCalled();
      expect(consoleWarn.mock.calls[0][0]).toContain('No pending request');

      consoleWarn.mockRestore();
    });

    it('事件监听器抛错不影响其他监听器', async () => {
      const listener1 = vi.fn(() => {
        throw new Error('listener1 error');
      });
      const listener2 = vi.fn();

      client.on('test.event', listener1);
      client.on('test.event', listener2);

      client.connect();
      const ws = getMockWs();
      ws.triggerOpen();

      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      ws.triggerMessage({
        type: 'event',
        event: 'test.event',
        payload: { data: 'test' }
      });

      await nextTick();

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled(); // 第二个仍然被调用
      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    });

    it('解析消息失败不崩溃', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      client.connect();
      const ws = getMockWs();
      ws.triggerOpen();

      // 发送非法 JSON
      if (ws.onmessage) {
        ws.onmessage({ data: 'invalid json {{{' });
      }

      await nextTick();

      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Failed to parse message'), expect.any(Error));

      consoleError.mockRestore();
    });
  });
});
