<template>
  <div class="training-detail h-full flex flex-col bg-white dark:bg-gray-900">
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <i class="i-carbon-circle-dash text-4xl animate-spin text-gray-400"></i>
        <div class="mt-4 text-gray-600 dark:text-gray-400">加载训练详情...</div>
      </div>
    </div>

    <div v-else-if="!session" class="flex-1 flex items-center justify-center">
      <div class="text-center text-gray-500">
        <i class="i-carbon-warning text-4xl"></i>
        <div class="mt-4">训练会话不存在</div>
        <button class="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg" @click="router.back()"> 返回 </button>
      </div>
    </div>

    <template v-else>
      <!-- 头部 -->
      <div class="p-6 border-b border-gray-200 dark:border-gray-700">
        <div class="flex items-center gap-3 mb-4">
          <button class="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors" @click="router.back()">
            <i class="i-carbon-arrow-left text-xl"></i>
          </button>
          <div class="flex-1">
            <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ session.goal.name }}</h1>
            <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
              智能体: {{ session.agentId }} · 训练策略: {{ getStrategyLabel(session.strategy) }}
            </p>
          </div>
          <span :class="['px-3 py-1 rounded text-sm font-medium', getStatusClass(session.status)]">
            {{ getStatusLabel(session.status) }}
          </span>
        </div>

        <!-- 操作按钮 -->
        <div class="flex gap-2">
          <button
            v-if="session.status === 'running'"
            class="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg flex items-center gap-2 transition-colors"
            @click="handlePause">
            <i class="i-carbon-pause-outline"></i>
            <span>暂停</span>
          </button>
          <button
            v-if="session.status === 'paused'"
            class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2 transition-colors"
            @click="handleResume">
            <i class="i-carbon-play-outline"></i>
            <span>恢复</span>
          </button>
          <button
            v-if="session.status === 'running' || session.status === 'paused'"
            class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center gap-2 transition-colors"
            @click="handleStop">
            <i class="i-carbon-stop-outline"></i>
            <span>停止</span>
          </button>
          <button
            v-if="session.status === 'completed'"
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors"
            @click="handleContinueTraining">
            <i class="i-carbon-renew"></i>
            <span>继续训练</span>
          </button>
          <button
            v-if="session.results.length > 0"
            class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg flex items-center gap-2 transition-colors"
            @click="handleShowWeakness">
            <i class="i-carbon-analytics"></i>
            <span>弱点分析</span>
          </button>
        </div>
      </div>

      <!-- 内容区域 -->
      <div class="flex-1 overflow-y-auto p-6 space-y-6">
        <!-- 进度卡片 -->
        <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 class="font-semibold text-gray-900 dark:text-white mb-4">训练进度</h3>

          <!-- 进度条 -->
          <div class="mb-4">
            <div class="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
              <span>{{ session.progress.completedRounds }}/{{ session.progress.totalRounds }} 轮</span>
              <span>{{ progressPercentage }}%</span>
            </div>
            <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
              <div
                :class="[
                  'h-3 rounded-full transition-all',
                  session.status === 'completed' ? 'bg-green-600' : 'bg-blue-600'
                ]"
                :style="{ width: `${progressPercentage}%` }"></div>
            </div>
          </div>

          <!-- 统计数据 -->
          <div class="grid grid-cols-4 gap-4">
            <div class="text-center">
              <div class="text-2xl font-bold text-gray-900 dark:text-white">
                {{ session.progress.currentScore?.toFixed(0) || '-' }}
              </div>
              <div class="text-xs text-gray-600 dark:text-gray-400 mt-1">当前得分</div>
            </div>
            <div class="text-center">
              <div class="text-2xl font-bold text-gray-900 dark:text-white">
                {{ session.progress.avgScore?.toFixed(1) || '-' }}
              </div>
              <div class="text-xs text-gray-600 dark:text-gray-400 mt-1">平均得分</div>
            </div>
            <div class="text-center">
              <div class="text-2xl font-bold text-gray-900 dark:text-white">
                {{ session.progress.passedRounds }}
              </div>
              <div class="text-xs text-gray-600 dark:text-gray-400 mt-1">达标轮次</div>
            </div>
            <div class="text-center">
              <div class="text-2xl font-bold text-gray-900 dark:text-white"> {{ passRate }}% </div>
              <div class="text-xs text-gray-600 dark:text-gray-400 mt-1">达标率</div>
            </div>
          </div>
        </div>

        <!-- 最近轮次 -->
        <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 class="font-semibold text-gray-900 dark:text-white mb-4">最近 10 轮</h3>

          <div v-if="recentResults.length === 0" class="text-center text-gray-500 py-8"> 暂无训练记录 </div>

          <div v-else class="space-y-2">
            <div
              v-for="result in recentResults"
              :key="result.round"
              class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <div class="flex items-center gap-3">
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300 w-16">
                  第 {{ result.round }} 轮
                </span>
                <span
                  :class="[
                    'px-2 py-0.5 rounded text-xs',
                    result.evaluation.passed
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  ]">
                  {{ result.evaluation.score }}分
                </span>
                <span class="text-xs text-gray-500 dark:text-gray-400"> 难度 {{ result.taskDifficulty }} </span>
                <span v-if="result.usedCoachAdvice" class="text-xs text-purple-600 dark:text-purple-400">
                  · 使用了教练建议
                </span>
              </div>
              <button
                class="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                @click="showResultDetail(result)">
                查看详情
              </button>
            </div>
          </div>
        </div>

        <!-- 维度分析（如果有数据） -->
        <div
          v-if="dimensionStats.length > 0"
          class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 class="font-semibold text-gray-900 dark:text-white mb-4">维度表现</h3>
          <div class="space-y-3">
            <div v-for="dim in dimensionStats" :key="dim.name">
              <div class="flex items-center justify-between text-sm mb-1">
                <span class="text-gray-700 dark:text-gray-300">{{ dim.name }}</span>
                <span class="font-medium text-gray-900 dark:text-white">{{ dim.avgScore.toFixed(1) }}分</span>
              </div>
              <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  :class="[
                    'h-2 rounded-full',
                    dim.avgScore >= 80 ? 'bg-green-600' : dim.avgScore >= 70 ? 'bg-yellow-600' : 'bg-red-600'
                  ]"
                  :style="{ width: `${dim.avgScore}%` }"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 训练可视化图表 (Echarts) -->
      <div v-if="session && session.results.length > 0" class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6 px-6 pb-6">
        <!-- 训练进度曲线 -->
        <div class="rounded-lg border border-gray-200 bg-white p-6">
          <TrainingProgressChart :results="session.results" />
        </div>

        <!-- 维度雷达图 -->
        <div class="rounded-lg border border-gray-200 bg-white p-6">
          <DimensionRadarChart :results="session.results" />
        </div>
      </div>
    </template>

    <!-- 弱点分析对话框 -->
    <div
      v-if="showWeaknessDialog"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      @click.self="showWeaknessDialog = false">
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] overflow-y-auto">
        <div class="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 class="text-xl font-bold text-gray-900 dark:text-white">弱点分析</h2>
          <button
            class="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            @click="showWeaknessDialog = false">
            <i class="i-carbon-close text-gray-600 dark:text-gray-400"></i>
          </button>
        </div>

        <div v-if="loadingWeakness" class="p-12 text-center">
          <i class="i-carbon-circle-dash text-4xl animate-spin text-gray-400"></i>
          <div class="mt-4 text-gray-600 dark:text-gray-400">分析中...</div>
        </div>

        <div v-else-if="weakness" class="p-6 space-y-6">
          <!-- 总体统计 -->
          <div class="grid grid-cols-3 gap-4">
            <div class="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
              <div class="text-sm text-gray-600 dark:text-gray-400">分析轮次</div>
              <div class="text-2xl font-bold text-gray-900 dark:text-white mt-1">{{ weakness.analyzedRounds }}</div>
            </div>
            <div class="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
              <div class="text-sm text-gray-600 dark:text-gray-400">整体通过率</div>
              <div class="text-2xl font-bold text-gray-900 dark:text-white mt-1"
                >{{ (weakness.overallPassRate * 100).toFixed(1) }}%</div
              >
            </div>
            <div class="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
              <div class="text-sm text-gray-600 dark:text-gray-400">弱点维度</div>
              <div class="text-2xl font-bold text-gray-900 dark:text-white mt-1">{{
                weakness.weakDimensions.length
              }}</div>
            </div>
          </div>

          <!-- 弱点维度详情 -->
          <div v-if="weakness.weakDimensions.length > 0">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">弱点维度（按失败率降序）</h3>
            <div class="space-y-3">
              <div
                v-for="dim in weakness.weakDimensions"
                :key="dim.dimension"
                class="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <div class="flex items-center justify-between mb-2">
                  <span class="font-medium text-gray-900 dark:text-white">{{ dim.dimension }}</span>
                  <span class="text-sm text-red-600 dark:text-red-400 font-medium">
                    失败率: {{ (dim.failureRate * 100).toFixed(1) }}%
                  </span>
                </div>
                <div class="grid grid-cols-3 gap-4 text-sm text-gray-600 dark:text-gray-400">
                  <div>
                    平均分: <span class="font-medium text-gray-900 dark:text-white">{{ dim.avgScore.toFixed(1) }}</span>
                  </div>
                  <div>
                    失败次数: <span class="font-medium text-gray-900 dark:text-white">{{ dim.failureCount }}</span>
                  </div>
                  <div>
                    总次数: <span class="font-medium text-gray-900 dark:text-white">{{ dim.totalCount }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="text-center text-gray-500 py-8">
            <i class="i-carbon-checkmark-filled text-4xl text-green-500"></i>
            <div class="mt-4">没有发现明显弱点维度，表现良好！</div>
          </div>

          <!-- 建议 -->
          <div
            v-if="weakness.weakDimensions.length > 0"
            class="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800">
            <div class="flex items-start gap-3">
              <i class="i-carbon-idea text-yellow-600 text-xl flex-shrink-0"></i>
              <div class="flex-1">
                <h4 class="font-medium text-gray-900 dark:text-white mb-2">改进建议</h4>
                <ul class="text-sm text-gray-600 dark:text-gray-400 space-y-1">
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
  // TODO: 实现详情弹窗
  alert('详情功能开发中');
}

// 状态样式
function getStatusClass(status: TrainingStatus): string {
  switch (status) {
    case 'running':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'completed':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    case 'paused':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
    case 'failed':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400';
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

  // 监听训练完成
  gateway.on('training.completed', (data: unknown) => {
    const eventData = data as { sessionId: string };
    if (eventData.sessionId === sessionId.value) {
      loadSession();
    }
  });
});

// 清理事件监听（Gateway客户端自动管理）
</script>
