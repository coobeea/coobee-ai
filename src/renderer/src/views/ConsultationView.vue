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
        @click="openCreateDialog">
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

          <div v-if="sessions.length === 0" class="text-center py-8 text-muted-foreground text-sm"> 暂无会诊记录 </div>
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
          <div
            v-for="opinion in selectedSession.opinions"
            :key="opinion.agentId"
            class="rounded-lg border border-border bg-card p-4">
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

    <!-- 创建会诊对话框 -->
    <Transition name="dialog">
      <div v-if="showCreateDialog" class="dialog-overlay" @click="showCreateDialog = false">
        <div class="dialog-content" @click.stop>
          <div class="dialog-header">
            <h2 class="text-lg font-semibold text-foreground">发起专家会诊</h2>
            <button class="dialog-close" @click="showCreateDialog = false">
              <span class="i-carbon-close inline-block h-5 w-5"></span>
            </button>
          </div>

          <div class="dialog-body">
            <div class="form-group">
              <label class="form-label">会诊问题</label>
              <textarea
                v-model="newConsultation.question"
                class="form-textarea"
                rows="4"
                placeholder="请描述需要会诊的问题..." />
            </div>

            <div class="form-group">
              <div class="flex items-center justify-between mb-2">
                <label class="form-label">专家团队</label>
                <button class="text-xs text-primary hover:underline" @click="addExpert"> + 添加专家 </button>
              </div>

              <div class="space-y-2">
                <div v-for="(expert, index) in newConsultation.experts" :key="index" class="expert-row">
                  <input v-model="expert.agentId" type="text" class="form-input flex-1" placeholder="Agent ID" />
                  <input v-model="expert.roleName" type="text" class="form-input flex-1" placeholder="角色名称" />
                  <input v-model="expert.specialty" type="text" class="form-input flex-1" placeholder="专业领域" />
                  <button v-if="newConsultation.experts.length > 1" class="remove-btn" @click="removeExpert(index)">
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
            <button class="btn-primary" :disabled="loading" @click="submitCreateConsultation">
              {{ loading ? '创建中...' : '发起会诊' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { ConsultationSession } from '@shared/types/consultation';
import * as consultationApi from '@/api/consultation';

const sessions = ref<ConsultationSession[]>([]);
const selectedSession = ref<ConsultationSession | null>(null);
const showCreateDialog = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);

// 创建表单
const newConsultation = ref({
  question: '',
  experts: [] as Array<{
    agentId: string;
    roleName: string;
    specialty: string;
  }>
});

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
  return name.split('').slice(0, 2).join('').toUpperCase();
}

function selectSession(session: ConsultationSession): void {
  selectedSession.value = session;
}

async function loadSessions(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    sessions.value = await consultationApi.listConsultations();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    sessions.value = [];
  } finally {
    loading.value = false;
  }
}

function openCreateDialog(): void {
  showCreateDialog.value = true;
  newConsultation.value = {
    question: '',
    experts: [
      { agentId: 'expert-1', roleName: '技术专家', specialty: '系统架构' },
      { agentId: 'expert-2', roleName: '产品专家', specialty: '用户体验' }
    ]
  };
}

function addExpert(): void {
  const index = newConsultation.value.experts.length + 1;
  newConsultation.value.experts.push({
    agentId: `expert-${index}`,
    roleName: `专家${index}`,
    specialty: '领域专长'
  });
}

function removeExpert(index: number): void {
  newConsultation.value.experts.splice(index, 1);
}

async function submitCreateConsultation(): Promise<void> {
  if (!newConsultation.value.question.trim()) {
    error.value = '请输入会诊问题';
    return;
  }

  if (newConsultation.value.experts.length === 0) {
    error.value = '至少需要1位专家';
    return;
  }

  loading.value = true;
  error.value = null;

  try {
    const session = await consultationApi.createConsultation({
      question: newConsultation.value.question,
      experts: newConsultation.value.experts,
      aggregationStrategy: 'confidence-based'
    });

    sessions.value.unshift(session);
    selectedSession.value = session;
    showCreateDialog.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadSessions();
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
  max-width: 700px;
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

.form-input,
.form-textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  font-size: 13px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  transition: all 0.15s ease;
  font-family: inherit;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.1);
}

.form-textarea {
  resize: vertical;
  min-height: 80px;
}

.expert-row {
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
