/**
 * useTtsPlayback — TTS 语音播放 composable
 *
 * 功能：
 *   1. 接收 LLM 流式文本增量（feedDelta），按标点断句
 *   2. 逐句通过 TTS Worker WebSocket 合成音频
 *   3. 音频队列顺序播放，支持用户打断（stop）
 *
 * 设计要点：
 *   - 全内存流转，不写磁盘文件
 *   - WebSocket 长连接复用，减少握手开销
 *   - 播放完自动释放音频资源
 */

import { ref, type Ref } from 'vue';
import { useWorkerStore } from '@/stores/worker';

const SENTENCE_DELIMITERS = /([。！？；\n!?;])/;
const MIN_SENTENCE_LENGTH = 2;

export interface TtsPlaybackOptions {
  speaker?: string;
}

export interface UseTtsPlaybackReturn {
  isSpeaking: Ref<boolean>;
  feedDelta: (text: string) => void;
  flush: () => void;
  stop: () => void;
  dispose: () => void;
}

export function useTtsPlayback(options: TtsPlaybackOptions = {}): UseTtsPlaybackReturn {
  const workerStore = useWorkerStore();
  const isSpeaking = ref(false);

  let ws: WebSocket | null = null;
  let sentenceBuffer = '';
  const audioQueue: ArrayBuffer[] = [];
  let isPlaying = false;
  let stopped = false;
  let audioCtx: AudioContext | null = null;
  let currentSource: AudioBufferSourceNode | null = null;

  function getAudioContext(): AudioContext {
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AudioContext();
    }
    return audioCtx;
  }

  function ensureWs(): WebSocket | null {
    if (ws && ws.readyState === WebSocket.OPEN) return ws;
    if (ws) {
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }

    const port = workerStore.ttsPort;
    if (!port) return null;

    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/tts`);
    socket.binaryType = 'arraybuffer';

    socket.onclose = () => {
      if (ws === socket) ws = null;
    };
    socket.onerror = () => {
      if (ws === socket) ws = null;
    };

    ws = socket;
    return socket;
  }

  function synthesize(sentence: string): void {
    const socket = ensureWs();
    if (!socket) return;

    const speaker = options.speaker || 'xiaoxiao';

    const handleMessage = (event: MessageEvent): void => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.audio) {
          const binary = atob(data.audio);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          audioQueue.push(bytes.buffer);
          playNext();
        }
      } catch {
        /* ignore non-JSON or parse errors */
      }
    };

    if (socket.readyState === WebSocket.OPEN) {
      socket.onmessage = handleMessage;
      socket.send(JSON.stringify({ text: sentence, speaker }));
    } else {
      socket.addEventListener(
        'open',
        () => {
          socket.onmessage = handleMessage;
          socket.send(JSON.stringify({ text: sentence, speaker }));
        },
        { once: true }
      );
    }
  }

  async function playNext(): Promise<void> {
    if (isPlaying || audioQueue.length === 0 || stopped) return;
    isPlaying = true;
    isSpeaking.value = true;

    const buffer = audioQueue.shift()!;
    const ctx = getAudioContext();

    try {
      if (ctx.state === 'suspended') await ctx.resume();
      const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
      if (stopped) {
        isPlaying = false;
        isSpeaking.value = false;
        return;
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      currentSource = source;

      source.onended = () => {
        currentSource = null;
        isPlaying = false;
        if (audioQueue.length > 0 && !stopped) {
          playNext();
        } else {
          isSpeaking.value = false;
        }
      };
      source.start(0);
    } catch {
      isPlaying = false;
      currentSource = null;
      if (audioQueue.length > 0 && !stopped) {
        playNext();
      } else {
        isSpeaking.value = false;
      }
    }
  }

  function feedDelta(text: string): void {
    if (stopped || !workerStore.ttsReady) return;
    sentenceBuffer += text;

    const parts = sentenceBuffer.split(SENTENCE_DELIMITERS);
    // parts: ["text", "delimiter", "text", "delimiter", ...]
    // The last element might be an incomplete sentence
    let i = 0;
    while (i + 1 < parts.length) {
      const sentence = parts[i] + parts[i + 1]; // text + delimiter
      if (sentence.trim().length >= MIN_SENTENCE_LENGTH) {
        synthesize(sentence.trim());
      }
      i += 2;
    }
    sentenceBuffer = i < parts.length ? parts[i] : '';
  }

  function flush(): void {
    if (sentenceBuffer.trim().length >= MIN_SENTENCE_LENGTH && !stopped && workerStore.ttsReady) {
      synthesize(sentenceBuffer.trim());
    }
    sentenceBuffer = '';
  }

  function stop(): void {
    stopped = true;
    sentenceBuffer = '';
    audioQueue.length = 0;

    if (currentSource) {
      try {
        currentSource.stop();
      } catch {
        /* ignore */
      }
      currentSource = null;
    }
    isPlaying = false;
    isSpeaking.value = false;

    // Reset stopped flag so next round can work
    stopped = false;
  }

  function dispose(): void {
    stop();
    if (ws) {
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      ws = null;
    }
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
  }

  return {
    isSpeaking,
    feedDelta,
    flush,
    stop,
    dispose
  };
}
