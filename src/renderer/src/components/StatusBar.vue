<script setup lang="ts">
/**
 * StatusBar — 全局底部状态栏
 *
 * 显示：
 *   1. Worker 状态（ASR、TTS 等）
 *   2. 快捷操作：日志、设置
 *
 * 高度与侧边栏任务列表项一致（约 36px）
 */

import { computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useWorkerStore } from '@/stores/worker';

const router = useRouter();
const route = useRoute();
const workerStore = useWorkerStore();

const activeMenuId = computed(() => route.name as string);

function handleSettings(): void {
  router.push('/settings');
}

function handleLogs(): void {
  router.push('/logs');
}

/** 获取状态颜色 */
function getStatusColor(status: string): string {
  switch (status) {
    case 'ready':
      return 'bg-emerald-500';
    case 'starting':
    case 'initializing':
      return 'bg-amber-400';
    case 'error':
      return 'bg-red-400';
    default:
      return 'bg-gray-300';
  }
}

/** 获取状态标签 */
function getStatusLabel(status: string): string {
  switch (status) {
    case 'stopped':
      return '未启动';
    case 'initializing':
      return '初始化';
    case 'starting':
      return '启动中';
    case 'ready':
      return '就绪';
    case 'error':
      return '错误';
    case 'stopping':
      return '停止中';
    default:
      return status;
  }
}

/** 获取 Worker 图标 */
function getWorkerIcon(name: string): string {
  switch (name) {
    case 'asr':
    case 'whisper-asr':
      return 'i-carbon-microphone';
    case 'tts':
      return 'i-carbon-volume-up';
    case 'brain':
      return 'i-carbon-catalog';
    case 'tavern':
      return 'i-carbon-task-star';
    case 'ocr':
      return 'i-carbon-image-search';
    default:
      return 'i-carbon-application';
  }
}

/** 点击状态切换 Worker 启动/停止 */
function handleWorkerClick(worker: { name: string; status: string }): void {
  if (worker.status === 'stopped' || worker.status === 'error') {
    workerStore.startWorker(worker.name);
  } else if (worker.status === 'ready') {
    workerStore.stopWorker(worker.name);
  }
}
</script>

<template>
  <div class="status-bar">
    <!-- Worker 状态列表 -->
    <div class="status-section">
      <button
        v-for="worker in workerStore.workerList"
        :key="worker.name"
        class="status-item"
        :title="`${worker.label}: ${getStatusLabel(worker.status)} (点击切换)`"
        @click="handleWorkerClick(worker)">
        <span :class="getWorkerIcon(worker.name)" class="status-icon" />
        <span class="status-label">{{ worker.label }}</span>
        <span class="status-dot" :class="getStatusColor(worker.status)" />
      </button>

      <!-- 无 Worker -->
      <div v-if="workerStore.workerList.length === 0" class="status-item-disabled">
        <span class="i-carbon-application inline-block h-3.5 w-3.5" />
        <span>无服务</span>
      </div>
    </div>

    <!-- 右侧快捷按钮 -->
    <div class="actions-section">
      <button class="action-btn" :class="{ active: activeMenuId === 'logs' }" title="日志" @click="handleLogs">
        <span class="i-carbon-report inline-block h-3.5 w-3.5" />
        <span>日志</span>
      </button>
      <button class="action-btn" :class="{ active: activeMenuId === 'settings' }" title="设置" @click="handleSettings">
        <span class="i-carbon-settings inline-block h-3.5 w-3.5" />
        <span>设置</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  flex-shrink: 0;
  padding: 0 12px;
  background: hsl(var(--surface));
  border-top: 1px solid hsl(var(--border) / 0.4);
}

/* Worker 状态区 */

.status-section {
  display: flex;
  align-items: center;
  gap: 2px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  color: hsl(var(--foreground) / 0.65);
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.status-item:hover {
  background: hsl(var(--foreground) / 0.04);
  color: hsl(var(--foreground) / 0.85);
}

.status-item-disabled {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.4);
  user-select: none;
}

.status-icon {
  display: inline-block;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  opacity: 0.7;
}

.status-label {
  font-size: 12px;
  line-height: 1;
}

.status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* 右侧操作按钮 */

.actions-section {
  display: flex;
  align-items: center;
  gap: 2px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.6);
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.action-btn:hover {
  background: hsl(var(--foreground) / 0.04);
  color: hsl(var(--foreground) / 0.8);
}

.action-btn.active {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  font-weight: 500;
}
</style>
