/**
 * 流式消费者模块
 *
 * 消费者架构：
 * ┌──────────────────────────────────────┐
 * │         EventBus（中心）              │
 * │    stream:message 事件               │
 * └──────────────────────────────────────┘
 *              ↓
 *    ┌─────────┼─────────┐
 *    ↓         ↓         ↓
 * Consumer1  Consumer2  Consumer3
 * (持久化)   (推送)     (监控)
 */

export { StreamStore, streamStore } from './StreamStore'
export {
  WebSocketBroadcaster,
  webSocketBroadcaster,
  type ClientMessage,
  type ServerMessage
} from './WebSocketBroadcaster'
export { StreamMonitor, streamMonitor, type SessionStats } from './StreamMonitor'
