<script setup lang="ts">
/**
 * TaskList — 任务列表组件
 *
 * 支持块状/列表视图切换，前端分页
 */

import { ref, computed, onMounted } from 'vue';
import configManager from '@/config';

interface Task {
  id: string;
  title: string;
  description: string;
  amount: number;
  files: string[];
  status: 'pending' | 'accepted' | 'in-progress' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

const props = withDefaults(
  defineProps<{
    viewMode?: 'grid' | 'list';
  }>(),
  {
    viewMode: 'grid'
  }
);

const emit = defineEmits<{
  viewTask: [taskId: string];
}>();

const tasks = ref<Task[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const currentPage = ref(1);
const pageSize = 12;

const taskCount = computed(() => tasks.value.length);

const BASE_URL = `${configManager.getBaseUrl()}/gateway/tavern`;

// 分页数据
const paginatedTasks = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  const end = start + pageSize;
  return tasks.value.slice(start, end);
});

const totalPages = computed(() => Math.ceil(tasks.value.length / pageSize));

async function fetchTasks(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch(`${BASE_URL}/tasks`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
    }
    tasks.value = (data as { tasks: Task[] }).tasks || [];
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    tasks.value = [];
  } finally {
    loading.value = false;
  }
}

function getStatusLabel(status: Task['status']): string {
  const labels = {
    pending: '待接取',
    accepted: '已接取',
    'in-progress': '进行中',
    completed: '已完成',
    cancelled: '已取消'
  };
  return labels[status];
}

function getStatusClass(status: Task['status']): string {
  const classes = {
    pending: 'status-pending',
    accepted: 'status-accepted',
    'in-progress': 'status-progress',
    completed: 'status-completed',
    cancelled: 'status-cancelled'
  };
  return classes[status];
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

function refresh(): void {
  fetchTasks();
}

defineExpose({
  taskCount,
  loading,
  refresh
});

onMounted(() => {
  fetchTasks();
});
</script>

<template>
  <div class="task-list">
    <!-- 加载中 -->
    <div v-if="loading && tasks.length === 0" class="empty-state">
      <span class="i-carbon-renew inline-block h-5 w-5 animate-spin opacity-25" />
      <p>加载中...</p>
    </div>

    <!-- 错误 -->
    <div v-else-if="error" class="error-state">
      <span class="i-carbon-warning-alt inline-block h-5 w-5" />
      <p>{{ error }}</p>
      <button class="retry-btn" @click="fetchTasks">重试</button>
    </div>

    <!-- 空状态 -->
    <div v-else-if="tasks.length === 0" class="empty-state">
      <span class="i-carbon-task inline-block h-8 w-8 opacity-[0.08]" />
      <p>暂无任务</p>
      <p class="empty-hint">发布第一个任务吧</p>
    </div>

    <!-- 任务列表 -->
    <template v-else>
      <!-- 块状视图 -->
      <div v-if="props.viewMode === 'grid'" class="task-grid">
        <div v-for="task in paginatedTasks" :key="task.id" class="task-card" @click="emit('viewTask', task.id)">
          <div class="task-header">
            <h3 class="task-title">{{ task.title }}</h3>
            <span class="task-status" :class="getStatusClass(task.status)">
              {{ getStatusLabel(task.status) }}
            </span>
          </div>
          <p class="task-description">{{ task.description }}</p>
          <div class="task-footer">
            <div class="task-amount">
              <span class="i-carbon-currency inline-block h-3.5 w-3.5" />
              <span>{{ task.amount }} 金币</span>
            </div>
            <span class="task-time">{{ formatTime(task.createdAt) }}</span>
          </div>
        </div>
      </div>

      <!-- 列表视图 -->
      <div v-else-if="props.viewMode === 'list'" class="task-list-view">
        <div v-for="task in paginatedTasks" :key="task.id" class="task-row" @click="emit('viewTask', task.id)">
          <div class="task-row-main">
            <h3 class="task-row-title">{{ task.title }}</h3>
            <p class="task-row-description">{{ task.description }}</p>
          </div>
          <div class="task-row-meta">
            <span class="task-status" :class="getStatusClass(task.status)">
              {{ getStatusLabel(task.status) }}
            </span>
            <div class="task-amount">
              <span class="i-carbon-currency inline-block h-3.5 w-3.5" />
              <span>{{ task.amount }}</span>
            </div>
            <span class="task-time">{{ formatTime(task.createdAt) }}</span>
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <div v-if="totalPages > 1" class="pagination">
        <button class="page-btn" :disabled="currentPage === 1" @click="currentPage--">
          <span class="i-carbon-chevron-left inline-block h-3.5 w-3.5" />
        </button>
        <span class="page-info">{{ currentPage }} / {{ totalPages }}</span>
        <button class="page-btn" :disabled="currentPage === totalPages" @click="currentPage++">
          <span class="i-carbon-chevron-right inline-block h-3.5 w-3.5" />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.task-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* 块状视图 */
.task-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.task-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid hsl(var(--border) / 0.35);
  background: hsl(var(--surface) / 0.6);
  cursor: pointer;
  transition: all 0.2s ease;
}

.task-card:hover {
  background: hsl(var(--surface));
  border-color: hsl(var(--border) / 0.6);
  box-shadow:
    0 2px 8px hsl(var(--shadow) / 0.06),
    0 1px 3px hsl(var(--shadow) / 0.04);
  transform: translateY(-1px);
}

.task-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.task-title {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.task-description {
  font-size: 12.5px;
  color: hsl(var(--muted-foreground) / 0.7);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.task-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid hsl(var(--border) / 0.2);
}

.task-amount {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--primary));
}

.task-time {
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.5);
}

.task-status {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 500;
  padding: 2px 7px;
  border-radius: 4px;
  line-height: 1.4;
}

.status-pending {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.status-accepted {
  background: hsl(217 91% 95%);
  color: hsl(217 91% 50%);
}

.status-progress {
  background: hsl(38 92% 95%);
  color: hsl(38 92% 45%);
}

.status-completed {
  background: hsl(142 71% 95%);
  color: hsl(142 71% 40%);
}

.status-cancelled {
  background: hsl(var(--muted) / 0.5);
  color: hsl(var(--muted-foreground));
}

/* 列表视图 */
.task-list-view {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.6);
  cursor: pointer;
  transition: all 0.15s ease;
}

.task-row:hover {
  background: hsl(var(--surface));
  border-color: hsl(var(--border) / 0.5);
}

.task-row-main {
  flex: 1;
  min-width: 0;
}

.task-row-title {
  font-size: 13.5px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-row-description {
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-row-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

/* 空状态 */
.empty-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 64px 32px;
  color: hsl(var(--muted-foreground) / 0.5);
  font-size: 13px;
  text-align: center;
}

.empty-hint {
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.4);
}

.error-state {
  color: hsl(var(--error));
}

.retry-btn {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.1);
  transition: all 0.15s ease;
}

.retry-btn:hover {
  background: hsl(var(--primary) / 0.15);
}

/* 分页 */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px 0;
}

.page-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  color: hsl(var(--foreground) / 0.6);
  background: hsl(var(--surface));
  border: 1px solid hsl(var(--border) / 0.3);
  transition: all 0.15s ease;
}

.page-btn:hover:not(:disabled) {
  background: hsl(var(--muted) / 0.3);
  border-color: hsl(var(--border) / 0.5);
}

.page-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.page-info {
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  min-width: 60px;
  text-align: center;
}
</style>
