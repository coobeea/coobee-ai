import { ref } from 'vue';
import { useWorkerStore } from '@/stores/worker';

export interface AudioRecorderOptions {
  onPartialResult?: (text: string) => void;
  onFinalResult?: (text: string) => void;
  onVolumeChange?: (volume: number) => void; // 0-100
  onSilence?: () => void;
  vadThreshold?: number; // 0.0 - 1.0 (默认 0.05)
  silenceDuration?: number; // 毫秒 (默认 1500)
}

export interface UseAudioRecorderReturn {
  isConnected: import('vue').Ref<boolean>;
  isRecording: import('vue').Ref<boolean>;
  isSpeaking: import('vue').Ref<boolean>;
  connect: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  disconnect: () => void;
}

export function useAudioRecorder(options: AudioRecorderOptions = {}): UseAudioRecorderReturn {
  const workerStore = useWorkerStore();

  // 状态
  const isConnected = ref(false);
  const isRecording = ref(false);
  const isSpeaking = ref(false); // VAD 状态

  // 内部对象
  let ws: WebSocket | null = null;
  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let processor: ScriptProcessorNode | null = null;

  // 缓冲与定时器
  let pcmSendBuffer: Float32Array[] = [];
  let sendTimer: number | null = null;
  let silenceTimer: number | null = null;

  const VAD_THRESHOLD = options.vadThreshold || 0.02;
  const SILENCE_DURATION = options.silenceDuration || 1500;

  // ==================== 核心算法 (移植自参考代码) ====================

  /**
   * 带抗混叠的降采样 (48k -> 16k)
   */
  const downsample = (samples: Float32Array, inputRate: number, outputRate: number): Float32Array => {
    if (inputRate === outputRate) return samples;
    const ratio = inputRate / outputRate;
    const intRatio = Math.round(ratio);

    // 整数比率：均值抽取
    if (Math.abs(ratio - intRatio) < 0.01 && intRatio >= 2) {
      const newLen = Math.floor(samples.length / intRatio);
      const result = new Float32Array(newLen);
      for (let i = 0; i < newLen; i++) {
        let sum = 0;
        const base = i * intRatio;
        for (let j = 0; j < intRatio; j++) {
          sum += samples[base + j];
        }
        result[i] = sum / intRatio;
      }
      return result;
    }

    // 非整数比率：简单移动平均
    const newLen = Math.round(samples.length / ratio);
    const result = new Float32Array(newLen);
    const windowHalf = Math.ceil(ratio / 2);
    for (let i = 0; i < newLen; i++) {
      const center = i * ratio;
      const lo = Math.max(0, Math.floor(center) - windowHalf);
      const hi = Math.min(samples.length - 1, Math.floor(center) + windowHalf);
      let sum = 0;
      for (let j = lo; j <= hi; j++) sum += samples[j];
      result[i] = sum / (hi - lo + 1);
    }
    return result;
  };

  /**
   * Float32 -> Int16
   */
  const float32ToInt16 = (float32: Float32Array): ArrayBuffer => {
    const buf = new ArrayBuffer(float32.length * 2);
    const view = new DataView(buf);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  };

  // ==================== WebSocket ====================

  const connect = async (): Promise<void> => {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    // 确保 ASR Worker 已启动
    if (!workerStore.asrReady || !workerStore.asrPort) {
      await workerStore.requestWorkers(); // 尝试刷新状态
      if (!workerStore.asrReady) {
        throw new Error('ASR Worker not ready');
      }
    }

    const url = `ws://127.0.0.1:${workerStore.asrPort}/ws/asr`;
    console.log('[AudioRecorder] Connecting to:', url);

    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      console.log('[AudioRecorder] WS Connected');
      isConnected.value = true;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.status === 'ready') {
          // Worker 就绪
        } else if (data.partial) {
          options.onPartialResult?.(data.partial);
        } else if (data.final) {
          options.onFinalResult?.(data.final);
        }
      } catch (_e) {
        // 忽略非 JSON 消息
      }
    };

    ws.onclose = () => {
      console.log('[AudioRecorder] WS Closed');
      isConnected.value = false;
      stopRecording();
    };

    ws.onerror = (e) => {
      console.error('[AudioRecorder] WS Error:', e);
      isConnected.value = false;
    };
  };

  // ==================== 录音与 VAD ====================

  const flushBuffer = (): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN || pcmSendBuffer.length === 0 || !audioContext) return;

    // 合并
    let totalLen = 0;
    for (const chunk of pcmSendBuffer) totalLen += chunk.length;
    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of pcmSendBuffer) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    pcmSendBuffer = [];

    // 降采样到 16000
    const targetRate = 16000;
    const finalSamples = downsample(merged, audioContext.sampleRate, targetRate);

    // 转 Int16 并发送
    const int16 = float32ToInt16(finalSamples);
    ws.send(int16);
  };

  const startRecording = async (): Promise<void> => {
    if (isRecording.value) return;
    if (!isConnected.value) await connect();

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch (e) {
      console.error('Mic permission denied:', e);
      throw e;
    }

    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(mediaStream);

    // 4096 样本 @ 48k ≈ 85ms
    processor = audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      if (!isRecording.value) return;
      const samples = e.inputBuffer.getChannelData(0);

      // VAD & 音量计算
      let maxVal = 0;
      for (let i = 0; i < samples.length; i += 32) {
        const v = Math.abs(samples[i]);
        if (v > maxVal) maxVal = v;
      }

      options.onVolumeChange?.(maxVal * 100);

      // VAD 逻辑
      if (maxVal > VAD_THRESHOLD) {
        // 检测到说话
        if (!isSpeaking.value) {
          isSpeaking.value = true;
          // console.log('Speech detected');
        }
        // 重置静音定时器
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = window.setTimeout(() => {
          // 静音超时
          if (isSpeaking.value) {
            isSpeaking.value = false;
            console.log('Silence detected (VAD)');
            options.onSilence?.();
          }
        }, SILENCE_DURATION);
      }

      // 只有在检测到说话（或说话刚结束的一小段时间内）才发送音频？
      // 或者：为了保证首字不丢失，一直发送，让服务端 VAD 决定？
      // FunASR 通常需要连续流。这里我们选择一直发送，只用 VAD 来触发“结束”信号。
      pcmSendBuffer.push(new Float32Array(samples));
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    // 每 250ms 发送一次
    sendTimer = window.setInterval(flushBuffer, 250);

    isRecording.value = true;
  };

  const stopRecording = (): void => {
    isRecording.value = false;
    isSpeaking.value = false;

    if (sendTimer) {
      clearInterval(sendTimer);
      sendTimer = null;
    }
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }

    flushBuffer(); // 发送剩余

    if (processor) {
      processor.disconnect();
      processor = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }

    // 不关闭 WS，保持连接以便下次快速开始
  };

  const disconnect = (): void => {
    stopRecording();
    if (ws) {
      ws.close();
      ws = null;
    }
    isConnected.value = false;
  };

  return {
    isConnected,
    isRecording,
    isSpeaking,
    connect,
    startRecording,
    stopRecording,
    disconnect
  };
}
