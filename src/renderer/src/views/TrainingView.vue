<template>
  <div class="training-view">
    <!-- 顶栏 -->
    <header class="header">
      <div class="header-left">
        <div class="header-icon">
          <span class="i-carbon-machine-learning-model inline-block h-4 w-4" />
        </div>
        <h1 class="header-title">智能体训练</h1>
        <span v-if="totalCount > 0" class="header-count">
          {{ totalCount }}
        </span>
      </div>
      <div class="header-right">
        <button class="create-btn" @click="showCreateDialog = true">
          <span class="i-carbon-add inline-block h-3.5 w-3.5" />
          <span>创建训练</span>
        </button>
      </div>
    </header>

    <!-- 内容区域 -->
    <div class="content">
      <!-- 统计卡片 -->
      <div class="stats-grid">
        <div class="stat-card info">
          <div class="stat-header">
            <span class="stat-label">运行中</span>
            <span class="i-carbon-in-progress inline-block h-5 w-5 stat-icon" />
          </div>
          <div class="stat-value">{{ runningCount }}</div>
        </div>

        <div class="stat-card success">
          <div class="stat-header">
            <span class="stat-label">已完成</span>
            <span class="i-carbon-checkmark-outline inline-block h-5 w-5 stat-icon" />
          </div>
          <div class="stat-value">{{ completedCount }}</div>
        </div>

        <div class="stat-card warning">
          <div class="stat-header">
            <span class="stat-label">已暂停</span>
            <span class="i-carbon-pause-outline inline-block h-5 w-5 stat-icon" />
          </div>
          <div class="stat-value">{{ pausedCount }}</div>
        </div>

        <div class="stat-card primary">
          <div class="stat-header">
            <span class="stat-label">总计</span>
            <span class="i-carbon-machine-learning-model inline-block h-5 w-5 stat-icon" />
          </div>
          <div class="stat-value">{{ totalCount }}</div>
        </div>
      </div>

      <!-- 训练列表 -->
      <div class="training-list-container">
        <div class="list-header">
          <h2 class="list-title">训练列表</h2>
          <div class="filter-tabs">
            <button
              v-for="status in ['all', 'running', 'completed', 'paused'] as const"
              :key="status"
              :class="['filter-tab', { active: filterStatus === status }]"
              @click="filterStatus = status as 'all' | TrainingStatus">
              {{
                status === 'all'
                  ? '全部'
                  : status === 'running'
                    ? '运行中'
                    : status === 'completed'
                      ? '已完成'
                      : '已暂停'
              }}
            </button>
          </div>
        </div>

        <div v-if="loading" class="empty-state">
          <div class="empty-spinner">
            <span class="i-carbon-renew inline-block h-5 w-5 animate-spin" />
          </div>
          <p class="empty-label">加载中...</p>
        </div>

        <div v-else-if="filteredSessions.length === 0" class="empty-state">
          <div class="empty-visual">
            <div class="empty-circle">
              <span class="i-carbon-machine-learning-model inline-block h-7 w-7" />
            </div>
            <div class="empty-orbit" />
          </div>
          <p class="empty-heading">暂无训练记录</p>
          <p class="empty-sub">创建训练任务，通过系统化训练持续提升智能体能力</p>
          <button class="primary-btn mt-5" @click="showCreateDialog = true">
            <span class="i-carbon-add inline-block h-3.5 w-3.5" />
            开始训练
          </button>
        </div>

        <div v-else class="session-list">
          <div
            v-for="session in filteredSessions"
            :key="session.id"
            class="session-card"
            @click="handleSessionClick(session.id)">
            <div class="session-header">
              <div class="session-title-area">
                <span class="session-name">{{ session.goal.name }}</span>
                <span :class="['status-badge', getStatusType(session.status)]">
                  {{ getStatusLabel(session.status) }}
                </span>
                <span class="session-agent-id">{{ session.agentId }}</span>
              </div>
              <!-- 操作按钮 -->
              <div class="session-actions" @click.stop>
                <button
                  v-if="session.status === 'running'"
                  class="action-icon"
                  title="暂停"
                  @click="handlePause(session.id)">
                  <span class="i-carbon-pause-outline inline-block h-3.5 w-3.5" />
                </button>
                <button
                  v-if="session.status === 'paused'"
                  class="action-icon"
                  title="恢复"
                  @click="handleResume(session.id)">
                  <span class="i-carbon-play-outline inline-block h-3.5 w-3.5" />
                </button>
                <button
                  v-if="session.status === 'running' || session.status === 'paused'"
                  class="action-icon"
                  title="停止"
                  @click="handleStop(session.id)">
                  <span class="i-carbon-stop-outline inline-block h-3.5 w-3.5" />
                </button>
                <button
                  v-if="session.status === 'completed' || session.status === 'failed'"
                  class="action-icon danger"
                  title="删除"
                  @click="handleDelete(session.id)">
                  <span class="i-carbon-trash-can inline-block h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <!-- 进度信息 -->
            <div class="session-progress">
              <div class="progress-text">
                <span>{{ session.progress.completedRounds }}/{{ session.progress.totalRounds }} 轮</span>
                <span v-if="session.progress.avgScore">· 平均 {{ session.progress.avgScore.toFixed(1) }}分</span>
                <span v-if="session.progress.passedRounds"
                  >· 达标 {{ session.progress.passedRounds }}/{{ session.progress.completedRounds }}</span
                >
              </div>
              <div class="progress-bar-track">
                <div
                  :class="['progress-bar-fill', session.status === 'completed' ? 'success' : 'info']"
                  :style="{
                    width: `${(session.progress.completedRounds / session.progress.totalRounds) * 100}%`
                  }"></div>
              </div>
            </div>

            <!-- 时间信息 -->
            <div class="session-time">
              开始: {{ formatTime(session.startTime) }}
              <span v-if="session.endTime">· 完成: {{ formatTime(session.endTime) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 创建训练对话框 -->
    <CreateTrainingDialog v-if="showCreateDialog" @close="showCreateDialog = false" @created="handleTrainingCreated" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { gateway } from '@/plugins/gatewaySetup';
import * as trainingApi from '@/api/training';
import type { TrainingSession, TrainingStatus } from '@shared/types/training';
import CreateTrainingDialog from '@/components/training/CreateTrainingDialog.vue';

const router = useRouter();

// 状态
const loading = ref(false);
const sessions = ref<TrainingSession[]>([]);
const showCreateDialog = ref(false);
const filterStatus = ref<'all' | TrainingStatus>('all');

// 统计数据
const runningCount = computed(() => sessions.value.filter((s) => s.status === 'running').length);
const completedCount = computed(() => sessions.value.filter((s) => s.status === 'completed').length);
const pausedCount = computed(() => sessions.value.filter((s) => s.status === 'paused').length);
const totalCount = computed(() => sessions.value.length);

// 过滤后的会话列表
const filteredSessions = computed(() => {
  if (filterStatus.value === 'all') {
    return sessions.value;
  }
  return sessions.value.filter((s) => s.status === filterStatus.value);
});

// 加载训练列表
async function loadSessions(): Promise<void> {
  loading.value = true;
  try {
    sessions.value = await trainingApi.getTrainingSessions();
  } catch (err) {
    console.error('加载训练列表失败:', err);
  } finally {
    loading.value = false;
  }
}

// 点击训练会话
function handleSessionClick(sessionId: string): void {
  router.push(`/training/${sessionId}`);
}

// 暂停训练
async function handlePause(sessionId: string): Promise<void> {
  try {
    await trainingApi.pauseTraining(sessionId);
    await loadSessions();
  } catch (err) {
    console.error('暂停训练失败:', err);
    alert(`暂停失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// 恢复训练
async function handleResume(sessionId: string): Promise<void> {
  try {
    await trainingApi.resumeTraining(sessionId);
    await loadSessions();
  } catch (err) {
    console.error('恢复训练失败:', err);
    alert(`恢复失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// 停止训练
async function handleStop(sessionId: string): Promise<void> {
  if (!confirm('确定要停止此训练吗？')) return;

  try {
    await trainingApi.stopTraining(sessionId);
    await loadSessions();
  } catch (err) {
    console.error('停止训练失败:', err);
    alert(`停止失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// 删除训练
async function handleDelete(sessionId: string): Promise<void> {
  if (!confirm('确定要删除此训练记录吗？')) return;

  try {
    await trainingApi.deleteTraining(sessionId);
    await loadSessions();
  } catch (err) {
    console.error('删除训练失败:', err);
    alert(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// 训练创建成功
function handleTrainingCreated(session: TrainingSession): void {
  showCreateDialog.value = false;
  loadSessions();
  router.push(`/training/${session.id}`);
}

// 状态类型
function getStatusType(status: TrainingStatus): string {
  switch (status) {
    case 'running':
      return 'info';
    case 'completed':
      return 'success';
    case 'paused':
      return 'warning';
    case 'failed':
      return 'error';
    default:
      return 'default';
  }
}

function getStatusLabel(status: TrainingStatus): string {
  const labels: Record<TrainingStatus, string> = {
    pending: '等待中',
    running: '运行中',
    paused: '已暂停',
    completed: '已完成',
    failed: '失败'
  };
  return labels[status] || status;
}

// 格式化时间
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN');
}

// WebSocket 事件监听
onMounted(() => {
  loadSessions();

  // 监听进度更新
  gateway.on('training.progress', (data: unknown) => {
    const eventData = data as {
      sessionId: string;
      status: string;
      currentRound: number;
      currentScore?: number;
      avgScore?: number;
      passedRounds: number;
    };
    const index = sessions.value.findIndex((s) => s.id === eventData.sessionId);
    if (index !== -1) {
      sessions.value[index].status = eventData.status as TrainingStatus;
      sessions.value[index].progress = {
        ...sessions.value[index].progress,
        currentRound: eventData.currentRound,
        currentScore: eventData.currentScore,
        avgScore: eventData.avgScore,
        completedRounds: eventData.currentRound,
        passedRounds: eventData.passedRounds
      };
    }
  });

  // 监听训练完成
  gateway.on('training.completed', () => {
    loadSessions();
  });
});

// 清理事件监听（Gateway客户端自动管理）
</script>

<style scoped>
/* ====== 根容器 ====== */

.training-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

/* ====== 顶栏 ====== */

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 32px;
  border-bottom: 1px solid hsl(var(--border) / 0.5);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary));
}

.header-title {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: hsl(var(--foreground));
}

.header-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  min-width: 20px;
  padding: 0 6px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.create-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
  border: none;
  cursor: pointer;
  transition: all 0.12s ease;
}

.create-btn:hover {
  background: hsl(var(--primary-hover));
}

/* ====== 内容区域 ====== */

.content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
}

/* ====== 统计卡片 ====== */

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  padding: 20px;
  border-radius: 10px;
  border: 1px solid;
  background: hsl(var(--surface));
}

.stat-card.info {
  border-color: hsl(var(--info) / 0.2);
  background: hsl(var(--info) / 0.05);
}

.stat-card.success {
  border-color: hsl(var(--success) / 0.2);
  background: hsl(var(--success) / 0.05);
}

.stat-card.warning {
  border-color: hsl(var(--warning) / 0.2);
  background: hsl(var(--warning) / 0.05);
}

.stat-card.primary {
  border-color: hsl(var(--primary) / 0.2);
  background: hsl(var(--primary) / 0.05);
}

.stat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.stat-label {
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--text-secondary));
}

.stat-icon {
  opacity: 0.6;
}

.stat-card.info .stat-icon {
  color: hsl(var(--info));
}

.stat-card.success .stat-icon {
  color: hsl(var(--success));
}

.stat-card.warning .stat-icon {
  color: hsl(var(--warning));
}

.stat-card.primary .stat-icon {
  color: hsl(var(--primary));
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: hsl(var(--foreground));
}

/* ====== 训练列表容器 ====== */

.training-list-container {
  background: hsl(var(--surface));
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 12px;
  overflow: hidden;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid hsl(var(--border) / 0.5);
}

.list-title {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.filter-tabs {
  display: flex;
  gap: 6px;
}

.filter-tab {
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--text-secondary));
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.12s ease;
}

.filter-tab:hover {
  background: hsl(var(--foreground) / 0.04);
}

.filter-tab.active {
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
}

/* ====== 空状态 ====== */

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: hsl(var(--text-muted));
}

.empty-spinner {
  color: hsl(var(--text-muted) / 0.4);
}

.empty-label {
  margin-top: 8px;
  font-size: 13px;
}

.empty-visual {
  position: relative;
  width: 80px;
  height: 80px;
  margin-bottom: 20px;
}

.empty-circle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: hsl(var(--foreground) / 0.03);
  display: flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--foreground) / 0.15);
}

.empty-orbit {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: 2px solid hsl(var(--foreground) / 0.06);
  border-radius: 50%;
  border-top-color: hsl(var(--primary) / 0.3);
  animation: orbit 3s linear infinite;
}

@keyframes orbit {
  to {
    transform: rotate(360deg);
  }
}

.empty-heading {
  font-size: 15px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 6px;
}

.empty-sub {
  font-size: 12px;
  color: hsl(var(--text-secondary));
  max-width: 400px;
  text-align: center;
}

.primary-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
  border: none;
  cursor: pointer;
  transition: all 0.12s ease;
}

.primary-btn:hover {
  background: hsl(var(--primary-hover));
}

/* ====== 会话列表 ====== */

.session-list {
  display: flex;
  flex-direction: column;
}

.session-card {
  padding: 16px 20px;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  cursor: pointer;
  transition: background 0.12s ease;
}

.session-card:last-child {
  border-bottom: none;
}

.session-card:hover {
  background: hsl(var(--foreground) / 0.02);
}

.session-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}

.session-title-area {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.session-name {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.status-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.status-badge.info {
  background: hsl(var(--info) / 0.1);
  color: hsl(var(--info));
}

.status-badge.success {
  background: hsl(var(--success) / 0.1);
  color: hsl(var(--success));
}

.status-badge.warning {
  background: hsl(var(--warning) / 0.1);
  color: hsl(var(--warning));
}

.status-badge.error {
  background: hsl(var(--error) / 0.1);
  color: hsl(var(--error));
}

.status-badge.default {
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
}

.session-agent-id {
  font-size: 11px;
  color: hsl(var(--text-muted));
}

.session-actions {
  display: flex;
  gap: 4px;
}

.action-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  color: hsl(var(--text-secondary));
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.12s ease;
}

.action-icon:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground));
}

.action-icon.danger {
  color: hsl(var(--error) / 0.7);
}

.action-icon.danger:hover {
  background: hsl(var(--error) / 0.1);
  color: hsl(var(--error));
}

/* ====== 进度信息 ====== */

.session-progress {
  margin-bottom: 8px;
}

.progress-text {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: hsl(var(--text-secondary));
  margin-bottom: 6px;
}

.progress-bar-track {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: hsl(var(--border));
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-bar-fill.info {
  background: hsl(var(--info));
}

.progress-bar-fill.success {
  background: hsl(var(--success));
}

/* ====== 时间信息 ====== */

.session-time {
  font-size: 11px;
  color: hsl(var(--text-muted));
}
</style>
