/**
 * Worker Store
 *
 * 管理所有 Worker 的运行状态。
 * 数据来源：WebSocket 推送的 worker_status 事件。
 * 消费方：VoicePanel 等组件根据 Worker 状态决定是否连接。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { WorkerStatusInfo } from '@shared/stream-protocol'

export const useWorkerStore = defineStore('worker', () => {
  // ---- 状态 ----

  /** 所有 Worker 的状态（按 name 索引） */
  const workers = ref<Map<string, WorkerStatusInfo>>(new Map())

  // ---- Getters ----

  /** 所有 Worker 列表 */
  const workerList = computed(() => Array.from(workers.value.values()))

  /** 获取指定 Worker */
  function getWorker(name: string): WorkerStatusInfo | undefined {
    return workers.value.get(name)
  }

  /** 指定 Worker 是否就绪 */
  function isReady(name: string): boolean {
    return workers.value.get(name)?.status === 'ready'
  }

  /** TTS 是否可用 */
  const ttsReady = computed(() => isReady('tts'))

  /** ASR 是否可用（兼容 asr / whisper-asr） */
  const asrReady = computed(() => isReady('whisper-asr') || isReady('asr'))

  /** TTS 端口 */
  const ttsPort = computed(() => workers.value.get('tts')?.port)

  /** ASR 端口（兼容 whisper-asr / asr） */
  const asrPort = computed(
    () => workers.value.get('whisper-asr')?.port ?? workers.value.get('asr')?.port
  )

  /** ASR Worker 名称（优先 whisper-asr） */
  const asrWorkerName = computed(() => (workers.value.has('whisper-asr') ? 'whisper-asr' : 'asr'))

  /** ASR Worker 类型（native = whisper-server HTTP, python = WebSocket） */
  const asrWorkerType = computed(() => {
    const name = asrWorkerName.value
    // whisper-asr 使用 HTTP POST，旧 asr 使用 WebSocket
    return name === 'whisper-asr' ? 'http' : 'websocket'
  })

  // ---- Actions ----

  /**
   * 处理 Worker 状态更新（由 wsSetup 调用）
   */
  function handleWorkerStatus(info: WorkerStatusInfo): void {
    workers.value.set(info.name, info)
    console.log(
      `[workerStore] ${info.name} → ${info.status}` +
        (info.port ? ` (port: ${info.port})` : '') +
        (info.error ? ` [${info.error}]` : '')
    )
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

    // 方法
    getWorker,
    isReady,
    handleWorkerStatus
  }
})
