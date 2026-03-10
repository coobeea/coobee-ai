<template>
  <div class="training-view h-full flex flex-col bg-white dark:bg-gray-900">
    <!-- 页面头部 -->
    <div class="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">智能体训练</h1>
        <p class="text-sm text-gray-600 dark:text-gray-400 mt-1"> 通过大规模、系统化的训练，持续提升智能体能力 </p>
      </div>
      <button
        class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors"
        @click="showCreateDialog = true">
        <i class="i-carbon-add text-lg"></i>
        <span>创建训练</span>
      </button>
    </div>

    <!-- 训练仪表板 -->
    <div class="p-6">
      <!-- 统计卡片 -->
      <div class="grid grid-cols-4 gap-4 mb-6">
        <div class="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm text-blue-600 dark:text-blue-400">运行中</span>
            <i class="i-carbon-in-progress text-blue-600 dark:text-blue-400 text-xl"></i>
          </div>
          <div class="text-2xl font-bold text-blue-900 dark:text-blue-100">{{ runningCount }}</div>
        </div>

        <div class="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm text-green-600 dark:text-green-400">已完成</span>
            <i class="i-carbon-checkmark-outline text-green-600 dark:text-green-400 text-xl"></i>
          </div>
          <div class="text-2xl font-bold text-green-900 dark:text-green-100">{{ completedCount }}</div>
        </div>

        <div class="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm text-yellow-600 dark:text-yellow-400">已暂停</span>
            <i class="i-carbon-pause-outline text-yellow-600 dark:text-yellow-400 text-xl"></i>
          </div>
          <div class="text-2xl font-bold text-yellow-900 dark:text-yellow-100">{{ pausedCount }}</div>
        </div>

        <div class="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm text-purple-600 dark:text-purple-400">总计</span>
            <i class="i-carbon-machine-learning-model text-purple-600 dark:text-purple-400 text-xl"></i>
          </div>
          <div class="text-2xl font-bold text-purple-900 dark:text-purple-100">{{ totalCount }}</div>
        </div>
      </div>

      <!-- 训练列表 -->
      <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 class="font-semibold text-gray-900 dark:text-white">训练列表</h2>
          <div class="flex gap-2">
            <button
              v-for="status in ['all', 'running', 'completed', 'paused'] as const"
              :key="status"
              :class="[
                'px-3 py-1 rounded text-sm transition-colors',
                filterStatus === status
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
              ]"
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

        <div v-if="loading" class="p-8 text-center text-gray-500">
          <i class="i-carbon-circle-dash text-3xl animate-spin"></i>
          <div class="mt-2">加载中...</div>
        </div>

        <div v-else-if="filteredSessions.length === 0" class="p-8 text-center text-gray-500">
          <i class="i-carbon-machine-learning-model text-4xl"></i>
          <div class="mt-2">暂无训练记录</div>
        </div>

        <div v-else class="divide-y divide-gray-200 dark:divide-gray-700">
          <div
            v-for="session in filteredSessions"
            :key="session.id"
            class="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
            @click="handleSessionClick(session.id)">
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <span class="font-medium text-gray-900 dark:text-white">
                    {{ session.goal.name }}
                  </span>
                  <span :class="['px-2 py-0.5 rounded text-xs', getStatusClass(session.status)]">
                    {{ getStatusLabel(session.status) }}
                  </span>
                  <span class="text-xs text-gray-500 dark:text-gray-400">
                    {{ session.agentId }}
                  </span>
                </div>

                <!-- 进度条 -->
                <div class="mt-2">
                  <div class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 mb-1">
                    <span>{{ session.progress.completedRounds }}/{{ session.progress.totalRounds }} 轮</span>
                    <span v-if="session.progress.avgScore">· 平均 {{ session.progress.avgScore.toFixed(1) }}分</span>
                    <span v-if="session.progress.passedRounds"
                      >· 达标 {{ session.progress.passedRounds }}/{{ session.progress.completedRounds }}</span
                    >
                  </div>
                  <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      :class="[
                        'h-2 rounded-full transition-all',
                        session.status === 'completed' ? 'bg-green-600' : 'bg-blue-600'
                      ]"
                      :style="{
                        width: `${(session.progress.completedRounds / session.progress.totalRounds) * 100}%`
                      }"></div>
                  </div>
                </div>

                <!-- 时间信息 -->
                <div class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  开始时间: {{ formatTime(session.startTime) }}
                  <span v-if="session.endTime">· 完成时间: {{ formatTime(session.endTime) }}</span>
                </div>
              </div>

              <!-- 操作按钮 -->
              <div class="flex gap-2 ml-4" @click.stop>
                <button
                  v-if="session.status === 'running'"
                  class="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                  title="暂停"
                  @click="handlePause(session.id)">
                  <i class="i-carbon-pause-outline text-gray-600 dark:text-gray-400"></i>
                </button>
                <button
                  v-if="session.status === 'paused'"
                  class="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                  title="恢复"
                  @click="handleResume(session.id)">
                  <i class="i-carbon-play-outline text-gray-600 dark:text-gray-400"></i>
                </button>
                <button
                  v-if="session.status === 'running' || session.status === 'paused'"
                  class="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                  title="停止"
                  @click="handleStop(session.id)">
                  <i class="i-carbon-stop-outline text-gray-600 dark:text-gray-400"></i>
                </button>
                <button
                  v-if="session.status === 'completed' || session.status === 'failed'"
                  class="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                  title="删除"
                  @click="handleDelete(session.id)">
                  <i class="i-carbon-trash-can text-gray-600 dark:text-gray-400"></i>
                </button>
              </div>
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
.training-view {
  overflow-y: auto;
}
</style>
