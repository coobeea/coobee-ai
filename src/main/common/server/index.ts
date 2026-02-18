import { log } from '@main/common/logger';
import { HttpServer } from './httpServer';

/**
 * 初始化服务器基础设施
 *
 * 创建 HttpServer 单例（统一端口，HTTP + WebSocket 共享）。
 * 必须在 Gateway 之前执行，因为 GatewayServer 需要挂载到 http.Server 上。
 */
export function initializeServerModules(): void {
  log.info('[ServerCore] Initializing HttpServer...');
  try {
    new HttpServer();
    log.info('[ServerCore] HttpServer initialized successfully.');
  } catch (error) {
    log.error('[ServerCore] Failed to initialize HttpServer:', error);
  }
}

export { HttpServer } from './httpServer';
