/**
 * 流式输出模块
 *
 * 架构：生产者 → EventBus → 消费者们
 *
 * 生产者：
 * - StreamEmitter (IStreamEmitter 接口)
 *
 * 消费者：
 * - StreamStore (持久化到数据库)
 * - StreamChannel (WebSocket 推送，已迁移至 src/main/channels/StreamChannel.ts)
 * - StreamMonitor (监控统计)
 */

// ========== 类型定义 ==========
export * from './types'

// ========== 生产者（发射器）==========
export { type IStreamEmitter, StreamEmitter, createStreamEmitter } from './StreamEmitter'

// ========== 消费者 ==========
export {
  // 持久化消费者
  StreamStore,
  streamStore,
  // 监控消费者
  StreamMonitor,
  streamMonitor,
  type SessionStats
} from './consumers'
