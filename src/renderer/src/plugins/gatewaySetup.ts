/**
 * Gateway 初始化插件
 *
 * 创建全局 GatewayClient 单例，在应用启动时建立连接。
 * 替代旧的 wsSetup 插件。
 *
 * 使用方式：
 *   import { gateway } from '@/plugins/gatewaySetup'
 *   const result = await gateway.request('worker.list')
 *   gateway.on('stream.message', (payload) => { ... })
 */

import type { App } from 'vue'
import configManager from '@/config'
import { GatewayClient } from '@/services/GatewayClient'

// ==================== 全局单例 ====================

/**
 * Gateway 客户端单例
 *
 * 全局可用，业务模块通过 import { gateway } from '@/plugins/gatewaySetup' 访问。
 */
export const gateway = new GatewayClient(configManager.getGatewayWsUrl())

// ==================== Vue Plugin ====================

let isInitialized = false

export default {
  install(_app: App): void {
    if (isInitialized) {
      console.warn('[gatewaySetup] Already initialized')
      return
    }

    gateway.connect()
    isInitialized = true
    console.log('[gatewaySetup] Gateway connection initiated')
  }
}
