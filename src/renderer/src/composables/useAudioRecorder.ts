import { ref } from 'vue';
import { useWorkerStore } from '@/stores/worker';

export interface AsrMeta {
  lang?: string | null;
  emotion?: string | null;
  event?: string | null;
}

export interface AudioRecorderOptions {
  onPartialResult?: (text: string, meta?: AsrMeta) => void;
  onFinalResult?: (text: string, meta?: AsrMeta) => void;
  onVolumeChange?: (volume: number) => void; // 0-100
  onSilence?: () => void;
  vadThreshold?: number; // 0.0 - 1.0 (默认 0.02)
  silenceDuration?: number; // 毫秒 (默认 1200)
}

export interface UseAudioRecorderReturn {
  isConnected: import('vue').Ref<boolean>;
  isRecording: import('vue').Ref<boolean>;
  isSpeaking: import('vue').Ref<boolean>;
  isMuted: import('vue').Ref<boolean>;
  connect: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  disconnect: () => void;
  resetSentOffset: () => void;
  mute: () => void;
  unmute: () => void;
}

export function useAudioRecorder(options: AudioRecorderOptions = {}): UseAudioRecorderReturn {
  const workerStore = useWorkerStore();

  const isConnected = ref(false);
  const isRecording = ref(false);
  const isSpeaking = ref(false);
  const isMuted = ref(false);

  let ws: WebSocket | null = null;
  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let processor: ScriptProcessorNode | null = null;

  let pcmSendBuffer: Float32Array[] = [];
  let sendTimer: number | null = null;
  let silenceTimer: number | null = null;
  let textIdleTimer: number | null = null;

  const VAD_THRESHOLD = options.vadThreshold || 0.02;
  const SILENCE_DURATION = options.silenceDuration || 1200;

  let sentTextLength = 0;
  let lastKnownFullText = '';
  let prevPartialText = '';

  const resetSentOffset = (): void => {
    sentTextLength = lastKnownFullText.length;
    prevPartialText = '';
  };

  const downsample = (samples: Float32Array, inputRate: number, outputRate: number): Float32Array => {
    if (inputRate === outputRate) return samples;
    const ratio = inputRate / outputRate;
    const intRatio = Math.round(ratio);

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

    if (!workerStore.asrReady || !workerStore.asrPort) {
      await workerStore.requestWorkers();
      if (!workerStore.asrReady) {
        throw new Error('ASR Worker not ready');
      }
    }

    const url = `ws://127.0.0.1:${workerStore.asrPort}/ws/asr`;

    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      isConnected.value = true;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.status === 'ready') return;

        if (data.partial) {
          lastKnownFullText = data.partial;
          const currentTurnText = data.partial.substring(sentTextLength);
          if (currentTurnText.trim() && !isMuted.value) {
            const meta: AsrMeta = {
              lang: data.lang ?? null,
              emotion: data.emotion ?? null,
              event: data.event ?? null
            };
            options.onPartialResult?.(currentTurnText, meta);

            if (currentTurnText !== prevPartialText) {
              prevPartialText = currentTurnText;
              resetTextIdleTimer();
            }
          }
        } else if (data.final) {
          const currentTurnText = data.final.substring(sentTextLength);
          if (currentTurnText.trim() && !isMuted.value) {
            options.onFinalResult?.(currentTurnText);
          }
        }
      } catch {
        // ignore non-JSON
      }
    };

    ws.onclose = () => {
      isConnected.value = false;
      stopRecording();
    };

    ws.onerror = () => {
      isConnected.value = false;
    };
  };

  // ==================== 录音与 VAD ====================

  const flushBuffer = (): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN || pcmSendBuffer.length === 0 || !audioContext) return;

    let totalLen = 0;
    for (const chunk of pcmSendBuffer) totalLen += chunk.length;
    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of pcmSendBuffer) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    pcmSendBuffer = [];

    const finalSamples = downsample(merged, audioContext.sampleRate, 16000);
    const int16 = float32ToInt16(finalSamples);
    ws.send(int16);
  };

  const resetTextIdleTimer = (): void => {
    if (textIdleTimer) clearTimeout(textIdleTimer);
    textIdleTimer = window.setTimeout(() => {
      if (prevPartialText.trim() && !isMuted.value) {
        options.onSilence?.();
      }
    }, SILENCE_DURATION);
  };

  const mute = (): void => {
    isMuted.value = true;
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    if (textIdleTimer) {
      clearTimeout(textIdleTimer);
      textIdleTimer = null;
    }
    isSpeaking.value = false;
  };

  const unmute = (): void => {
    isMuted.value = false;
    prevPartialText = '';
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
    processor = audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      if (!isRecording.value) return;
      const samples = e.inputBuffer.getChannelData(0);

      let maxVal = 0;
      for (let i = 0; i < samples.length; i += 32) {
        const v = Math.abs(samples[i]);
        if (v > maxVal) maxVal = v;
      }

      if (!isMuted.value) {
        options.onVolumeChange?.(maxVal * 100);
        if (maxVal > VAD_THRESHOLD) {
          if (!isSpeaking.value) isSpeaking.value = true;
          if (silenceTimer) clearTimeout(silenceTimer);
          silenceTimer = window.setTimeout(() => {
            if (isSpeaking.value) isSpeaking.value = false;
          }, SILENCE_DURATION);
        }
      } else {
        options.onVolumeChange?.(0);
      }

      pcmSendBuffer.push(new Float32Array(samples));
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

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
    if (textIdleTimer) {
      clearTimeout(textIdleTimer);
      textIdleTimer = null;
    }

    flushBuffer();

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
    isMuted,
    connect,
    startRecording,
    stopRecording,
    disconnect,
    resetSentOffset,
    mute,
    unmute
  };
}
