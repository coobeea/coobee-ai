<template>
  <div class="flex h-full flex-col bg-background">
    <!-- 顶部标题栏 -->
    <div class="flex items-center justify-between border-b border-border bg-card px-6 py-4">
      <div class="flex items-center gap-3">
        <span class="i-carbon-group inline-block h-6 w-6 text-primary"></span>
        <div>
          <h1 class="text-lg font-semibold text-foreground">专家小组会诊</h1>
          <p class="text-xs text-muted-foreground">多专家并行咨询与意见整合</p>
        </div>
      </div>

      <button
        class="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        @click="showCreateDialog = true">
        <span class="i-carbon-add inline-block h-4 w-4"></span>
        发起会诊
      </button>
    </div>

    <!-- 主内容区 -->
    <div class="flex flex-1 overflow-hidden">
      <!-- 左侧：会诊列表 -->
      <div class="w-80 border-r border-border bg-card overflow-y-auto">
        <div class="p-4 space-y-2">
          <div
            v-for="session in sessions"
            :key="session.id"
            class="rounded-lg border border-border bg-background p-3 cursor-pointer hover:bg-muted transition-colors"
            :class="{ 'ring-2 ring-primary': selectedSession?.id === session.id }"
            @click="selectSession(session)">
            <h3 class="font-medium text-sm text-foreground line-clamp-2">
              {{ session.question }}
            </h3>
            <div class="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{{ session.experts.length }} 位专家</span>
              <span
                class="rounded-full px-2 py-0.5"
                :class="{
                  'bg-blue-500/10 text-blue-500': session.status === 'consulting',
                  'bg-green-500/10 text-green-500': session.status === 'completed',
                  'bg-gray-500/10 text-gray-500': session.status === 'pending'
                }">
                {{ statusText(session.status) }}
              </span>
            </div>
          </div>

          <div v-if="sessions.length === 0" class="text-center py-8 text-muted-foreground text-sm">
            暂无会诊记录
          </div>
        </div>
      </div>

      <!-- 右侧：会诊详情 -->
      <div v-if="selectedSession" class="flex-1 flex flex-col overflow-hidden">
        <!-- 问题描述 -->
        <div class="border-b border-border bg-card px-6 py-4">
          <h2 class="text-base font-semibold text-foreground mb-2">会诊问题</h2>
          <p class="text-sm text-muted-foreground whitespace-pre-wrap">{{ selectedSession.question }}</p>
        </div>

        <!-- 专家意见 -->
        <div class="flex-1 overflow-y-auto p-6 space-y-4">
          <div v-for="opinion in selectedSession.opinions" :key="opinion.agentId" class="rounded-lg border border-border bg-card p-4">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <div
                  class="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-medium">
                  {{ getInitials(opinion.roleName) }}
                </div>
                <div>
                  <div class="text-sm font-medium text-foreground">{{ opinion.roleName }}</div>
                  <div class="text-xs text-muted-foreground">置信度: {{ (opinion.confidence * 100).toFixed(0) }}%</div>
                </div>
              </div>
              <span
                class="text-xs px-2 py-1 rounded-full"
                :class="{
                  'bg-green-500/10 text-green-500': opinion.type === 'approval',
                  'bg-blue-500/10 text-blue-500': opinion.type === 'suggestion',
                  'bg-yellow-500/10 text-yellow-500': opinion.type === 'warning',
                  'bg-red-500/10 text-red-500': opinion.type === 'objection'
                }">
                {{ opinionTypeText(opinion.type) }}
              </span>
            </div>
            <p class="text-sm text-foreground whitespace-pre-wrap">{{ opinion.content }}</p>
          </div>

          <!-- 综合结论 -->
          <div v-if="selectedSession.conclusion" class="rounded-lg border-2 border-primary/30 bg-primary/5 p-4">
            <h3 class="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <span class="i-carbon-checkmark-filled inline-block h-4 w-4 text-primary"></span>
              综合结论
            </h3>
            <div class="text-sm text-foreground whitespace-pre-wrap">{{ selectedSession.conclusion }}</div>
          </div>
        </div>
      </div>

      <!-- 无选中状态 -->
      <div v-else class="flex-1 flex items-center justify-center text-muted-foreground">
        <div class="text-center">
          <span class="i-carbon-group inline-block h-16 w-16 mb-4 opacity-20"></span>
          <p>选择一个会诊或发起新的会诊</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { ConsultationSession } from '@shared/types/consultation';

const sessions = ref<ConsultationSession[]>([]);
const selectedSession = ref<ConsultationSession | null>(null);
const showCreateDialog = ref(false);

function statusText(status: string): string {
  const map: Record<string, string> = {
    pending: '待开始',
    consulting: '咨询中',
    completed: '已完成',
    failed: '失败'
  };
  return map[status] || status;
}

function opinionTypeText(type: string): string {
  const map: Record<string, string> = {
    analysis: '分析',
    suggestion: '建议',
    warning: '警告',
    approval: '赞成',
    objection: '反对'
  };
  return map[type] || type;
}

function getInitials(name: string): string {
  return name
    .split('')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function selectSession(session: ConsultationSession): void {
  selectedSession.value = session;
}

async function loadSessions(): Promise<void> {
  sessions.value = [];
}

onMounted(() => {
  loadSessions();
});
</script>
