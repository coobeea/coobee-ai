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
          @click="createDiscussion">
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

          <div v-if="selectedDiscussion.messages.length === 0" class="text-center py-12 text-muted-foreground">
            讨论尚未开始
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div class="border-t border-border bg-card px-6 py-4">
          <div class="flex items-center gap-3">
            <button
              v-if="selectedDiscussion.status === 'active'"
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import type { DiscussionSession } from '@shared/types/discussion';

const discussions = ref<DiscussionSession[]>([]);
const selectedDiscussion = ref<DiscussionSession | null>(null);

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
  discussions.value = [];
}

function selectDiscussion(discussion: DiscussionSession): void {
  selectedDiscussion.value = discussion;
}

function createDiscussion(): void {
  console.log('TODO: Implement create discussion');
}

function pauseDiscussion(): void {
  console.log('TODO: Implement pause discussion');
}

function resumeDiscussion(): void {
  console.log('TODO: Implement resume discussion');
}

function endDiscussion(): void {
  console.log('TODO: Implement end discussion');
}

onMounted(() => {
  loadDiscussions();
});
</script>
