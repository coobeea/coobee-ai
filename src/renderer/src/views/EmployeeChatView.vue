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

async function initThread(): Promise<void> {
  await threadsStore.fetchThreads(TARGET_AGENT_ID);

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

// ---- 对话显示：按轮次组织 ----
interface ConversationTurn {
  user: StreamChatMessage;
  assistant?: StreamChatMessage;
}

const conversationTurns = computed((): ConversationTurn[] => {
  const turns: ConversationTurn[] = [];
  const msgs = messages.value;
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role === 'user') {
      const turn: ConversationTurn = { user: msgs[i] };
      if (i + 1 < msgs.length && msgs[i + 1].role === 'assistant') {
        turn.assistant = msgs[i + 1];
      }
      turns.push(turn);
    }
  }
  return turns;
});

const latestTurn = computed(() => {
  return conversationTurns.value.length > 0 ? conversationTurns.value[conversationTurns.value.length - 1] : null;
});

const olderTurns = computed(() => {
  const all = conversationTurns.value;
  if (all.length <= 1) return [];
  return all.slice(-4, -1);
});

const chatAreaEl = ref<HTMLElement | null>(null);
function scrollToBottom(): void {
  nextTick(() => {
    if (chatAreaEl.value) {
      chatAreaEl.value.scrollTop = chatAreaEl.value.scrollHeight;
    }
  });
}

watch(
  () => messages.value.length,
  () => scrollToBottom()
);
watch(
  () => messages.value[messages.value.length - 1]?.content,
  () => scrollToBottom()
);

// ---- 工具执行摘要 ----
function getToolChips(msg: StreamChatMessage): { name: string; status: string }[] {
  return msg.blocks
    .filter((b) => b.type === 'tool')
    .map((b) => {
      if (b.type === 'tool') return { name: b.tool.name, status: b.tool.status };
      return { name: '', status: '' };
    })
    .filter((t) => t.name);
}

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
  lastPartialText = '';
  resetSentOffset();
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

// ---- 流式状态追踪 & 排队发送 ----
let pendingText = '';

watch(isStreaming, (val) => {
  if (!val) {
    status.value = 'idle';
    if (pendingText) {
      const text = pendingText;
      pendingText = '';
      sendToLLM(text);
    }
  } else {
    status.value = 'thinking';
  }
});

function trySendOrQueue(text: string): void {
  if (!text.trim()) return;
  stopRecording();
  if (isStreaming.value) {
    pendingText = pendingText ? pendingText + ' ' + text.trim() : text.trim();
    console.log('[EmployeeChat] LLM busy, queued:', pendingText);
    return;
  }
  sendToLLM(text);
}

// ---- 录音机 ----
let lastPartialText = '';

const { startRecording, stopRecording, disconnect, resetSentOffset } = useAudioRecorder({
  onPartialResult: (text, meta) => {
    subtitle.value = text;
    lastPartialText = text;
    if (!isStreaming.value) status.value = 'listening';
    if (meta) asrMeta.value = meta;
  },
  onFinalResult: (text) => {
    subtitle.value = '';
    lastPartialText = '';
    trySendOrQueue(text);
  },
  onVolumeChange: (vol) => {
    volume.value = vol;
  },
  onSilence: () => {
    if (lastPartialText.trim()) {
      const text = lastPartialText.trim();
      subtitle.value = '';
      lastPartialText = '';
      trySendOrQueue(text);
    }
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

  await initThread();
});

onUnmounted(() => {
  disconnect();
});

async function toggleMic(): Promise<void> {
  if (status.value === 'listening') {
    status.value = isStreaming.value ? 'thinking' : 'idle';
    stopRecording();
  } else if (isStreaming.value) {
    return;
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
  <div class="chat-root">
    <!-- 上半区：头像 + 状态 -->
    <div class="avatar-section">
      <div class="avatar-frame">
        <EmployeeAvatar :state="status" />
      </div>
      <!-- 员工信息 -->
      <div v-if="employee" class="emp-info">
        <span class="emp-name">{{ employee.name }}</span>
        <span class="emp-role">{{ employee.role }}</span>
      </div>
      <!-- 状态指示 -->
      <div class="state-badge" :class="status">
        <template v-if="status === 'listening'">
          <span class="dot pulse" />
          <span>聆听中</span>
        </template>
        <template v-else-if="status === 'thinking'">
          <span class="dot-think" />
          <span>思考中...</span>
        </template>
        <template v-else>
          <span class="dot-idle" />
          <span>待命</span>
        </template>
      </div>
    </div>

    <!-- 下半区：对话 + 控制 -->
    <div class="chat-section">
      <!-- 对话区域（固定高度，内部滚动） -->
      <div ref="chatAreaEl" class="chat-area">
        <!-- 历史轮次（简洁、半透明） -->
        <template v-for="(turn, idx) in olderTurns" :key="'h-' + idx">
          <div class="turn-row older">
            <div class="turn-user">{{ turn.user.content }}</div>
            <div v-if="turn.assistant?.content" class="turn-ai">{{ turn.assistant.content }}</div>
          </div>
        </template>

        <!-- 最新一轮（突出显示） -->
        <div v-if="latestTurn" class="turn-row latest">
          <div class="turn-user latest-user">{{ latestTurn.user.content }}</div>

          <!-- AI 回复 -->
          <div v-if="latestTurn.assistant" class="turn-ai-card">
            <!-- 工具执行指示器 -->
            <div v-if="getToolChips(latestTurn.assistant).length" class="tool-bar">
              <span v-for="(chip, ci) in getToolChips(latestTurn.assistant)" :key="ci" class="tool-chip">
                <span class="i-carbon-tool-box inline-block h-2.5 w-2.5" />
                {{ chip.name }}
                <span v-if="chip.status === 'calling'" class="i-carbon-renew inline-block h-2.5 w-2.5 animate-spin" />
                <span
                  v-else-if="chip.status === 'done'"
                  class="i-carbon-checkmark inline-block h-2.5 w-2.5 text-green-400" />
              </span>
            </div>
            <!-- 文本内容 -->
            <div v-if="latestTurn.assistant.content" class="ai-text">
              {{ latestTurn.assistant.content }}
            </div>
            <!-- 错误 -->
            <div v-if="latestTurn.assistant.status === 'error' && latestTurn.assistant.error" class="ai-error">
              {{ latestTurn.assistant.error }}
            </div>
          </div>

          <!-- 思考中动画（AI 还没回复时） -->
          <div v-else-if="status === 'thinking'" class="thinking-anim"> <span /><span /><span /> </div>
        </div>

        <!-- 排队中提示（安全兜底） -->
        <div v-if="pendingText && isStreaming" class="queued-hint">有新消息待发送...</div>
      </div>

      <!-- 字幕 + 麦克风 -->
      <div class="control-zone">
        <!-- 实时字幕 -->
        <div class="subtitle-row">
          <div v-if="subtitle" class="live-subtitle">
            <span v-if="asrMeta.emotion && asrMeta.emotion !== 'NEUTRAL'" class="emo-badge">
              {{ { HAPPY: '😊', SAD: '😢', ANGRY: '😠' }[asrMeta.emotion] || '' }}
            </span>
            <span v-if="asrMeta.lang && asrMeta.lang !== 'zh' && asrMeta.lang !== 'nospeech'" class="lang-badge">
              {{ { en: 'EN', yue: '粤', ja: '日', ko: '韩' }[asrMeta.lang] || asrMeta.lang }}
            </span>
            {{ subtitle }}
          </div>
        </div>

        <!-- 麦克风按钮 -->
        <div class="mic-row">
          <div class="mic-wrapper">
            <div class="mic-vis" :class="{ active: status === 'listening' }">
              <AudioVisualizer :volume="volume" :is-active="status === 'listening'" color="rgba(239, 68, 68, 0.6)" />
            </div>
            <div class="mic-ring" :class="{ active: status === 'listening' }" />
            <button
              class="mic-btn"
              :class="{ active: status === 'listening', disabled: !threadReady || isStreaming }"
              :disabled="!threadReady || (isStreaming && status !== 'listening')"
              :style="status === 'listening' ? { transform: `scale(${1 + volume / 400})` } : {}"
              @click="toggleMic">
              <span v-if="status !== 'listening'" class="i-carbon-microphone h-5 w-5" />
              <span v-else class="i-carbon-stop-filled h-5 w-5" />
            </button>
          </div>
          <span v-if="!threadReady" class="mic-hint">会话准备中...</span>
          <span v-else-if="isStreaming" class="mic-hint">AI 回复中，请稍候...</span>
        </div>
      </div>
    </div>

    <!-- 退出按钮 -->
    <button class="exit-btn" title="结束对话" @click="handleExit">
      <span class="i-carbon-close h-4 w-4" />
    </button>
  </div>
</template>

<style scoped>
.chat-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #0f1115;
  overflow: hidden;
  position: relative;
  color: #fff;
}

/* ---- 上半区：头像 ---- */
.avatar-section {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 20px 4px;
  gap: 4px;
}

.avatar-frame {
  width: 160px;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.emp-info {
  text-align: center;
}

.emp-name {
  font-size: 16px;
  font-weight: 600;
  display: block;
}

.emp-role {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.state-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.65);
}

.state-badge.listening {
  background: rgba(239, 68, 68, 0.15);
  color: rgba(252, 165, 165, 0.9);
}

.state-badge.thinking {
  background: rgba(99, 102, 241, 0.15);
  color: rgba(165, 180, 252, 0.9);
}

.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #ef4444;
}

.dot.pulse {
  animation: dotPulse 1.5s infinite;
}

.dot-think {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #818cf8;
  animation: dotPulse 1.5s infinite;
}

.dot-idle {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
}

/* ---- 下半区：对话 + 控制 ---- */
.chat-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 16px;
}

.chat-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 4px;
  justify-content: flex-end;
}

.chat-area::-webkit-scrollbar {
  width: 3px;
}

.chat-area::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
}

/* ---- 轮次显示 ---- */
.turn-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.turn-row.older {
  opacity: 0.35;
}

.turn-user {
  align-self: flex-start;
  padding: 4px 0;
  color: rgba(200, 210, 255, 0.85);
  font-size: 13px;
  line-height: 1.5;
  border-left: 2px solid rgba(99, 102, 241, 0.35);
  padding-left: 10px;
}

.turn-user.latest-user {
  color: rgba(220, 225, 255, 0.95);
  border-left-color: rgba(99, 102, 241, 0.6);
}

.turn-ai {
  align-self: flex-start;
  max-width: 85%;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.6);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.turn-ai-card {
  align-self: flex-start;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 10px 14px;
  animation: fadeIn 0.25s ease-out;
}

.tool-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}

.tool-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.4);
  font-size: 10px;
}

.ai-text {
  color: rgba(255, 255, 255, 0.88);
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-error {
  color: rgba(252, 165, 165, 0.8);
  font-size: 11px;
  margin-top: 4px;
}

/* 思考中动画 */
.thinking-anim {
  display: flex;
  gap: 5px;
  padding: 8px 0;
}

.thinking-anim span {
  width: 6px;
  height: 6px;
  background: rgba(99, 102, 241, 0.5);
  border-radius: 50%;
  animation: dotBounce 1.4s ease-in-out infinite;
}

.thinking-anim span:nth-child(2) {
  animation-delay: 0.2s;
}

.thinking-anim span:nth-child(3) {
  animation-delay: 0.4s;
}

/* 排队提示 */
.queued-hint {
  align-self: flex-start;
  font-size: 11px;
  color: rgba(253, 186, 116, 0.6);
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(251, 146, 60, 0.08);
}

/* ---- 底部控制区 ---- */
.control-zone {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 8px 0 20px;
}

.subtitle-row {
  min-height: 28px;
  display: flex;
  justify-content: center;
}

.live-subtitle {
  display: flex;
  align-items: center;
  gap: 5px;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
  padding: 4px 14px;
  border-radius: 8px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.05);
  max-width: 80%;
  animation: fadeIn 0.15s ease-out;
}

.emo-badge {
  font-size: 14px;
}

.lang-badge {
  font-size: 10px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(59, 130, 246, 0.25);
  color: rgba(147, 197, 253, 0.9);
  font-weight: 600;
}

.mic-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.mic-wrapper {
  position: relative;
  width: 72px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mic-vis {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.mic-vis.active {
  opacity: 1;
}

.mic-btn {
  position: relative;
  width: 48px;
  height: 48px;
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
  box-shadow: 0 3px 16px rgba(0, 0, 0, 0.3);
}

.mic-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
}

.mic-btn.active {
  background: #ef4444;
  box-shadow: 0 3px 20px rgba(239, 68, 68, 0.4);
  border-color: rgba(239, 68, 68, 0.5);
}

.mic-btn.disabled,
.mic-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.mic-ring {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 68px;
  height: 68px;
  border-radius: 50%;
  border: 1px solid rgba(239, 68, 68, 0.15);
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
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
}

/* ---- 退出按钮 ---- */
.exit-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  border: none;
  color: rgba(255, 255, 255, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 100;
  transition: all 0.2s;
}

.exit-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

/* ---- 动画 ---- */
@keyframes dotPulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(6px);
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
