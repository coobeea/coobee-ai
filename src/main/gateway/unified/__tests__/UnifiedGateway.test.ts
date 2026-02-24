import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnifiedGateway } from '../UnifiedGateway';
import type { UnifiedContext } from '../types';

describe('UnifiedGateway', () => {
  let gateway: UnifiedGateway;

  beforeEach(() => {
    gateway = new UnifiedGateway();
  });

  describe('register and call', () => {
    it('应该注册并调用 RPC 方法', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'success' });

      gateway.register('test.method', handler, 'rpc');

      const response = await gateway.call('test.method', { param: 'value' });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({ result: 'success' });
      expect(handler).toHaveBeenCalledWith({ param: 'value' }, expect.objectContaining({ type: 'rpc' }));
    });

    it('应该处理不存在的路由', async () => {
      const response = await gateway.call('nonexistent.method');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('ROUTE_NOT_FOUND');
    });

    it('应该处理处理器错误', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Handler error'));

      gateway.register('error.method', handler);

      const response = await gateway.call('error.method');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('HANDLER_ERROR');
      expect(response.error?.message).toBe('Handler error');
    });
  });

  describe('event handling', () => {
    it('应该注册并触发事件', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);

      gateway.on('test.event', handler);

      await gateway.emit('test.event', { data: 'value' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'test.event',
          data: { data: 'value' }
        }),
        expect.objectContaining({ type: 'event' })
      );
    });

    it('应该支持多个事件处理器', async () => {
      const handler1 = vi.fn().mockResolvedValue(undefined);
      const handler2 = vi.fn().mockResolvedValue(undefined);

      gateway.on('test.event', handler1);
      gateway.on('test.event', handler2);

      await gateway.emit('test.event', { data: 'value' });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('应该支持取消订阅', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);

      const unsubscribe = gateway.on('test.event', handler);
      unsubscribe();

      await gateway.emit('test.event', { data: 'value' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('HTTP request', () => {
    it('应该处理 HTTP 请求', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'success' });

      gateway.register('/api/test', handler, 'http');

      const response = await gateway.request('/api/test', { param: 'value' });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({ result: 'success' });
      expect(handler).toHaveBeenCalledWith({ param: 'value' }, expect.objectContaining({ type: 'http' }));
    });
  });

  describe('unregister', () => {
    it('应该注销路由', () => {
      const handler = vi.fn();

      gateway.register('test.method', handler);
      expect(gateway.getRoutes()).toHaveLength(1);

      const result = gateway.unregister('test.method');
      expect(result).toBe(true);
      expect(gateway.getRoutes()).toHaveLength(0);
    });

    it('应该返回 false 当路由不存在', () => {
      const result = gateway.unregister('nonexistent.method');
      expect(result).toBe(false);
    });
  });

  describe('getRoutes and getEvents', () => {
    it('应该返回已注册的路由', () => {
      gateway.register('method1', vi.fn(), 'rpc');
      gateway.register('method2', vi.fn(), 'http');

      const routes = gateway.getRoutes();

      expect(routes).toHaveLength(2);
      expect(routes).toContainEqual({ target: 'method1', type: 'rpc' });
      expect(routes).toContainEqual({ target: 'method2', type: 'http' });
    });

    it('应该返回已注册的事件', () => {
      gateway.on('event1', vi.fn());
      gateway.on('event2', vi.fn());

      const events = gateway.getEvents();

      expect(events).toHaveLength(2);
      expect(events).toContain('event1');
      expect(events).toContain('event2');
    });
  });

  describe('clear', () => {
    it('应该清空所有路由和事件', () => {
      gateway.register('method1', vi.fn());
      gateway.on('event1', vi.fn());

      expect(gateway.getRoutes()).toHaveLength(1);
      expect(gateway.getEvents()).toHaveLength(1);

      gateway.clear();

      expect(gateway.getRoutes()).toHaveLength(0);
      expect(gateway.getEvents()).toHaveLength(0);
    });
  });

  describe('context propagation', () => {
    it('应该传递上下文到处理器', async () => {
      let receivedContext: UnifiedContext | undefined;

      const handler = vi.fn().mockImplementation((_payload: unknown, context: UnifiedContext) => {
        receivedContext = context;
        return { ok: true };
      });

      gateway.register('test.method', handler);

      await gateway.call(
        'test.method',
        { param: 'value' },
        {
          client: { connectionId: 'test-client-123' }
        }
      );

      expect(receivedContext).toBeDefined();
      expect(receivedContext?.type).toBe('rpc');
      expect(receivedContext?.client?.connectionId).toBe('test-client-123');
    });
  });
});
