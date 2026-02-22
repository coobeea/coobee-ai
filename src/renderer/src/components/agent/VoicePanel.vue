<script setup lang="ts">
/**
 * VoicePanel — 实时语音交互面板
 *
 * 功能：
 *   1. 展示 Worker 状态（asr / tts）
 *   2. ASR Worker ready 后自动开始麦克风监听
 *   3. Web Audio API 采集 Float32 PCM → 降采样 16kHz → Int16 LE → WebSocket 直传
 *   4. 服务端 VAD 检测停顿触发识别，保证句子完整性
 *   5. 提供"静音/取消静音"切换
 *
 * 性能优化：
 *   - 消除 ffmpeg 转码开销（~200ms 延迟）
 *   - 带抗混叠的降采样（防止高频失真）
 *   - VAD 智能触发（完整句子识别）
 */

import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { useWorkerStore } from '@/stores/worker';
import { useChatStore } from '@/stores/chat';

const workerStore = useWorkerStore();
const chatStore = useChatStore();

// ---- 初始化 ----

onMounted(() => {
  workerStore.requestWorkers();
});

onUnmounted(() => {
  stopListening();
  disconnectTTS();
});

// ---- ASR 状态 ----

const asrConnected = ref(false);
const isListening = ref(false);
const isMuted = ref(false);
const partialText = ref('');
const micError = ref('');

let audioStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: ScriptProcessorNode | null = null;
let pcmBuffer: Float32Array[] = [];
let sendTimer: ReturnType<typeof setInterval> | null = null;
const asrWs = ref<WebSocket | null>(null);

/** ASR Worker ready → 自动开始监听 */
watch(
  () => workerStore.asrReady,
  (ready) => {
    if (ready && workerStore.asrPort) {
      startASR(workerStore.asrPort);
    } else if (!ready) {
      stopListening();
    }
  },
  { immediate: true }
);

// ==================== ASR 启动/停止 ====================

function startASR(port: number): void {
  if (isListening.value) return;
  console.log(`[VoicePanel] ASR 启动: port=${port}`);
  connectASRWebSocket(port);
}

// ==================== 音频处理工具 ====================

/**
 * 带抗混叠的降采样（48kHz → 16kHz）
 *
 * 关键：先低通滤波再抽取，防止高频混叠失真
 */
function downsample(samples: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return samples;

  const ratio = inputRate / outputRate;
  const intRatio = Math.round(ratio);

  // 整数比率：均值抽取（最佳质量，如 48000/16000=3）
  if (Math.abs(ratio - intRatio) < 0.01 && intRatio >= 2) {
    const newLen = Math.floor(samples.length / intRatio);
    const result = new Float32Array(newLen);

    for (let i = 0; i < newLen; i++) {
      let sum = 0;
      const base = i * intRatio;
      for (let j = 0; j < intRatio; j++) {
        sum += samples[base + j];
      }
      result[i] = sum / intRatio; // 低通滤波
    }
    return result;
  }

  // 非整数比率：移动平均滤波 + 线性插值
  const windowHalf = Math.ceil(ratio / 2);
  const newLen = Math.round(samples.length / ratio);
  const result = new Float32Array(newLen);

  for (let i = 0; i < newLen; i++) {
    const center = i * ratio;
    const lo = Math.max(0, Math.floor(center) - windowHalf);
    const hi = Math.min(samples.length - 1, Math.floor(center) + windowHalf);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += samples[j];
    result[i] = sum / (hi - lo + 1);
  }
  return result;
}

/**
 * Float32 [-1, 1] → Int16 LE ArrayBuffer
 */
function float32ToInt16(float32: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);

  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    const sample = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(i * 2, sample, true); // little-endian
  }

  return buf;
}

/**
 * 发送累积的 PCM 缓冲
 */
function sendPcmBuffer(): void {
  if (!asrWs.value || asrWs.value.readyState !== WebSocket.OPEN) return;
  if (pcmBuffer.length === 0) return;

  // 合并所有累积的样本
  let totalLen = 0;
  for (const chunk of pcmBuffer) totalLen += chunk.length;
  const merged = new Float32Array(totalLen);
  let offset = 0;
  for (const chunk of pcmBuffer) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  pcmBuffer = [];

  if (!audioContext) return;

  // 降采样到 16kHz
  const downsampled = downsample(merged, audioContext.sampleRate, 16000);

  // 转 Int16 LE
  const int16buf = float32ToInt16(downsampled);

  // 发送
  asrWs.value.send(int16buf);
}

// ==================== WebSocket 连接 ====================

function connectASRWebSocket(port: number): void {
  if (asrWs.value) return;

  const url = `ws://127.0.0.1:${port}/ws/asr`;
  console.log(`[VoicePanel] 连接 ASR WebSocket: ${url}`);

  const ws = new WebSocket(url);

  ws.onopen = () => {
    asrConnected.value = true;
    micError.value = '';
    startListening();
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data as string);
      if (data.partial) partialText.value = data.partial;
      if (data.final) {
        partialText.value = '';
        if (data.final.trim()) chatStore.sendMessage(data.final.trim());
      }
    } catch {
      /* ignore */
    }
  };

  ws.onclose = () => {
    asrConnected.value = false;
    asrWs.value = null;
    stopListening();
  };

  ws.onerror = () => console.warn('[VoicePanel] ASR WebSocket 错误');

  asrWs.value = ws;
}

// ==================== 麦克风管理 ====================

async function startListening(): Promise<void> {
  if (isListening.value) return;

  try {
    // 枚举设备，诊断可用性
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === 'audioinput');
    console.log(
      `[VoicePanel] 可用音频输入设备: ${audioInputs.length}`,
      audioInputs.map((d) => `${d.label || '未知设备'} (${d.deviceId.slice(0, 8)})`)
    );

    if (audioInputs.length === 0) {
      micError.value = '未检测到麦克风，请连接麦克风后重试';
      console.warn('[VoicePanel] 无音频输入设备');
      return;
    }

    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    });

    // 使用 Web Audio API 采集 PCM
    // 不指定 sampleRate: 16000，让浏览器使用默认采样率（通常 48kHz）
    // 在 JS 中做降采样质量更可控
    audioContext = new AudioContext();
    const actualRate = audioContext.sampleRate;
    console.log(
      `[VoicePanel] AudioContext: ${actualRate} Hz → 降采样到 16000 Hz (比率 ${(actualRate / 16000).toFixed(1)}:1)`
    );

    sourceNode = audioContext.createMediaStreamSource(audioStream);

    // ScriptProcessorNode: bufferSize=4096
    // 48kHz 时每次约 85ms
    processorNode = audioContext.createScriptProcessor(4096, 1, 1);

    processorNode.onaudioprocess = (event) => {
      if (isMuted.value) {
        // 清零输出防止回放
        event.outputBuffer.getChannelData(0).fill(0);
        return;
      }

      const samples = event.inputBuffer.getChannelData(0); // Float32
      pcmBuffer.push(new Float32Array(samples));

      // 清零输出防止回放
      event.outputBuffer.getChannelData(0).fill(0);
    };

    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination); // 必须连接才能触发

    // 每 250ms 发送一次
    sendTimer = setInterval(sendPcmBuffer, 250);

    isListening.value = true;
    isMuted.value = false;
    micError.value = '';

    console.log('[VoicePanel] 麦克风监听已启动 (PCM 直传模式)');
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[VoicePanel] 获取麦克风失败:', errMsg);
    micError.value =
      errMsg.includes('denied') || errMsg.includes('NotAllowed')
        ? '麦克风权限被拒绝，请在系统设置中允许'
        : `麦克风不可用: ${errMsg}`;
  }
}

function stopListening(): void {
  // 停止定时发送
  if (sendTimer) {
    clearInterval(sendTimer);
    sendTimer = null;
  }

  // 发送剩余缓冲
  sendPcmBuffer();

  // 停止 AudioContext
  if (processorNode) {
    processorNode.disconnect();
    processorNode = null;
  }
  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }

  // 释放麦克风
  if (audioStream) {
    audioStream.getTracks().forEach((t) => t.stop());
    audioStream = null;
  }

  // 关闭 WebSocket
  if (asrWs.value) {
    asrWs.value.close();
    asrWs.value = null;
  }

  isListening.value = false;
  asrConnected.value = false;
  partialText.value = '';
  pcmBuffer = [];
}

/** 静音/取消静音切换 */
function toggleMute(): void {
  isMuted.value = !isMuted.value;
  if (isMuted.value) {
    partialText.value = '';
  }
  console.log(`[VoicePanel] ${isMuted.value ? '已静音' : '取消静音'}`);
}

// ---- TTS WebSocket ----

const ttsWs = ref<WebSocket | null>(null);
const ttsConnected = ref(false);
const isSpeaking = ref(false);

watch(
  () => workerStore.ttsReady,
  (ready) => {
    if (ready && workerStore.ttsPort) {
      connectTTS(workerStore.ttsPort);
    } else if (!ready) {
      disconnectTTS();
    }
  },
  { immediate: true }
);

function connectTTS(port: number): void {
  if (ttsWs.value) return;
  const url = `ws://127.0.0.1:${port}/ws/tts`;
  const ws = new WebSocket(url);
  ws.onopen = () => {
    ttsConnected.value = true;
  };
  ws.onclose = () => {
    ttsConnected.value = false;
    ttsWs.value = null;
  };
  ws.onerror = () => console.warn('[VoicePanel] TTS 连接错误');
  ttsWs.value = ws;
}

function disconnectTTS(): void {
  if (ttsWs.value) {
    ttsWs.value.close();
    ttsWs.value = null;
  }
  ttsConnected.value = false;
  isSpeaking.value = false;
}

// ---- 状态指示 ----

const voiceEnabled = computed(() => workerStore.asrReady || workerStore.ttsReady);

/** ASR Worker 信息（兼容 whisper-asr / asr） */
const asrWorker = computed(() => workerStore.getWorker('whisper-asr') ?? workerStore.getWorker('asr'));

function getStatusColor(status: string): string {
  switch (status) {
    case 'ready':
      return 'bg-emerald-500';
    case 'starting':
    case 'initializing':
      return 'bg-amber-400';
    case 'error':
      return 'bg-red-400';
    default:
      return 'bg-gray-300';
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'stopped':
      return '未启动';
    case 'initializing':
      return '初始化中...';
    case 'starting':
      return '启动中...';
    case 'ready':
      return '就绪';
    case 'error':
      return '错误';
    case 'stopping':
      return '停止中...';
    default:
      return status;
  }
}
</script>

<template>
  <div class="flex shrink-0 items-center gap-2 border-t border-gray-200/60 bg-white/80 px-4 py-2">
    <!-- Worker 状态指示器 -->
    <div class="flex items-center gap-3">
      <!-- ASR 状态（兼容 whisper-asr / asr） -->
      <div v-if="asrWorker" class="flex items-center gap-1.5" :title="`ASR: ${getStatusLabel(asrWorker.status)}`">
        <span class="i-carbon-microphone inline-block h-3.5 w-3.5 text-gray-500"></span>
        <span class="inline-block h-1.5 w-1.5 rounded-full" :class="getStatusColor(asrWorker.status)"></span>
        <span class="text-[10px] text-gray-400">
          {{ getStatusLabel(asrWorker.status) }}
        </span>
      </div>

      <!-- TTS 状态 -->
      <div
        v-if="workerStore.getWorker('tts')"
        class="flex items-center gap-1.5"
        :title="`TTS: ${getStatusLabel(workerStore.getWorker('tts')!.status)}`">
        <span class="i-carbon-volume-up inline-block h-3.5 w-3.5 text-gray-500"></span>
        <span
          class="inline-block h-1.5 w-1.5 rounded-full"
          :class="getStatusColor(workerStore.getWorker('tts')!.status)"></span>
        <span class="text-[10px] text-gray-400">
          {{ getStatusLabel(workerStore.getWorker('tts')!.status) }}
        </span>
      </div>

      <!-- 启动/停止按钮 -->
      <template v-for="w in workerStore.workerList" :key="w.name + '-action'">
        <button
          v-if="w.status === 'stopped' || w.status === 'error'"
          class="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary transition hover:bg-primary/20"
          @click="workerStore.startWorker(w.name)">
          启动{{ w.label }}
        </button>
        <button
          v-else-if="w.status === 'ready'"
          class="rounded bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 transition hover:bg-red-50 hover:text-red-500"
          @click="workerStore.stopWorker(w.name)">
          停止{{ w.label }}
        </button>
      </template>

      <!-- 无 Worker -->
      <div v-if="workerStore.workerList.length === 0" class="flex items-center gap-1 text-[10px] text-gray-400">
        <span class="i-carbon-microphone-off inline-block h-3.5 w-3.5"></span>
        <span>语音未启用</span>
      </div>
    </div>

    <!-- 分隔线 -->
    <div v-if="voiceEnabled" class="h-4 w-px bg-gray-200"></div>

    <!-- 监听状态 + 静音切换 -->
    <template v-if="isListening">
      <div class="flex items-center gap-1.5">
        <span v-if="!isMuted" class="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500"></span>
        <span class="text-[10px]" :class="isMuted ? 'text-gray-400' : 'text-emerald-600'">
          {{ isMuted ? '已静音' : '正在聆听...' }}
        </span>
      </div>

      <button
        class="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium transition"
        :class="isMuted ? 'bg-gray-100 text-gray-500 hover:bg-gray-200' : 'bg-red-50 text-red-500 hover:bg-red-100'"
        :title="isMuted ? '取消静音' : '静音'"
        @click="toggleMute">
        <span
          class="inline-block h-3.5 w-3.5"
          :class="isMuted ? 'i-carbon-microphone-off' : 'i-carbon-microphone-filled'"></span>
        {{ isMuted ? '取消静音' : '静音' }}
      </button>
    </template>

    <!-- 麦克风错误提示 -->
    <div v-if="micError" class="flex items-center gap-1 text-[10px] text-red-500">
      <span class="i-carbon-warning inline-block h-3 w-3"></span>
      <span>{{ micError }}</span>
    </div>

    <!-- 实时识别文字 -->
    <div
      v-if="partialText"
      class="min-w-0 flex-1 truncate rounded bg-blue-50 px-2 py-0.5 font-mono text-[10px] text-blue-600">
      {{ partialText }}
    </div>

    <!-- TTS 播放状态 -->
    <div v-if="isSpeaking" class="flex items-center gap-1 text-[10px] text-violet-500">
      <span class="i-carbon-volume-up-filled inline-block h-3 w-3 animate-pulse"></span>
      <span>播放中</span>
    </div>
  </div>
</template>
