/**
 * HttpServer 初始化 Hook
 *
 * 创建 HttpServer 单例，使 GatewayServer 可以挂载 WebSocket 和 HTTP 路由。
 *
 * 执行顺序：
 *   ReadyApiRegistrationHook (35) → ReadyGatewayHook (45) → 窗口创建 (400)
 */

import { LifecyclePhase, LifecycleContext, LifecycleHook } from '@main/common/types';
import { log } from '@main/common/logger';

export const ReadyApiRegistrationHook: LifecycleHook = {
  name: 'ready-api-registration',
  phase: LifecyclePhase.READY,
  priority: 35,
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyApiRegistrationHook] Initializing server modules (HttpServer + IpcServer)...');

    try {
      const { initializeServerModules } = await import('@main/common/server');
      initializeServerModules();
      log.info('[ReadyApiRegistrationHook] Server modules initialized successfully');
    } catch (error) {
      log.error('[ReadyApiRegistrationHook] Failed to initialize server modules:', error);
    }
  }
};
