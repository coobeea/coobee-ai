<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { employeeApi, type DigitalEmployee } from '@/api/employee';
import EmployeeAvatar from '@/components/EmployeeAvatar.vue';
import AudioVisualizer from '@/components/AudioVisualizer.vue';
import { useAudioRecorder, type AsrMeta } from '@/composables/useAudioRecorder';
import { useStreamHandler, type StreamChatMessage } from '@/composables/useStreamHandler';
import { gateway } from '@/plugins/gatewaySetup';
import { streamSubscribe, streamUnsubscribe } from '@/composables/useStreamWs';
import { useThreadsStore } from '@/stores/threads';

const route = useRoute();
const router = useRouter();
const employeeId = route.params.id as string;

const threadsStore = useThreadsStore();

const employee = ref<DigitalEmployee | null>(null);
const loading = ref(true);
const status = ref<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
const subtitle = ref('');
const volume = ref(0);
const asrMeta = ref<AsrMeta>({});
const TARGET_AGENT_ID = 'app-copilot';

// ---- Session / Thread 管理 ----
const sessionId = ref<string | null>(null);
const threadReady = ref(false);

const { messages, isStreaming, handleStreamMessage, addUserMessage, addErrorMessage } = useStreamHandler({
  idPrefix: 'emp-chat',
  maxMessages: 200
});

function ensureSubscribed(): void {
  if (sessionId.value) {
    streamSubscribe(sessionId.value, handleStreamMessage);
  }
}

/**
 * 创建或恢复 Thread
 *
 * 查找该员工是否已有活跃的 Thread（agentId=app-copilot），有则复用，无则创建。
 */
async function initThread(): Promise<void> {
  await threadsStore.fetchThreads(TARGET_AGENT_ID);

  // 查找该员工的活跃 Thread（metadata 或 title 中包含员工信息）
  const existing = threadsStore.threads.find(
    (t) => t.agentId === TARGET_AGENT_ID && t.status === 'active' && t.runStatus !== 'error'
  );

  if (existing) {
    sessionId.value = existing.id;
    console.log(`[EmployeeChat] Reusing thread: ${existing.id}`);
  } else {
    const empName = employee.value?.name || '员工';
    const thread = await threadsStore.createThread(`${empName} 的对话`, TARGET_AGENT_ID);
    if (thread) {
      sessionId.value = thread.id;
      console.log(`[EmployeeChat] Created thread: ${thread.id}`);
    } else {
      console.error('[EmployeeChat] Failed to create thread');
      addErrorMessage('无法创建对话会话');
      return;
    }
  }

  threadReady.value = true;
  ensureSubscribed();
}

onMounted(() => {
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

const olderMessages = computed(() => {
  if (messages.value.length <= 1) return [];
  const lastAi = lastAssistantMsg.value;
  return messages.value.filter((m) => m !== lastAi).slice(-6);
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
function buildContextHint(): string {
  const parts: string[] = [];
  const meta = asrMeta.value;
  if (meta.emotion && meta.emotion !== 'NEUTRAL') {
    const emoMap: Record<string, string> = { HAPPY: '开心', SAD: '悲伤', ANGRY: '愤怒' };
    parts.push(`[用户情绪: ${emoMap[meta.emotion] || meta.emotion}]`);
  }
  if (meta.lang && meta.lang !== 'zh' && meta.lang !== 'nospeech') {
    const langMap: Record<string, string> = { en: '英语', yue: '粤语', ja: '日语', ko: '韩语' };
    parts.push(`[语言: ${langMap[meta.lang] || meta.lang}]`);
  }
  return parts.length > 0 ? parts.join(' ') + '\n' : '';
}

async function sendToLLM(text: string): Promise<void> {
  if (!text.trim()) return;

  if (!threadReady.value || !sessionId.value) {
    console.warn('[EmployeeChat] Thread not ready, cannot send');
    addErrorMessage('会话尚未就绪，请稍后再试');
    return;
  }

  status.value = 'thinking';
  subtitle.value = '';
  addUserMessage(text);

  const contextHint = buildContextHint();
  const messageToSend = contextHint ? contextHint + text : text;

  try {
    ensureSubscribed();

    const result = await gateway.request<{ sessionId: string; status: string }>('chat.send', {
      message: messageToSend,
      sessionId: sessionId.value,
      mode: 'agent',
      agentId: TARGET_AGENT_ID
    });

    console.log('[EmployeeChat] chat.send result:', result);

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
  onPartialResult: (text, meta) => {
    subtitle.value = text;
    status.value = 'listening';
    if (meta) asrMeta.value = meta;
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

// ---- 加载员工信息 + 初始化 Thread ----
onMounted(async () => {
  try {
    employee.value = await employeeApi.getEmployee(employeeId);
  } catch (error) {
    console.error('Failed to load employee:', error);
    router.replace('/employee');
    return;
  } finally {
    loading.value = false;
  }

  // 员工加载成功后初始化 Thread
  await initThread();
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

      <!-- AI 回复展示区 -->
      <div ref="messagesEl" class="response-area">
        <!-- 最新一条 AI 回复（突出显示） -->
        <div v-if="lastAssistantMsg" class="ai-response-card">
          <!-- 工具执行摘要（折叠形式） -->
          <div v-if="lastAssistantMsg.blocks?.length" class="tool-summary">
            <template v-for="(block, bIdx) in lastAssistantMsg.blocks" :key="bIdx">
              <span v-if="block.type === 'tool'" class="tool-chip">
                <span class="i-carbon-tool-box inline-block h-2.5 w-2.5" />
                <span>{{ block.tool.name }}</span>
                <span
                  v-if="block.tool.status === 'calling'"
                  class="i-carbon-renew inline-block h-2.5 w-2.5 animate-spin" />
                <span
                  v-else-if="block.tool.status === 'done'"
                  class="i-carbon-checkmark inline-block h-2.5 w-2.5 text-green-400" />
              </span>
            </template>
          </div>
          <!-- AI 文本回复 -->
          <div v-if="lastAssistantMsg.content" class="ai-text">{{ lastAssistantMsg.content }}</div>
          <!-- 错误 -->
          <div v-if="lastAssistantMsg.status === 'error' && lastAssistantMsg.error" class="ai-error">
            <span class="i-carbon-warning-alt inline-block h-3 w-3" />
            {{ lastAssistantMsg.error }}
          </div>
        </div>

        <!-- 思考中动画 -->
        <div v-else-if="status === 'thinking'" class="thinking-indicator">
          <span class="thinking-dot" /><span class="thinking-dot" /><span class="thinking-dot" />
        </div>

        <!-- 对话历史（较旧的消息，半透明） -->
        <div v-if="olderMessages.length" class="history-area">
          <div v-for="msg in olderMessages" :key="msg.id" class="history-msg" :class="msg.role">
            <span v-if="msg.role === 'user'" class="history-user">{{ msg.content }}</span>
            <span v-else class="history-ai">{{ msg.content }}</span>
          </div>
        </div>
      </div>

      <!-- 底部：字幕 + 麦克风 -->
      <div class="bottom-zone">
        <!-- 实时字幕（用户说话时） -->
        <div v-if="subtitle && status === 'listening'" class="live-subtitle">
          <span
            v-if="asrMeta.emotion && asrMeta.emotion !== 'NEUTRAL'"
            class="asr-tag emotion-tag"
            :class="{
              happy: asrMeta.emotion === 'HAPPY',
              sad: asrMeta.emotion === 'SAD',
              angry: asrMeta.emotion === 'ANGRY'
            }">
            {{ { HAPPY: '😊', SAD: '😢', ANGRY: '😠' }[asrMeta.emotion] || '🎭' }}
          </span>
          <span v-if="asrMeta.lang && asrMeta.lang !== 'zh' && asrMeta.lang !== 'nospeech'" class="asr-tag lang-tag">
            {{ { en: 'EN', yue: '粤', ja: '日', ko: '韩' }[asrMeta.lang] || asrMeta.lang }}
          </span>
          {{ subtitle }}
        </div>

        <!-- 麦克风控制 -->
        <div class="mic-wrapper">
          <div class="mic-visualizer-bg" :class="{ active: status === 'listening' }">
            <AudioVisualizer :volume="volume" :is-active="status === 'listening'" color="rgba(239, 68, 68, 0.6)" />
          </div>
          <div class="mic-ring" :class="{ active: status === 'listening' }" />
          <button
            class="mic-btn-main"
            :class="{ active: status === 'listening', disabled: !threadReady }"
            :disabled="!threadReady || status === 'thinking'"
            :style="status === 'listening' ? { transform: `scale(${1 + volume / 400})` } : {}"
            @click="toggleMic">
            <span v-if="status !== 'listening'" class="i-carbon-microphone h-6 w-6" />
            <span v-else class="i-carbon-stop-filled h-6 w-6" />
          </button>
          <span v-if="!threadReady" class="mic-hint">会话准备中...</span>
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

/* ---- AI 回复展示区 ---- */
.response-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 24px 12px;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 10px;
}

.response-area::-webkit-scrollbar {
  width: 3px;
}

.response-area::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}

/* 最新 AI 回复卡片 */
.ai-response-card {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 14px 18px;
  max-width: 90%;
  animation: fadeUp 0.3s ease-out;
}

.tool-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}

.tool-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.45);
  font-size: 10px;
}

.ai-text {
  color: rgba(255, 255, 255, 0.88);
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-error {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.15);
  color: rgba(252, 165, 165, 0.8);
  font-size: 11px;
  margin-top: 6px;
}

/* 思考中指示器 */
.thinking-indicator {
  display: flex;
  justify-content: center;
  gap: 6px;
  padding: 12px 0;
}

.thinking-dot {
  width: 8px;
  height: 8px;
  background: rgba(99, 102, 241, 0.5);
  border-radius: 50%;
  animation: dotBounce 1.4s ease-in-out infinite;
}

.thinking-dot:nth-child(2) {
  animation-delay: 0.2s;
}

.thinking-dot:nth-child(3) {
  animation-delay: 0.4s;
}

/* 对话历史（半透明、紧凑） */
.history-area {
  display: flex;
  flex-direction: column;
  gap: 4px;
  opacity: 0.45;
}

.history-msg {
  font-size: 11px;
  line-height: 1.4;
}

.history-user {
  display: inline-block;
  margin-left: auto;
  text-align: right;
  color: rgba(165, 180, 252, 0.7);
  max-width: 70%;
}

.history-ai {
  display: inline-block;
  color: rgba(255, 255, 255, 0.6);
  max-width: 80%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 底部区域 ---- */
.bottom-zone {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 12px 20px 24px;
  pointer-events: auto;
}

.live-subtitle {
  display: flex;
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

.asr-tag {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 4px;
  flex-shrink: 0;
}

.emotion-tag {
  font-size: 14px;
}

.lang-tag {
  background: rgba(59, 130, 246, 0.3);
  color: rgba(147, 197, 253, 0.9);
  font-weight: 600;
  letter-spacing: 0.5px;
}

.mic-wrapper {
  position: relative;
  width: 88px;
  height: 88px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
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
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background 0.3s,
    transform 0.1s,
    opacity 0.2s;
  z-index: 10;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.mic-btn-main:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
}

.mic-btn-main.active {
  background: #ef4444;
  box-shadow: 0 4px 24px rgba(239, 68, 68, 0.4);
  border-color: rgba(239, 68, 68, 0.5);
}

.mic-btn-main.disabled,
.mic-btn-main:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.mic-ring {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 80px;
  height: 80px;
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

.mic-hint {
  position: absolute;
  bottom: -20px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  white-space: nowrap;
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
