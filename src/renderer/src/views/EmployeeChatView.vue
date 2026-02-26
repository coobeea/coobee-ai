<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted, watch, computed } from 'vue';
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
const textInput = ref('');

// ---- Session 管理 ----
const sessionId = ref(`chat-employee-${employeeId}`);

const { messages, isStreaming, handleStreamMessage, addUserMessage, addErrorMessage } = useStreamHandler({
  idPrefix: 'emp-chat',
  maxMessages: 50
});

function ensureSubscribed(): void {
  streamSubscribe(sessionId.value, handleStreamMessage);
}

onMounted(() => {
  ensureSubscribed();
  // Gateway 首次连接后也确保订阅生效
  const unregister = gateway.onConnect(() => {
    ensureSubscribed();
  });
  onUnmounted(unregister);
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

// 消息列表自动滚动到底部
const messagesEl = ref<HTMLElement | null>(null);
function scrollToBottom(): void {
  nextTick(() => {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
    }
  });
}

watch(
  () => messages.value.length,
  () => scrollToBottom()
);

watch(
  () => lastAssistantMsg.value?.content,
  () => scrollToBottom()
);

// ---- 发送消息给应用管家 ----
async function sendToLLM(text: string): Promise<void> {
  if (!text.trim()) return;

  status.value = 'thinking';
  subtitle.value = '';
  addUserMessage(text);

  try {
    const targetAgentId = 'app-copilot';

    // 发送前确保订阅已建立
    ensureSubscribed();

    const result = await gateway.request<{ sessionId: string; status: string }>('chat.send', {
      message: text,
      sessionId: sessionId.value,
      mode: 'agent',
      agentId: targetAgentId
    });

    console.log('[EmployeeChat] chat.send result:', result);

    // 后端可能返回不同的 sessionId（自动创建 Thread 的场景）
    if (result && result.sessionId && result.sessionId !== sessionId.value) {
      console.log(`[EmployeeChat] SessionId changed: ${sessionId.value} → ${result.sessionId}`);
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

function handleTextSend(): void {
  const text = textInput.value.trim();
  if (!text) return;
  textInput.value = '';
  sendToLLM(text);
}

// ---- 流式状态追踪 ----
watch(isStreaming, (val) => {
  if (!val) {
    status.value = 'idle';
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
    <!-- Avatar 背景 -->
    <div class="scene-container">
      <EmployeeAvatar :state="status" />
    </div>

    <!-- UI 层 -->
    <div class="ui-overlay">
      <!-- 顶栏 -->
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
            <span class="i-carbon-close h-5 w-5" />
          </button>
        </div>
      </header>

      <!-- 对话内容区（可滚动） -->
      <div ref="messagesEl" class="messages-area">
        <div v-for="msg in messages" :key="msg.id" class="msg-bubble" :class="msg.role">
          <!-- 用户消息 -->
          <template v-if="msg.role === 'user'">
            <div class="msg-user">
              <span class="i-carbon-user inline-block h-3 w-3 shrink-0" />
              <span>{{ msg.content }}</span>
            </div>
          </template>

          <!-- AI 消息 -->
          <template v-else>
            <!-- 思考过程 -->
            <template v-for="(block, bIdx) in msg.blocks" :key="bIdx">
              <div v-if="block.type === 'thinking'" class="msg-thinking">
                <span class="i-carbon-watson inline-block h-3 w-3 shrink-0" />
                <span class="msg-thinking-text"
                  >{{ block.text.slice(-120) }}{{ block.text.length > 120 ? '…' : '' }}</span
                >
              </div>
              <div v-else-if="block.type === 'tool'" class="msg-tool">
                <span class="i-carbon-tool-box inline-block h-3 w-3 shrink-0" />
                <span class="msg-tool-name">{{ block.tool.name }}</span>
                <span v-if="block.tool.status === 'calling'" class="i-carbon-renew inline-block h-3 w-3 animate-spin" />
                <span
                  v-else-if="block.tool.status === 'done'"
                  class="i-carbon-checkmark inline-block h-3 w-3 text-green-400" />
              </div>
            </template>
            <!-- 文本输出 -->
            <div v-if="msg.content" class="msg-ai-text">{{ msg.content }}</div>
            <!-- 错误 -->
            <div v-if="msg.status === 'error' && msg.error" class="msg-error">
              <span class="i-carbon-warning-alt inline-block h-3 w-3" />
              {{ msg.error }}
            </div>
          </template>
        </div>

        <!-- 正在输入指示 -->
        <div v-if="status === 'thinking' && !lastAssistantMsg" class="msg-typing"> <span /><span /><span /> </div>
      </div>

      <!-- 底部：字幕 + 输入 + 麦克风 -->
      <div class="bottom-zone">
        <!-- 实时字幕（用户说话时） -->
        <div v-if="subtitle && status === 'listening'" class="live-subtitle">
          {{ subtitle }}
        </div>

        <!-- 文本输入 -->
        <div class="text-input-row">
          <input
            v-model="textInput"
            class="text-input"
            placeholder="输入消息..."
            :disabled="status === 'thinking'"
            @keydown.enter="handleTextSend" />
          <button class="send-btn" :disabled="!textInput.trim() || status === 'thinking'" @click="handleTextSend">
            <span class="i-carbon-send h-4 w-4" />
          </button>
        </div>

        <!-- 麦克风控制 -->
        <div class="mic-wrapper">
          <div class="mic-visualizer-bg" :class="{ active: status === 'listening' }">
            <AudioVisualizer :volume="volume" :is-active="status === 'listening'" color="rgba(239, 68, 68, 0.6)" />
          </div>
          <div class="mic-ring" :class="{ active: status === 'listening' }" />
          <button
            class="mic-btn-main"
            :class="{ active: status === 'listening' }"
            :style="status === 'listening' ? { transform: `scale(${1 + volume / 400})` } : {}"
            @click="toggleMic">
            <span v-if="status !== 'listening'" class="i-carbon-microphone h-6 w-6" />
            <span v-else class="i-carbon-stop-filled h-6 w-6" />
          </button>
        </div>
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

/* ---- 顶栏 ---- */
.top-bar {
  padding: 16px 20px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  pointer-events: auto;
  flex-shrink: 0;
}

.employee-info .name {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
  margin: 0;
  line-height: 1.3;
}

.employee-info .role {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.top-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-pill {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 16px;
  font-size: 11px;
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
  width: 5px;
  height: 5px;
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
  width: 32px;
  height: 32px;
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

/* ---- 消息列表 ---- */
.messages-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 20px 12px;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  mask-image: linear-gradient(to bottom, transparent 0%, black 8%, black 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 8%, black 100%);
}

.messages-area::-webkit-scrollbar {
  width: 4px;
}

.messages-area::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
}

.msg-bubble {
  animation: fadeUp 0.25s ease-out;
}

.msg-user {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-end;
  background: rgba(99, 102, 241, 0.2);
  border: 1px solid rgba(99, 102, 241, 0.2);
  padding: 6px 14px;
  border-radius: 12px 12px 4px 12px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  max-width: 80%;
  margin-left: auto;
}

.msg-thinking {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.1);
  color: rgba(165, 180, 252, 0.7);
  font-size: 11px;
  max-width: 70%;
}

.msg-thinking-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.msg-tool {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
}

.msg-tool-name {
  font-weight: 500;
}

.msg-ai-text {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 8px 14px;
  border-radius: 12px 12px 12px 4px;
  color: rgba(255, 255, 255, 0.88);
  font-size: 13px;
  line-height: 1.6;
  max-width: 85%;
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-error {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.15);
  color: rgba(252, 165, 165, 0.8);
  font-size: 11px;
}

.msg-typing {
  display: flex;
  gap: 5px;
  padding: 4px 0;
}

.msg-typing span {
  width: 6px;
  height: 6px;
  background: rgba(99, 102, 241, 0.5);
  border-radius: 50%;
  animation: dotBounce 1.4s ease-in-out infinite;
}

.msg-typing span:nth-child(2) {
  animation-delay: 0.2s;
}
.msg-typing span:nth-child(3) {
  animation-delay: 0.4s;
}

/* ---- 底部区域 ---- */
.bottom-zone {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 8px 20px 20px;
  pointer-events: auto;
}

.live-subtitle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
  padding: 6px 16px;
  border-radius: 10px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.06);
  max-width: 70%;
  text-align: center;
  animation: fadeUp 0.2s ease-out;
}

.text-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 480px;
}

.text-input {
  flex: 1;
  height: 36px;
  padding: 0 14px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}

.text-input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.text-input:focus {
  border-color: rgba(99, 102, 241, 0.5);
}

.text-input:disabled {
  opacity: 0.5;
}

.send-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(99, 102, 241, 0.7);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.9);
}

.send-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.mic-wrapper {
  position: relative;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
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
  width: 48px;
  height: 48px;
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
  top: 8px;
  left: 8px;
  width: 64px;
  height: 64px;
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

@keyframes fadeUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
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
</style>
