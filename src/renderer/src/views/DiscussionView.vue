<template>
  <div class="flex h-full flex-col bg-background">
    <!-- 顶部工具栏 -->
    <div class="flex items-center justify-between border-b border-border bg-card px-6 py-4">
      <div class="flex items-center gap-3">
        <span class="i-carbon-forum inline-block h-6 w-6 text-primary"></span>
        <div>
          <h1 class="text-lg font-semibold text-foreground">智能体讨论室</h1>
          <p class="text-xs text-muted-foreground">多智能体协作讨论</p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button
          class="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          @click="openCreateDialog">
          <span class="i-carbon-add inline-block h-4 w-4"></span>
          创建讨论
        </button>
      </div>
    </div>

    <!-- 主内容区 -->
    <div class="flex flex-1 overflow-hidden">
      <!-- 左侧：讨论列表 -->
      <div class="w-80 border-r border-border bg-card overflow-y-auto">
        <div class="p-4 space-y-2">
          <div
            v-for="discussion in discussions"
            :key="discussion.id"
            class="rounded-lg border border-border bg-background p-3 cursor-pointer hover:bg-muted transition-colors"
            :class="{ 'ring-2 ring-primary': selectedDiscussion?.id === discussion.id }"
            @click="selectDiscussion(discussion)">
            <h3 class="font-medium text-sm text-foreground line-clamp-1">
              {{ discussion.topic }}
            </h3>
            <div class="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{{ discussion.participants.length }} 位参与者</span>
              <span
                class="rounded-full px-2 py-0.5"
                :class="{
                  'bg-green-500/10 text-green-500': discussion.status === 'active',
                  'bg-yellow-500/10 text-yellow-500': discussion.status === 'paused',
                  'bg-gray-500/10 text-gray-500': discussion.status === 'completed'
                }">
                {{ statusText(discussion.status) }}
              </span>
            </div>
          </div>

          <div v-if="discussions.length === 0" class="text-center py-8 text-muted-foreground text-sm">
            暂无讨论记录
          </div>
        </div>
      </div>

      <!-- 右侧：讨论详情 -->
      <div v-if="selectedDiscussion" class="flex-1 flex flex-col overflow-hidden">
        <!-- 讨论主题和状态 -->
        <div class="border-b border-border bg-card px-6 py-4">
          <h2 class="text-base font-semibold text-foreground">{{ selectedDiscussion.topic }}</h2>
          <div class="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            <span>共识度: {{ (selectedDiscussion.consensusLevel || 0) * 100 }}%</span>
            <span>消息: {{ selectedDiscussion.messages.length }}</span>
            <span>当前发言: {{ currentSpeakerName }}</span>
          </div>
        </div>

        <!-- 消息流 -->
        <div class="flex-1 overflow-y-auto p-6 space-y-4">
          <div v-for="message in selectedDiscussion.messages" :key="message.id" class="flex gap-3">
            <div
              class="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-medium">
              {{ getAgentInitials(message.agentId) }}
            </div>
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-sm font-medium text-foreground">{{ getAgentName(message.agentId) }}</span>
                <span class="text-xs text-muted-foreground">{{ formatTime(message.timestamp) }}</span>
                <span
                  v-if="message.type !== 'statement'"
                  class="text-xs px-2 py-0.5 rounded-full"
                  :class="{
                    'bg-blue-500/10 text-blue-500': message.type === 'question',
                    'bg-green-500/10 text-green-500': message.type === 'agreement',
                    'bg-red-500/10 text-red-500': message.type === 'objection'
                  }">
                  {{ messageTypeText(message.type) }}
                </span>
              </div>
              <p class="text-sm text-foreground whitespace-pre-wrap">{{ message.content }}</p>
            </div>
          </div>

          <div v-if="selectedDiscussion.messages.length === 0" class="text-center py-12">
            <p class="text-muted-foreground mb-4">讨论尚未开始</p>
            <button
              v-if="selectedDiscussion.status === 'active'"
              class="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
              @click="startDiscussion">
              <span class="i-carbon-play inline-block h-5 w-5"></span>
              开始讨论
            </button>
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div class="border-t border-border bg-card px-6 py-4">
          <div class="flex items-center gap-3">
            <button
              v-if="selectedDiscussion.status === 'active' && selectedDiscussion.messages.length > 0"
              class="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm hover:bg-muted/80 transition-colors"
              @click="pauseDiscussion">
              <span class="i-carbon-pause inline-block h-4 w-4"></span>
              暂停
            </button>
            <button
              v-if="selectedDiscussion.status === 'paused'"
              class="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
              @click="resumeDiscussion">
              <span class="i-carbon-play inline-block h-4 w-4"></span>
              继续
            </button>
            <button
              v-if="selectedDiscussion.status !== 'completed'"
              class="flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm text-destructive-foreground hover:bg-destructive/90 transition-colors"
              @click="endDiscussion">
              <span class="i-carbon-checkmark inline-block h-4 w-4"></span>
              结束讨论
            </button>
          </div>
        </div>
      </div>

      <!-- 无选中状态 -->
      <div v-else class="flex-1 flex items-center justify-center text-muted-foreground">
        <div class="text-center">
          <span class="i-carbon-forum inline-block h-16 w-16 mb-4 opacity-20"></span>
          <p>选择或创建一个讨论</p>
        </div>
      </div>
    </div>

    <!-- 创建讨论对话框 -->
    <Transition name="dialog">
      <div v-if="showCreateDialog" class="dialog-overlay" @click="showCreateDialog = false">
        <div class="dialog-content" @click.stop>
          <div class="dialog-header">
            <h2 class="text-lg font-semibold text-foreground">创建讨论室</h2>
            <button class="dialog-close" @click="showCreateDialog = false">
              <span class="i-carbon-close inline-block h-5 w-5"></span>
            </button>
          </div>

          <div class="dialog-body">
            <div class="form-group">
              <label class="form-label">讨论主题</label>
              <input v-model="newDiscussion.topic" type="text" class="form-input" placeholder="输入讨论主题..." />
            </div>

            <div class="form-group">
              <div class="flex items-center justify-between mb-2">
                <label class="form-label">参与者（至少2位）</label>
                <button class="text-xs text-primary hover:underline" @click="addParticipant"> + 添加参与者 </button>
              </div>

              <div class="space-y-2">
                <div v-for="(participant, index) in newDiscussion.participants" :key="index" class="participant-row">
                  <select v-model="participant.agentId" class="form-input flex-1" @change="onAgentSelected(index)">
                    <option value="">-- 选择 Agent --</option>
                    <option v-for="agent in availableAgents" :key="agent.id" :value="agent.id">
                      {{ agent.name }}
                    </option>
                  </select>
                  <input v-model="participant.role" type="text" class="form-input flex-1" placeholder="角色（可选）" />
                  <button
                    v-if="newDiscussion.participants.length > 2"
                    class="remove-btn"
                    @click="removeParticipant(index)">
                    <span class="i-carbon-close inline-block h-4 w-4"></span>
                  </button>
                </div>
              </div>
            </div>

            <div v-if="error" class="error-message">
              {{ error }}
            </div>
          </div>

          <div class="dialog-footer">
            <button class="btn-secondary" @click="showCreateDialog = false"> 取消 </button>
            <button class="btn-primary" :disabled="loading" @click="submitCreateDiscussion">
              {{ loading ? '创建中...' : '创建' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import type { DiscussionSession, DiscussionParticipant } from '@shared/types/discussion';
import * as discussionApi from '@/api/discussion';
import { useAgentsStore } from '@/stores/agents';

const agentsStore = useAgentsStore();

const discussions = ref<DiscussionSession[]>([]);
const selectedDiscussion = ref<DiscussionSession | null>(null);
const showCreateDialog = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);

// 创建对话框表单
const newDiscussion = ref({
  topic: '',
  participants: [] as Array<{ agentId: string; name: string; role: string }>
});

// 可选的 Agent 列表（显示所有 Agent）
const availableAgents = computed(() => agentsStore.agents);

const currentSpeakerName = computed(() => {
  if (!selectedDiscussion.value?.currentSpeaker) return '无';
  const participant = selectedDiscussion.value.participants.find(
    (p) => p.agentId === selectedDiscussion.value?.currentSpeaker
  );
  return participant?.name || selectedDiscussion.value.currentSpeaker;
});

function statusText(status: string): string {
  const map: Record<string, string> = {
    active: '进行中',
    paused: '已暂停',
    completed: '已完成',
    archived: '已归档'
  };
  return map[status] || status;
}

function messageTypeText(type: string): string {
  const map: Record<string, string> = {
    question: '提问',
    answer: '回答',
    objection: '反对',
    agreement: '同意',
    summary: '总结'
  };
  return map[type] || type;
}

function getAgentInitials(agentId: string): string {
  const words = agentId.split('-');
  return words
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getAgentName(agentId: string): string {
  if (agentId === 'system') return '系统';
  const participant = selectedDiscussion.value?.participants.find((p) => p.agentId === agentId);
  return participant?.name || agentId;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

async function loadDiscussions(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    discussions.value = await discussionApi.listDiscussions();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    discussions.value = [];
  } finally {
    loading.value = false;
  }
}

function selectDiscussion(discussion: DiscussionSession): void {
  selectedDiscussion.value = discussion;
}

function openCreateDialog(): void {
  showCreateDialog.value = true;
  newDiscussion.value = {
    topic: '',
    participants: [
      { agentId: '', name: '', role: '' },
      { agentId: '', name: '', role: '' }
    ]
  };
}

function addParticipant(): void {
  newDiscussion.value.participants.push({
    agentId: '',
    name: '',
    role: ''
  });
}

function onAgentSelected(index: number): void {
  const participant = newDiscussion.value.participants[index];
  if (participant.agentId) {
    const agent = availableAgents.value.find((a) => a.id === participant.agentId);
    if (agent) {
      participant.name = agent.name;
    }
  }
}

function removeParticipant(index: number): void {
  newDiscussion.value.participants.splice(index, 1);
}

async function submitCreateDiscussion(): Promise<void> {
  if (!newDiscussion.value.topic.trim()) {
    error.value = '请输入讨论主题';
    return;
  }

  if (newDiscussion.value.participants.length < 2) {
    error.value = '至少需要2位参与者';
    return;
  }

  // 验证所有参与者都选择了 Agent
  const emptyParticipants = newDiscussion.value.participants.filter((p) => !p.agentId);
  if (emptyParticipants.length > 0) {
    error.value = '请为所有参与者选择 Agent';
    return;
  }

  loading.value = true;
  error.value = null;

  try {
    const participants: DiscussionParticipant[] = newDiscussion.value.participants.map((p) => ({
      agentId: p.agentId,
      name: p.name || availableAgents.value.find((a) => a.id === p.agentId)?.name || p.agentId,
      role: p.role || 'participant',
      active: true
    }));

    const session = await discussionApi.createDiscussion({
      topic: newDiscussion.value.topic,
      participants,
      turnStrategy: 'round-robin',
      consensusThreshold: 0.7,
      maxRounds: 20
    });

    discussions.value.unshift(session);
    selectedDiscussion.value = session;
    showCreateDialog.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function startDiscussion(): Promise<void> {
  if (!selectedDiscussion.value) return;

  loading.value = true;
  error.value = null;

  try {
    const updated = await discussionApi.startDiscussion(selectedDiscussion.value.id);
    selectedDiscussion.value = updated;
    const index = discussions.value.findIndex((d) => d.id === updated.id);
    if (index >= 0) discussions.value[index] = updated;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function pauseDiscussion(): Promise<void> {
  if (!selectedDiscussion.value) return;

  try {
    const updated = await discussionApi.pauseDiscussion(selectedDiscussion.value.id);
    selectedDiscussion.value = updated;
    const index = discussions.value.findIndex((d) => d.id === updated.id);
    if (index >= 0) discussions.value[index] = updated;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function resumeDiscussion(): Promise<void> {
  if (!selectedDiscussion.value) return;

  try {
    const updated = await discussionApi.resumeDiscussion(selectedDiscussion.value.id);
    selectedDiscussion.value = updated;
    const index = discussions.value.findIndex((d) => d.id === updated.id);
    if (index >= 0) discussions.value[index] = updated;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function endDiscussion(): Promise<void> {
  if (!selectedDiscussion.value) return;

  try {
    const updated = await discussionApi.endDiscussion(selectedDiscussion.value.id);
    selectedDiscussion.value = updated;
    const index = discussions.value.findIndex((d) => d.id === updated.id);
    if (index >= 0) discussions.value[index] = updated;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

onMounted(async () => {
  await agentsStore.fetchAgents();
  await loadDiscussions();
});
</script>

<style scoped>
/* 对话框样式 */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.dialog-content {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid hsl(var(--border));
}

.dialog-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  color: hsl(var(--muted-foreground));
  transition: all 0.15s ease;
}

.dialog-close:hover {
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--foreground));
}

.dialog-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.dialog-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 16px 24px;
  border-top: 1px solid hsl(var(--border));
}

.form-group {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--foreground));
  margin-bottom: 8px;
}

.form-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  font-size: 13px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  transition: all 0.15s ease;
}

.form-input:focus {
  outline: none;
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.1);
}

.participant-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.remove-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  color: hsl(var(--destructive));
  transition: all 0.15s ease;
}

.remove-btn:hover {
  background: hsl(var(--destructive) / 0.1);
}

.error-message {
  padding: 12px;
  border-radius: 6px;
  background: hsl(var(--destructive) / 0.1);
  color: hsl(var(--destructive));
  font-size: 13px;
}

.btn-primary,
.btn-secondary {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.btn-primary {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

.btn-primary:hover:not(:disabled) {
  background: hsl(var(--primary) / 0.9);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}

.btn-secondary:hover {
  background: hsl(var(--muted) / 0.8);
}

/* 对话框动画 */
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s ease;
}

.dialog-enter-active .dialog-content,
.dialog-leave-active .dialog-content {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

.dialog-enter-from .dialog-content,
.dialog-leave-to .dialog-content {
  transform: scale(0.95);
  opacity: 0;
}
</style>
