/**
 * Agent 流式事件类型重导出
 *
 * WebSocket 连接管理已移至 plugins/wsSetup.ts（单例服务）。
 * 此文件仅保留类型重导出，供需要流式类型的模块使用。
 */

export type {
  StreamMessage,
  StreamMessageType,
  StreamSource,
  ConnectionState
} from '@shared/stream-protocol'
