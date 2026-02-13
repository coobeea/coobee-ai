<script setup lang="ts">
/**
 * VoicePanel — 语音交互面板
 *
 * 功能：
 *   1. 展示 Worker 状态（支持 whisper-asr / asr / tts）
 *   2. ASR Worker ready 后自动开始麦克风监听
 *   3. 麦克风录音 → 定时发送给 ASR 识别 → 实时显示文字
 *   4. 支持两种 ASR 模式：
 *      - HTTP（whisper-server）：AudioContext 采集 PCM → 转 WAV → POST /inference
 *      - WebSocket（旧 FunASR）：MediaRecorder 流式发送 webm chunks
 *   5. 提供"静音/取消静音"切换
 */

import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { useWorkerStore } from '@/stores/worker'
import { useChatStore } from '@/stores/chat'

const workerStore = useWorkerStore()
const chatStore = useChatStore()

// ---- 初始化 ----

onMounted(() => {
  workerStore.requestWorkers()
})

onUnmounted(() => {
  stopListening()
  disconnectTTS()
})

// ---- ASR 状态 ----

const asrConnected = ref(false)
const isListening = ref(false)
const isMuted = ref(false)
const partialText = ref('')
const micError = ref('')

let audioStream: MediaStream | null = null

// HTTP 模式状态（whisper-server — PCM 直采）
let audioContext: AudioContext | null = null
let sourceNode: MediaStreamAudioSourceNode | null = null
let processorNode: ScriptProcessorNode | null = null
let recognitionTimer: ReturnType<typeof setInterval> | null = null
let pcmChunks: Float32Array[] = []
let isRecognizing = false
let committedText = ''

// WebSocket 模式状态（旧 FunASR 兼容）
let mediaRecorder: MediaRecorder | null = null
const asrWs = ref<WebSocket | null>(null)

/** 连续静音计数，超过一定次数清空已有文本 */
let silenceCount = 0
const SILENCE_CLEAR_COUNT = 4 // 连续 4 次（~6 秒）静音后清空显示

/** ASR Worker ready → 自动开始监听 */
watch(
  () => workerStore.asrReady,
  (ready) => {
    if (ready && workerStore.asrPort) {
      startASR(workerStore.asrPort)
    } else if (!ready) {
      stopListening()
    }
  },
  { immediate: true }
)

// ==================== ASR 启动/停止 ====================

function startASR(port: number): void {
  if (isListening.value) return

  const mode = workerStore.asrWorkerType
  console.log(`[VoicePanel] ASR 启动: mode=${mode}, port=${port}`)

  if (mode === 'http') {
    // whisper-server: 直接开始录音，定时 HTTP 发送
    asrConnected.value = true
    startListening()
  } else {
    // 旧 WebSocket 模式
    connectASRWebSocket(port)
  }
}

// ==================== PCM → WAV 工具 ====================

/** 合并多个 Float32Array 为一个 */
function mergeFloat32Arrays(arrays: Float32Array[]): Float32Array {
  let total = 0
  for (const a of arrays) total += a.length
  const result = new Float32Array(total)
  let offset = 0
  for (const a of arrays) {
    result.set(a, offset)
    offset += a.length
  }
  return result
}

/** 将 PCM Float32 采样转为 16-bit WAV Blob */
function createWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const numSamples = samples.length
  const buffer = new ArrayBuffer(44 + numSamples * 2)
  const view = new DataView(buffer)

  // RIFF header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + numSamples * 2, true)
  writeString(view, 8, 'WAVE')

  // fmt chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample

  // data chunk
  writeString(view, 36, 'data')
  view.setUint32(40, numSamples * 2, true)

  // PCM samples (clamp to [-1, 1] → Int16)
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

// ==================== 音频分析工具 ====================

/** 计算 PCM 数据的 RMS 能量值（0 ~ 1） */
function calcRMS(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i]
  }
  return Math.sqrt(sum / samples.length)
}

/**
 * 静音检测阈值
 * - 典型安静环境 RMS ≈ 0.001 ~ 0.005
 * - 正常说话 RMS ≈ 0.02 ~ 0.15
 * - 阈值 0.008 可以过滤绝大多数环境噪声
 */
const SILENCE_RMS_THRESHOLD = 0.008

/**
 * Whisper 常见幻觉模式（静音时模型虚构的文字）
 * 这些模式在多个 Whisper 模型版本中反复出现
 */
const HALLUCINATION_PATTERNS = [
  /字幕/i,
  /subtitle/i,
  /caption/i,
  /^\.+$/,
  /谢谢观看/,
  /谢谢收看/,
  /请订阅/,
  /感谢观看/,
  /感谢收听/,
  /下期再见/,
  /订阅/,
  /点赞/,
  /关注/,
  /^music$/i,
  /^\(.*\)$/, // 纯括号注释如 (Music)、(字幕:...)
  /^【.*】$/, // 纯方括号注释
  /^[♪♫\u{1F3B5}\u{1F3B6}\s]+$/u, // 纯音乐符号
  /you\b/i, // 英文幻觉
  /thank/i,
  /^the\b/i,
  /^\s*\.{2,}\s*$/ // 省略号
]

/** 检查文本是否为 Whisper 幻觉 */
function isHallucination(text: string): boolean {
  const t = text.trim()
  if (t.length === 0) return true
  // 纯标点或空白
  if (/^[\s.,。，、！？!?…\-\n()（）【】[\]""'']+$/.test(t)) return true
  // 匹配已知幻觉模式
  return HALLUCINATION_PATTERNS.some((p) => p.test(t))
}

// ==================== HTTP 模式（whisper-server） ====================

/**
 * 将累积的 PCM 数据转为 WAV 发送给 whisper-server 的 /inference 接口。
 * 每 ~1.5 秒调用一次。
 *
 * 关键优化：
 *   1. 先做 RMS 能量检测，静音不发送 → 避免 Whisper 幻觉
 *   2. 识别结果过滤已知幻觉模式
 *   3. 连续静音自动清空已显示文本
 */
async function sendToWhisper(): Promise<void> {
  if (isRecognizing || pcmChunks.length === 0 || isMuted.value) return

  const port = workerStore.asrPort
  if (!port) return

  isRecognizing = true

  // 取出当前累积的 PCM chunks
  const chunks = [...pcmChunks]
  pcmChunks = []

  try {
    const samples = mergeFloat32Arrays(chunks)

    // 样本太少跳过（< 0.3 秒）
    if (samples.length < 4800) {
      isRecognizing = false
      return
    }

    // ---- 核心：RMS 静音检测 ----
    const rms = calcRMS(samples)
    if (rms < SILENCE_RMS_THRESHOLD) {
      // 静音，不发送请求
      silenceCount++
      if (silenceCount >= SILENCE_CLEAR_COUNT && committedText) {
        // 连续静音较久，清空已显示的识别文本
        console.log('[VoicePanel] 连续静音，清空识别文本')
        committedText = ''
        partialText.value = ''
      }
      isRecognizing = false
      return
    }

    // 有声音，重置静音计数
    silenceCount = 0

    const wavBlob = createWavBlob(samples, 16000)

    const formData = new FormData()
    formData.append('file', wavBlob, 'audio.wav')
    formData.append('response_format', 'json')
    formData.append('language', 'zh')

    const resp = await fetch(`http://127.0.0.1:${port}/inference`, {
      method: 'POST',
      body: formData
    })

    if (resp.ok) {
      const data = await resp.json()
      const rawText = (data.text || '').trim()

      if (rawText) {
        // 清理方括号/括号注释
        const cleaned = rawText
          .replace(/^\[.*?\]\s*/g, '')
          .replace(/^\(.*?\)\s*/g, '')
          .replace(/^【.*?】\s*/g, '')
          .trim()

        if (cleaned && cleaned.length > 1 && !isHallucination(cleaned)) {
          committedText = committedText ? committedText + ' ' + cleaned : cleaned
          partialText.value = committedText
          console.log(`[VoicePanel] 识别: ${cleaned} (rms=${rms.toFixed(4)})`)
        } else if (cleaned) {
          console.log(`[VoicePanel] 过滤幻觉: "${cleaned}" (rms=${rms.toFixed(4)})`)
        }
      }
    } else {
      console.warn(`[VoicePanel] whisper 返回错误: ${resp.status}`)
    }
  } catch (err) {
    console.warn('[VoicePanel] whisper 请求失败:', err)
  } finally {
    isRecognizing = false
  }
}

// ==================== WebSocket 模式（旧 FunASR 兼容） ====================

function connectASRWebSocket(port: number): void {
  if (asrWs.value) return

  const url = `ws://127.0.0.1:${port}/ws/asr`
  console.log(`[VoicePanel] 连接 ASR WebSocket: ${url}`)

  const ws = new WebSocket(url)

  ws.onopen = () => {
    asrConnected.value = true
    micError.value = ''
    startListening()
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data as string)
      if (data.partial) partialText.value = data.partial
      if (data.final) {
        partialText.value = ''
        if (data.final.trim()) chatStore.sendMessage(data.final.trim())
      }
    } catch {
      /* ignore */
    }
  }

  ws.onclose = () => {
    asrConnected.value = false
    asrWs.value = null
    stopListening()
  }

  ws.onerror = () => console.warn('[VoicePanel] ASR WebSocket 错误')

  asrWs.value = ws
}

// ==================== 麦克风管理 ====================

async function startListening(): Promise<void> {
  if (isListening.value) return

  const mode = workerStore.asrWorkerType

  try {
    // 枚举设备，诊断可用性
    const devices = await navigator.mediaDevices.enumerateDevices()
    const audioInputs = devices.filter((d) => d.kind === 'audioinput')
    console.log(
      `[VoicePanel] 可用音频输入设备: ${audioInputs.length}`,
      audioInputs.map((d) => `${d.label || '未知设备'} (${d.deviceId.slice(0, 8)})`)
    )

    if (audioInputs.length === 0) {
      micError.value = '未检测到麦克风，请连接麦克风后重试'
      console.warn('[VoicePanel] 无音频输入设备')
      return
    }

    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true })

    if (mode === 'http') {
      // ---- HTTP 模式：使用 AudioContext 直接采集 PCM ----
      audioContext = new AudioContext({ sampleRate: 16000 })
      // 确保 AudioContext 处于 running 状态（Chromium 自动播放策略可能使其 suspended）
      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }
      sourceNode = audioContext.createMediaStreamSource(audioStream)

      // ScriptProcessorNode: bufferSize=4096, 1 input channel, 1 output channel
      processorNode = audioContext.createScriptProcessor(4096, 1, 1)

      processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
        // 清零输出，防止麦克风声音回放到扬声器
        const output = event.outputBuffer.getChannelData(0)
        output.fill(0)

        if (isMuted.value) return
        // 复制一份 PCM 数据（原 buffer 会被复用）
        const inputData = event.inputBuffer.getChannelData(0)
        pcmChunks.push(new Float32Array(inputData))
      }

      sourceNode.connect(processorNode)
      // 必须连接到 destination 才能让 onaudioprocess 触发
      processorNode.connect(audioContext.destination)

      // 每 1.5 秒发送一次识别请求
      recognitionTimer = setInterval(sendToWhisper, 1500)

      pcmChunks = []
      committedText = ''
    } else {
      // ---- WebSocket 模式：使用 MediaRecorder ----
      mediaRecorder = new MediaRecorder(audioStream, {
        mimeType: 'audio/webm;codecs=opus'
      })

      mediaRecorder.ondataavailable = (event) => {
        if (isMuted.value || event.data.size === 0) return
        if (asrWs.value?.readyState === WebSocket.OPEN) {
          asrWs.value.send(event.data)
        }
      }

      mediaRecorder.start(250)
    }

    isListening.value = true
    isMuted.value = false
    micError.value = ''

    console.log(`[VoicePanel] 麦克风监听已启动 (mode=${mode})`)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[VoicePanel] 获取麦克风失败:', errMsg)
    micError.value =
      errMsg.includes('denied') || errMsg.includes('NotAllowed')
        ? '麦克风权限被拒绝，请在系统设置中允许'
        : `麦克风不可用: ${errMsg}`
  }
}

function stopListening(): void {
  // 停止定时识别
  if (recognitionTimer) {
    clearInterval(recognitionTimer)
    recognitionTimer = null
  }

  // 停止 AudioContext（HTTP 模式）
  if (processorNode) {
    processorNode.disconnect()
    processorNode = null
  }
  if (sourceNode) {
    sourceNode.disconnect()
    sourceNode = null
  }
  if (audioContext) {
    audioContext.close().catch(() => {})
    audioContext = null
  }

  // 停止 MediaRecorder（WebSocket 模式）
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
  }
  mediaRecorder = null

  // 释放麦克风
  if (audioStream) {
    audioStream.getTracks().forEach((t) => t.stop())
    audioStream = null
  }

  // 关闭 WebSocket（如果有）
  if (asrWs.value) {
    asrWs.value.close()
    asrWs.value = null
  }

  isListening.value = false
  asrConnected.value = false
  partialText.value = ''
  pcmChunks = []
  committedText = ''
  silenceCount = 0
}

/** 静音/取消静音切换 */
function toggleMute(): void {
  isMuted.value = !isMuted.value
  if (isMuted.value) {
    partialText.value = ''
    pcmChunks = []
    committedText = ''
    silenceCount = 0
  }
  console.log(`[VoicePanel] ${isMuted.value ? '已静音' : '取消静音'}`)
}

// ---- TTS WebSocket ----

const ttsWs = ref<WebSocket | null>(null)
const ttsConnected = ref(false)
const isSpeaking = ref(false)

watch(
  () => workerStore.ttsReady,
  (ready) => {
    if (ready && workerStore.ttsPort) {
      connectTTS(workerStore.ttsPort)
    } else if (!ready) {
      disconnectTTS()
    }
  },
  { immediate: true }
)

function connectTTS(port: number): void {
  if (ttsWs.value) return
  const url = `ws://127.0.0.1:${port}/ws/tts`
  const ws = new WebSocket(url)
  ws.onopen = () => {
    ttsConnected.value = true
  }
  ws.onclose = () => {
    ttsConnected.value = false
    ttsWs.value = null
  }
  ws.onerror = () => console.warn('[VoicePanel] TTS 连接错误')
  ttsWs.value = ws
}

function disconnectTTS(): void {
  if (ttsWs.value) {
    ttsWs.value.close()
    ttsWs.value = null
  }
  ttsConnected.value = false
  isSpeaking.value = false
}

// ---- 状态指示 ----

const voiceEnabled = computed(() => workerStore.asrReady || workerStore.ttsReady)

/** ASR Worker 信息（兼容 whisper-asr / asr） */
const asrWorker = computed(
  () => workerStore.getWorker('whisper-asr') ?? workerStore.getWorker('asr')
)

function getStatusColor(status: string): string {
  switch (status) {
    case 'ready':
      return 'bg-emerald-500'
    case 'starting':
    case 'initializing':
      return 'bg-amber-400'
    case 'error':
      return 'bg-red-400'
    default:
      return 'bg-gray-300'
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'stopped':
      return '未启动'
    case 'initializing':
      return '初始化中...'
    case 'starting':
      return '启动中...'
    case 'ready':
      return '就绪'
    case 'error':
      return '错误'
    case 'stopping':
      return '停止中...'
    default:
      return status
  }
}
</script>

<template>
  <div class="flex shrink-0 items-center gap-2 border-t border-gray-200/60 bg-white/80 px-4 py-2">
    <!-- Worker 状态指示器 -->
    <div class="flex items-center gap-3">
      <!-- ASR 状态（兼容 whisper-asr / asr） -->
      <div
        v-if="asrWorker"
        class="flex items-center gap-1.5"
        :title="`ASR: ${getStatusLabel(asrWorker.status)}`"
      >
        <span class="i-carbon-microphone inline-block h-3.5 w-3.5 text-gray-500"></span>
        <span
          class="inline-block h-1.5 w-1.5 rounded-full"
          :class="getStatusColor(asrWorker.status)"
        ></span>
        <span class="text-[10px] text-gray-400">
          {{ getStatusLabel(asrWorker.status) }}
        </span>
      </div>

      <!-- TTS 状态 -->
      <div
        v-if="workerStore.getWorker('tts')"
        class="flex items-center gap-1.5"
        :title="`TTS: ${getStatusLabel(workerStore.getWorker('tts')!.status)}`"
      >
        <span class="i-carbon-volume-up inline-block h-3.5 w-3.5 text-gray-500"></span>
        <span
          class="inline-block h-1.5 w-1.5 rounded-full"
          :class="getStatusColor(workerStore.getWorker('tts')!.status)"
        ></span>
        <span class="text-[10px] text-gray-400">
          {{ getStatusLabel(workerStore.getWorker('tts')!.status) }}
        </span>
      </div>

      <!-- 启动/停止按钮 -->
      <template v-for="w in workerStore.workerList" :key="w.name + '-action'">
        <button
          v-if="w.status === 'stopped' || w.status === 'error'"
          class="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary transition hover:bg-primary/20"
          @click="workerStore.startWorker(w.name)"
        >
          启动{{ w.label }}
        </button>
        <button
          v-else-if="w.status === 'ready'"
          class="rounded bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 transition hover:bg-red-50 hover:text-red-500"
          @click="workerStore.stopWorker(w.name)"
        >
          停止{{ w.label }}
        </button>
      </template>

      <!-- 无 Worker -->
      <div
        v-if="workerStore.workerList.length === 0"
        class="flex items-center gap-1 text-[10px] text-gray-400"
      >
        <span class="i-carbon-microphone-off inline-block h-3.5 w-3.5"></span>
        <span>语音未启用</span>
      </div>
    </div>

    <!-- 分隔线 -->
    <div v-if="voiceEnabled" class="h-4 w-px bg-gray-200"></div>

    <!-- 监听状态 + 静音切换 -->
    <template v-if="isListening">
      <div class="flex items-center gap-1.5">
        <span
          v-if="!isMuted"
          class="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500"
        ></span>
        <span class="text-[10px]" :class="isMuted ? 'text-gray-400' : 'text-emerald-600'">
          {{ isMuted ? '已静音' : '正在聆听...' }}
        </span>
      </div>

      <button
        class="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium transition"
        :class="
          isMuted
            ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            : 'bg-red-50 text-red-500 hover:bg-red-100'
        "
        :title="isMuted ? '取消静音' : '静音'"
        @click="toggleMute"
      >
        <span
          class="inline-block h-3.5 w-3.5"
          :class="isMuted ? 'i-carbon-microphone-off' : 'i-carbon-microphone-filled'"
        ></span>
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
      class="min-w-0 flex-1 truncate rounded bg-blue-50 px-2 py-0.5 font-mono text-[10px] text-blue-600"
    >
      {{ partialText }}
    </div>

    <!-- TTS 播放状态 -->
    <div v-if="isSpeaking" class="flex items-center gap-1 text-[10px] text-violet-500">
      <span class="i-carbon-volume-up-filled inline-block h-3 w-3 animate-pulse"></span>
      <span>播放中</span>
    </div>
  </div>
</template>
