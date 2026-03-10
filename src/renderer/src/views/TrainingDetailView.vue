<template>
  <div class="training-detail">
    <div v-if="loading" class="empty-state">
      <div class="empty-spinner">
        <span class="i-carbon-renew inline-block h-5 w-5 animate-spin" />
      </div>
      <p class="empty-label">加载训练详情...</p>
    </div>

    <div v-else-if="!session" class="empty-state">
      <div class="empty-visual">
        <div class="empty-circle">
          <span class="i-carbon-warning inline-block h-7 w-7" />
        </div>
      </div>
      <p class="empty-heading">训练会话不存在</p>
      <button class="primary-btn mt-5" @click="router.back()">返回</button>
    </div>

    <template v-else>
      <!-- 头部 -->
      <header class="header">
        <div class="header-main">
          <button class="back-btn" @click="router.back()">
            <span class="i-carbon-arrow-left inline-block h-4 w-4" />
          </button>
          <div class="header-info">
            <h1 class="header-title">{{ session.goal.name }}</h1>
            <div class="header-meta">
              <span>智能体: {{ session.agentId }}</span>
              <span>·</span>
              <span>策略: {{ getStrategyLabel(session.strategy) }}</span>
            </div>
          </div>
          <span :class="['status-badge', getStatusType(session.status)]">
            {{ getStatusLabel(session.status) }}
          </span>
        </div>
        <div class="header-actions">
          <button v-if="session.status === 'running'" class="action-btn warning" @click="handlePause">
            <span class="i-carbon-pause-outline inline-block h-3.5 w-3.5" />
            <span>暂停</span>
          </button>
          <button v-if="session.status === 'paused'" class="action-btn success" @click="handleResume">
            <span class="i-carbon-play-outline inline-block h-3.5 w-3.5" />
            <span>恢复</span>
          </button>
          <button
            v-if="session.status === 'running' || session.status === 'paused'"
            class="action-btn error"
            @click="handleStop">
            <span class="i-carbon-stop-outline inline-block h-3.5 w-3.5" />
            <span>停止</span>
          </button>
          <button v-if="session.status === 'completed'" class="action-btn primary" @click="handleContinueTraining">
            <span class="i-carbon-renew inline-block h-3.5 w-3.5" />
            <span>继续训练</span>
          </button>
          <button v-if="session.results.length > 0" class="action-btn secondary" @click="handleShowWeakness">
            <span class="i-carbon-analytics inline-block h-3.5 w-3.5" />
            <span>弱点分析</span>
          </button>
        </div>
      </header>

      <!-- 内容区域 -->
      <div class="content">
        <!-- 进度卡片 -->
        <div class="info-card">
          <h3 class="card-section-title">训练进度</h3>

          <!-- 进度条 -->
          <div class="progress-section">
            <div class="progress-header">
              <span>{{ session.progress.completedRounds }}/{{ session.progress.totalRounds }} 轮</span>
              <span>{{ progressPercentage }}%</span>
            </div>
            <div class="progress-bar-track">
              <div
                :class="['progress-bar-fill', session.status === 'completed' ? 'success' : 'info']"
                :style="{ width: `${progressPercentage}%` }"></div>
            </div>
          </div>

          <!-- 统计数据 -->
          <div class="stats-row">
            <div class="stat-item">
              <div class="stat-item-value">{{ session.progress.currentScore?.toFixed(0) || '-' }}</div>
              <div class="stat-item-label">当前得分</div>
            </div>
            <div class="stat-item">
              <div class="stat-item-value">{{ session.progress.avgScore?.toFixed(1) || '-' }}</div>
              <div class="stat-item-label">平均得分</div>
            </div>
            <div class="stat-item">
              <div class="stat-item-value">{{ session.progress.passedRounds }}</div>
              <div class="stat-item-label">达标轮次</div>
            </div>
            <div class="stat-item">
              <div class="stat-item-value">{{ passRate }}%</div>
              <div class="stat-item-label">达标率</div>
            </div>
          </div>
        </div>

        <!-- 最近轮次 -->
        <div class="info-card">
          <h3 class="card-section-title">最近 10 轮</h3>

          <div v-if="recentResults.length === 0" class="empty-hint">暂无训练记录</div>

          <div v-else class="rounds-list">
            <div v-for="result in recentResults" :key="result.round" class="round-item">
              <div class="round-info">
                <span class="round-number">第 {{ result.round }} 轮</span>
                <span :class="['round-score', result.evaluation.passed ? 'passed' : 'failed']">
                  {{ result.evaluation.score }}分
                </span>
                <span class="round-difficulty">难度 {{ result.taskDifficulty }}</span>
                <span v-if="result.usedCoachAdvice" class="round-coached">· 使用了教练建议</span>
              </div>
              <button class="round-detail-btn" @click="showResultDetail(result)">查看详情</button>
            </div>
          </div>
        </div>

        <!-- 维度分析 -->
        <div v-if="dimensionStats.length > 0" class="info-card">
          <h3 class="card-section-title">维度表现</h3>
          <div class="dimensions-list">
            <div v-for="dim in dimensionStats" :key="dim.name" class="dimension-item">
              <div class="dimension-header">
                <span class="dimension-name">{{ dim.name }}</span>
                <span class="dimension-score">{{ dim.avgScore.toFixed(1) }}分</span>
              </div>
              <div class="dimension-bar-track">
                <div
                  :class="[
                    'dimension-bar-fill',
                    dim.avgScore >= 80 ? 'excellent' : dim.avgScore >= 70 ? 'good' : 'poor'
                  ]"
                  :style="{ width: `${dim.avgScore}%` }"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 图表区域 -->
        <div v-if="session.results.length > 0" class="charts-grid">
          <div class="chart-card">
            <TrainingProgressChart :results="session.results" />
          </div>
          <div class="chart-card">
            <DimensionRadarChart :results="session.results" />
          </div>
        </div>
      </div>
    </template>

    <!-- 弱点分析对话框 -->
    <div v-if="showWeaknessDialog" class="dialog-overlay" @click.self="showWeaknessDialog = false">
      <div class="dialog weakness-dialog">
        <div class="dialog-header">
          <span class="i-carbon-analytics inline-block h-4 w-4" />
          <span>弱点分析</span>
          <button class="close-btn" @click="showWeaknessDialog = false">
            <span class="i-carbon-close inline-block h-4 w-4" />
          </button>
        </div>

        <div v-if="loadingWeakness" class="dialog-loading">
          <span class="i-carbon-renew inline-block h-5 w-5 animate-spin" />
          <p>分析中...</p>
        </div>

        <div v-else-if="weakness" class="dialog-body">
          <!-- 总体统计 -->
          <div class="weakness-stats">
            <div class="weakness-stat-item info">
              <div class="weakness-stat-label">分析轮次</div>
              <div class="weakness-stat-value">{{ weakness.analyzedRounds }}</div>
            </div>
            <div class="weakness-stat-item success">
              <div class="weakness-stat-label">整体通过率</div>
              <div class="weakness-stat-value">{{ (weakness.overallPassRate * 100).toFixed(1) }}%</div>
            </div>
            <div class="weakness-stat-item error">
              <div class="weakness-stat-label">弱点维度</div>
              <div class="weakness-stat-value">{{ weakness.weakDimensions.length }}</div>
            </div>
          </div>

          <!-- 弱点维度详情 -->
          <div v-if="weakness.weakDimensions.length > 0">
            <h3 class="weakness-section-title">弱点维度（按失败率降序）</h3>
            <div class="weakness-list">
              <div v-for="dim in weakness.weakDimensions" :key="dim.dimension" class="weakness-item">
                <div class="weakness-item-header">
                  <span class="weakness-item-name">{{ dim.dimension }}</span>
                  <span class="weakness-item-rate">失败率: {{ (dim.failureRate * 100).toFixed(1) }}%</span>
                </div>
                <div class="weakness-item-stats">
                  <div
                    >平均分: <span>{{ dim.avgScore.toFixed(1) }}</span></div
                  >
                  <div
                    >失败次数: <span>{{ dim.failureCount }}</span></div
                  >
                  <div
                    >总次数: <span>{{ dim.totalCount }}</span></div
                  >
                </div>
              </div>
            </div>
          </div>

          <div v-else class="weakness-empty">
            <span class="i-carbon-checkmark-filled inline-block h-10 w-10 success-icon" />
            <p>没有发现明显弱点维度，表现良好！</p>
          </div>

          <!-- 建议 -->
          <div v-if="weakness.weakDimensions.length > 0" class="weakness-suggestion">
            <span class="i-carbon-idea inline-block h-5 w-5 suggestion-icon" />
            <div class="suggestion-content">
              <h4>改进建议</h4>
              <ul>
                <li>• 使用"继续训练"功能针对弱点维度进行额外训练</li>
                <li>• 系统会自动生成针对 {{ weakness.weakestDimension?.dimension }} 等弱点的训练任务</li>
                <li>• 建议额外训练 100-500 轮以显著提升弱点维度表现</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { gateway } from '@/plugins/gatewaySetup';
import * as trainingApi from '@/api/training';
import type { TrainingSession, TrainingStatus, TrainingRoundResult } from '@shared/types/training';
import type { WeaknessAnalysis } from '@/api/training';
import TrainingProgressChart from '@/components/training/TrainingProgressChart.vue';
import DimensionRadarChart from '@/components/training/DimensionRadarChart.vue';

const route = useRoute();
const router = useRouter();

const sessionId = computed(() => route.params.id as string);
const loading = ref(false);
const session = ref<TrainingSession | null>(null);
const showWeaknessDialog = ref(false);
const weakness = ref<WeaknessAnalysis | null>(null);
const loadingWeakness = ref(false);

// 计算属性
const progressPercentage = computed(() => {
  if (!session.value) return 0;
  return Math.floor((session.value.progress.completedRounds / session.value.progress.totalRounds) * 100);
});

const passRate = computed(() => {
  if (!session.value || session.value.progress.completedRounds === 0) return 0;
  return Math.floor((session.value.progress.passedRounds / session.value.progress.completedRounds) * 100);
});

const recentResults = computed(() => {
  if (!session.value) return [];
  return session.value.results.slice(-10).reverse();
});

const dimensionStats = computed(() => {
  if (!session.value || session.value.results.length === 0) return [];

  const dimensionScores: Record<string, number[]> = {};

  for (const result of session.value.results) {
    for (const [dim, score] of Object.entries(result.evaluation.dimensions || {})) {
      if (!dimensionScores[dim]) dimensionScores[dim] = [];
      dimensionScores[dim].push(score);
    }
  }

  return Object.entries(dimensionScores).map(([name, scores]) => ({
    name,
    avgScore: scores.reduce((a, b) => a + b, 0) / scores.length
  }));
});

// 加载训练详情
async function loadSession(): Promise<void> {
  loading.value = true;
  try {
    session.value = await trainingApi.getTrainingSession(sessionId.value);
  } catch (err) {
    console.error('加载训练详情失败:', err);
  } finally {
    loading.value = false;
  }
}

// 暂停训练
async function handlePause(): Promise<void> {
  try {
    await trainingApi.pauseTraining(sessionId.value);
    await loadSession();
  } catch (err) {
    console.error('暂停训练失败:', err);
    alert(`暂停失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// 恢复训练
async function handleResume(): Promise<void> {
  try {
    await trainingApi.resumeTraining(sessionId.value);
    await loadSession();
  } catch (err) {
    console.error('恢复训练失败:', err);
    alert(`恢复失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// 停止训练
async function handleStop(): Promise<void> {
  if (!confirm('确定要停止此训练吗？')) return;

  try {
    await trainingApi.stopTraining(sessionId.value);
    await loadSession();
  } catch (err) {
    console.error('停止训练失败:', err);
    alert(`停止失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// 继续训练
async function handleContinueTraining(): Promise<void> {
  router.push({
    path: '/training',
    query: { continueFrom: sessionId.value }
  });
}

// 显示弱点分析
async function handleShowWeakness(): Promise<void> {
  showWeaknessDialog.value = true;
  loadingWeakness.value = true;

  try {
    weakness.value = await trainingApi.getWeaknessAnalysis(sessionId.value);
  } catch (err) {
    console.error('加载弱点分析失败:', err);
  } finally {
    loadingWeakness.value = false;
  }
}

// 显示单轮详情
function showResultDetail(_result: TrainingRoundResult): void {
  alert('详情功能开发中');
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

function getStrategyLabel(strategy: string): string {
  const labels: Record<string, string> = {
    sequential: '串行',
    parallel: '并行',
    adaptive: '自适应',
    'weakness-targeted': '弱点强化'
  };
  return labels[strategy] || strategy;
}

// WebSocket 事件监听
onMounted(() => {
  loadSession();

  gateway.on('training.progress', (data: unknown) => {
    const eventData = data as {
      sessionId: string;
      status: string;
      currentRound: number;
      currentScore?: number;
      avgScore?: number;
      passedRounds: number;
    };
    if (eventData.sessionId === sessionId.value && session.value) {
      session.value.status = eventData.status as TrainingStatus;
      session.value.progress = {
        ...session.value.progress,
        currentRound: eventData.currentRound,
        currentScore: eventData.currentScore,
        avgScore: eventData.avgScore,
        completedRounds: eventData.currentRound,
        passedRounds: eventData.passedRounds
      };
    }
  });

  gateway.on('training.completed', (data: unknown) => {
    const eventData = data as { sessionId: string };
    if (eventData.sessionId === sessionId.value) {
      loadSession();
    }
  });
});
</script>

<style scoped>
/* ====== 根容器 ====== */

.training-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

/* ====== 头部 ====== */

.header {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 32px;
  border-bottom: 1px solid hsl(var(--border) / 0.5);
}

.header-main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: hsl(var(--text-secondary));
  cursor: pointer;
  transition: all 0.12s ease;
}

.back-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground));
}

.header-info {
  flex: 1;
}

.header-title {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: hsl(var(--foreground));
  margin-bottom: 4px;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: hsl(var(--text-secondary));
}

.status-badge {
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 12px;
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

.header-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.12s ease;
}

.action-btn.primary {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

.action-btn.primary:hover {
  background: hsl(var(--primary-hover));
}

.action-btn.secondary {
  background: hsl(var(--secondary));
  color: hsl(var(--secondary-foreground));
}

.action-btn.secondary:hover {
  background: hsl(var(--secondary-hover));
}

.action-btn.success {
  background: hsl(var(--success));
  color: hsl(var(--success-foreground));
}

.action-btn.success:hover {
  filter: brightness(1.1);
}

.action-btn.warning {
  background: hsl(var(--warning));
  color: hsl(var(--warning-foreground));
}

.action-btn.warning:hover {
  filter: brightness(1.1);
}

.action-btn.error {
  background: hsl(var(--error));
  color: hsl(var(--error-foreground));
}

.action-btn.error:hover {
  filter: brightness(1.1);
}

/* ====== 内容区域 ====== */

.content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.info-card {
  background: hsl(var(--surface));
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 12px;
  padding: 24px;
}

.card-section-title {
  font-size: 16px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 16px;
}

/* ====== 进度部分 ====== */

.progress-section {
  margin-bottom: 20px;
}

.progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: hsl(var(--text-secondary));
  margin-bottom: 8px;
}

.progress-bar-track {
  width: 100%;
  height: 8px;
  border-radius: 4px;
  background: hsl(var(--border));
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-bar-fill.info {
  background: hsl(var(--info));
}

.progress-bar-fill.success {
  background: hsl(var(--success));
}

/* ====== 统计行 ====== */

.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.stat-item {
  text-align: center;
}

.stat-item-value {
  font-size: 24px;
  font-weight: 700;
  color: hsl(var(--foreground));
}

.stat-item-label {
  font-size: 11px;
  color: hsl(var(--text-secondary));
  margin-top: 4px;
}

/* ====== 轮次列表 ====== */

.empty-hint {
  text-align: center;
  padding: 40px 20px;
  color: hsl(var(--text-muted));
  font-size: 13px;
}

.rounds-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.round-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-radius: 8px;
  background: hsl(var(--surface-variant));
}

.round-info {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}

.round-number {
  min-width: 60px;
  font-weight: 500;
  color: hsl(var(--foreground));
}

.round-score {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.round-score.passed {
  background: hsl(var(--success) / 0.1);
  color: hsl(var(--success));
}

.round-score.failed {
  background: hsl(var(--error) / 0.1);
  color: hsl(var(--error));
}

.round-difficulty {
  color: hsl(var(--text-muted));
}

.round-coached {
  color: hsl(var(--primary));
}

.round-detail-btn {
  font-size: 11px;
  color: hsl(var(--primary));
  background: none;
  border: none;
  cursor: pointer;
  transition: opacity 0.12s ease;
}

.round-detail-btn:hover {
  opacity: 0.8;
}

/* ====== 维度列表 ====== */

.dimensions-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dimension-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dimension-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
}

.dimension-name {
  color: hsl(var(--foreground));
  font-weight: 500;
}

.dimension-score {
  color: hsl(var(--foreground));
  font-weight: 600;
}

.dimension-bar-track {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: hsl(var(--border));
  overflow: hidden;
}

.dimension-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.dimension-bar-fill.excellent {
  background: hsl(var(--success));
}

.dimension-bar-fill.good {
  background: hsl(var(--warning));
}

.dimension-bar-fill.poor {
  background: hsl(var(--error));
}

/* ====== 图表网格 ====== */

.charts-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
}

.chart-card {
  background: hsl(var(--surface));
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 12px;
  padding: 24px;
}

/* ====== 空状态 ====== */

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
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

.empty-heading {
  font-size: 15px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 6px;
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

/* ====== 对话框 ====== */

.dialog-overlay {
  position: fixed;
  inset: 0;
  background: hsl(var(--overlay) / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.dialog {
  background: hsl(var(--surface));
  border-radius: 12px;
  box-shadow: 0 8px 32px hsl(var(--shadow) / 0.12);
  overflow: hidden;
}

.weakness-dialog {
  width: 100%;
  max-width: 800px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.dialog-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 20px 24px;
  border-bottom: 1px solid hsl(var(--border) / 0.5);
  font-size: 16px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.close-btn {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: hsl(var(--text-secondary));
  cursor: pointer;
  transition: all 0.12s ease;
}

.close-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground));
}

.dialog-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px;
  gap: 12px;
  color: hsl(var(--text-muted));
}

.dialog-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ====== 弱点分析统计 ====== */

.weakness-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.weakness-stat-item {
  padding: 16px;
  border-radius: 10px;
  border: 1px solid;
}

.weakness-stat-item.info {
  border-color: hsl(var(--info) / 0.2);
  background: hsl(var(--info) / 0.05);
}

.weakness-stat-item.success {
  border-color: hsl(var(--success) / 0.2);
  background: hsl(var(--success) / 0.05);
}

.weakness-stat-item.error {
  border-color: hsl(var(--error) / 0.2);
  background: hsl(var(--error) / 0.05);
}

.weakness-stat-label {
  font-size: 12px;
  color: hsl(var(--text-secondary));
  margin-bottom: 8px;
}

.weakness-stat-value {
  font-size: 24px;
  font-weight: 700;
  color: hsl(var(--foreground));
}

/* ====== 弱点列表 ====== */

.weakness-section-title {
  font-size: 15px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 12px;
}

.weakness-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.weakness-item {
  padding: 16px;
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 10px;
}

.weakness-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.weakness-item-name {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.weakness-item-rate {
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--error));
}

.weakness-item-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  font-size: 12px;
  color: hsl(var(--text-secondary));
}

.weakness-item-stats span {
  font-weight: 600;
  color: hsl(var(--foreground));
}

.weakness-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 12px;
  text-align: center;
}

.success-icon {
  color: hsl(var(--success));
}

.weakness-empty p {
  font-size: 13px;
  color: hsl(var(--text-secondary));
}

/* ====== 建议卡片 ====== */

.weakness-suggestion {
  display: flex;
  gap: 12px;
  padding: 16px;
  border-radius: 10px;
  background: hsl(var(--warning) / 0.08);
  border: 1px solid hsl(var(--warning) / 0.2);
}

.suggestion-icon {
  flex-shrink: 0;
  color: hsl(var(--warning));
}

.suggestion-content {
  flex: 1;
}

.suggestion-content h4 {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 8px;
}

.suggestion-content ul {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: hsl(var(--text-secondary));
}
</style>
