/**
 * Gateway System 方法组
 *
 * 方法：
 *   system.networkInfo — 获取局域网地址及端口 + 二维码 DataURL，用于手机扫码访问
 */

import os from 'node:os';

import QRCode from 'qrcode';

import { Env } from '@main/common/env';
import { log } from '@main/common/logger';
import type { MethodGroup } from '../protocol';

function getLocalIPs(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces || {})) {
    for (const iface of interfaces![name] || []) {
      if (!iface.internal && iface.family === 'IPv4') {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

export const systemMethods: MethodGroup = {
  namespace: 'system',
  methods: {
    networkInfo: async () => {
      const port = Env.main.serverPort ? parseInt(Env.main.serverPort, 10) : 8765;
      const host = Env.main.serverHost || '127.0.0.1';
      const ips = getLocalIPs();
      const primaryIP = ips[0] || '127.0.0.1';
      const isLanEnabled = host === '0.0.0.0' || host !== '127.0.0.1';
      const baseUrl = isLanEnabled ? `http://${primaryIP}:${port}` : `http://127.0.0.1:${port}`;

      let qrDataUrl = '';
      try {
        qrDataUrl = await QRCode.toDataURL(baseUrl, {
          width: 256,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' }
        });
      } catch (err) {
        log.warn('[system.networkInfo] QR code generation failed:', err);
      }

      return {
        host,
        port,
        localIPs: ips,
        primaryIP,
        isLanEnabled,
        baseUrl,
        qrDataUrl
      };
    }
  }
};
