/**
 * Worker Store
 *
 * Worker 领域的唯一入口：状态管理 + WebSocket 交互。
 * 内部通过 useWorkerWs 注册 WebSocket 事件，外部只需使用本 Store。
 *
 * 数据来源：WebSocket 推送的 worker:status / worker:list 事件
 * 消费方：VoicePanel 等组件读取状态、调用 start/stop 操作
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  onWorkerStatus,
  startWorker as wsStartWorker,
  stopWorker as wsStopWorker,
  requestWorkers as wsRequestWorkers
} from '@/composables/useWorkerWs';
import type { WorkerStatusInfo } from '@shared/stream-protocol';

export const useWorkerStore = defineStore('worker', () => {
  // ---- 状态 ----

  /** 所有 Worker 的状态（按 name 索引） */
  const workers = ref<Map<string, WorkerStatusInfo>>(new Map());

  // ---- WebSocket 事件自动注册 ----

  /**
   * 注册 Worker 状态监听
   *
   * Store 初始化时自动注册，Worker 状态变更时直接写入 workers Map。
   * 不需要外部手动桥接。
   */
  onWorkerStatus((info) => {
    workers.value.set(info.name, info);
    console.log(
      `[workerStore] ${info.name} → ${info.status}` +
        (info.port ? ` (port: ${info.port})` : '') +
        (info.error ? ` [${info.error}]` : '')
    );
  });

  // ---- Getters ----

  /** 所有 Worker 列表 */
  const workerList = computed(() => Array.from(workers.value.values()));

  /** 获取指定 Worker */
  function getWorker(name: string): WorkerStatusInfo | undefined {
    return workers.value.get(name);
  }

  /** 指定 Worker 是否就绪 */
  function isReady(name: string): boolean {
    return workers.value.get(name)?.status === 'ready';
  }

  /** TTS 是否可用 */
  const ttsReady = computed(() => isReady('tts'));

  /** ASR 是否可用 */
  const asrReady = computed(() => isReady('asr'));

  /** TTS 端口 */
  const ttsPort = computed(() => workers.value.get('tts')?.port);

  /** ASR 端口 */
  const asrPort = computed(() => workers.value.get('asr')?.port);

  /** ASR Worker 名称 */
  const asrWorkerName = computed(() => 'asr');

  /** ASR Worker 类型（WebSocket） */
  const asrWorkerType = computed(() => 'websocket' as const);

  // ---- Actions ----

  /** 启动指定 Worker */
  function startWorker(name: string): void {
    wsStartWorker(name);
  }

  /** 停止指定 Worker */
  function stopWorker(name: string): void {
    wsStopWorker(name);
  }

  /** 主动请求 Worker 状态列表 */
  function requestWorkers(): void {
    wsRequestWorkers();
  }

  return {
    // 状态
    workers,
    workerList,
    ttsReady,
    asrReady,
    ttsPort,
    asrPort,
    asrWorkerName,
    asrWorkerType,

    // 查询
    getWorker,
    isReady,

    // 操作
    startWorker,
    stopWorker,
    requestWorkers
  };
});
