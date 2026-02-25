<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { employeeApi, type DigitalEmployee } from '@/api/employee';
import EmployeeAvatar from '@/components/EmployeeAvatar.vue';
import AudioVisualizer from '@/components/AudioVisualizer.vue';
import { useAudioRecorder } from '@/composables/useAudioRecorder';
import { useStreamHandler, type StreamChatMessage } from '@/composables/useStreamHandler';
import { gateway } from '@/plugins/gatewaySetup';
import { streamSubscribe, streamUnsubscribe } from '@/composables/useStreamWs';

const route = useRoute();
const router = useRouter();
const employeeId = route.params.id as string;

const employee = ref<DigitalEmployee | null>(null);
const loading = ref(true);
const status = ref<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
const subtitle = ref('');
const volume = ref(0);

// ---- Session 管理 ----
const sessionId = ref(`chat-employee-${employeeId}`);

const { messages, isStreaming, handleStreamMessage, addUserMessage, addErrorMessage } = useStreamHandler({
  idPrefix: 'emp-chat',
  maxMessages: 50
});

onMounted(() => {
  if (sessionId.value) {
    streamSubscribe(sessionId.value, handleStreamMessage);
  }
});

onUnmounted(() => {
  if (sessionId.value) {
    streamUnsubscribe(sessionId.value);
  }
});

// ---- AI 响应展示 ----
const lastAssistantMsg = computed((): StreamChatMessage | undefined => {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    if (messages.value[i].role === 'assistant') return messages.value[i];
  }
  return undefined;
});

const aiDisplayText = computed((): string => {
  const msg = lastAssistantMsg.value;
  if (!msg) return '';
  return msg.content;
});

const aiThinking = computed((): string => {
  const msg = lastAssistantMsg.value;
  if (!msg) return '';
  const thinkBlock = msg.blocks.find((b) => b.type === 'thinking');
  if (thinkBlock && thinkBlock.type === 'thinking') return thinkBlock.text;
  return '';
});

const aiToolCalls = computed(() => {
  const msg = lastAssistantMsg.value;
  if (!msg) return [];
  return msg.blocks
    .filter((b) => b.type === 'tool')
    .map((b) => (b.type === 'tool' ? b.tool : null))
    .filter(Boolean);
});

// 字幕：优先显示用户正在说的话，其次显示 AI 文字输出
watch(
  () => messages.value.length,
  (newLen, oldLen) => {
    if (newLen > oldLen) {
      const lastMsg = messages.value[newLen - 1];
      if (lastMsg.role === 'assistant') {
        watch(
          () => lastMsg.content,
          (newContent) => {
            if (status.value !== 'listening') {
              subtitle.value = newContent;
            }
          }
        );
      }
    }
  }
);

// ---- 发送消息给应用管家 ----
async function sendToLLM(text: string): Promise<void> {
  if (!text.trim()) return;

  status.value = 'thinking';
  subtitle.value = '';
  addUserMessage(text);

  try {
    const targetAgentId = 'app-manager';

    const result = await gateway.request<{ sessionId: string; status: string }>('chat.send', {
      message: text,
      sessionId: sessionId.value,
      mode: 'agent',
      agentId: targetAgentId
    });

    if (result && result.sessionId !== sessionId.value) {
      streamUnsubscribe(sessionId.value);
      sessionId.value = result.sessionId;
      streamSubscribe(sessionId.value, handleStreamMessage);
    }
  } catch (err) {
    console.error('[EmployeeChat] Send error:', err);
    addErrorMessage(String(err));
    status.value = 'idle';
  }
}

// ---- 流式状态追踪 ----
watch(isStreaming, (val) => {
  if (!val) {
    const lastMsg = messages.value[messages.value.length - 1];
    if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content) {
      status.value = 'idle';
    } else {
      status.value = 'idle';
    }
  } else {
    status.value = 'thinking';
  }
});

// ---- 录音机 ----
const { startRecording, stopRecording, disconnect } = useAudioRecorder({
  onPartialResult: (text) => {
    subtitle.value = text;
    status.value = 'listening';
  },
  onFinalResult: (text) => {
    subtitle.value = text;
    sendToLLM(text);
  },
  onVolumeChange: (vol) => {
    volume.value = vol;
  },
  onSilence: () => {
    // VAD 静音 → ASR 自动产出 final result
  }
});

// ---- 加载员工信息 ----
onMounted(async () => {
  try {
    employee.value = await employeeApi.getEmployee(employeeId);
  } catch (error) {
    console.error('Failed to load employee:', error);
    router.replace('/employee');
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  disconnect();
});

async function toggleMic(): Promise<void> {
  if (status.value === 'listening') {
    status.value = 'idle';
    stopRecording();
  } else {
    status.value = 'listening';
    try {
      await startRecording();
    } catch (_e) {
      status.value = 'idle';
    }
  }
}

function handleExit(): void {
  router.push('/employee');
}
</script>

<template>
  <div class="chat-view">
    <!-- 3D Scene Container -->
    <div class="scene-container">
      <EmployeeAvatar :state="status" />
    </div>

    <!-- UI Overlay -->
    <div class="ui-overlay">
      <!-- Top Bar -->
      <header class="top-bar">
        <div v-if="employee" class="employee-info">
          <h2 class="name">{{ employee.name }}</h2>
          <span class="role">{{ employee.role }}</span>
        </div>
        <div class="top-right">
          <div v-if="status !== 'idle'" class="status-pill" :class="status">
            <span v-if="status === 'listening'" class="status-dot pulse" />
            <span v-else-if="status === 'thinking'" class="i-carbon-watson inline-block h-3 w-3 animate-pulse" />
            <span class="status-label">
              {{ status === 'listening' ? '聆听中' : status === 'thinking' ? '思考中' : '说话中' }}
            </span>
          </div>
          <button class="btn-icon" title="结束对话" @click="handleExit">
            <span class="i-carbon-close h-6 w-6" />
          </button>
        </div>
      </header>

      <!-- AI 响应区 -->
      <div class="response-area">
        <!-- 思考过程（折叠） -->
        <div v-if="aiThinking && status === 'thinking'" class="thinking-indicator">
          <span class="i-carbon-watson inline-block h-3.5 w-3.5 animate-pulse" />
          <span class="thinking-text">{{ aiThinking.slice(-80) }}{{ aiThinking.length > 80 ? '...' : '' }}</span>
        </div>

        <!-- 工具调用 -->
        <div v-if="aiToolCalls.length > 0" class="tool-calls">
          <div v-for="(tool, idx) in aiToolCalls" :key="idx" class="tool-call-item">
            <span class="i-carbon-tool-box inline-block h-3 w-3" />
            <span class="tool-name">{{ tool?.name }}</span>
            <span v-if="tool?.status === 'calling'" class="i-carbon-renew inline-block h-3 w-3 animate-spin" />
            <span v-else-if="tool?.status === 'done'" class="i-carbon-checkmark inline-block h-3 w-3 text-green-400" />
          </div>
        </div>
      </div>

      <!-- Subtitle Area -->
      <div class="subtitle-area">
        <Transition name="subtitle-fade">
          <p v-if="subtitle || aiDisplayText" class="subtitle-text">
            {{ subtitle || aiDisplayText }}
          </p>
        </Transition>
        <p v-if="!subtitle && !aiDisplayText && status === 'listening'" class="subtitle-text listening-dots">
          <span /><span /><span />
        </p>
      </div>

      <!-- Bottom Controls -->
      <div class="mic-wrapper">
        <!-- 波形可视化 -->
        <div class="mic-visualizer-bg" :class="{ active: status === 'listening' }">
          <AudioVisualizer :volume="volume" :is-active="status === 'listening'" color="rgba(239, 68, 68, 0.6)" />
        </div>

        <!-- 脉冲光环 -->
        <div class="mic-ring" :class="{ active: status === 'listening' }" />

        <!-- Mic Button -->
        <button
          class="mic-btn-main"
          :class="{ active: status === 'listening' }"
          :style="status === 'listening' ? { transform: `scale(${1 + volume / 400})` } : {}"
          @click="toggleMic">
          <span v-if="status !== 'listening'" class="i-carbon-microphone h-8 w-8" />
          <span v-else class="i-carbon-stop-filled h-8 w-8" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-view {
  width: 100%;
  height: 100%;
  position: relative;
  background: #0f1115;
  overflow: hidden;
}

.scene-container {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}

.ui-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: none;
  display: flex;
  flex-direction: column;
}

/* ---- Top Bar ---- */
.top-bar {
  padding: 20px 24px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  pointer-events: auto;
}

.employee-info .name {
  font-size: 20px;
  font-weight: 600;
  color: #fff;
  margin: 0;
  line-height: 1.3;
}

.employee-info .role {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
}

.top-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(8px);
}

.status-pill.listening {
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.status-pill.thinking {
  background: rgba(99, 102, 241, 0.2);
  border: 1px solid rgba(99, 102, 241, 0.3);
}

.status-pill.speaking {
  background: rgba(34, 197, 94, 0.2);
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ef4444;
}

.status-dot.pulse {
  animation: dotPulse 1.5s ease-in-out infinite;
}

@keyframes dotPulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

.status-label {
  line-height: 1;
}

.btn-icon {
  background: rgba(255, 255, 255, 0.08);
  border: none;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

/* ---- AI Response Area ---- */
.response-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 0 32px;
  pointer-events: auto;
}

.thinking-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 10px;
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.15);
  color: rgba(165, 180, 252, 0.8);
  font-size: 12px;
  max-width: 60%;
  animation: fadeIn 0.3s ease;
}

.thinking-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-calls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
}

.tool-call-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.65);
  font-size: 11px;
}

.tool-name {
  font-weight: 500;
}

/* ---- Subtitle ---- */
.subtitle-area {
  flex: 1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 150px;
  pointer-events: none;
}

.subtitle-text {
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(12px);
  padding: 14px 28px;
  border-radius: 14px;
  font-size: 17px;
  line-height: 1.6;
  max-width: 65%;
  text-align: center;
  color: rgba(255, 255, 255, 0.92);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.08);
  animation: fadeUp 0.3s ease-out;
}

.subtitle-fade-enter-active,
.subtitle-fade-leave-active {
  transition: all 0.3s ease;
}

.subtitle-fade-enter-from,
.subtitle-fade-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

.listening-dots {
  display: flex;
  gap: 6px;
  padding: 16px 28px;
}

.listening-dots span {
  display: block;
  width: 8px;
  height: 8px;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 50%;
  animation: dotBounce 1.4s ease-in-out infinite;
}

.listening-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.listening-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes dotBounce {
  0%,
  80%,
  100% {
    transform: scale(0.6);
    opacity: 0.4;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes fadeUp {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* ---- Mic ---- */
.mic-wrapper {
  position: absolute;
  bottom: 56px;
  left: 50%;
  transform: translateX(-50%);
  width: 140px;
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}

.mic-visualizer-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.mic-visualizer-bg.active {
  opacity: 1;
}

.mic-btn-main {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background 0.3s,
    transform 0.1s;
  z-index: 10;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}

.mic-btn-main:hover {
  background: rgba(255, 255, 255, 0.15);
}

.mic-btn-main.active {
  background: #ef4444;
  box-shadow: 0 4px 24px rgba(239, 68, 68, 0.4);
  border-color: rgba(239, 68, 68, 0.5);
}

.mic-ring {
  position: absolute;
  top: 20px;
  left: 20px;
  width: 100px;
  height: 100px;
  border-radius: 50%;
  border: 1px solid rgba(239, 68, 68, 0.2);
  pointer-events: none;
  z-index: 1;
  opacity: 0;
  transform: scale(0.8);
  transition: all 0.3s ease;
}

.mic-ring.active {
  opacity: 0.5;
  transform: scale(1);
  animation: breathe 2s infinite ease-in-out;
}

@keyframes breathe {
  0%,
  100% {
    transform: scale(0.95);
    opacity: 0.3;
  }
  50% {
    transform: scale(1.05);
    opacity: 0.6;
  }
}
</style>
