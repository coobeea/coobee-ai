/**
 * Streaming Hook
 *
 * 初始化流式事件消费者（WebSocketBroadcaster）
 * 在 IPC 注册之前执行，确保流式管道就绪
 */

import { LifecyclePhase, LifecycleContext, LifecycleHook } from '@main/common/types'
import { log } from '@main/common/logger'

/**
 * Streaming Hook
 *
 * 在 READY 阶段初始化流式消费者
 * 命名规范：导出变量名必须以 'Hook' 结尾以便自动扫描
 */
export const ReadyStreamingHook: LifecycleHook = {
  name: 'ready-streaming',
  phase: LifecyclePhase.READY,
  priority: 45, // 在 IPC 注册(50) 之前初始化
  critical: false, // 流式服务失败不应阻断启动

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyStreamingHook] Initializing streaming consumers...')

    try {
      // 动态导入以避免循环依赖
      const { webSocketBroadcaster } =
        await import('@main/ai/streaming/consumers/WebSocketBroadcaster')

      // 初始化 WebSocket 广播器
      const port = 8765
      webSocketBroadcaster.initialize(port)

      log.info(`[ReadyStreamingHook] WebSocketBroadcaster initialized on port ${port}`)
    } catch (error) {
      log.error('[ReadyStreamingHook] Failed to initialize streaming consumers:', error)
      // 不抛出错误，流式服务失败不应阻断启动
    }
  }
}
