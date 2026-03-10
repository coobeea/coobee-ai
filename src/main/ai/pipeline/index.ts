/**
 * 消息管线统一入口
 */
export { MessagePipeline } from './MessagePipeline';
export { SessionQueue } from './SessionQueue';
export { AbortManager } from './AbortManager';
export { drainFollowup, drainCollect, buildCollectPrompt } from './DrainStrategy';
export type {
  QueueMode,
  QueueSettings,
  QueueStatus,
  PendingMessage,
  SessionPipelineState,
  SubmitOptions,
  SubmitResult
} from './types';
export { DEFAULT_QUEUE_SETTINGS } from './types';
