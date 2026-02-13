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
 *
 * 注：WebSocket 推送已迁移至 WsHub + StreamChannel（src/main/channels/StreamChannel.ts）
 */

export { StreamStore, streamStore } from './StreamStore'
export { StreamMonitor, streamMonitor, type SessionStats } from './StreamMonitor'
