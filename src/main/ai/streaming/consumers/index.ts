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
 * 注：WebSocket 推送由 Gateway 事件桥接处理（src/main/gateway/events/StreamBridge.ts）
 */

export { StreamStore, streamStore } from './StreamStore'
export { StreamMonitor, streamMonitor, type SessionStats } from './StreamMonitor'
