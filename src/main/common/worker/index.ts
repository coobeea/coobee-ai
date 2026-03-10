/**
 * Worker 模块统一导出
 *
 * 管理 Worker 子进程（whisper-asr、tts 等）的生命周期。
 */

export { WorkerManager } from './WorkerManager';
export type { WorkerConfig, WorkerInfo, WorkerStatus, WorkerStatusEvent, WorkerLogEvent } from './types';
