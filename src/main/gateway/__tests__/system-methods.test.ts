import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@main/common/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('@main/common/env', () => ({
  Env: {
    main: {
      serverPort: '8765',
      serverHost: '0.0.0.0'
    }
  }
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,MOCK_QR')
  }
}));

import { systemMethods } from '../methods/system';

describe('system.networkInfo', () => {
  const handler = systemMethods.methods.networkInfo;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns network info with correct structure', async () => {
    const ctx = {} as Parameters<typeof handler>[1];
    const result = (await handler({}, ctx)) as Record<string, unknown>;

    expect(result).toHaveProperty('host');
    expect(result).toHaveProperty('port');
    expect(result).toHaveProperty('localIPs');
    expect(result).toHaveProperty('primaryIP');
    expect(result).toHaveProperty('isLanEnabled');
    expect(result).toHaveProperty('baseUrl');
    expect(result).toHaveProperty('qrDataUrl');
  });

  it('returns port from env', async () => {
    const ctx = {} as Parameters<typeof handler>[1];
    const result = (await handler({}, ctx)) as Record<string, unknown>;

    expect(result.port).toBe(8765);
  });

  it('detects LAN enabled when host is 0.0.0.0', async () => {
    const ctx = {} as Parameters<typeof handler>[1];
    const result = (await handler({}, ctx)) as Record<string, unknown>;

    expect(result.isLanEnabled).toBe(true);
    expect(result.host).toBe('0.0.0.0');
  });

  it('generates QR code data URL', async () => {
    const ctx = {} as Parameters<typeof handler>[1];
    const result = (await handler({}, ctx)) as Record<string, unknown>;

    expect(result.qrDataUrl).toBe('data:image/png;base64,MOCK_QR');
  });

  it('baseUrl uses primary IP when LAN enabled', async () => {
    const ctx = {} as Parameters<typeof handler>[1];
    const result = (await handler({}, ctx)) as Record<string, unknown>;

    expect(typeof result.baseUrl).toBe('string');
    expect((result.baseUrl as string).includes(':8765')).toBe(true);
  });

  it('localIPs is an array', async () => {
    const ctx = {} as Parameters<typeof handler>[1];
    const result = (await handler({}, ctx)) as Record<string, unknown>;

    expect(Array.isArray(result.localIPs)).toBe(true);
  });

  it('namespace is system', () => {
    expect(systemMethods.namespace).toBe('system');
  });
});
