/**
 * GatewayServer 心跳机制测试
 *
 * 验证 WebSocket 连接级心跳：
 *   - 连接建立后启动心跳定时器
 *   - 心跳超时（未收到 pong）→ 终止连接
 *   - 正常 pong 响应 → 保持连接存活
 *   - 关闭连接时清理心跳定时器
 *   - 关闭 GatewayServer 时清理所有定时器
 *   - 自定义心跳间隔
 *   - 多客户端独立心跳
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('@main/common/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}));

class MockWs extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  send = vi.fn();
  ping = vi.fn();
  close = vi.fn();
  terminate = vi.fn();
}

let lastWss: EventEmitter;

vi.mock('ws', () => {
  return {
    WebSocket: { OPEN: 1 },
    WebSocketServer: class extends EventEmitter {
      close = vi.fn();
      constructor() {
        super();
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        lastWss = this;
      }
    }
  };
});

const mockApp = { use: vi.fn().mockReturnValue({ use: vi.fn() }) };
const mockHttpServer = {
  getHttpServer: vi.fn().mockReturnValue({}),
  getApp: vi.fn().mockReturnValue(mockApp)
};

describe('GatewayServer 心跳机制', () => {
  let GatewayServer: typeof import('../GatewayServer').GatewayServer;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    const mod = await import('../GatewayServer');
    GatewayServer = mod.GatewayServer;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createServer(heartbeatInterval?: number): InstanceType<typeof GatewayServer> {
    const server = new GatewayServer({
      httpServer: mockHttpServer as never,
      heartbeatInterval
    });
    server.start();
    return server;
  }

  function connect(): MockWs {
    const ws = new MockWs();
    lastWss.emit('connection', ws);
    return ws;
  }

  it('连接建立后启动心跳（默认 30s 间隔）', () => {
    const server = createServer();
    const ws = connect();

    expect(server.clientCount).toBe(1);

    vi.advanceTimersByTime(30_000);
    expect(ws.ping).toHaveBeenCalledTimes(1);
  });

  it('自定义心跳间隔', () => {
    createServer(5000);
    const ws = connect();

    vi.advanceTimersByTime(5000);
    expect(ws.ping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(ws.terminate).toHaveBeenCalledTimes(1);
  });

  it('收到 pong 后保持连接存活', () => {
    createServer(5000);
    const ws = connect();

    vi.advanceTimersByTime(5000);
    expect(ws.ping).toHaveBeenCalledTimes(1);

    ws.emit('pong');

    vi.advanceTimersByTime(5000);
    expect(ws.ping).toHaveBeenCalledTimes(2);
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it('未收到 pong → 心跳超时终止连接', () => {
    createServer(5000);
    const ws = connect();

    vi.advanceTimersByTime(5000);
    expect(ws.ping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(ws.terminate).toHaveBeenCalledTimes(1);
  });

  it('多轮心跳：连续收到 pong 保持存活', () => {
    createServer(5000);
    const ws = connect();

    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(5000);
      ws.emit('pong');
    }

    expect(ws.ping).toHaveBeenCalledTimes(5);
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it('客户端正常断开 → 清理心跳定时器', () => {
    const server = createServer(5000);
    const ws = connect();

    expect(server.clientCount).toBe(1);

    ws.emit('close');
    expect(server.clientCount).toBe(0);

    vi.advanceTimersByTime(50_000);
    expect(ws.ping).not.toHaveBeenCalled();
  });

  it('客户端错误断开 → 清理心跳定时器', () => {
    const server = createServer(5000);
    const ws = connect();

    ws.emit('error', new Error('connection reset'));
    expect(server.clientCount).toBe(0);

    vi.advanceTimersByTime(50_000);
    expect(ws.ping).not.toHaveBeenCalled();
  });

  it('关闭 GatewayServer → 清理所有连接和心跳', async () => {
    const server = createServer(5000);
    const ws1 = connect();
    const ws2 = connect();

    expect(server.clientCount).toBe(2);

    // Mock close behavior so it returns
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((server as any).wss) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (server as any).wss.close = vi.fn((cb) => {
        if (cb) cb();
      });
    }

    await server.close();

    expect(ws1.terminate).toHaveBeenCalled();
    expect(ws2.terminate).toHaveBeenCalled();
    expect(server.clientCount).toBe(0);

    vi.advanceTimersByTime(50_000);
    expect(ws1.ping).not.toHaveBeenCalled();
    expect(ws2.ping).not.toHaveBeenCalled();
  });

  it('多客户端独立心跳', () => {
    createServer(5000);
    const ws1 = connect();
    const ws2 = connect();

    vi.advanceTimersByTime(5000);
    expect(ws1.ping).toHaveBeenCalledTimes(1);
    expect(ws2.ping).toHaveBeenCalledTimes(1);

    ws1.emit('pong');

    vi.advanceTimersByTime(5000);
    expect(ws1.ping).toHaveBeenCalledTimes(2);
    expect(ws1.terminate).not.toHaveBeenCalled();
    expect(ws2.terminate).toHaveBeenCalledTimes(1);
  });
});
