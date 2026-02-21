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

import { ref, computed } from 'vue';
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
const viewMode = ref<'grid' | 'list'>('grid');
const taskListRef = ref<InstanceType<typeof TaskList> | null>(null);

const taskCount = computed(() => taskListRef.value?.taskCount ?? 0);
const isLoading = computed(() => taskListRef.value?.loading ?? false);

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

function handleRefresh(): void {
  if (taskListRef.value) {
    taskListRef.value.refresh();
  }
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
        <span v-if="view === 'list'" class="task-count">共 {{ taskCount }} 个任务</span>
      </div>
      <div v-if="view === 'list'" class="header-right">
        <button
          class="view-toggle-btn"
          :class="{ active: viewMode === 'grid' }"
          title="块状视图"
          @click="viewMode = 'grid'">
          <span class="i-carbon-grid inline-block h-3.5 w-3.5" />
        </button>
        <button
          class="view-toggle-btn"
          :class="{ active: viewMode === 'list' }"
          title="列表视图"
          @click="viewMode = 'list'">
          <span class="i-carbon-list inline-block h-3.5 w-3.5" />
        </button>
        <button class="refresh-btn" title="刷新" @click="handleRefresh">
          <span class="i-carbon-renew inline-block h-3.5 w-3.5" :class="{ 'animate-spin': isLoading }" />
        </button>
        <div class="toolbar-divider"></div>
        <button class="create-btn" @click="handleCreateTask">
          <span class="i-carbon-add inline-block h-3.5 w-3.5" />
          <span>发布任务</span>
        </button>
      </div>
    </header>

    <!-- 内容区域 -->
    <div class="content">
      <!-- 任务列表 -->
      <TaskList v-if="view === 'list'" ref="taskListRef" :view-mode="viewMode" @view-task="handleViewTask" />

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

.header-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.task-count {
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.7);
  margin-left: 12px;
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: hsl(var(--border) / 0.3);
  margin: 0 8px;
}

.view-toggle-btn,
.refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: hsl(var(--muted-foreground) / 0.5);
  transition: all 0.15s ease;
}

.view-toggle-btn:hover,
.refresh-btn:hover {
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--foreground) / 0.7);
}

.view-toggle-btn.active {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.create-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.08);
  transition: all 0.15s ease;
}

.create-btn:hover {
  background: hsl(var(--primary) / 0.14);
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}
</style>
