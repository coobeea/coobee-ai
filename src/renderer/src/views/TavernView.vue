<script setup lang="ts">
/**
 * TavernView — 酒馆任务系统
 *
 * 任务发布平台，支持：
 * - 任务列表展示（块状/列表视图）
 * - 任务发布（描述 + 文件 + 金额）
 * - 任务详情查看
 *
 * 存储：文件系统（每个任务一个文件夹）
 */

import { ref } from 'vue';
import TaskList from '@/components/tavern/TaskList.vue';
import TaskForm from '@/components/tavern/TaskForm.vue';

export interface TaskResult {
  textResult: string;
  fileResults: string[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  amount: number;
  files: string[];
  status: 'pending' | 'accepted' | 'in-progress' | 'completed' | 'cancelled';
  result?: TaskResult;
  createdAt: string;
  updatedAt: string;
}

const view = ref<'list' | 'create' | 'detail'>('list');
const selectedTaskId = ref<string | null>(null);

function handleCreateTask(): void {
  view.value = 'create';
  selectedTaskId.value = null;
}

function handleViewTask(taskId: string): void {
  view.value = 'detail';
  selectedTaskId.value = taskId;
}

function handleBackToList(): void {
  view.value = 'list';
  selectedTaskId.value = null;
}

function handleTaskCreated(): void {
  view.value = 'list';
}
</script>

<template>
  <div class="tavern-view">
    <!-- 顶栏 -->
    <header class="header">
      <div class="header-left">
        <button v-if="view !== 'list'" class="back-btn" @click="handleBackToList">
          <span class="i-carbon-chevron-left inline-block h-4 w-4" />
        </button>
        <div class="header-icon">
          <span class="i-carbon-task-star inline-block h-4 w-4" />
        </div>
        <h1 class="header-title">
          {{ view === 'list' ? '酒馆任务' : view === 'create' ? '发布任务' : '任务详情' }}
        </h1>
      </div>
    </header>

    <!-- 内容区域 -->
    <div class="content">
      <!-- 任务列表 -->
      <TaskList v-if="view === 'list'" @view-task="handleViewTask" @create-task="handleCreateTask" />

      <!-- 任务发布表单 -->
      <TaskForm v-else-if="view === 'create'" @cancel="handleBackToList" @success="handleTaskCreated" />

      <!-- 任务详情 -->
      <TaskForm
        v-else-if="view === 'detail' && selectedTaskId"
        :task-id="selectedTaskId"
        readonly
        @cancel="handleBackToList" />
    </div>
  </div>
</template>

<style scoped>
.tavern-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: hsl(var(--background));
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 20px;
  flex-shrink: 0;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.6);
  backdrop-filter: blur(12px);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  color: hsl(var(--muted-foreground));
  transition: all 0.15s ease;
}

.back-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground) / 0.7);
}

.header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.header-title {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  letter-spacing: -0.01em;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}
</style>
